import { env } from "cloudflare:workers";
import { authorize } from "@/lib/access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { defaultPreferences, preferenceSchema } from "@/lib/collaboration";
import {
  emptyContext,
  osSelectionRequestSchema,
  osSelectionSchema,
  type ContextState,
  type ContextView,
  type OsSelection,
} from "@/lib/flightdeck/context";
import {
  chooseContext,
  createCachedReader,
  createContextClient,
  loadContext,
  readContextConfig,
  type ContextResult,
} from "@/lib/flightdeck/context-client";
export const dynamic = "force-dynamic";

// Read-only FlightDeck OS workspace/project context. The OS credential is a
// machine credential that cannot filter per Atlas user, so lists are returned
// only to the Atlas Super Admin, the same role that administers Apps &
// connections. Import/onboard stay disconnected (see ../import, ../onboard).
const cache = new Map<
  string,
  { until: number; value?: ContextResult<unknown> }
>();
const respond = (view: ContextView, status = 200) =>
  json({ ...view, checkedAt: new Date().toISOString() }, status);

function reader(fresh: boolean) {
  const config = readContextConfig({
    url: env.ATLAS_FLIGHTDECK_URL,
    token: env.ATLAS_FLIGHTDECK_INBOUND_TOKEN,
  });
  return config
    ? createCachedReader(createContextClient(config), cache, { fresh })
    : null;
}

async function savedSelection(userId: string): Promise<OsSelection | null> {
  const row = await database()
    .prepare("SELECT data FROM atlas_preferences WHERE user_id=?")
    .bind(userId)
    .first<{ data: string }>();
  if (!row) return null;
  const parsed = osSelectionSchema
    .nullable()
    .safeParse(JSON.parse(row.data).flightdeckContext ?? null);
  return parsed.success ? parsed.data : null;
}

/** Merges only flightdeckContext into the stored preferences, with the same
 * revision guard the other preference writers use. */
async function saveSelection(userId: string, selection: OsSelection) {
  const db = database();
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db
      .prepare("SELECT data,revision FROM atlas_preferences WHERE user_id=?")
      .bind(userId)
      .first<{ data: string; revision: number }>();
    const data = preferenceSchema.parse({
      ...defaultPreferences,
      ...(row ? JSON.parse(row.data) : {}),
      flightdeckContext: selection,
    });
    const result = row
      ? await db
          .prepare(
            "UPDATE atlas_preferences SET data=?,revision=revision+1 WHERE user_id=? AND revision=?",
          )
          .bind(JSON.stringify(data), userId, row.revision)
          .run()
      : await db
          .prepare(
            "INSERT OR IGNORE INTO atlas_preferences(user_id,data,revision) VALUES (?,?,1)",
          )
          .bind(userId, JSON.stringify(data))
          .run();
    if (result.meta.changes) return true;
  }
  return false;
}

export async function GET() {
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  if (!auth.access.superAdmin) return respond(emptyContext("not_permitted"));
  const os = reader(false);
  if (!os) return respond(emptyContext("not_configured"));
  let saved: OsSelection | null;
  try {
    saved = await savedSelection(auth.access.userId);
  } catch {
    return json(
      { error: "Your saved FlightDeck context is unavailable." },
      503,
    );
  }
  return respond(await loadContext(os, saved, { superAdmin: true }));
}

const failure: Record<
  Exclude<ContextState, "ok">,
  { status: number; error: string }
> = {
  not_permitted: {
    status: 403,
    error: "Only the Atlas Super Admin can choose the FlightDeck context.",
  },
  not_configured: { status: 503, error: "FlightDeck is not configured." },
  os_unreachable: {
    status: 503,
    error: "FlightDeck is unreachable. Your selection was not changed.",
  },
  unauthorized: {
    status: 502,
    error: "FlightDeck refused Atlas's credential. Nothing was changed.",
  },
  rate_limited: {
    status: 429,
    error: "FlightDeck is busy. Try again shortly.",
  },
  workspace_not_found: {
    status: 404,
    error: "That FlightDeck workspace is not available to Atlas.",
  },
  workspace_disabled: {
    status: 409,
    error: "That FlightDeck workspace is disabled.",
  },
  invalid_response: {
    status: 502,
    error: "FlightDeck sent an unexpected response. Nothing was changed.",
  },
};
function refuse(state: Exclude<ContextState, "ok">, retryAfter?: number) {
  const { status, error } = failure[state];
  return Response.json(
    { error, state, retryAfter: retryAfter ?? null },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
      },
    },
  );
}

export async function PUT(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize("projects.read");
  if (auth.error) return auth.error;
  if (!auth.access.superAdmin) return refuse("not_permitted");
  if (!request.headers.get("content-type")?.includes("application/json"))
    return json({ error: "Send a JSON selection." }, 415);
  const raw = await request.text();
  let requested;
  try {
    requested = osSelectionRequestSchema.parse(
      raw.length > 2000 ? null : JSON.parse(raw),
    );
  } catch {
    return json({ error: "Choose a FlightDeck workspace and project." }, 400);
  }
  const os = reader(true);
  if (!os) return refuse("not_configured");
  // Re-validated against fresh OS lists. An unknown project falls back to
  // that workspace's default project; the workspace is never switched.
  const view = await chooseContext(os, requested, { superAdmin: true });
  if (view.state !== "ok")
    return refuse(view.state, view.retryAfter ?? undefined);
  if (!view.selected) return refuse("invalid_response");
  try {
    if (!(await saveSelection(auth.access.userId, view.selected)))
      return json(
        { error: "Preferences changed at the same time. Try again." },
        409,
      );
  } catch {
    return json(
      { error: "Your FlightDeck context could not be saved. Try again." },
      503,
    );
  }
  return respond(view);
}
