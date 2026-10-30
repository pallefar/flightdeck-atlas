import { test, expect } from "@playwright/test";
import { analyseBrain, requirementText } from "../lib/domain/analysis";
import type { BrainView } from "../lib/domain/brain-view";

// The readiness panel, as a checklist over facts the server sent. Pure, so it
// is tested on plain objects: no score beyond what is counted, no risk that the
// data does not imply.
const view = (over: Partial<BrainView> = {}): BrainView => ({
  record: {
    projectId: "p-1",
    name: "Billing dispute process",
    stage: "intake",
    revision: 2,
    entryType: "process",
  },
  status: "active",
  data: {},
  workspace: { id: "general", name: "General" },
  assignments: {
    owner: "me@example.test",
    processOwner: null,
    teoaApprover: null,
    visionApprover: null,
  },
  access: { canEdit: true, canAssignRoles: true, canView: true },
  stage: { current: "intake", next: "reuse", missing: [], missingForNext: [] },
  chain: { ok: true, length: 2 },
  evidence: [],
  values: [],
  reuse: null,
  gates: [],
  canGate: {},
  ...over,
});
const evidence = (over: Partial<BrainView["evidence"][number]> = {}) => ({
  id: "e-1",
  kind: "document",
  source: "sop.docx",
  classification: "internal",
  scanState: "clear",
  status: "accepted",
  bytes: 10,
  ...over,
});
test.describe("a new project", () => {
  test("a bare intake scores low and names the next steps", () => {
    const result = analyseBrain(
      view({ stage: { current: "intake", next: "reuse", missing: ["classification"], missingForNext: [] } }),
    );
    expect(result.readiness).toBeLessThan(40);
    expect(result.met).toBeLessThan(result.total);
    expect(result.rolesFilled).toBe(1);
    const kinds = result.nextActions.map((action) => action.kind);
    expect(kinds).toContain("process_owner");
    expect(kinds).toContain("approvers");
    expect(kinds).toContain("evidence");
    expect(kinds).toContain("requirement");
    // The stage's own missing fact travels with its code, so the UI can
    // translate it with the key it already has.
    expect(result.nextActions.find((action) => action.kind === "requirement")?.requirement).toBe(
      "classification",
    );
  });
  test("the risks are the ones its own counts imply", () => {
    const result = analyseBrain(view());
    expect(result.risks).toContain("process_owner");
    expect(result.risks).toContain("approvers");
    expect(result.risks).toContain("evidence");
    expect(result.risks).not.toContain("scan");
    expect(result.risks).not.toContain("chain");
  });
  test("with nothing captured, the scan action is not offered twice", () => {
    const kinds = analyseBrain(view()).nextActions.map((action) => action.kind);
    expect(kinds).not.toContain("scan_none");
    expect(kinds).toContain("evidence");
  });
});
test.describe("a project with its facts in place", () => {
  const ready = view({
    stage: { current: "value", next: "to-be", missing: [], missingForNext: [] },
    assignments: {
      owner: "me@example.test",
      processOwner: "po@example.test",
      teoaApprover: "t@example.test",
      visionApprover: "v@example.test",
    },
    evidence: [evidence()],
    reuse: { decision: "extend", reason: "sub-app exists", matches: [] },
    values: [{ id: "v1", basis: "measured", period: "baseline", figures: {}, sourceRef: "x.csv", confidence: "medium" }],
  });
  test("scores 100 with nothing left to do", () => {
    const result = analyseBrain(ready);
    expect(result.readiness).toBe(100);
    expect(result.nextActions).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.hasBaseline).toBe(true);
    expect(result.hasReuseDecision).toBe(true);
    expect(result.evidenceAccepted).toBe(1);
  });
  test("a review and a broken chain are flagged, with their actions", () => {
    const result = analyseBrain({
      ...ready,
      chain: { ok: false, brokenAt: 2 },
      evidence: [evidence({ status: "pending", scanState: "review" })],
    });
    expect(result.evidenceNeedsReview).toBe(1);
    expect(result.risks).toEqual(expect.arrayContaining(["scan", "chain"]));
    const kinds = result.nextActions.map((action) => action.kind);
    expect(kinds).toEqual(expect.arrayContaining(["scan", "chain", "evidence"]));
  });
});
test("a requirement code has a readable label, and an unknown one is itself", () => {
  expect(requirementText("as-is-map")).toBe("Link the as-is map");
  expect(requirementText("a-new-code")).toBe("a-new-code");
});
