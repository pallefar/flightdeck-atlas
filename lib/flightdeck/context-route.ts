// The /api/flightdeck/context handlers, with their dependencies passed in so
// the tests run exactly this code over a fake OS and a local database. The
// route file wires in the real authorisation, OS reader and D1 binding.
// No Worker bindings are imported here.
import { defaultPreferences, preferenceSchema } from "../collaboration";
import { json, sameOrigin } from "../http";
import {
  emptyContext,
  osSelectionRequestSchema,
  osSelectionSchema,
  type ContextState,
  type ContextView,
  type OsSelection,
} from "./context";
import {
  chooseContext,
  loadContext,
  type ContextReader,
} from "./context-client";

export type ContextAuth =
  | { access: { userId: string; superAdmin: boolean }; error?: never }
  | { access?: never; error: Response };

/** The part of a D1 binding the preference store uses. */
export type PreferenceDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
};
export type SelectionStore = {
  load(userId: string): Promise<OsSelection | null>;
  save(userId: string, selection: OsSelection): Promise<boolean>;
};

/** The FlightDeck selection inside stored preferences JSON, or null when it
 * is absent or no longer valid. /api/workspace uses this so its preference
 * saves keep the selection: only this route changes it, after checking it
 * against the OS. */
export function keptSelection(storedData: string | null | undefined) {
  if (!storedData) return null;
  const parsed = osSelectionSchema
    .nullable()
    .safeParse(JSON.parse(storedData).flightdeckContext ?? null);
  return parsed.success ? parsed.data : null;
}

export function preferenceSelectionStore(
  database: () => PreferenceDb,
): SelectionStore {
  return {
    async load(userId) {
      const row = await database()
        .prepare("SELECT data FROM atlas_preferences WHERE user_id=?")
        .bind(userId)
        .first<{ data: string }>();
      return keptSelection(row?.data);
    },
    /** Merges only flightdeckContext into the stored preferences, with the
     * same revision guard the other preference writers use. */
    async save(userId, selection) {
      const db = database();
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await db
          .prepare(
            "SELECT data,revision FROM atlas_preferences WHERE user_id=?",
          )
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
    },
  };
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
const respond = (view: ContextView, status = 200) =>
  json({ ...view, checkedAt: new Date().toISOString() }, status);

/** Read-only FlightDeck OS workspace/project context. The OS credential is a
 * machine credential that cannot filter per Atlas user, so lists are returned
 * only to the Atlas Super Admin, the same role that administers Apps &
 * connections. The Super Admin check runs before any OS read. */
export function createContextRoute(deps: {
  authorize: () => Promise<ContextAuth>;
  /** The OS reader, or null when FlightDeck is not configured. `fresh`
   * bypasses cached lists. */
  reader: (fresh: boolean) => ContextReader | null;
  store: SelectionStore;
}) {
  async function GET() {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    if (!auth.access.superAdmin) return respond(emptyContext("not_permitted"));
    const os = deps.reader(false);
    if (!os) return respond(emptyContext("not_configured"));
    let saved: OsSelection | null;
    try {
      saved = await deps.store.load(auth.access.userId);
    } catch {
      return json(
        { error: "Your saved FlightDeck context is unavailable." },
        503,
      );
    }
    return respond(await loadContext(os, saved, { superAdmin: true }));
  }

  async function PUT(request: Request) {
    if (!sameOrigin(request))
      return json({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
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
    const os = deps.reader(true);
    if (!os) return refuse("not_configured");
    // Re-validated against fresh OS lists. An unknown project falls back to
    // that workspace's default project; the workspace is never switched.
    const view = await chooseContext(os, requested, { superAdmin: true });
    if (view.state !== "ok")
      return refuse(view.state, view.retryAfter ?? undefined);
    if (!view.selected) return refuse("invalid_response");
    try {
      if (!(await deps.store.save(auth.access.userId, view.selected)))
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

  return { GET, PUT };
}
