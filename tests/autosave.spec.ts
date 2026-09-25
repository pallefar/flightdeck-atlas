import { test, expect } from "@playwright/test";
import {
  createSaveCoordinator,
  RETRY_BACKOFF_MS,
  type SaveTransport,
  type Timers,
} from "../lib/flightdeck/autosave";

// Pure unit checks of the autosave coordinator. No server, no browser: the
// transport is a controllable fetch mock and time is a fake clock, so every
// ordering below is exact rather than raced.

type Call = {
  value: string;
  baseRevision: number;
  signal: AbortSignal;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
};

function fakeTransport() {
  const calls: Call[] = [];
  const send: SaveTransport<string> = (value, baseRevision, signal) =>
    new Promise<Response>((resolve, reject) =>
      calls.push({ value, baseRevision, signal, resolve, reject }),
    );
  return { calls, send };
}

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      due.delete(id as number);
    },
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    timers,
    settle,
    pendingDelays: () => [...due.values()].map((t) => t.at - now),
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        await settle();
        const next = [...due.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        due.delete(next[0]);
        next[1].fn();
      }
      now = end;
      await settle();
    },
  };
}

const saved = (revision: number) =>
  new Response(JSON.stringify({ project: { revision } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const failed = (status: number, body: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error: `status ${status}`, ...body }), {
    status,
    headers: { "content-type": "application/json" },
  });

function setup(initialRevision = 1, extra: { timeoutMs?: number } = {}) {
  const clock = fakeClock();
  const transport = fakeTransport();
  const saver = createSaveCoordinator<string>({
    initialRevision,
    send: transport.send,
    debounceMs: 500,
    timers: clock.timers,
    ...extra,
  });
  return { clock, calls: transport.calls, saver };
}

test("state exposes pending, acknowledgedRevision and lastError", async () => {
  const { saver } = setup(4);
  const s = saver.getState();
  expect(s).toMatchObject({
    status: "idle",
    pending: false,
    acknowledgedRevision: 4,
    lastError: null,
  });
});

test("edits are debounced and coalesced into one save of the latest value", async () => {
  const { clock, calls, saver } = setup();
  saver.edit("a");
  await clock.advance(200);
  saver.edit("ab");
  await clock.advance(200);
  saver.edit("abc");
  expect(saver.getState()).toMatchObject({ status: "pending", pending: true });
  await clock.advance(499);
  expect(calls).toHaveLength(0);
  await clock.advance(1);
  expect(calls.map((c) => [c.value, c.baseRevision])).toEqual([["abc", 1]]);
  expect(saver.getState().status).toBe("saving");
  calls[0].resolve(saved(2));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "saved",
    pending: false,
    acknowledgedRevision: 2,
    lastError: null,
  });
});

test("edits during an in-flight save give exactly one follow-up with the latest value", async () => {
  const { clock, calls, saver } = setup();
  saver.edit("v1");
  await clock.advance(500);
  expect(calls).toHaveLength(1);
  saver.edit("v2");
  saver.edit("v3");
  await clock.advance(5_000);
  // Single flight: nothing else goes out while the first save is open.
  expect(calls).toHaveLength(1);
  expect(saver.getState()).toMatchObject({ status: "saving", pending: true });
  calls[0].resolve(saved(2));
  await clock.advance(500);
  expect(calls).toHaveLength(2);
  expect(calls[1].value).toBe("v3");
  // The follow-up is based on the revision the first save produced.
  expect(calls[1].baseRevision).toBe(2);
  calls[1].resolve(saved(3));
  await clock.advance(5_000);
  expect(calls).toHaveLength(2);
  expect(saver.getState()).toMatchObject({
    status: "saved",
    pending: false,
    acknowledgedRevision: 3,
  });
});

test("a slow first response arriving after the second never regresses acknowledgedRevision", async () => {
  const { clock, calls, saver } = setup(1, { timeoutMs: 10_000 });
  saver.edit("v1");
  await clock.advance(500);
  expect(calls).toHaveLength(1);
  // The first request hangs past its timeout: it is abandoned and retried.
  await clock.advance(10_000);
  expect(calls[0].signal.aborted).toBe(true);
  expect(saver.getState().status).toBe("retrying");
  await clock.advance(RETRY_BACKOFF_MS[0]);
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ value: "v1", baseRevision: 1 });
  calls[1].resolve(saved(2));
  await clock.settle();
  saver.edit("v2");
  await clock.advance(500);
  expect(calls[2]).toMatchObject({ value: "v2", baseRevision: 2 });
  calls[2].resolve(saved(3));
  await clock.settle();
  expect(saver.getState().acknowledgedRevision).toBe(3);
  // The abandoned first request finally answers, with an older revision.
  calls[0].resolve(saved(2));
  await clock.advance(5_000);
  expect(saver.getState()).toMatchObject({
    status: "saved",
    acknowledgedRevision: 3,
    pending: false,
  });
  expect(calls).toHaveLength(3);
});

test("a late conflict from an abandoned request is ignored", async () => {
  const { clock, calls, saver } = setup(1, { timeoutMs: 10_000 });
  saver.edit("v1");
  await clock.advance(10_500);
  await clock.advance(RETRY_BACKOFF_MS[0]);
  calls[1].resolve(saved(2));
  await clock.settle();
  calls[0].resolve(failed(409));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "saved",
    acknowledgedRevision: 2,
  });
});

test("a 409 moves to conflict and stops", async () => {
  const { clock, calls, saver } = setup(3);
  saver.edit("mine");
  await clock.advance(500);
  calls[0].resolve(failed(409));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "conflict",
    pending: true,
    acknowledgedRevision: 3,
  });
  expect(saver.getState().lastError).toContain("409");
  // Further edits are kept but never sent while in conflict.
  saver.edit("mine, more");
  await clock.advance(120_000);
  expect(calls).toHaveLength(1);
  expect(saver.getState()).toMatchObject({ status: "conflict", pending: true });
  // Keep mine: resume on the revision now on the server; the latest local
  // value is what goes out, against that revision.
  saver.resume(7);
  await clock.advance(500);
  expect(calls[1]).toMatchObject({ value: "mine, more", baseRevision: 7 });
  calls[1].resolve(saved(8));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "saved",
    acknowledgedRevision: 8,
    lastError: null,
  });
});

test("a locked draft gives stopped and sends nothing further", async () => {
  const { clock, calls, saver } = setup(2);
  saver.edit("x");
  await clock.advance(500);
  calls[0].resolve(failed(409, { code: "draft_locked" }));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "stopped",
    stopReason: "locked",
    pending: true,
    acknowledgedRevision: 2,
  });
  saver.edit("y");
  await clock.advance(120_000);
  expect(calls).toHaveLength(1);
  expect(saver.getState().status).toBe("stopped");
});

test("a refused save (403) stops without retrying", async () => {
  const { clock, calls, saver } = setup();
  saver.edit("x");
  await clock.advance(500);
  calls[0].resolve(failed(403));
  await clock.advance(120_000);
  expect(calls).toHaveLength(1);
  expect(saver.getState()).toMatchObject({
    status: "stopped",
    stopReason: "refused",
  });
});

test("a 5xx or offline response retries with backoff 2/4/8/30 s", async () => {
  const { clock, calls, saver } = setup();
  expect(RETRY_BACKOFF_MS).toEqual([2_000, 4_000, 8_000, 30_000]);
  saver.edit("x");
  await clock.advance(500);
  const expectRetryAfter = async (ms: number, n: number) => {
    expect(saver.getState().status).toBe("retrying");
    expect(saver.getState().retryInMs).toBe(ms);
    await clock.advance(ms - 1);
    expect(calls).toHaveLength(n - 1);
    await clock.advance(1);
    expect(calls).toHaveLength(n);
  };
  calls[0].resolve(failed(503));
  await clock.settle();
  expect(saver.getState().lastError).toContain("503");
  await expectRetryAfter(2_000, 2);
  calls[1].reject(new TypeError("Failed to fetch"));
  await clock.settle();
  expect(saver.getState().lastError).toContain("Failed to fetch");
  await expectRetryAfter(4_000, 3);
  calls[2].resolve(failed(500));
  await clock.settle();
  await expectRetryAfter(8_000, 4);
  calls[3].resolve(failed(502));
  await clock.settle();
  await expectRetryAfter(30_000, 5);
  calls[4].resolve(failed(504));
  await clock.settle();
  // Capped at 30 s from then on.
  await expectRetryAfter(30_000, 6);
  // An edit while retrying rides on the scheduled retry, it does not jump it.
  calls[5].resolve(failed(500));
  await clock.settle();
  saver.edit("xy");
  await clock.advance(29_999);
  expect(calls).toHaveLength(6);
  await clock.advance(1);
  expect(calls[6].value).toBe("xy");
  calls[6].resolve(saved(2));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "saved",
    acknowledgedRevision: 2,
    lastError: null,
    retryInMs: null,
    pending: false,
  });
  // Backoff restarts from 2 s after a success.
  saver.edit("xyz");
  await clock.advance(500);
  calls[7].resolve(failed(503));
  await clock.settle();
  expect(saver.getState().retryInMs).toBe(2_000);
});

test("flush sends the latest edit now and resolves with the settled state", async () => {
  const { clock, calls, saver } = setup();
  saver.edit("now");
  const done = saver.flush();
  await clock.settle();
  expect(calls).toHaveLength(1);
  calls[0].resolve(saved(2));
  const state = await done;
  expect(state).toMatchObject({ status: "saved", acknowledgedRevision: 2 });
});

test("subscribers see every state change and dispose stops everything", async () => {
  const { clock, calls, saver } = setup();
  const seen: string[] = [];
  const off = saver.subscribe((s) => seen.push(s.status));
  saver.edit("a");
  await clock.advance(500);
  calls[0].resolve(saved(2));
  await clock.settle();
  expect(seen).toEqual(["pending", "saving", "saved"]);
  off();
  saver.edit("b");
  saver.dispose();
  await clock.advance(120_000);
  expect(calls).toHaveLength(1);
  expect(seen).toEqual(["pending", "saving", "saved"]);
});

test("a 2xx without a readable revision stops rather than guessing", async () => {
  const { clock, calls, saver } = setup(5);
  saver.edit("a");
  await clock.advance(500);
  calls[0].resolve(new Response("<html>", { status: 200 }));
  await clock.settle();
  expect(saver.getState()).toMatchObject({
    status: "stopped",
    stopReason: "refused",
    acknowledgedRevision: 5,
    pending: true,
  });
});
