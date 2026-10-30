// The app update manifest, and the honest answer to "is there a newer one?".
//
// The OS updates system (docs/UPDATES.md) sets the rule this copies: a check
// either reports a verdict or a refusal CODE, and a refusal is never shown as
// "up to date". The manifest ships with the deployment, so no remote fetch is
// invented here; an empty `url` means the build exists but its download is not
// published, and the app says that instead of offering a dead button.
import { manifest } from "./app-updates-manifest";
import { z } from "zod";
export const MANIFEST_SCHEMA = "atlas-app-updates/1" as const;
export const releaseSchema = z
  .object({
    version: z.string().regex(/^\d+(\.\d+)*$/),
    releasedAt: z.string().datetime({ offset: true }),
    notes: z.string().max(4000),
    url: z.union([z.literal(""), z.string().url()]),
    sha256: z.union([z.literal(""), z.string().regex(/^[0-9a-f]{64}$/)]),
  })
  .strict();
export const manifestSchema = z
  .object({
    schema: z.literal(MANIFEST_SCHEMA),
    releases: z.array(releaseSchema).min(1).max(200),
  })
  .strict();
export type Release = z.infer<typeof releaseSchema>;
export const REFUSAL_CODES = [
  "UPDATES_NOT_CONFIGURED",
  "RELEASE_METADATA_INVALID",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
/** Numeric dotted comparison. Missing parts count as zero, so 1.2 == 1.2.0. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
export const latestRelease = (releases: Release[]): Release =>
  releases.reduce((best, release) =>
    compareVersions(release.version, best.version) > 0 ? release : best,
  );
export type UpdateCheck =
  | {
      status: "up_to_date";
      current: string;
      latest: Release;
      /** True when the latest release has a published download. */
      downloadable: boolean;
    }
  | { status: "update_available"; current: string; latest: Release; downloadable: boolean }
  | { status: "ahead_of_release"; current: string; latest: Release; downloadable: boolean }
  | { status: "refused"; code: RefusalCode };
/** Never throws: a broken manifest is a refusal, not a crash and not a pass. */
export function checkForUpdate(current: string, raw: unknown = manifest): UpdateCheck {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return { status: "refused", code: "RELEASE_METADATA_INVALID" };
  const latest = latestRelease(parsed.data.releases);
  const order = compareVersions(current, latest.version);
  const downloadable = latest.url !== "" && latest.sha256 !== "";
  if (order === 0) return { status: "up_to_date", current, latest, downloadable };
  if (order > 0) return { status: "ahead_of_release", current, latest, downloadable };
  return { status: "update_available", current, latest, downloadable };
}
/** The manifest the route serves, or a refusal. */
export function servedUpdateCheck(current: string | null) {
  if (!current) return { ok: false as const, code: "UPDATES_NOT_CONFIGURED" as RefusalCode };
  const check = checkForUpdate(current);
  if (check.status === "refused") return { ok: false as const, code: check.code };
  return { ok: true as const, check };
}
/** The releases a feed carries, put through the same comparison. Used when the
 * central updater is the source, so there is one verdict, not two. */
export const updatePayloadFrom = (
  releases: Release[],
  current: string | null,
  source: "feed" | "local",
) => {
  const parsed = manifestSchema.safeParse({ schema: "atlas-app-updates/1", releases });
  if (!parsed.success) return { status: "refused", code: "UPDATES_UNREADABLE" as const };
  if (!current) return { status: "refused", code: "UPDATES_NOT_CONFIGURED" as const };
  const check = checkForUpdate(current, parsed.data);
  return check.status === "refused"
    ? { status: "refused", code: check.code }
    : { ...check, source };
};

/** What the route returns for a caller that names its version. */
export const updatePayload = (current: string | null) => {
  const served = servedUpdateCheck(current);
  return served.ok ? { ...served.check } : { status: "refused", code: served.code };
};
