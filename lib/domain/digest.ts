// Canonical JSON and sha256.
//
// Two rules make these digests worth trusting:
// 1. Key order never changes the digest (canonical, sorted, undefined keys
//    dropped), so a digest crossing a process boundary survives a rebuild.
// 2. The same input always gives the same hash on the Worker, in Node and in
//    a browser test, because it uses WebCrypto only — no node:crypto import.
// Used by the audit chain (lib/audit/chain.ts) and the material-change digest
// that reopens stage 4 (lib/domain/stages.ts).

/** Sort object keys recursively; drop undefined so an omitted field and a
 * field set to undefined hash the same. Arrays keep their order (it means
 * something). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) out[key] = canonical(entry);
    }
    return out;
  }
  return value;
}
export const canonicalJson = (value: unknown) => JSON.stringify(canonical(value));
const encoder = new TextEncoder();
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** The digest of any JSON-able value. */
export const digestOf = (value: unknown) => sha256Hex(canonicalJson(value));
/** The fields whose change makes a project "materially changed" and reopens
 * stage 4 (PRD §6, §7.4: same approach as the existing Vision material
 * digest). Only the digest crosses a boundary, never this text. */
export const MATERIAL_FIELDS = [
  "objective",
  "successMeasure",
  "teoaScopeId",
  "kpiDefinitions",
  "onboardingFacts",
] as const;
export async function materialDigest(facts: {
  objective?: string;
  successMeasure?: string;
  teoaScopeId?: string | null;
  kpiDefinitions?: { name: string; unit: string; target: number }[];
  onboardingFacts?: Record<string, unknown>;
}): Promise<string> {
  return digestOf({
    objective: facts.objective ?? "",
    successMeasure: facts.successMeasure ?? "",
    teoaScopeId: facts.teoaScopeId ?? null,
    kpiDefinitions: facts.kpiDefinitions ?? [],
    onboardingFacts: facts.onboardingFacts ?? {},
  });
}
