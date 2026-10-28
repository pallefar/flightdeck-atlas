// Data classification for the onboarding brain.
//
// TE policy (PRD §9 G-1) is blunt: four classes never leave the machine and
// never reach a model, no matter who asks. This module is the single place
// that decides, so the upload path, the scan and any AI call cannot disagree.
// It is pure: no Worker bindings, no network, safe to import from a browser
// client or a test.
export const CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "export-restricted",
  "itar",
  "cui",
  "customer-pii",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
/** Blocked from upload, storage and any AI processing (PRD §9 G-1). Adding a
 * class here is the only way to block one; never branch on the string
 * elsewhere. */
export const BLOCKED_CLASSIFICATIONS = [
  "export-restricted",
  "itar",
  "cui",
  "customer-pii",
] as const;
export type BlockedClassification = (typeof BLOCKED_CLASSIFICATIONS)[number];
const blocked = new Set<string>(BLOCKED_CLASSIFICATIONS);
export const isBlocked = (c: Classification) => blocked.has(c);
/** Evidence may be stored only for an allowed class. */
export const allowsUpload = (c: Classification) => !isBlocked(c);
/** AI drafting needs an explicit user action AND an allowed class; the
 * caller records the action, this only answers the class question. */
export const allowsAi = (c: Classification) => !isBlocked(c);
/** The scan verdicts an upload can reach. `review` blocks AI drafting until a
 * reviewer clears or redacts; `blocked` stores nothing at all. */
export const SCAN_VERDICTS = ["clear", "review", "blocked"] as const;
export type ScanVerdict = (typeof SCAN_VERDICTS)[number];
/** Evidence lifecycle. `redacted` means redaction tags were applied and the
 * item may be used; the original is gone. */
export const EVIDENCE_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "redacted",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];
/** Where evidence came from. `capture` is the desktop capture bundle. */
export const EVIDENCE_KINDS = [
  "recording",
  "voice",
  "document",
  "connector",
  "interview",
  "capture",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
/** A short, stable code for the UI to translate. The value is never shown as
 * the block reason, because the class names are internal vocabulary. */
export const blockedCode = (c: Classification) =>
  isBlocked(c) ? `classification.${c}` : null;
/** What an actor may do with an item of this class. */
export function capabilities(c: Classification) {
  return {
    upload: allowsUpload(c),
    ai: allowsAi(c),
    // A blocked class is refused before a row is written, so nothing to keep.
    store: allowsUpload(c),
  } as const;
}
