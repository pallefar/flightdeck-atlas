// The /api/flightdeck/crm handlers (crm-40): the FlightDeck OS CRM projection
// for ONE Atlas project, read through the OS's `read:crm` routes (OS crm-37;
// the written contract is the OS's docs/CRM-ATLAS-SYNC-CONTRACT.md).
// Dependencies are passed in so the spec runs exactly this code over a fake
// OS; the route files wire the real authorisation, link table and credential.
// No Worker bindings are imported here, and Atlas keeps no CRM table: the
// projection is read per request and only passed on.
//
// Every rule here FAILS CLOSED:
// - A request whose Origin is foreign, or whose Sec-Fetch-Site is cross-site
//   or same-site, is refused (403) before anything else runs.
// - No session, no read right on the Atlas project (projectFor), an unknown or
//   malformed id: the same 404, before the link is looked up.
// - The OS ids come ONLY from the stored atlas_project_links row. Nothing the
//   browser sends besides the Atlas project id is read.
// - The FULL stored link is checked against the current configuration before
//   any CRM request: accessState "active", the configured Atlas installation,
//   the instance id the configured OS publishes, and a workspace among the
//   credential's configured (read:context) workspaces. A mismatch answers
//   `link_mismatch` and logs its reason code for admins (no OS id, no
//   credential in the log).
// - A credential without `read:crm` makes no CRM request at all, so before an
//   OS admin grants the scope the project page is as it was.
// - The OS body is parsed with Atlas's strict copy of v1 (crm-contract.ts);
//   anything that does not parse, is for another project, or is any OS
//   refusal answers `unavailable` with a reason code and NO data.
// - Every answer is `Cache-Control: private, no-store`.
//
// ⚠ WHO SEES IT: anyone who can open the Atlas project (the contract's
// default; the card carries initials and roles, companies and the deal
// stage, never a name, channel or amount). `superAdminOnly` is the one-line
// gate the contract leaves to the owner.
import type { ContextReader, CrmClient, WhoamiRead } from "./context-client";
import {
  crmProjectionV1Schema,
  crmRevisionV1Schema,
  type CrmRevisionView,
  type CrmRouteView,
  type CrmUnavailableReason,
} from "./crm-contract";

export type CrmOs = CrmClient;
/** One atlas_project_links row, as stored. */
export type StoredLink = {
  installationId: string;
  osInstanceId: string;
  workspaceId: string;
  osProjectId: string;
  accessState: string;
};
export type CrmAuth<A> =
  | { access: A; error?: never }
  | { access?: never; error: Response };
/** What is logged on a link mismatch: codes only. */
export type CrmLogEntry = {
  event: "flightdeck.crm.link_mismatch";
  reason: "link_mismatch";
  detail:
    | "access_state"
    | "installation"
    | "instance"
    | "instance_unknown"
    | "workspace";
};

/** An Atlas project id worth looking up; anything else is not found. */
const ATLAS_PROJECT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const NO_STORE = { "Cache-Control": "private, no-store" };
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: NO_STORE });
const notFound = () => answer({ error: "Not found." }, 404);
const unavailable = (reason: CrmUnavailableReason) =>
  answer({ state: "unavailable", reason } satisfies CrmRouteView);

/** Stricter than lib/http.ts sameOrigin for this read: a same-site (other
 * subdomain) request is refused too. A request without the headers (a
 * same-origin fetch may omit Origin on GET) passes. */
function sameOriginRead(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

/** True only when the whoami body lists `read:crm`. */
function hasReadCrm(read: WhoamiRead) {
  if (read.state !== "ok") return false;
  const scopes =
    read.body && typeof read.body === "object"
      ? (read.body as { scopes?: unknown }).scopes
      : undefined;
  return Array.isArray(scopes) && scopes.includes("read:crm");
}

export function createCrmRoute<A extends { superAdmin: boolean }>(deps: {
  authorize: () => Promise<CrmAuth<A>>;
  /** The Atlas project when this viewer may read it, else null. */
  projectFor: (access: A, atlasProjectId: string) => Promise<unknown>;
  /** Every stored link row of this Atlas project (any installation). */
  links: (atlasProjectId: string) => Promise<StoredLink[]>;
  /** The configured Atlas installation, or null when invalid. */
  installationId: () => string | null;
  /** The context reader (workspaces + instance id), or null when not
   * configured. */
  reader: () => ContextReader | null;
  /** The whoami read, or null when not configured. */
  whoami: () => (() => Promise<WhoamiRead>) | null;
  /** The CRM reads, or null when not configured. */
  crm: () => CrmOs | null;
  /** The configured OS origin for the deep link ("" when not configured). */
  origin: () => string;
  log?: (entry: CrmLogEntry) => void;
  /** The owner's optional Super-Admin-only gate (default: every viewer who
   * can open the project). */
  superAdminOnly?: boolean;
}) {
  const log =
    deps.log ??
    ((entry: CrmLogEntry) =>
      console.warn(`FlightDeck CRM: ${entry.reason} (${entry.detail})`));

  /** Everything before the CRM read: the request, the viewer, the stored
   * link and its identity. Returns the Response to send, or the verified
   * link and the CRM reader. */
  async function resolve(
    request: Request,
  ): Promise<Response | { link: StoredLink; crm: CrmOs }> {
    if (!sameOriginRead(request))
      return answer({ error: "Request origin is not allowed." }, 403);
    const auth = await deps.authorize();
    if (auth.error) return notFound();
    if (deps.superAdminOnly && !auth.access.superAdmin) return notFound();
    const atlasProjectId = new URL(request.url).searchParams.get("project");
    if (!atlasProjectId || !ATLAS_PROJECT_ID_RE.test(atlasProjectId))
      return notFound();
    if (!(await deps.projectFor(auth.access, atlasProjectId)))
      return notFound();

    const installationId = deps.installationId();
    const reader = deps.reader();
    const whoami = deps.whoami();
    const crm = deps.crm();
    if (!installationId || !reader || !whoami || !crm || !deps.origin())
      return unavailable("not_configured");
    const rows = await deps.links(atlasProjectId);
    if (!rows.length) return unavailable("not_linked");
    const mismatch = (detail: CrmLogEntry["detail"]) => {
      log({ event: "flightdeck.crm.link_mismatch", reason: "link_mismatch", detail });
      return unavailable("link_mismatch");
    };
    const link = rows.find((r) => r.installationId === installationId);
    if (!link) return mismatch("installation");
    if (link.accessState !== "active") return mismatch("access_state");

    // No read:crm, no CRM request (and no identity read either).
    const who = await whoami();
    if (who.state !== "ok") return unavailable(who.state);
    if (!hasReadCrm(who)) return unavailable("not_enabled");

    const ws = await reader.workspaces();
    if (ws.state !== "ok")
      return unavailable(
        ws.state === "workspace_not_found" ? "not_found" : ws.state,
      );
    if (!ws.data.instanceId) return mismatch("instance_unknown");
    if (ws.data.instanceId !== link.osInstanceId) return mismatch("instance");
    const workspace = ws.data.workspaces.find((w) => w.id === link.workspaceId);
    if (!workspace) return mismatch("workspace");
    if (!workspace.enabled) return unavailable("workspace_disabled");
    return { link, crm };
  }

  /** GET /api/flightdeck/crm?project=<atlasId> */
  async function GET(request: Request) {
    const resolved = await resolve(request);
    if (resolved instanceof Response) return resolved;
    const { link, crm } = resolved;
    const res = await crm.projection(link.workspaceId, link.osProjectId);
    if (res.state !== "ok") return unavailable(res.state);
    // The client already parsed it; parsed again here because this is what
    // the browser receives, whatever reader is wired in.
    const parsed = crmProjectionV1Schema.safeParse(res.data);
    if (!parsed.success || parsed.data.projectId !== link.osProjectId)
      return unavailable("invalid_response");
    const query = new URLSearchParams({
      fdWorkspace: link.workspaceId,
      fdProject: link.osProjectId,
    });
    return answer({
      state: "ok",
      projection: parsed.data,
      openUrl: `${deps.origin()}/console/crm?${query}`,
    } satisfies CrmRouteView);
  }

  /** GET /api/flightdeck/crm/revision?project=<atlasId> */
  async function revision(request: Request) {
    const resolved = await resolve(request);
    if (resolved instanceof Response) return resolved;
    const { link, crm } = resolved;
    const res = await crm.revision(link.workspaceId, link.osProjectId);
    if (res.state !== "ok") return unavailable(res.state);
    const parsed = crmRevisionV1Schema.safeParse(res.data);
    if (!parsed.success || parsed.data.projectId !== link.osProjectId)
      return unavailable("invalid_response");
    return answer({
      state: "ok",
      revision: parsed.data.revision,
    } satisfies CrmRevisionView);
  }

  return { GET, revision };
}
