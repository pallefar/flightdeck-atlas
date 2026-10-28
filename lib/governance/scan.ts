// The governance scan (PRD §9 G-1, G-2).
//
// It answers one question for one piece of text: may this be stored, and may
// it be drafted into a model? It is deterministic, local, and never sends
// anything anywhere.
//
// Two rules make its output safe to store and show:
// 1. Findings are CODES with counts. A matched value — an email, a key, a
//    marking's surrounding sentence — never leaves this function, so the
//    evidence table cannot become a second copy of the data it protects.
// 2. Unknown content is "review", not "clear". Absence of text (a video, a
//    photo, a document we have not extracted) is not evidence of cleanliness,
//    so the default verdict is the cautious one.
import type { ScanVerdict } from "../domain/classification";
export type FindingCode =
  | "pii.email"
  | "pii.phone"
  | "pii.iban"
  | "secret.aws_key"
  | "secret.private_key"
  | "secret.assignment"
  | "secret.high_entropy"
  | "marking.cui"
  | "marking.itar"
  | "marking.export_restricted";
export type ScanFinding = { code: FindingCode; count: number };
export type ScanResult = {
  verdict: ScanVerdict;
  findings: ScanFinding[];
  /** Short, translatable reasons (codes), never the matched text. */
  reasons: string[];
};
type Rule = {
  code: FindingCode;
  pattern: RegExp;
  /** Blocks the item outright rather than sending it to review. */
  blocking?: boolean;
  reason: string;
};
/** Ordered: the first blocking rule decides "blocked". */
const RULES: Rule[] = [
  {
    code: "secret.private_key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    blocking: true,
    reason: "governance.private_key",
  },
  {
    code: "secret.aws_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    blocking: true,
    reason: "governance.cloud_credential",
  },
  {
    code: "marking.cui",
    pattern: /\bCUI\b|\bCONTROLLED UNCLASSIFIED INFORMATION\b/gi,
    blocking: true,
    reason: "governance.classification_marking",
  },
  {
    code: "marking.itar",
    pattern: /\bITAR\b|\bINTERNATIONAL TRAFFIC IN ARMS REGULATIONS\b/gi,
    blocking: true,
    reason: "governance.classification_marking",
  },
  {
    code: "marking.export_restricted",
    pattern: /\bEXPORT[\s-]?RESTRICTED\b|\bEXPORT CONTROLLED\b/gi,
    blocking: true,
    reason: "governance.classification_marking",
  },
  {
    code: "secret.assignment",
    pattern: /\b(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S{6,}/gi,
    blocking: true,
    reason: "governance.secret_assignment",
  },
  {
    code: "pii.email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    reason: "governance.personal_data",
  },
  {
    code: "pii.iban",
    // Spaced groups are how an IBAN is printed on a form.
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){10,30}\b/g,
    reason: "governance.personal_data",
  },
  {
    code: "pii.phone",
    pattern: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]\d{3,4}(?:[\s-]\d{2,4})?/g,
    reason: "governance.personal_data",
  },
];
/** Shannon entropy per character. Used only to flag a long random-looking
 * token; a normal sentence stays well below the threshold. */
function entropy(text: string) {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let result = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    result -= p * Math.log2(p);
  }
  return result;
}
const TOKEN = /\b[A-Za-z0-9+/=_-]{32,}\b/g;
/** Scan one piece of text. `null`/empty means "no text to inspect", which is
 * a review, not a pass (see the header). */
export function scanText(text: string | null | undefined): ScanResult {
  if (!text || !text.trim())
    return { verdict: "review", findings: [], reasons: ["governance.no_text"] };
  const findings: ScanFinding[] = [];
  const reasons: string[] = [];
  let blocked = false;
  for (const rule of RULES) {
    const matches = text.match(rule.pattern);
    if (!matches?.length) continue;
    findings.push({ code: rule.code, count: matches.length });
    reasons.push(rule.reason);
    if (rule.blocking) blocked = true;
  }
  // A long high-entropy token is worth a human look even when no rule named
  // it: it is what a leaked key usually looks like.
  const token = TOKEN.exec(text);
  if (token && entropy(token[0]) >= 4.2) {
    findings.push({ code: "secret.high_entropy", count: 1 });
    reasons.push("governance.high_entropy");
  }
  const verdict: ScanVerdict = blocked
    ? "blocked"
    : findings.length
      ? "review"
      : "clear";
  return { verdict, findings, reasons: [...new Set(reasons)] };
}
/** The codes only, as the evidence contract stores them. */
export const findingCodes = (result: ScanResult) =>
  result.findings.map((finding) => finding.code);
/** Whether a verdict allows AI drafting, given the class already allowed it. */
export const allowsAiDrafting = (result: ScanResult) =>
  result.verdict === "clear";
/** Redaction patterns the Redact Studio contract expects (G-3). Opaque tags
 * stay in the text; the value is restored only locally by the studio. */
export const REDACTION_TAG = "\\[\\[redact:[a-z0-9-]{1,40}\\]\\]";
export const isRedacted = (text: string) =>
  new RegExp(REDACTION_TAG, "g").test(text);
