// Who may pass which gate.
//
// The rule from the PRD (§6): "A gate can be passed only by a user with that
// gate role, never by the requester alone." So this module answers one
// question and nothing else: does this actor hold EVERY permission the stage
// requires? There is no super-admin bypass: the Super Admin already holds
// every permission by construction (lib/access.ts), and a bypass would make
// the audit chain claim an approval the person never gave.
//
// Kept as a matrix so a test can assert the whole table, and so adding a gate
// is a one-line change with an audit consequence that is obvious in review.
import type { Permission } from "../access-policy";
import { RETIRED, type StageOrRetired } from "./stages";
export const GATE_PERMISSIONS: Record<StageOrRetired, readonly Permission[]> = {
  intake: ["onboarding.triage"],
  reuse: ["onboarding.triage"],
  capture: ["onboarding.capture.review"],
  "as-is": ["onboarding.gate.process_owner"],
  // Alignment needs both owners: the TEOA scope and the Vision objective are
  // different authorities and one approval may not stand in for the other.
  aligned: ["onboarding.gate.teoa", "onboarding.gate.vision"],
  value: ["onboarding.gate.process_owner", "onboarding.value.edit"],
  // The to-be + build decision is the builder's and the owner's call (PRD §6).
  "to-be": ["onboarding.triage", "onboarding.gate.process_owner"],
  build: ["onboarding.triage"],
  live: ["onboarding.gate.process_owner"],
  measured: ["onboarding.value.edit", "onboarding.gate.process_owner"],
  [RETIRED]: ["onboarding.gate.process_owner"],
};
export function gatePermissions(stage: StageOrRetired): readonly Permission[] {
  return GATE_PERMISSIONS[stage];
}
/** The permissions this actor lacks for the stage; empty means they may pass
 * it. A denial names what is missing, never who else could do it. */
export function missingGatePermissions(
  held: readonly string[],
  stage: StageOrRetired,
): Permission[] {
  const set = new Set(held);
  return GATE_PERMISSIONS[stage].filter((p) => !set.has(p));
}
export const canPassGate = (held: readonly string[], stage: StageOrRetired) =>
  missingGatePermissions(held, stage).length === 0;
/** A decision is recorded, never inferred. `reopen` is a gate event too: a
 * material change sends the project back to alignment with a reason. */
export const GATE_DECISIONS = ["pass", "reject", "reopen"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];
/** Rejecting and reopening both need a stated reason; passing does not. */
export const reasonRequired = (decision: GateDecision) =>
  decision !== "pass";
