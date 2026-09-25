// Single-flight autosave coordinator for the onboarding draft.
//
// Pure: no React, no DOM, no fetch of its own. The caller hands it a transport
// (one PUT against a base revision) and, in tests, a clock. It guarantees:
//   - edits are debounced and coalesced; only the latest value is ever sent;
//   - at most one save is in flight, and edits made meanwhile give exactly one
//     follow-up, based on the revision that save produced;
//   - a response from an abandoned (timed-out) request never changes state, so
//     a slow answer arriving late cannot regress acknowledgedRevision or raise
//     a stale conflict;
//   - 409 stops in "conflict" and keeps the local value (nothing is thrown
//     away and nothing is overwritten); a locked draft (409 draft_locked) and
//     any other refusal stop in "stopped"; neither is retried;
//   - 5xx, 408, 429, network failures and timeouts retry with backoff
//     2 / 4 / 8 / 30 s, the last step repeating.
// The UI (status pill, leave guard, conflict recovery) is a separate item and
// reads getState()/subscribe().

export type SaveTransport<T> = (
  value: T,
  baseRevision: number,
  signal: AbortSignal,
) => Promise<Response>;

export type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export type AutosaveStatus =
  "idle" | "pending" | "saving" | "saved" | "retrying" | "conflict" | "stopped";

export type AutosaveState = {
  status: AutosaveStatus;
  /** True while there is a local edit the server has not acknowledged. */
  pending: boolean;
  /** The revision of the last save this coordinator saw succeed. Never
   * decreases. */
  acknowledgedRevision: number;
  lastError: string | null;
  /** Why saving stopped: the draft is locked, or the save was refused
   * (permission, validation, an unreadable answer). Null unless stopped. */
  stopReason: "locked" | "refused" | null;
  /** The delay before the scheduled retry; null unless retrying. */
  retryInMs: number | null;
};

export const RETRY_BACKOFF_MS = [2_000, 4_000, 8_000, 30_000] as const;

export type SaveCoordinatorOptions<T> = {
  initialRevision: number;
  send: SaveTransport<T>;
  debounceMs?: number;
  /** A request unanswered after this long is abandoned and retried. */
  timeoutMs?: number;
  timers?: Timers;
  /** Reads the new revision from a 2xx body. Defaults to the Atlas project
   * PUT answer, { project: { revision } }. */
  readRevision?: (body: unknown) => number | null;
};

export type SaveCoordinator<T> = {
  edit(value: T): void;
  /** Sends the latest edit now (skipping debounce and a waiting retry) and
   * resolves once nothing is in flight or scheduled. */
  flush(): Promise<AutosaveState>;
  /** Continues after a conflict or stop, against the given server revision
   * (for "Keep mine" after the caller reconciled). The latest local value is
   * what gets sent next. */
  resume(revision: number): void;
  getState(): AutosaveState;
  subscribe(fn: (s: AutosaveState) => void): () => void;
  dispose(): void;
};

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) =>
    globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

const defaultReadRevision = (body: unknown): number | null => {
  const r = (body as { project?: { revision?: unknown } } | null)?.project
    ?.revision;
  return typeof r === "number" && Number.isInteger(r) && r > 0 ? r : null;
};

const RETRYABLE = (status: number) =>
  status >= 500 || status === 408 || status === 429;

export function createSaveCoordinator<T>(
  opts: SaveCoordinatorOptions<T>,
): SaveCoordinator<T> {
  const timers = opts.timers ?? defaultTimers;
  const debounceMs = opts.debounceMs ?? 800;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const readRevision = opts.readRevision ?? defaultReadRevision;

  let status: AutosaveStatus = "idle";
  let acknowledgedRevision = opts.initialRevision;
  let baseRevision = opts.initialRevision;
  let lastError: string | null = null;
  let stopReason: AutosaveState["stopReason"] = null;
  let retryInMs: number | null = null;

  let latest: { value: T } | null = null;
  let editSeq = 0;
  let ackSeq = 0;
  let failures = 0;

  let debounceTimer: unknown = null;
  let retryTimer: unknown = null;
  // The one request whose answer counts; any other answer is ignored.
  let inFlight: {
    id: number;
    seq: number;
    controller: AbortController;
    timeout: unknown;
  } | null = null;
  let requestId = 0;
  let flushing = false;
  let disposed = false;

  const listeners = new Set<(s: AutosaveState) => void>();
  let waiters: ((s: AutosaveState) => void)[] = [];
  let lastEmitted = "";

  const getState = (): AutosaveState => ({
    status,
    pending: editSeq > ackSeq,
    acknowledgedRevision,
    lastError,
    stopReason,
    retryInMs,
  });

  function emit() {
    const s = getState();
    const key = JSON.stringify(s);
    if (key !== lastEmitted) {
      lastEmitted = key;
      for (const fn of [...listeners]) fn(s);
    }
    // A flush settles once nothing is in flight or debouncing; a scheduled
    // retry counts as settled, so a leave guard is never left waiting.
    if (waiters.length && !inFlight && debounceTimer === null) {
      flushing = false;
      const done = waiters;
      waiters = [];
      for (const w of done) w(s);
    }
  }

  const clear = (id: unknown) => {
    if (id !== null) timers.clearTimeout(id);
    return null;
  };

  const halted = () =>
    disposed || status === "conflict" || status === "stopped";

  function schedule() {
    if (halted() || inFlight || retryTimer !== null) return;
    if (editSeq <= ackSeq) return;
    debounceTimer = clear(debounceTimer);
    if (flushing) {
      start();
      return;
    }
    status = "pending";
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      start();
    }, debounceMs);
  }

  function start() {
    if (halted() || inFlight || !latest || editSeq <= ackSeq) {
      emit();
      return;
    }
    debounceTimer = clear(debounceTimer);
    retryTimer = clear(retryTimer);
    retryInMs = null;
    const id = ++requestId;
    const seq = editSeq;
    const controller = new AbortController();
    const timeout = timers.setTimeout(() => {
      if (inFlight?.id !== id) return;
      controller.abort();
      inFlight = null;
      retry("The save timed out.");
    }, timeoutMs);
    inFlight = { id, seq, controller, timeout };
    status = "saving";
    emit();
    let sent: Promise<Response>;
    try {
      sent = opts.send(latest.value, baseRevision, controller.signal);
    } catch (e) {
      sent = Promise.reject(e);
    }
    sent.then(
      (r) => answered(id, r),
      (e) => {
        if (claim(id) === null) return;
        retry(e instanceof Error ? e.message : "The save could not be sent.");
      },
    );
  }

  /** Claims the answer if it belongs to the live request: returns the edit
   * it carried, or null for an abandoned request (whose answer is ignored). */
  function claim(id: number) {
    if (disposed || inFlight?.id !== id) return null;
    clear(inFlight.timeout);
    const { seq } = inFlight;
    inFlight = null;
    return seq;
  }

  async function answered(id: number, r: Response) {
    if (disposed || inFlight?.id !== id) return;
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    const seq = claim(id);
    if (seq === null) return;
    const message = (body as { error?: unknown } | null)?.error;
    const error =
      typeof message === "string" && message
        ? message
        : `The save failed (HTTP ${r.status}).`;
    if (r.ok) {
      const revision = readRevision(body);
      if (revision === null) {
        stop("refused", "The save answer carried no project revision.");
        return;
      }
      acknowledgedRevision = Math.max(acknowledgedRevision, revision);
      baseRevision = acknowledgedRevision;
      ackSeq = Math.max(ackSeq, seq);
      failures = 0;
      lastError = null;
      status = "saved";
      schedule();
      emit();
      return;
    }
    if (r.status === 409) {
      if ((body as { code?: unknown } | null)?.code === "draft_locked")
        stop("locked", error);
      else {
        status = "conflict";
        lastError = error;
        emit();
      }
      return;
    }
    if (RETRYABLE(r.status)) {
      retry(error);
      return;
    }
    stop("refused", error);
  }

  function stop(reason: "locked" | "refused", error: string) {
    status = "stopped";
    stopReason = reason;
    lastError = error;
    emit();
  }

  function retry(error: string) {
    if (disposed) return;
    const delay =
      RETRY_BACKOFF_MS[Math.min(failures, RETRY_BACKOFF_MS.length - 1)];
    failures++;
    lastError = error;
    status = "retrying";
    retryInMs = delay;
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      start();
    }, delay);
    emit();
  }

  return {
    edit(value) {
      if (disposed) return;
      latest = { value };
      editSeq++;
      if (!halted() && !inFlight && retryTimer === null) schedule();
      emit();
    },
    flush() {
      return new Promise<AutosaveState>((resolve) => {
        waiters.push(resolve);
        flushing = true;
        if (!halted() && !inFlight && editSeq > ackSeq) {
          retryTimer = clear(retryTimer);
          start();
        } else emit();
      });
    },
    resume(revision) {
      if (disposed || (status !== "conflict" && status !== "stopped")) return;
      baseRevision = revision;
      failures = 0;
      lastError = null;
      stopReason = null;
      status = editSeq > ackSeq ? "pending" : "saved";
      schedule();
      emit();
    },
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      disposed = true;
      debounceTimer = clear(debounceTimer);
      retryTimer = clear(retryTimer);
      if (inFlight) {
        clear(inFlight.timeout);
        inFlight.controller.abort();
        inFlight = null;
      }
      listeners.clear();
      const done = waiters;
      waiters = [];
      for (const w of done) w(getState());
    },
  };
}
