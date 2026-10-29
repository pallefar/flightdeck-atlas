import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// The route files are thin, and a test that mocks fetch cannot see a missing
// HTTP method: an unexported POST once left the create flow dead while every
// mocked test passed. This spec reads the route files and pins the methods the
// clients actually call.
const read = (path: string) => readFileSync(path, "utf8");
const methods = (path: string) =>
  [...read(path).matchAll(/export async function (GET|POST|PATCH|DELETE|PUT)/g)]
    .map((match) => match[1])
    .sort();
test("the onboarding routes export every method the clients call", () => {
  expect(methods("app/api/onboarding/route.ts")).toEqual(["GET"]);
  expect(methods("app/api/onboarding/[id]/route.ts")).toEqual(["GET", "PATCH", "POST"]);
  expect(methods("app/api/onboarding/[id]/gate/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/reuse/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/evidence/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/value/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/handoff/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/compliance/route.ts")).toEqual(["POST"]);
});
test("the workspace and role-assignment routes exist", () => {
  expect(methods("app/api/workspaces/route.ts")).toEqual(["GET", "POST"]);
  expect(methods("app/api/workspaces/[id]/members/route.ts")).toEqual(["POST"]);
  expect(methods("app/api/onboarding/[id]/roles/route.ts")).toEqual(["POST"]);
});
test("the device-token route mints, lists and revokes", () => {
  expect(methods("app/api/access/device-tokens/route.ts")).toEqual(["DELETE", "GET", "POST"]);
});
test("every onboarding route passes the request to authorize, so a Bearer token works", () => {
  const source = read("lib/onboarding/routes.ts");
  const calls = [...source.matchAll(/deps\.authorize\("([^"]+)"(, request)?\)/g)];
  expect(calls.length).toBeGreaterThan(5);
  for (const call of calls) expect(call[2], call[1]).toBe(", request");
});
