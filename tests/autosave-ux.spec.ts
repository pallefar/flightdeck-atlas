import { test, expect } from "@playwright/test";
import {
  autosavePill,
  bufferKey,
  clearHeld,
  confirmLeave,
  hasUnsavedWork,
  readHeld,
  registerLeaveGuard,
  sameOutsideOnboarding,
  stableJson,
  writeHeld,
} from "../lib/flightdeck/autosave-ux";
import type { AutosaveState } from "../lib/flightdeck/autosave";

// The pure rules behind the onboarding autosave UI (onb-atlas-save-ux): the
// pill's words per coordinator state, when leaving must ask, the held copy
// (per viewer, per project, never breaking on a blocked store), and the
// route guard registry.

const state = (over: Partial<AutosaveState> = {}): AutosaveState => ({
  status: "idle",
  pending: false,
  acknowledgedRevision: 7,
  lastError: null,
  stopReason: null,
  retryInMs: null,
  ...over,
});

test("the pill follows every coordinator state", () => {
  const at = new Date(2026, 8, 25, 12, 4);
  expect(autosavePill(state()).text).toBe("All changes saved (revision 7)");
  expect(autosavePill(state({ status: "pending", pending: true })).text).toBe(
    "Changes not saved yet",
  );
  expect(autosavePill(state({ status: "saving", pending: true })).text).toBe(
    "Saving…",
  );
  const saved = autosavePill(state({ status: "saved" }), { savedAt: at });
  expect(saved.text).toMatch(/^Saved 12:04.*\(revision 7\)$/);
  expect(saved.tone).toBe("ok");
  const retry = autosavePill(
    state({ status: "retrying", pending: true, retryInMs: 4_000 }),
  );
  expect(retry).toEqual({ text: "Not saved, retrying in 4 s", tone: "warn" });
  expect(autosavePill(state({ status: "conflict", pending: true })).text).toBe(
    "Not saved: someone else saved this draft",
  );
  expect(
    autosavePill(
      state({ status: "stopped", pending: true, stopReason: "locked" }),
    ).text,
  ).toMatch(/^Not saved: FlightDeck may hold this draft/);
  expect(
    autosavePill(
      state({
        status: "stopped",
        pending: true,
        stopReason: "refused",
        lastError: "You do not have permission to change this project.",
      }),
    ).text,
  ).toBe("Not saved: You do not have permission to change this project");
  // Fields outside the autosaved part wait for Save now, and the pill says so.
  expect(
    autosavePill(state({ status: "saved" }), { savedAt: at, basicsDirty: true })
      .text,
  ).toBe("Basics not saved yet: use Save now");
  // German comes from the same module.
  expect(autosavePill(state({ status: "saving" }), { locale: "de" }).text).toBe(
    "Wird gespeichert…",
  );
});

test("leaving asks only while something is not on the server", () => {
  expect(hasUnsavedWork(state(), false, false)).toBe(false);
  expect(hasUnsavedWork(state({ status: "saved" }), false, false)).toBe(false);
  expect(
    hasUnsavedWork(state({ status: "pending", pending: true }), false, false),
  ).toBe(true);
  expect(
    hasUnsavedWork(state({ status: "retrying", pending: true }), false, false),
  ).toBe(true);
  expect(
    hasUnsavedWork(state({ status: "conflict", pending: true }), false, false),
  ).toBe(true);
  expect(hasUnsavedWork(state(), true, false)).toBe(true);
  expect(hasUnsavedWork(state(), false, true)).toBe(true);
});

test("the route guard asks each registered form and honours the answer", () => {
  let unsaved = true;
  const off = registerLeaveGuard(() => (unsaved ? "Leave?" : null));
  const asked: string[] = [];
  expect(confirmLeave((q) => (asked.push(q), false))).toBe(false);
  expect(confirmLeave((q) => (asked.push(q), true))).toBe(true);
  unsaved = false;
  expect(confirmLeave((q) => (asked.push(q), false))).toBe(true);
  expect(asked).toEqual(["Leave?", "Leave?"]);
  off();
  unsaved = true;
  expect(confirmLeave(() => false)).toBe(true);
});

class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const blocked = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

test("the held copy is per viewer and per project, and a blocked store never throws", () => {
  const store = new MemoryStore();
  const held = {
    draft: { a: 1 },
    baseDraft: { a: 0 },
    basicsDirty: false,
    base: 3,
  };
  writeHeld("u1", "p1", held, store);
  expect(readHeld("u1", "p1", store)).toMatchObject({ v: 1, ...held });
  expect(readHeld("u2", "p1", store)).toBeNull();
  expect(readHeld("u1", "p2", store)).toBeNull();
  expect(bufferKey("u1", "p1")).not.toBe(bufferKey("u2", "p1"));
  clearHeld("u1", "p1", store);
  expect(readHeld("u1", "p1", store)).toBeNull();
  // Garbage or an older shape is ignored, never trusted.
  store.setItem(bufferKey("u1", "p1"), "{not json");
  expect(readHeld("u1", "p1", store)).toBeNull();
  store.setItem(bufferKey("u1", "p1"), JSON.stringify({ v: 1, draft: {} }));
  expect(readHeld("u1", "p1", store)).toBeNull();
  expect(() => writeHeld("u1", "p1", held, blocked)).not.toThrow();
  expect(readHeld("u1", "p1", blocked)).toBeNull();
  expect(() => clearHeld("u1", "p1", blocked)).not.toThrow();
  expect(readHeld("u1", "p1", null)).toBeNull();
});

test("versions that differ only in the onboarding part let the form move its base", () => {
  expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
    stableJson({ a: { c: 3, d: 2 }, b: 1 }),
  );
  const a = {
    name: "X",
    description: "S",
    revision: 3,
    updatedAt: "t1",
    activity: [1],
    onboarding: { countryCode: "DE" },
    onboardingRevision: 2,
  };
  const b = {
    ...a,
    revision: 4,
    updatedAt: "t2",
    activity: [1, 2],
    onboarding: { countryCode: "FR" },
    onboardingRevision: 4,
  };
  expect(sameOutsideOnboarding(a, b)).toBe(true);
  expect(sameOutsideOnboarding(a, { ...b, description: "T" })).toBe(false);
});
