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
import {
  SUBMISSION_ID_RE,
  ONBOARDING_KIND,
  onboardingEnvelopeSchema,
  osAlreadySubmittedSchema,
  osSubmitAcceptedSchema,
  osSubmitConflictSchema,
  osSubmitDuplicateSchema,
  parseSubmissionStatus,
  type OnboardingEnvelope,
  type OsSubmissionStatus,
} from "./onboarding";

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

type ClientOptions = { fetch?: Fetcher; timeoutMs?: number };
type Exchange = (
  path: string,
  init: { method: "GET" | "POST"; body?: string },
) => Promise<
  | { state: "answered"; response: Response; body: unknown }
  | { state: "os_unreachable" }
>;
/** The one place Atlas talks to the OS. Only the bearer credential, Accept
 * and (for a POST) Content-Type are sent: no cookies, no X-Workspace-Id, no
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

/** Submits and read-backs spend the same 30-a-minute credential as the
 * context reads, so they honour (and record) the same rate limit. */
export function createGuardedSubmissions(
  client: SubmissionClient,
  cache: Map<string, { until: number; value?: ContextResult<unknown> }>,
  options: { now?: () => number } = {},
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
