import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type LintResult = {
  filePath: string;
  errorCount: number;
  messages: { line: number; ruleId: string | null; severity: number }[];
};

// `npm run lint` is part of the check list in README.md. This spec makes
// `npx playwright test` fail on a lint error too, so the check cannot drift
// red again unnoticed. Warnings are reported by ESLint but do not fail it.
// No browser, no server: this runs the repo's own lint script.
test("npm run lint reports no ESLint errors", () => {
  test.setTimeout(240_000);
  const root = fileURLToPath(new URL("..", import.meta.url));
  const run = spawnSync(
    "npm",
    ["run", "lint", "--silent", "--", "--format", "json"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  expect(run.error).toBeUndefined();
  expect(run.stderr.trim()).toBe("");
  const results = JSON.parse(run.stdout) as LintResult[];
  expect(results.length).toBeGreaterThan(0);
  const errors = results.flatMap((r) =>
    r.messages
      .filter((m) => m.severity === 2)
      .map((m) => `${path.relative(root, r.filePath)}:${m.line} ${m.ruleId}`),
  );
  expect(errors).toEqual([]);
  expect(run.status).toBe(0);
});
