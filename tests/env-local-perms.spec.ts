import { test, expect } from "@playwright/test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envLocalPermissionWarning } from "../scripts/env-local-perms.mjs";

// .env.local holds ATLAS_FLIGHTDECK_INBOUND_TOKEN. The dev server warns (and
// only warns) when group or others can read or write it. No browser, no
// server: these checks use throwaway files with fake contents.
test.describe("env.local permission warning", () => {
  test.skip(process.platform === "win32", "POSIX file modes only");
  let dir = "";
  test.beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "atlas-env-perms-"));
  });
  test.afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const fileWithMode = (mode: number) => {
    const file = path.join(dir, ".env.local");
    writeFileSync(file, "FAKE=not-a-secret\n");
    chmodSync(file, mode);
    return file;
  };

  test("warns for world-readable 644 and names the fix", () => {
    const file = fileWithMode(0o644);
    const warning = envLocalPermissionWarning(file);
    expect(warning).toContain("644");
    expect(warning).toContain(`chmod 600 "${file}"`);
    expect(warning).not.toContain("not-a-secret");
  });

  test("warns for group-readable 640 and group-writable 620", () => {
    expect(envLocalPermissionWarning(fileWithMode(0o640))).toContain("640");
    expect(envLocalPermissionWarning(fileWithMode(0o620))).toContain("620");
  });

  test("is silent for owner-only 600 and 400", () => {
    expect(envLocalPermissionWarning(fileWithMode(0o600))).toBeNull();
    expect(envLocalPermissionWarning(fileWithMode(0o400))).toBeNull();
  });

  test("is silent when the file does not exist", () => {
    expect(envLocalPermissionWarning(path.join(dir, "missing"))).toBeNull();
  });
});
