import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// The native client is generated from the same schemas the web suite parses.
// This spec makes it impossible to change a schema and leave the committed
// Swift models behind: `gen-swift.mjs --check` compares the rendered model
// with the file in the tree and exits non-zero when they differ.
test("the committed Swift models match schema/*.schema.json", () => {
  const output = execFileSync("node", ["scripts/gen-swift.mjs", "--check"], {
    encoding: "utf8",
  });
  expect(output).toContain("match");
});
test("the native package, its tests and its build script exist", () => {
  for (const path of [
    "atlas/macos/Atlas/Package.swift",
    "atlas/macos/Atlas/build.sh",
    "atlas/macos/Atlas/Sources/AtlasDomain/Generated.swift",
    "atlas/macos/Atlas/Sources/AtlasDomain/Stages.swift",
    "atlas/macos/Atlas/Sources/Atlas/AtlasApp.swift",
    "atlas/macos/Atlas/Tests/AtlasDomainTests/ContractTests.swift",
  ])
    expect(existsSync(path), path).toBe(true);
});
test("every analysis anchor has a section to jump to", () => {
  // The next actions call scrollTo(anchor). An anchor without a matching
  // `.id(...)` fails silently at runtime, so the wiring is checked here.
  const analysis = readFileSync(
    "atlas/macos/Atlas/Sources/AtlasDomain/Analysis.swift",
    "utf8",
  );
  const declaration = analysis.match(/public enum AnalysisAnchor[^{]*\{([\s\S]*?)\}/);
  const anchors = (declaration?.[1] ?? "")
    .split(/[\n,]/)
    .map((line) => line.replace(/case/g, "").trim())
    .filter(Boolean);
  expect(anchors.sort()).toEqual(["evidence", "gate", "intake", "reuse", "roles", "value"]);
  const view = readFileSync("atlas/macos/Atlas/Sources/Atlas/AtlasApp.swift", "utf8");
  for (const anchor of anchors)
    expect(view, anchor).toContain(`.id("${anchor}")`);
});
test("the Swift tests decode the same fixtures as the web suite", () => {
  const source = execFileSync(
    "cat",
    ["tests/fixtures/atlas-gate-event.v1.json"],
    { encoding: "utf8" },
  );
  expect(source).toContain("atlas-gate-event/1");
  const swift = execFileSync(
    "cat",
    ["atlas/macos/Atlas/Tests/AtlasDomainTests/ContractTests.swift"],
    { encoding: "utf8" },
  );
  expect(swift).toContain("atlas-gate-event.v1");
  expect(swift).toContain("atlas-onboarding-record.v1");
});
