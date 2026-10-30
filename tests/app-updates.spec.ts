import { test, expect } from "@playwright/test";
import {
  checkForUpdate,
  compareVersions,
  latestRelease,
  manifestSchema,
  REFUSAL_CODES,
  updatePayload,
} from "../lib/app-updates";
import { manifest } from "../lib/app-updates-manifest";
import { readFileSync } from "node:fs";

// The app's update check. Its promise is the OS updates rule in miniature: a
// verdict or a refusal CODE, never a refusal dressed up as "up to date".
const release = (version: string, url = "", sha256 = "") => ({
  version,
  releasedAt: "2026-10-30T00:00:00.000Z",
  notes: `Notes for ${version}`,
  url,
  sha256,
});
const manifestWith = (versions: string[]) => ({
  schema: "atlas-app-updates/1",
  releases: versions.map((version) => release(version)),
});
test.describe("version comparison", () => {
  test("numeric, dotted, and missing parts count as zero", () => {
    expect(compareVersions("1.2.0", "1.2")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.1.0", "0.1.1")).toBe(-1);
    expect(compareVersions("2", "1.99.99")).toBe(1);
  });
  test("the latest release is the highest version, not the last line", () => {
    const latest = latestRelease(
      manifestWith(["1.2.0", "1.10.0", "1.9.0"]).releases as never,
    );
    expect(latest.version).toBe("1.10.0");
  });
});
test.describe("the shipped manifest", () => {
  test("parses, and names the schema this module reads", () => {
    const parsed = manifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(true);
    expect(manifest.schema).toBe("atlas-app-updates/1");
  });
  test("the published JSON and the typed copy are the same object", () => {
    const published = JSON.parse(
      readFileSync(new URL("../app-updates.json", import.meta.url), "utf8"),
    );
    expect(published).toEqual(manifest);
  });
  test("a build of today's version is up to date, and says whether it can be downloaded", () => {
    const check = checkForUpdate("0.1.0");
    expect(check.status).toBe("up_to_date");
    // No url/sha256 in the manifest: nothing to download, and no dead button.
    expect(check.status !== "refused" && check.downloadable).toBe(false);
  });
});
test.describe("verdicts", () => {
  test("a newer release is offered with its notes", () => {
    const check = checkForUpdate("0.1.0", manifestWith(["0.1.0", "0.2.0"]));
    expect(check.status).toBe("update_available");
    if (check.status === "update_available") expect(check.latest.notes).toContain("0.2.0");
  });
  test("a build ahead of the release is reported as such, not as an update", () => {
    const check = checkForUpdate("0.3.0", manifestWith(["0.1.0"]));
    expect(check.status).toBe("ahead_of_release");
  });
  test("a release with a download must carry both url and sha256", () => {
    const withDownload = {
      schema: "atlas-app-updates/1",
      releases: [
        release("0.2.0", "https://downloads.example.test/Atlas-0.2.0.dmg", "a".repeat(64)),
      ],
    };
    const check = checkForUpdate("0.1.0", withDownload);
    expect(check.status !== "refused" && check.downloadable).toBe(true);
  });
});
test.describe("refusals", () => {
  test("a broken manifest is refused, never treated as up to date", () => {
    expect(checkForUpdate("0.1.0", { schema: "atlas-app-updates/1", releases: [] })).toEqual({
      status: "refused",
      code: "RELEASE_METADATA_INVALID",
    });
    expect(checkForUpdate("0.1.0", { nope: true })).toEqual({
      status: "refused",
      code: "RELEASE_METADATA_INVALID",
    });
  });
  test("a release with an unknown key is refused rather than silently narrowed", () => {
    const bad = {
      schema: "atlas-app-updates/1",
      releases: [{ ...release("0.2.0"), surprise: 1 }],
    };
    expect(checkForUpdate("0.1.0", bad)).toEqual({
      status: "refused",
      code: "RELEASE_METADATA_INVALID",
    });
  });
  test("a caller that names no version is refused", () => {
    expect(updatePayload(null)).toEqual({
      status: "refused",
      code: "UPDATES_NOT_CONFIGURED",
    });
    expect(REFUSAL_CODES).toContain("UPDATES_NOT_CONFIGURED");
  });
  test("the route payload for a known version carries the verdict", () => {
    expect(updatePayload("0.1.0")).toMatchObject({ status: "up_to_date", current: "0.1.0" });
  });
});
