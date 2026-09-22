// Server-only transport for the FlightDeck OS inbound context API.
// The inbound credential is a machine credential held in Atlas server
// configuration. It is only ever placed in the Authorization header of a
// request to the configured OS origin. It is never logged, returned in a
// response or error, stored, or sent to the browser.
import {
  emptyContext,
  osIdSchema,
  osNotFoundSchema,
  osProjectsResponseSchema,
  osWorkspaceDisabledSchema,
  osWorkspacesResponseSchema,
  pickProject,
  pickWorkspace,
  visibleProjects,
  type ContextFailureState,
  type ContextView,
  type OsProjectsResponse,
  type OsSelection,
  type OsWorkspacesResponse,
} from "./context";

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
}

export const WORKSPACES_PATH = "/api/inbound/v1/context/workspaces";
export const projectsPath = (workspaceId: string) =>
  `${WORKSPACES_PATH}/${encodeURIComponent(workspaceId)}/projects`;
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

export function createContextClient(
  config: ContextConfig,
  options: { fetch?: Fetcher; timeoutMs?: number } = {},
): ContextReader {
  const send: Fetcher = options.fetch || ((url, init) => fetch(url, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  async function get(
    path: string,
    notFound: boolean,
  ): Promise<{ state: "ok"; body: unknown } | ContextFailure> {
    let response: Response;
    try {
      // Only the bearer credential and Accept header are sent: no cookies,
      // no X-Workspace-Id, no browser identity.
      response = await send(config.baseUrl + path, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/json",
        },
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
    if (
      response.status !== 200 ||
      !response.headers.get("content-type")?.includes("application/json") ||
      body === null
    )
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
  options: { fresh?: boolean; ttlMs?: number; now?: () => number } = {},
): ContextReader {
  const ttlMs = options.ttlMs ?? 10_000,
    now = options.now || Date.now;
  async function cached<T>(
    key: string,
    load: () => Promise<ContextResult<T>>,
  ): Promise<ContextResult<T>> {
    const started = now();
    const blocked = cache.get(RATE_LIMIT_KEY);
    if (blocked && blocked.until > started)
      return {
        state: "rate_limited",
        retryAfter: Math.max(1, Math.ceil((blocked.until - started) / 1000)),
      };
    const hit = cache.get(key);
    if (!options.fresh && hit?.value && hit.until > started)
      return hit.value as ContextResult<T>;
    const value = await load();
    if (cache.size > 200) cache.clear();
    if (value.state === "ok") cache.set(key, { until: now() + ttlMs, value });
    else {
      cache.delete(key);
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
  };
}
const RATE_LIMIT_KEY = "rate-limit";
