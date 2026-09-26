// The /api/flightdeck/apps/directory handler (apps-32): the FlightDeck OS
// apps DIRECTORY for the viewer's SELECTED OS project (OS apps-29). The
// existing /api/flightdeck/apps (apps-route.ts) is left exactly as it is.
// Dependencies are passed in so the spec runs exactly this code over a fake
// OS; the route file wires the real authorisation, credential and origin.
//
// Every rule here FAILS CLOSED:
// - The directory is read only when whoami advertises
//   contracts["apps-directory"] === 1. Anything else is
//   `directory_unavailable`; it NEVER falls back to the legacy /apps list,
//   which answers for the workspace's default project, not the selected one.
// - It asks for the SAVED osProjectId. No saved project is reported
//   (`no_project_selected`), never answered with the default project's apps;
//   the OS's uniform 404 is `project_not_available`.
// - The OS echoes {workspaceId, projectId, locale}; an answer for anything
//   else is refused (context-client appsDirectory).
// - A link is built only for an app whose workspaceStatus is "enabled".
// - Cache keys are (OS origin, credential fingerprint, workspace, project,
//   locale). The fingerprint is a one-way digest: the credential itself never
//   appears in a key. A 401/403 deletes EVERY key of that credential. Nothing
//   is served older than five minutes.
//
// ⚠ WHO SEES IT: as apps-route.ts — a machine credential cannot filter by
// Atlas user, so this is what the OS says about the project, not what one
// person may open. Every entry is `accessCheckedOnOpen`: the OS checks the
// person's role when the link is opened. A link, never a grant.
import { json } from "../http";
import { resolveRequestLocale } from "../i18n/server";
import type { Locale } from "../i18n";
import type { ContextState, OsAppsDirectory, OsSelection } from "./context";
import {
  CACHE_MAX_AGE_MS,
  clearCredential,
  createCachedReader,
  createContextClient,
  createWhoamiReader,
  WHOAMI_PATH,
  type ContextConfig,
  type ContextResult,
  type Fetcher,
} from "./context-client";

export { clearCredential };
/** The directory contract version this Atlas reads (OS
 * INBOUND_APPS_DIRECTORY_CONTRACT). */
export const APPS_DIRECTORY_CONTRACT = 1;
/** The oldest a cached directory or capability read may be when served. */
export const DIRECTORY_MAX_AGE_MS = CACHE_MAX_AGE_MS;
const DIRECTORY_TTL_MS = 60_000;

type Cache = Map<string, { until: number; value?: ContextResult<unknown> }>;

/** A one-way fingerprint of the credential, for cache keys only. Domain-
 * separated so it is useful for nothing else; the credential is never kept. */
export async function credentialFingerprint(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(`atlas-os-cache-key:v1:${token}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A bridge media URL only when it is on the configured OS origin under
 * /console/bridge-media/; null otherwise (dropped, never rewritten). For the
 * bridge detail consumer; the directory contract carries no media. */
export function bridgeMediaUrl(value: unknown, osOrigin: string): string | null {
  if (typeof value !== "string" || !osOrigin) return null;
  if (/\.\.|%2e|\\/i.test(value)) return null;
  let url: URL, os: URL;
  try {
    url = new URL(value);
    os = new URL(osOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.origin !== os.origin) return null;
  return url.pathname.startsWith("/console/bridge-media/") ? url.href : null;
}

/** The OS side of the directory, for one configured credential. */
export type DirectoryOs = {
  /** Whether the OS serves the directory contract Atlas reads. */
  capability(): Promise<ContextResult<{ directory: boolean }>>;
  directory(
    workspaceId: string,
    projectId: string,
    locale: Locale,
  ): Promise<ContextResult<OsAppsDirectory>>;
};

export function createDirectoryOs(deps: {
  config: ContextConfig;
  /** The isolate's shared cache: it also holds the credential-wide rate
   * limit, so the directory spends the same 30 requests a minute. */
  cache: Cache;
  fetch?: Fetcher;
  now?: () => number;
  ttlMs?: number;
  /** Called when the OS refuses the credential, so every other reader of
   * the isolate drops what it holds for it (lib/flightdeck/os-wiring.ts). */
  onRefused?: () => void;
}): DirectoryOs {
  const now = deps.now || Date.now;
  const client = { ...(deps.fetch ? { fetch: deps.fetch } : {}) };
  let prefix: Promise<string> | null = null;
  const keyPrefix = () =>
    (prefix ??= credentialFingerprint(deps.config.token).then(
      (fp) => `${deps.config.baseUrl}|${fp}|`,
    ));
  return {
    async capability() {
      const p = await keyPrefix();
      const key = p + WHOAMI_PATH;
      const started = now();
      const hit = deps.cache.get(key);
      if (hit?.value && hit.until > started)
        return hit.value as ContextResult<{ directory: boolean }>;
      const read = await createWhoamiReader(deps.config, deps.cache, {
        ...client,
        now,
      })();
      if (read.state === "unauthorized" || read.state === "invalid_response") {
        clearCredential(deps.cache, p);
        deps.onRefused?.();
        return { state: read.state };
      }
      if (read.state !== "ok") return { state: read.state };
      const contracts =
        read.body && typeof read.body === "object"
          ? (read.body as { contracts?: unknown }).contracts
          : undefined;
      const version =
        contracts && typeof contracts === "object" && !Array.isArray(contracts)
          ? (contracts as Record<string, unknown>)["apps-directory"]
          : undefined;
      const value: ContextResult<{ directory: boolean }> = {
        state: "ok",
        data: { directory: version === APPS_DIRECTORY_CONTRACT },
      };
      deps.cache.set(key, { until: started + DIRECTORY_MAX_AGE_MS, value });
      return value;
    },
    async directory(workspaceId, projectId, locale) {
      const reader = createCachedReader(
        createContextClient(deps.config, client),
        deps.cache,
        {
          keyPrefix: await keyPrefix(),
          ttlMs: deps.ttlMs ?? DIRECTORY_TTL_MS,
          now,
          onRefused: deps.onRefused,
        },
      );
      return reader.appsDirectory!(workspaceId, projectId, locale);
    },
  };
}

export const directoryStates = [
  "ok",
  "not_configured",
  "os_unreachable",
  "unauthorized",
  "rate_limited",
  "invalid_response",
  "workspace_disabled",
  "directory_unavailable",
  "no_project_selected",
  "project_not_available",
] as const;
export type DirectoryState = (typeof directoryStates)[number];

/** One app as the browser gets it: no roles, no credential. `url` is set
 * only for an enabled app; opening it still goes through the OS's own
 * sign-in and role check. */
export type DirectoryApp = {
  id: string;
  label: string;
  icon: string;
  version: string;
  category: string | null;
  availability: "available" | "coming-soon" | null;
  workspaceStatus: string;
  url: string | null;
  accessCheckedOnOpen: true;
  requestAccessEnabled: boolean;
  tagline: string | null;
  releaseRevision: number | null;
};
export type DirectoryView = {
  state: DirectoryState;
  workspaceId: string | null;
  projectId: string | null;
  locale: Locale | null;
  apps: DirectoryApp[];
  retryAfter: number | null;
};

export type DirectoryAuth =
  | { access: { userId: string; superAdmin: boolean }; error?: never }
  | { access?: never; error: Response };

export function createAppsDirectoryRoute(deps: {
  authorize: () => Promise<DirectoryAuth>;
  /** The OS directory reader, or null when FlightDeck is not configured. */
  os: () => DirectoryOs | null;
  /** The OS origin for links ("" when not configured). */
  origin: () => string;
  /** The viewer's saved FlightDeck selection, if any. */
  selection: (userId: string) => Promise<OsSelection | null>;
}) {
  const respond = (state: DirectoryState, extra: Partial<DirectoryView> = {}) =>
    json({
      state,
      workspaceId: null,
      projectId: null,
      locale: null,
      apps: [],
      retryAfter: null,
      ...extra,
      checkedAt: new Date().toISOString(),
    } satisfies DirectoryView & { checkedAt: string });

  async function GET(request: Request) {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const os = deps.os();
    const origin = deps.origin();
    if (!os || !origin) return respond("not_configured");
    let saved: OsSelection | null = null;
    try {
      saved = await deps.selection(auth.access.userId);
    } catch {
      saved = null; // a missing preference row is not an error here
    }
    const workspaceId = saved?.osWorkspaceId ?? null;
    const projectId = saved?.osProjectId ?? null;
    if (!workspaceId || !projectId)
      return respond("no_project_selected", { workspaceId });
    const ids = { workspaceId, projectId };
    const cap = await os.capability();
    if (cap.state !== "ok") return respond(failure(cap.state), { ...ids, retryAfter: cap.retryAfter ?? null });
    if (!cap.data.directory) return respond("directory_unavailable", ids);
    const locale = resolveRequestLocale(request);
    const res = await os.directory(workspaceId, projectId, locale);
    if (res.state !== "ok")
      return respond(
        res.state === "workspace_not_found"
          ? "project_not_available"
          : failure(res.state),
        { ...ids, retryAfter: res.retryAfter ?? null },
      );
    const query = new URLSearchParams({
      fdWorkspace: res.data.workspaceId,
      fdProject: res.data.projectId,
    });
    return respond("ok", {
      ...ids,
      locale: res.data.locale,
      apps: res.data.apps.map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon,
        version: a.version,
        category: a.category,
        availability: a.availability,
        workspaceStatus: a.workspaceStatus,
        // A path on a locked app is never turned into a link.
        url:
          a.workspaceStatus === "enabled" && a.path
            ? `${origin}${a.path}?${query}`
            : null,
        accessCheckedOnOpen: true,
        requestAccessEnabled: a.requestAccessEnabled,
        tagline: a.tagline ?? null,
        releaseRevision: a.releaseRevision ?? null,
      })),
    });
  }
  return { GET };
}

/** A context failure as a directory state (not_permitted and
 * workspace_not_found never reach here: the caller maps them). */
function failure(state: ContextState): DirectoryState {
  return (directoryStates as readonly string[]).includes(state)
    ? (state as DirectoryState)
    : "invalid_response";
}
