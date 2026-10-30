import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SUITE_APPS, resolvedSuiteURL, suiteLinks } from "../lib/suite/apps";

// Atlas is the front door, so the suite's links are configuration, not guesses.
test("a suite URL is resolved from its template, or reported as unset", () => {
  expect(resolvedSuiteURL("https://maps.example.test/m?project={project}", "p-1")).toBe(
    "https://maps.example.test/m?project=p-1",
  );
  expect(resolvedSuiteURL(undefined, "p-1")).toBeNull();
  expect(resolvedSuiteURL("   ", "p-1")).toBeNull();
  // A template that is not an http(s) URL is refused rather than rendered.
  expect(resolvedSuiteURL("javascript:alert(1)", "p-1")).toBeNull();
  expect(resolvedSuiteURL("not a url", "p-1")).toBeNull();
  expect(resolvedSuiteURL("https://x.test/?p={project}", "a b")).toBe("https://x.test/?p=a%20b");
});

test("every suite app is listed, and an unconfigured one says so", () => {
  const links = suiteLinks({ ATLAS_MAPS_URL: "https://maps.test/{project}" }, "p-1");
  expect(links.map((link) => link.key)).toEqual(SUITE_APPS.map((app) => app.key));
  const maps = links.find((link) => link.key === "maps");
  expect(maps?.url).toBe("https://maps.test/p-1");
  expect(links.find((link) => link.key === "studio")?.url).toBeNull();
  // Each app names the environment variable it reads, so a missing link is
  // actionable rather than mysterious.
  for (const app of SUITE_APPS) expect(app.env).toMatch(/^ATLAS_[A-Z]+_URL$/);
});

test("the suite route is read-only and names the project it needs", () => {
  const source = readFileSync("app/api/suite/route.ts", "utf8");
  expect(source).toContain("export async function GET");
  expect(source).not.toContain("export async function POST");
  expect(source).toContain("project_required");
});
