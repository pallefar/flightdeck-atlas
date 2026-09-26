// Server-only transport for the FlightDeck OS inbound context API.
// The inbound credential is a machine credential held in Atlas server
// configuration. It is only ever placed in the Authorization header of a
// request to the configured OS origin. It is never logged, returned in a
// response or error, stored, or sent to the browser.
import {
  emptyContext,
  osAppCatalogSchema,
  osAppsDirectorySchema,
  osAppsResponseSchema,
  osIdSchema,
  osNotFoundSchema,
  osProjectDisabledSchema,
  osProjectsResponseSchema,
  osWorkspaceDisabledSchema,
  osWorkspacesResponseSchema,
  pickProject,
  pickWorkspace,
  visibleProjects,
  type ContextFailureState,
  type ContextView,
  type OsAppCatalog,
  type OsAppsDirectory,
  type OsAppsResponse,
  type OsProjectsResponse,
  type OsSelection,
  type OsWorkspacesResponse,
} from "./context";
import {
  SUBMISSION_ID_RE,
  ONBOARDING_KIND,
  onboardingEnvelopeSchema,
  osAlreadySubmittedSchema,
  osLineageRefusalSchema,
  osSubmitAcceptedSchema,
  osSubmitConflictSchema,
  osSubmitDuplicateSchema,
  parseSubmissionStatus,
  type OnboardingEnvelope,
  type OsSubmissionStatus,
} from "./onboarding";
import {
  FLIGHTDECK_CONTRACT_HEADER,
  FLIGHTDECK_CONTRACT_RANGE,
} from "./contract";
import {
  crmProjectionV1Schema,
  crmRevisionV1Schema,
  type CrmProjectionV1,
  type CrmRevisionV1,
} from "./crm-contract";

export type ContextConfig = { baseUrl: string; token: string };
export type ContextFailure = {
  state: ContextFailureState;
  retryAfter?: number;
};
export type ContextResult<T> = { state: "ok"; data: T } | ContextFailure;
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
export interface ContextReader {
  workspaces(): Promise<ContextResult<OsWorkspacesResponse>>;
  projects(workspaceId: string): Promise<ContextResult<OsProjectsResponse>>;
  /** The sub-apps enabled in that workspace (Atlas's 9-dot menu). Optional so
   * readers that only serve the context switcher need not implement it. */
  apps?(workspaceId: string): Promise<ContextResult<OsAppsResponse>>;
  /** The apps directory for the SELECTED project (OS apps-29). Optional for
   * the same reason. Only read once whoami advertises the contract. */
  appsDirectory?(
    workspaceId: string,
    projectId: string,
    locale: "en" | "de",
  ): Promise<ContextResult<OsAppsDirectory>>;
  /** The sub-apps enabled in ONE project of that workspace, through the OS's
   * validated `?projectId=` (deck-host-launch-project): the Slides tool's
   * launch on the OS project linked to an Atlas project. */
  appsForProject?(
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectAppsResult>;
  /** The allowlisted app catalog (OS onb-inbound-apps-discovery): the apps
   * a requester can ask for. `workspaceId` null is instance-level; a
   * workspace adds that workspace's consent (the Super Admin path). Only
   * read once whoami advertises features.appDiscovery. */
  appCatalog?(
    workspaceId: string | null,
    locale: "en" | "de",
  ): Promise<AppCatalogResult>;
}
/** An answer for one project: a list, a failure, or that project disabled. */
export type ProjectAppsResult =
  | ContextResult<OsAppsResponse>
  | { state: "project_disabled"; retryAfter?: never };
/** A catalog answer: the catalog, a failure, or (instance-level) the OS's
 * uniform 404, which there can only mean the feature is off for this
 * credential. */
export type AppCatalogResult =
  | ContextResult<OsAppCatalog>
  | { state: "feature_off"; retryAfter?: never };

export const WORKSPACES_PATH = "/api/inbound/v1/context/workspaces";
export const projectsPath = (workspaceId: string) =>
  `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}/projects`;
export const appsPath = (workspaceId: string) =>
  `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}/apps`;
export const appsDirectoryPath = (
  workspaceId: string,
  projectId: string,
  locale: "en" | "de",
) =>
  `${appsPath(workspaceId)}/directory?${new URLSearchParams({ projectId, locale })}`;
export const projectAppsPath = (workspaceId: string, projectId: string) =>
  `${appsPath(workspaceId)}?${new URLSearchParams({ projectId })}`;
export const APP_CATALOG_PATH = "/api/inbound/v1/context/app-catalog";
export const appCatalogPath = (
  workspaceId: string | null,
  locale: "en" | "de",
) =>
  `${APP_CATALOG_PATH}?${new URLSearchParams(
    workspaceId ? { workspaceId, locale } : { locale },
  )}`;
const TIMEOUT_MS = 5000;
const MAX_BODY_CHARS = 1_000_000;
// Same charset the OS enforces before it verifies a credential.
const CREDENTIAL_RE = /^[A-Za-z0-9_-]{16,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Returns null (state "not_configured") unless both values are present and
 * safe to use. Plain HTTP is accepted only for a loopback OS, so the
 * credential never crosses a network in clear text. */
export function readContextConfig(values: {
  url?: string;
  token?: string;
}): ContextConfig | null {
  const raw = values.url?.trim();
  const token = values.token?.trim();
  if (!raw || !token || !CREDENTIAL_RE.test(token)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
  )
    return null;
  return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ""), token };
}

function retryAfterFrom(response: Response, body: unknown) {
  const header = Number(response.headers.get("retry-after"));
  const fromBody =
    body && typeof body === "object" && "retryAfterSeconds" in body
      ? Number((body as { retryAfterSeconds: unknown }).retryAfterSeconds)
      : NaN;
  const seconds = Number.isFinite(header) && header > 0 ? header : fromBody;
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(3600, Math.ceil(seconds))
    : 60;
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_CHARS)
    throw Error("too large");
  const text = await response.text();
  if (text.length > MAX_BODY_CHARS) throw Error("too large");
  return JSON.parse(text);
}

type ClientOptions = { fetch?: Fetcher; timeoutMs?: number };
type Exchange = (
  path: string,
  init: { method: "GET" | "POST"; body?: string },
) => Promise<
  | { state: "answered"; response: Response; body: unknown }
  | { state: "os_unreachable" }
>;
/** The one place Atlas talks to the OS. Only the bearer credential, Accept,
 * the advertised contract range (X-FlightDeck-Contract, ./contract.ts) and
 * (for a POST) Content-Type are sent: no cookies, no X-Workspace-Id, no
 * browser identity. The OS pins these routes to te-ops (§8b decision 3). */
function exchanger(config: ContextConfig, options: ClientOptions): Exchange {
  const send: Fetcher = options.fetch || ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return async (path, init) => {
    let response: Response;
    try {
      response = await send(config.baseUrl + path, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
          [FLIGHTDECK_CONTRACT_HEADER]: FLIGHTDECK_CONTRACT_RANGE,
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { state: "os_unreachable" };
    }
    let body: unknown = null;
    try {
      body = await readJson(response);
    } catch (error) {
      if ((error as Error)?.name === "TimeoutError")
        return { state: "os_unreachable" };
      body = null;
    }
    return { state: "answered", response, body };
  };
}
const isJson = (response: Response) =>
  !!response.headers.get("content-type")?.includes("application/json");

export function createContextClient(
  config: ContextConfig,
  options: ClientOptions = {},
): ContextReader {
  const exchange = exchanger(config, options);
  async function get(
    path: string,
    notFound: boolean,
  ): Promise<{ state: "ok"; body: unknown } | ContextFailure> {
    const answer = await exchange(path, { method: "GET" });
    return read(answer, notFound);
  }
  function read(
    answer: Awaited<ReturnType<Exchange>>,
    notFound: boolean,
  ): { state: "ok"; body: unknown } | ContextFailure {
    if (answer.state !== "answered") return answer;
    const { response, body } = answer;
    if (response.status === 401 || response.status === 403)
      return { state: "unauthorized" };
    if (response.status === 429)
      return {
        state: "rate_limited",
        retryAfter: retryAfterFrom(response, body),
      };
    if (
      notFound &&
      response.status === 404 &&
      osNotFoundSchema.safeParse(body).success
    )
      return { state: "workspace_not_found" };
    if (
      notFound &&
      response.status === 409 &&
      osWorkspaceDisabledSchema.safeParse(body).success
    )
      return { state: "workspace_disabled" };
    if (response.status !== 200 || !isJson(response) || body === null)
      return { state: "invalid_response" };
    return { state: "ok", body };
  }
  return {
    async workspaces() {
      const result = await get(WORKSPACES_PATH, false);
      if (result.state !== "ok") return result;
      const parsed = osWorkspacesResponseSchema.safeParse(result.body);
      return parsed.success
        ? { state: "ok", data: parsed.data }
        : { state: "invalid_response" };
    },
    async projects(workspaceId) {
      if (!osIdSchema.safeParse(workspaceId).success)
        return { state: "workspace_not_found" };
      const result = await get(projectsPath(workspaceId), true);
      if (result.state !== "ok") return result;
      const parsed = osProjectsResponseSchema.safeParse(result.body);
      // A response for another workspace is never substituted silently.
      return parsed.success && parsed.data.workspaceId === workspaceId
        ? { state: "ok", data: parsed.data }
        : { state: "invalid_response" };
    },
    async apps(workspaceId) {
      if (!osIdSchema.safeParse(workspaceId).success)
        return { state: "workspace_not_found" };
      const result = await get(appsPath(workspaceId), true);
      if (result.state !== "ok") return result;
      const parsed = osAppsResponseSchema.safeParse(result.body);
      return parsed.success && parsed.data.workspaceId === workspaceId
        ? { state: "ok", data: parsed.data }
        : { state: "invalid_response" };
    },
    async appsDirectory(workspaceId, projectId, locale) {
      if (
        !osIdSchema.safeParse(workspaceId).success ||
        !osIdSchema.safeParse(projectId).success
      )
        return { state: "workspace_not_found" };
      const result = await get(
        appsDirectoryPath(workspaceId, projectId, locale),
        true,
      );
      if (result.state !== "ok") return result;
      const parsed = osAppsDirectorySchema.safeParse(result.body);
      // The OS echoes what the answer is for; an answer for another
      // workspace, project or locale is refused, never shown as this one.
      return parsed.success &&
        parsed.data.workspaceId === workspaceId &&
        parsed.data.projectId === projectId &&
        parsed.data.locale === locale
        ? { state: "ok", data: parsed.data }
        : { state: "invalid_response" };
    },
    async appsForProject(workspaceId, projectId) {
      if (
        !osIdSchema.safeParse(workspaceId).success ||
        !osIdSchema.safeParse(projectId).success
      )
        return { state: "workspace_not_found" };
      const answer = await exchange(projectAppsPath(workspaceId, projectId), {
        method: "GET",
      });
      if (
        answer.state === "answered" &&
        answer.response.status === 409 &&
        osProjectDisabledSchema.safeParse(answer.body).success
      )
        return { state: "project_disabled" };
      const result = read(answer, true);
      if (result.state !== "ok") return result;
      const parsed = osAppsResponseSchema.safeParse(result.body);
      // An answer for another workspace or project (the default one, say) is
      // never shown as this project's list.
      return parsed.success &&
        parsed.data.workspaceId === workspaceId &&
        parsed.data.projectId === projectId
        ? { state: "ok", data: parsed.data }
        : { state: "invalid_response" };
    },
    async appCatalog(workspaceId, locale) {
      if (workspaceId !== null && !osIdSchema.safeParse(workspaceId).success)
        return { state: "workspace_not_found" };
      const answer = await exchange(appCatalogPath(workspaceId, locale), {
        method: "GET",
      });
      // Instance-level there is no workspace to be missing: the OS's uniform
      // 404 means the route does not exist for this credential.
      if (
        workspaceId === null &&
        answer.state === "answered" &&
        answer.response.status === 404 &&
        osNotFoundSchema.safeParse(answer.body).success
      )
        return { state: "feature_off" };
      const result = read(answer, true);
      if (result.state !== "ok") return result;
      const parsed = osAppCatalogSchema.safeParse(result.body);
      if (!parsed.success || parsed.data.locale !== locale)
        return { state: "invalid_response" };
      // The OS echoes what the answer is for; an instance answer to a
      // workspace ask (or the reverse), or another workspace's answer, is
      // refused, never shown as this one.
      const data = parsed.data;
      const matches =
        workspaceId === null
          ? data.scope === "instance"
          : data.scope === "workspace" && data.workspaceId === workspaceId;
      return matches ? { state: "ok", data } : { state: "invalid_response" };
    },
  };
}

const failed = (result: ContextFailure) =>
  emptyContext(result.state, result.retryAfter ?? null);

/** The current view for a saved selection. Read-only: a fallback is shown,
 * not written back. A saved workspace that is no longer readable is reported,
 * never replaced by another workspace. */
export async function loadContext(
  reader: ContextReader,
  saved: OsSelection | null,
  viewer: { superAdmin: boolean },
): Promise<ContextView> {
  const ws = await reader.workspaces();
  if (ws.state !== "ok") return failed(ws);
  const workspaces = ws.data.workspaces;
  const pick = pickWorkspace(workspaces, saved?.osWorkspaceId || null);
  if (pick.missing)
    return { ...emptyContext("workspace_not_found"), workspaces };
  if (!pick.workspace) return { ...emptyContext("ok"), workspaces };
  return projectsFor(
    reader,
    workspaces,
    pick.workspace,
    saved?.osWorkspaceId === pick.workspace.id ? saved.osProjectId : null,
    viewer,
  );
}

/** Validates a requested selection against fresh OS lists. */
export async function chooseContext(
  reader: ContextReader,
  requested: { osWorkspaceId: string; osProjectId?: string | null },
  viewer: { superAdmin: boolean },
): Promise<ContextView> {
  const ws = await reader.workspaces();
  if (ws.state !== "ok") return failed(ws);
  const workspaces = ws.data.workspaces;
  const target = workspaces.find((w) => w.id === requested.osWorkspaceId);
  if (!target) return { ...emptyContext("workspace_not_found"), workspaces };
  return projectsFor(
    reader,
    workspaces,
    target,
    requested.osProjectId ?? null,
    viewer,
  );
}

async function projectsFor(
  reader: ContextReader,
  workspaces: OsWorkspacesResponse["workspaces"],
  workspace: OsWorkspacesResponse["workspaces"][number],
  requestedProjectId: string | null,
  viewer: { superAdmin: boolean },
): Promise<ContextView> {
  const disabled = {
    ...emptyContext("workspace_disabled"),
    workspaces,
    selected: { osWorkspaceId: workspace.id, osProjectId: null },
  };
  if (!workspace.enabled) return disabled;
  const pr = await reader.projects(workspace.id);
  if (pr.state === "workspace_disabled") return disabled;
  if (pr.state === "workspace_not_found")
    return { ...emptyContext("workspace_not_found"), workspaces };
  if (pr.state !== "ok") return failed(pr);
  const projects = visibleProjects(pr.data.projects, viewer.superAdmin);
  const choice = pickProject(projects, requestedProjectId);
  return {
    state: "ok",
    workspaces,
    projects,
    selected: { osWorkspaceId: workspace.id, osProjectId: choice.projectId },
    projectFallback: choice.fallback,
    retryAfter: null,
  };
}

/** Coalesces bursts (window focus, several tabs, the sidebar and the mobile
 * menu) so Atlas stays well inside the OS's per-credential window of 30
 * requests a minute. Only plain resolved data is kept: Workers must not share
 * a pending request across requests. A rate limit applies to the whole
 * credential, so it is honoured for every path until it expires instead of
 * pressing the OS again. `fresh` skips cached lists (used before saving a
 * selection) but still records what it reads. */
export function createCachedReader(
  reader: ContextReader,
  cache: Map<string, { until: number; value?: ContextResult<unknown> }>,
  options: {
    fresh?: boolean;
    ttlMs?: number;
    now?: () => number;
    /** Namespaces every key (apps-32: OS origin + credential fingerprint).
     * When set, a refused credential (401/403) deletes EVERY key under it. */
    keyPrefix?: string;
    /** Called once the OS has refused the credential (401/403), so every
     * OTHER reader of the same credential drops what it holds too (apps-32,
     * lib/flightdeck/os-wiring.ts). */
    onRefused?: () => void;
  } = {},
): ContextReader {
  // Nothing is ever served older than CACHE_MAX_AGE_MS, whatever is asked.
  const ttlMs = Math.min(options.ttlMs ?? 10_000, CACHE_MAX_AGE_MS),
    now = options.now || Date.now,
    prefix = options.keyPrefix ?? "";
  async function cached<
    R extends ContextResult<unknown> | ProjectAppsResult | AppCatalogResult,
  >(
    key: string,
    load: () => Promise<R>,
  ): Promise<R> {
    const started = now();
    const blocked = cache.get(RATE_LIMIT_KEY);
    if (blocked && blocked.until > started)
      return {
        state: "rate_limited",
        retryAfter: Math.max(1, Math.ceil((blocked.until - started) / 1000)),
      } as R;
    const hit = cache.get(prefix + key);
    if (!options.fresh && hit?.value && hit.until > started)
      return hit.value as R;
    const value = await load();
    if (cache.size > 200) cache.clear();
    if (value.state === "ok")
      cache.set(prefix + key, {
        until: now() + ttlMs,
        value: value as ContextResult<unknown>,
      });
    else if (value.state === "unauthorized") {
      if (prefix) clearCredential(cache, prefix);
      else cache.delete(key);
      options.onRefused?.();
    } else {
      cache.delete(prefix + key);
      if (value.state === "rate_limited")
        cache.set(RATE_LIMIT_KEY, {
          until: now() + (value.retryAfter ?? 60) * 1000,
        });
    }
    return value;
  }
  return {
    workspaces: () => cached(WORKSPACES_PATH, () => reader.workspaces()),
    projects: (id) => cached(projectsPath(id), () => reader.projects(id)),
    ...(reader.apps
      ? {
          apps: (id: string) => cached(appsPath(id), () => reader.apps!(id)),
        }
      : {}),
    ...(reader.appsDirectory
      ? {
          appsDirectory: (id: string, project: string, locale: "en" | "de") =>
            cached(appsDirectoryPath(id, project, locale), () =>
              reader.appsDirectory!(id, project, locale),
            ),
        }
      : {}),
    ...(reader.appsForProject
      ? {
          appsForProject: (id: string, projectId: string) =>
            cached(projectAppsPath(id, projectId), () =>
              reader.appsForProject!(id, projectId),
            ),
        }
      : {}),
    ...(reader.appCatalog
      ? {
          appCatalog: (id: string | null, locale: "en" | "de") =>
            cached(appCatalogPath(id, locale), () =>
              reader.appCatalog!(id, locale),
            ),
        }
      : {}),
  };
}
/** The credential-wide rate-limit block's key in the isolate cache. */
export const RATE_LIMIT_KEY = "rate-limit";
/** The oldest a cached OS answer may be when it is served. */
export const CACHE_MAX_AGE_MS = 5 * 60_000;
/** Deletes every cache key under one credential's prefix (apps-32: a
 * 401/403 or revocation must not leave any of its lists behind). The
 * credential-wide rate-limit block is not under a prefix and is kept. */
export function clearCredential(
  cache: Map<string, unknown>,
  prefix: string,
): number {
  if (!prefix) return 0;
  let removed = 0;
  for (const key of [...cache.keys()])
    if (key.startsWith(prefix)) {
      cache.delete(key);
      removed++;
    }
  return removed;
}
/** Deletes every answer in an isolate's cache except the credential-wide
 * rate-limit block (apps-32). The isolate cache holds answers for ONE
 * configured credential only (lib/flightdeck/os-server.ts reads it from the
 * Worker environment, which is fixed per isolate), so once the OS refuses
 * it, nothing in the cache may be served any more. Fails closed: the worst
 * case is one extra read per list. */
export function forgetCredential(cache: Map<string, unknown>): number {
  let removed = 0;
  for (const key of [...cache.keys()])
    if (key !== RATE_LIMIT_KEY) {
      cache.delete(key);
      removed++;
    }
  return removed;
}

// ── read:crm — one OS project's CRM projection (OS crm-37, Atlas crm-40) ──

export const crmProjectionPath = (workspaceId: string, projectId: string) =>
  `${projectsPath(workspaceId)}/${encodeURIComponent(projectId)}/crm`;
export const crmRevisionPath = (workspaceId: string, projectId: string) =>
  `${crmProjectionPath(workspaceId, projectId)}/revision`;
/** Why a CRM read has no data. `refused` is a 403 (the credential lacks
 * `read:crm`): an answer about this scope, NOT a revoked credential, so it
 * never clears the other readers' caches. `not_found` is the OS's uniform
 * 404 (a closed gate, an unknown or disabled project). */
export type CrmReadFailure = {
  state:
    | "unauthorized"
    | "refused"
    | "not_found"
    | "workspace_disabled"
    | "rate_limited"
    | "os_unreachable"
    | "invalid_response"
    | "crm_not_ready"
    | "crm_projection_invalid";
  retryAfter?: number;
};
export type CrmReadResult<T> = { state: "ok"; data: T } | CrmReadFailure;
export interface CrmClient {
  projection(
    workspaceId: string,
    projectId: string,
  ): Promise<CrmReadResult<CrmProjectionV1>>;
  revision(
    workspaceId: string,
    projectId: string,
  ): Promise<CrmReadResult<CrmRevisionV1>>;
}
/** The two CRM reads, never cached. The ids are the caller's STORED link's
 * (lib/flightdeck/crm-route.ts), checked before they are joined into a path.
 * Every answer is parsed with Atlas's strict copy of v1, and an answer for
 * another project is refused, never shown as this one. */
export function createCrmClient(
  config: ContextConfig,
  options: ClientOptions = {},
): CrmClient {
  const exchange = exchanger(config, options);
  async function get<T extends { projectId: string }>(
    path: string,
    projectId: string,
    parse: (body: unknown) => T | null,
  ): Promise<CrmReadResult<T>> {
    const answer = await exchange(path, { method: "GET" });
    if (answer.state !== "answered") return { state: "os_unreachable" };
    const { response, body } = answer;
    const code =
      body && typeof body === "object"
        ? (body as { code?: unknown }).code
        : undefined;
    if (response.status === 401) return { state: "unauthorized" };
    if (response.status === 403) return { state: "refused" };
    if (response.status === 429)
      return {
        state: "rate_limited",
        retryAfter: retryAfterFrom(response, body),
      };
    if (response.status === 404) return { state: "not_found" };
    if (response.status === 409 && code === "workspace_disabled")
      return { state: "workspace_disabled" };
    if (response.status === 503 && code === "crm_not_ready")
      return { state: "crm_not_ready" };
    if (response.status === 503 && code === "crm_projection_invalid")
      return { state: "crm_projection_invalid" };
    if (response.status !== 200 || !isJson(response) || body === null)
      return { state: "invalid_response" };
    const data = parse(body);
    return data && data.projectId === projectId
      ? { state: "ok", data }
      : { state: "invalid_response" };
  }
  const idsOk = (workspaceId: string, projectId: string) =>
    osIdSchema.safeParse(workspaceId).success &&
    osIdSchema.safeParse(projectId).success;
  return {
    async projection(workspaceId, projectId) {
      if (!idsOk(workspaceId, projectId)) return { state: "not_found" };
      return get(crmProjectionPath(workspaceId, projectId), projectId, (b) => {
        const parsed = crmProjectionV1Schema.safeParse(b);
        return parsed.success ? parsed.data : null;
      });
    },
    async revision(workspaceId, projectId) {
      if (!idsOk(workspaceId, projectId)) return { state: "not_found" };
      return get(crmRevisionPath(workspaceId, projectId), projectId, (b) => {
        const parsed = crmRevisionV1Schema.safeParse(b);
        return parsed.success ? parsed.data : null;
      });
    },
  };
}

// ── submit:proposal — the project-onboarding kind (plan §4.3, §4.6) ───────

export const SUBMISSIONS_PATH = "/api/inbound/v1/submissions";
type TransportFailure = {
  state:
    | "os_unreachable"
    | "unauthorized"
    | "refused"
    | "rate_limited"
    | "invalid_response";
  retryAfter?: number;
};
export type SubmitReceipt = {
  submissionId: string;
  receivedAt: string | null;
  payloadSha256: string | null;
  duplicate: boolean;
};
/** `os_unreachable` and `invalid_response` after a POST mean "not known":
 * the OS may have filed it. Only `invalid_submission`, `unauthorized` and
 * `refused` are definite refusals made before anything was filed. */
export type SubmitResult =
  | { state: "ok"; data: SubmitReceipt }
  | { state: "invalid_submission" }
  | {
      state: "already_submitted";
      submissionId: string | null;
      osState: string | null;
    }
  /** OS 409: its intake lock for this request is torn; an operator must
   * inspect it. The OS may or may not hold the request. */
  | { state: "lock_unreadable" }
  /** OS 409: this key was used for a different Atlas project, so nothing of
   * this project was filed under it. */
  | { state: "idempotency_key_conflict" }
  /** OS 409 ALREADY_SUPERSEDED (onb-resubmit-lineage-os): the request this
   * one names in `supersedes` already has a successor, named here. Nothing
   * was filed. */
  | { state: "already_superseded"; submissionId: string | null }
  /** OS 404 SUPERSEDES_NOT_FOUND or 409 SUPERSEDES_WRONG_STATE: FlightDeck
   * will not take this as that request's successor. Nothing was filed. */
  | { state: "supersedes_refused" }
  | TransportFailure;
export type ReadSubmissionResult =
  | { state: "ok"; data: OsSubmissionStatus }
  | { state: "not_found" }
  | TransportFailure;
export interface SubmissionClient {
  submit(envelope: OnboardingEnvelope): Promise<SubmitResult>;
  readSubmission(submissionId: string): Promise<ReadSubmissionResult>;
}

function refusal(response: Response, body: unknown): TransportFailure | null {
  if (response.status === 401) return { state: "unauthorized" };
  // Missing submit:proposal scope, or the kind is not enabled for Atlas
  // (INBOUND_PROJECT_ONBOARDING_ENABLED and inbound.api.integrationKinds).
  if (response.status === 403) return { state: "refused" };
  if (response.status === 429)
    return {
      state: "rate_limited",
      retryAfter: retryAfterFrom(response, body),
    };
  return null;
}

export function createSubmissionClient(
  config: ContextConfig,
  options: ClientOptions = {},
): SubmissionClient {
  const exchange = exchanger(config, options);
  return {
    async submit(envelope) {
      // Checked before sending: a payload outside the allowlist never leaves.
      const checked = onboardingEnvelopeSchema.safeParse(envelope);
      if (!checked.success) return { state: "invalid_submission" };
      const answer = await exchange(SUBMISSIONS_PATH, {
        method: "POST",
        body: JSON.stringify(checked.data),
      });
      if (answer.state !== "answered") return answer;
      const { response, body } = answer;
      const refused = refusal(response, body);
      if (refused) return refused;
      if (response.status === 400) return { state: "invalid_submission" };
      if (!isJson(response)) return { state: "invalid_response" };
      // The lineage refusals come only with a payload naming `supersedes`;
      // anywhere else the code means nothing here and stays not known.
      if (checked.data.payload.supersedes) {
        const lineage = osLineageRefusalSchema.safeParse(body);
        if (
          lineage.success &&
          response.status ===
            (lineage.data.code === "SUPERSEDES_NOT_FOUND" ? 404 : 409)
        )
          return lineage.data.code === "ALREADY_SUPERSEDED"
            ? {
                state: "already_superseded",
                submissionId: lineage.data.submissionId ?? null,
              }
            : { state: "supersedes_refused" };
      }
      if (response.status === 409) {
        const lock = osAlreadySubmittedSchema.safeParse(body);
        if (lock.success)
          return {
            state: "already_submitted",
            submissionId: lock.data.submissionId ?? null,
            osState: lock.data.state ?? null,
          };
        const conflict = osSubmitConflictSchema.safeParse(body);
        return conflict.success
          ? { state: conflict.data.code }
          : { state: "invalid_response" };
      }
      if (response.status === 202) {
        const filed = osSubmitAcceptedSchema.safeParse(body);
        return filed.success
          ? {
              state: "ok",
              data: {
                submissionId: filed.data.submissionId,
                receivedAt: filed.data.receivedAt,
                payloadSha256: filed.data.payloadSha256,
                duplicate: false,
              },
            }
          : { state: "invalid_response" };
      }
      if (response.status === 200) {
        // Same idempotency key again: the OS returns the original id.
        const again = osSubmitDuplicateSchema.safeParse(body);
        return again.success
          ? {
              state: "ok",
              data: {
                submissionId: again.data.submissionId,
                receivedAt: again.data.receivedAt ?? null,
                payloadSha256: again.data.payloadSha256 ?? null,
                duplicate: true,
              },
            }
          : { state: "invalid_response" };
      }
      return { state: "invalid_response" };
    },
    async readSubmission(submissionId) {
      if (!SUBMISSION_ID_RE.test(submissionId)) return { state: "not_found" };
      const answer = await exchange(`${SUBMISSIONS_PATH}/${submissionId}`, {
        method: "GET",
      });
      if (answer.state !== "answered") return answer;
      const { response, body } = answer;
      const refused = refusal(response, body);
      if (refused) return refused;
      if (
        response.status === 404 &&
        body &&
        typeof body === "object" &&
        (body as { error?: unknown }).error === "no such submission"
      )
        return { state: "not_found" };
      if (response.status !== 200 || !isJson(response))
        return { state: "invalid_response" };
      const status = parseSubmissionStatus(body);
      // A read-back for another submission or kind is never substituted.
      return status &&
        status.submissionId === submissionId &&
        status.kind === ONBOARDING_KIND
        ? { state: "ok", data: status }
        : { state: "invalid_response" };
    },
  };
}

// ── whoami — this credential's optional-feature flags ──────────────────────

export const WHOAMI_PATH = "/api/inbound/v1/whoami";
/** What one whoami read came to: the JSON body of a 200, or why there is
 * none. Kept apart from the body-or-null loader below so the Connections
 * line (lib/flightdeck/connection.ts) can say WHY Atlas is not connected. */
export type WhoamiRead =
  | { state: "ok"; body: unknown }
  | {
      state:
        "unauthorized" | "os_unreachable" | "rate_limited" | "invalid_response";
    };
/** Reads GET /v1/whoami once per call. It spends the same credential-wide
 * rate limit as every other call, and honours (and records) a 429. */
export function createWhoamiReader(
  config: ContextConfig,
  cache: Map<string, { until: number; value?: ContextResult<unknown> }>,
  options: ClientOptions & {
    now?: () => number;
    /** Called on a 401 or 403: the OS refused the credential (apps-32). */
    onRefused?: () => void;
  } = {},
): () => Promise<WhoamiRead> {
  const exchange = exchanger(config, options);
  const now = options.now || Date.now;
  return async () => {
    const blocked = cache.get(RATE_LIMIT_KEY);
    if (blocked && blocked.until > now()) return { state: "rate_limited" };
    const answer = await exchange(WHOAMI_PATH, { method: "GET" });
    if (answer.state !== "answered") return { state: "os_unreachable" };
    const { response, body } = answer;
    if (response.status === 429) {
      cache.set(RATE_LIMIT_KEY, {
        until: now() + retryAfterFrom(response, body) * 1000,
      });
      return { state: "rate_limited" };
    }
    if (response.status === 401 || response.status === 403)
      options.onRefused?.();
    if (response.status === 401) return { state: "unauthorized" };
    return response.status === 200 && isJson(response)
      ? { state: "ok", body }
      : { state: "invalid_response" };
  };
}
/** Loads the whoami body for lib/flightdeck/features.ts: the JSON body of a
 * 200, or null for anything else (the reader then turns every flag off). */
export function createWhoamiLoader(
  config: ContextConfig,
  cache: Map<string, { until: number; value?: ContextResult<unknown> }>,
  options: Parameters<typeof createWhoamiReader>[2] = {},
): () => Promise<unknown> {
  const read = createWhoamiReader(config, cache, options);
  return async () => {
    const answer = await read();
    return answer.state === "ok" ? answer.body : null;
  };
}

/** Submits and read-backs spend the same 30-a-minute credential as the
 * context reads, so they honour (and record) the same rate limit. */
export function createGuardedSubmissions(
  client: SubmissionClient,
  cache: Map<string, { until: number; value?: ContextResult<unknown> }>,
  options: {
    now?: () => number;
    /** Called when the OS refuses the credential (401) or its scope (403),
     * so the other readers drop what they cached for it (apps-32). */
    onRefused?: () => void;
  } = {},
): SubmissionClient {
  const now = options.now || Date.now;
  async function guard<T extends { state: string }>(
    load: () => Promise<T>,
  ): Promise<T | { state: "rate_limited"; retryAfter: number }> {
    const started = now();
    const blocked = cache.get(RATE_LIMIT_KEY);
    if (blocked && blocked.until > started)
      return {
        state: "rate_limited",
        retryAfter: Math.max(1, Math.ceil((blocked.until - started) / 1000)),
      };
    const value = await load();
    if (value.state === "unauthorized" || value.state === "refused")
      options.onRefused?.();
    if (value.state === "rate_limited")
      cache.set(RATE_LIMIT_KEY, {
        until:
          now() + ((value as { retryAfter?: number }).retryAfter ?? 60) * 1000,
      });
    return value;
  }
  return {
    submit: (envelope) => guard(() => client.submit(envelope)),
    readSubmission: (id) => guard(() => client.readSubmission(id)),
  };
}
