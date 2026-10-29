// Who may do what in the onboarding brain.
//
// Two questions, answered separately on purpose:
// 1. WHAT may this person do — the Atlas permissions they hold
//    (onboarding.view, .create, .gate.*, .value.edit …).
// 2. WHOSE project may they do it on — the workspace they are in, and the
//    role they were assigned on this project.
//
// A permission without an assignment does nothing, and an assignment without
// the permission does nothing. The Super Admin is the one exception: it
// administers the installation, so it may act on any workspace and pass any
// gate. Everyone else is bounded by both.
//
// Pure: no Worker bindings, no database. The route passes in what it read.
import type { ProjectRole, WorkspaceRole } from "./roles";
/** The gate a stage belongs to, and the project role that answers for it. */
export const STAGE_ROLE: Record<string, ProjectRole | "both-approvers"> = {
  intake: "owner",
  reuse: "owner",
  capture: "owner",
  "as-is": "process_owner",
  aligned: "both-approvers",
  value: "process_owner",
  "to-be": "process_owner",
  build: "owner",
  live: "process_owner",
  measured: "process_owner",
  retired: "owner",
};
export type Actor = {
  email: string;
  superAdmin: boolean;
  permissions: readonly string[];
};
export type ProjectAssignment = {
  owner: string | null;
  processOwner: string | null;
  teoaApprover: string | null;
  visionApprover: string | null;
};
export const assignmentsFrom = (
  rows: { role: ProjectRole; email: string }[],
): ProjectAssignment => ({
  owner: rows.find((row) => row.role === "owner")?.email ?? null,
  processOwner: rows.find((row) => row.role === "process_owner")?.email ?? null,
  teoaApprover: rows.find((row) => row.role === "teoa_approver")?.email ?? null,
  visionApprover: rows.find((row) => row.role === "vision_approver")?.email ?? null,
});
const same = (a: string | null, b: string) =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();
/** The effective process owner: a named one, or the owner when nobody else
 * was assigned. The alignment approvers never fall back. */
export const effectiveProcessOwner = (a: ProjectAssignment) =>
  a.processOwner ?? a.owner;
export const isWorkspaceAdmin = (
  roles: Record<string, WorkspaceRole>,
  workspaceId: string | null,
) => workspaceId !== null && roles[workspaceId] === "admin";
/** Only the Super Admin creates a workspace; an Admin creates projects inside
 * one they administer. */
export const canCreateWorkspace = (actor: Actor) => actor.superAdmin;
export function canCreateIn(actor: Actor, workspaceId: string, roles: Record<string, WorkspaceRole>) {
  if (!actor.permissions.includes("onboarding.create")) return false;
  if (actor.superAdmin) return true;
  return isWorkspaceAdmin(roles, workspaceId);
}
/** Which workspaces this actor may pick from when onboarding. The Super Admin
 * may pick any (see the route, which lists them all); an Admin only theirs. */
export const canChooseWorkspace = (
  actor: Actor,
  workspaceId: string,
  roles: Record<string, WorkspaceRole>,
) => actor.superAdmin || isWorkspaceAdmin(roles, workspaceId);
/** Reading a project's brain needs a way in: Super Admin, workspace member, or
 * a role on the project. */
export function canView(
  actor: Actor,
  input: {
    workspaceId: string | null;
    roles: Record<string, WorkspaceRole>;
    assignments: ProjectAssignment;
  },
) {
  if (!actor.permissions.includes("onboarding.view") && !actor.superAdmin) return false;
  if (actor.superAdmin) return true;
  if (input.workspaceId && input.roles[input.workspaceId]) return true;
  return Object.values(input.assignments).some((email) => same(email, actor.email));
}
/** Editing the facts, and starting the intake, belongs to the owner and to the
 * workspace's admin. */
export function canEdit(
  actor: Actor,
  input: {
    workspaceId: string | null;
    roles: Record<string, WorkspaceRole>;
    assignments: ProjectAssignment;
  },
) {
  if (!actor.permissions.includes("onboarding.create")) return false;
  if (actor.superAdmin) return true;
  if (same(input.assignments.owner, actor.email)) return true;
  return isWorkspaceAdmin(input.roles, input.workspaceId);
}
/** Assigning roles is the workspace admin's or the Super Admin's job — not the
 * owner's, or an owner could hand themselves the approvals. */
export function canAssignRoles(
  actor: Actor,
  input: { workspaceId: string | null; roles: Record<string, WorkspaceRole> },
) {
  if (actor.superAdmin) return true;
  if (!actor.permissions.includes("onboarding.triage")) return false;
  return isWorkspaceAdmin(input.roles, input.workspaceId);
}
export type GateRefusal = "gate_role_required" | "assignment_required";
/**
 * May this actor pass this stage's gate? Both halves must hold:
 * the permission (what they may do) and the assignment (whose project).
 * Returns the reason for a refusal so the route can answer precisely.
 */
export function gateRefusal(
  actor: Actor,
  stage: string,
  input: {
    workspaceId: string | null;
    roles: Record<string, WorkspaceRole>;
    assignments: ProjectAssignment;
  },
): GateRefusal | null {
  const required = STAGE_ROLE[stage];
  if (!required) return "gate_role_required";
  const permissions: Record<string, string[]> = {
    owner: ["onboarding.create"],
    process_owner: ["onboarding.gate.process_owner"],
    "both-approvers": ["onboarding.gate.teoa", "onboarding.gate.vision"],
  };
  const needed = required === "both-approvers" ? permissions["both-approvers"] : permissions[required];
  const held = needed.every((permission) => actor.permissions.includes(permission));
  if (!held) return "gate_role_required";
  if (actor.superAdmin) return null;
  if (required === "both-approvers") {
    const teoa = same(input.assignments.teoaApprover, actor.email);
    const vision = same(input.assignments.visionApprover, actor.email);
    // One person may hold both approvals only if they were assigned both; the
    // route checks the two permissions separately, so an actor with one
    // permission still cannot stand in for the other.
    return teoa && vision ? null : "assignment_required";
  }
  if (required === "process_owner") {
    const effective = effectiveProcessOwner(input.assignments);
    if (same(effective, actor.email)) return null;
    return "assignment_required";
  }
  return same(input.assignments.owner, actor.email) ? null : "assignment_required";
}
