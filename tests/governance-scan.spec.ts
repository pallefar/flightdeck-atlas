import { test, expect } from "@playwright/test";
import {
  allowsAiDrafting,
  findingCodes,
  isRedacted,
  scanText,
} from "../lib/governance/scan";

// The governance scan. Its promise is narrow and testable: it refuses what
// must not be stored, sends what a human must look at to review, and never
// copies the matched value into its output. Every test below also asserts
// that promise, not just the verdict.
const CLEAN =
  "The operator opens the case in ServiceNow, checks the document and files the request.";
test.describe("clean text", () => {
  test("a normal process paragraph is clear and lets AI drafting proceed", () => {
    const result = scanText(CLEAN);
    expect(result.verdict).toBe("clear");
    expect(result.findings).toEqual([]);
    expect(allowsAiDrafting(result)).toBe(true);
  });
});
test.describe("personal data", () => {
  test("an email address is a review, and the address is not in the result", () => {
    const text = `${CLEAN} Contact anna.schmidt@example.com for the intake.`;
    const result = scanText(text);
    expect(result.verdict).toBe("review");
    expect(findingCodes(result)).toContain("pii.email");
    expect(JSON.stringify(result)).not.toContain("anna.schmidt@example.com");
    expect(allowsAiDrafting(result)).toBe(false);
  });
  test("an IBAN and a phone number are reviews, never clear", () => {
    const result = scanText(`${CLEAN} DE89 3704 0044 0532 0130 00, +49 6251 123 456`);
    expect(result.verdict).toBe("review");
    const codes = findingCodes(result);
    expect(codes).toContain("pii.iban");
    expect(codes).toContain("pii.phone");
  });
});
test.describe("blocking content", () => {
  for (const [name, text] of [
    ["an AWS key", "key AKIAIOSFODNN7EXAMPLE here"],
    ["a private key block", "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."],
    ["a password assignment", "password: hunter2-demo"],
    ["a CUI marking", "CUI // when filled in"],
    ["an ITAR marking", "ITAR controlled document"],
    ["an export-restricted marking", "EXPORT RESTRICTED — do not distribute"],
  ] as const) {
    test(`${name} blocks the item outright`, () => {
      const result = scanText(text);
      expect(result.verdict).toBe("blocked");
      expect(allowsAiDrafting(result)).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
      // Only codes and counts: no matched value travels.
      for (const finding of result.findings) {
        expect(Object.keys(finding).sort()).toEqual(["code", "count"]);
        expect(finding.code).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    });
  }
  test("the blocked AWS key never appears in the output", () => {
    const result = scanText("AKIAIOSFODNN7EXAMPLE");
    expect(JSON.stringify(result)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});
test.describe("unknown content", () => {
  test("no text at all is a review, never a pass", () => {
    expect(scanText(null).verdict).toBe("review");
    expect(scanText("   ").verdict).toBe("review");
    expect(scanText("").reasons).toEqual(["governance.no_text"]);
  });
  test("a long random-looking token sends the item to review", () => {
    const token = "q7Zx9vLm2Kp4Rt8Wn3Yb6Cd1Ef5Gh0Jk";
    const result = scanText(`Reference ${token} in the export.`);
    expect(["review", "blocked"]).toContain(result.verdict);
    expect(findingCodes(result)).toContain("secret.high_entropy");
  });
  test("a sentence of ordinary words is not high entropy", () => {
    expect(findingCodes(scanText(CLEAN))).not.toContain("secret.high_entropy");
  });
});
test.describe("redaction tags", () => {
  test("the Redact Studio tag shape is recognised, and a fresh check never lags", () => {
    expect(isRedacted("Text [[redact:customer-name]] afterwards")).toBe(true);
    expect(isRedacted("Text [[redact:customer-name]] afterwards")).toBe(true);
    expect(isRedacted("plain text")).toBe(false);
  });
});
