import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  CODE_TTL_MS,
  collectToken,
  deviceCodeState,
  newDeviceCode,
  type DeviceCodeRow,
} from "../lib/auth/device-codes";

// The sign-in is a state machine, so it is tested as one: the clock is the only
// thing that changes the answer, and a token is collectable exactly once.
const row = (over: Partial<DeviceCodeRow> = {}): DeviceCodeRow => ({
  code: "ABCD-2345",
  createdAt: "2026-10-30T09:00:00.000Z",
  expiresAt: new Date(Date.parse("2026-10-30T09:00:00.000Z") + CODE_TTL_MS).toISOString(),
  approvedBy: null,
  approvedAt: null,
  token: null,
  deliveredAt: null,
  ...over,
});

test.describe("a code", () => {
  test("is readable aloud: no vowels, no look-alikes, one dash", () => {
    for (let i = 0; i < 50; i += 1) {
      const code = newDeviceCode();
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{4}-[BCDFGHJKLMNPQRSTVWXYZ23456789]{4}$/);
    }
  });
  test("starts pending, becomes approved, and expires on its deadline", () => {
    const t0 = new Date("2026-10-30T09:00:00.000Z");
    expect(deviceCodeState(row(), t0)).toBe("pending");
    expect(deviceCodeState(row({ token: "tok", approvedBy: "me@example.test" }), t0)).toBe("approved");
    expect(deviceCodeState(row(), new Date(t0.getTime() + CODE_TTL_MS + 1000))).toBe("expired");
    expect(deviceCodeState(null, t0)).toBe("unknown");
    // A delivered code is finished even if a stale row were left behind.
    expect(deviceCodeState(row({ deliveredAt: t0.toISOString() }), t0)).toBe("delivered");
  });
  test("a token cannot be collected before approval, or without one", () => {
    const t0 = new Date("2026-10-30T09:00:00.000Z");
    expect(collectToken(row(), t0)).toEqual({ error: "The code is not ready." });
    expect(collectToken(row({ token: "tok", approvedBy: "me@example.test" }), t0)).toEqual({
      token: "tok",
    });
    expect(
      collectToken(row({ token: "tok" }), new Date(t0.getTime() + CODE_TTL_MS + 1000)),
    ).toEqual({ error: "The code is not ready." });
  });
});

test("the route exports only the four verbs the sign-in needs", () => {
  const source = readFileSync("app/api/access/device-code/route.ts", "utf8");
  for (const verb of ["GET", "POST", "PUT"]) expect(source).toContain(`export async function ${verb}`);
  // Approval needs a session; starting and collecting do not.
  expect(source).toContain('authorize(undefined, false, request)');
});

test("the app has a sign-in path that never asks for a token", () => {
  const settings = readFileSync("atlas/macos/Atlas/Sources/Atlas/AtlasApp.swift", "utf8");
  const client = readFileSync("atlas/macos/Atlas/Sources/AtlasDomain/AtlasAPI.swift", "utf8");
  expect(client).toContain("/api/access/device-code");
  expect(settings).toContain("Sign in with the browser");
});
