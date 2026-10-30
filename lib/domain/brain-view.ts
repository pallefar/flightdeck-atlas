// The shape of `GET /api/onboarding/:id`, as the lane reads it.
//
// Declared apart from the analysis so the analysis can be tested on a plain
// object, and so the lane and the tests agree on what a view is.
export type BrainEvidence = {
  id: string;
  kind: string;
  source: string;
  classification: string;
  scanState: string;
  status: string;
  bytes: number;
};
export type BrainValue = {
  id: string;
  basis: string;
  period: string;
  figures: { hours?: number; cost?: number };
  sourceRef: string | null;
  confidence: string;
};
export type BrainAssignments = {
  owner: string | null;
  processOwner: string | null;
  teoaApprover: string | null;
  visionApprover: string | null;
};
export type BrainView = {
  record: {
    projectId: string;
    name: string;
    stage: string;
    revision: number;
    entryType: "project" | "process";
  };
  status: string;
  data: Record<string, unknown>;
  workspace: { id: string; name: string } | null;
  assignments: BrainAssignments;
  access: { canEdit: boolean; canAssignRoles: boolean; canView: boolean };
  stage: {
    current: string;
    next: string | null;
    missing: string[];
    missingForNext: string[];
  };
  chain: { ok: boolean; length?: number; brokenAt?: number };
  evidence: BrainEvidence[];
  values: BrainValue[];
  reuse: { decision: string; reason: string; matches: unknown[] } | null;
  gates: { stage: string; decision: string; at: string }[];
  canGate: Record<string, boolean>;
  facts?: Record<string, boolean | string | null>;
  handoffs?: { id: string; kind: string; status: string; createdAt: string }[];
};
