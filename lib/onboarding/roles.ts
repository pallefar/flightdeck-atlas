// The role vocabulary of the onboarding brain. Kept apart from the rules so a
// UI (or the native client) can list the roles without importing the policy.
export const WORKSPACE_ROLES = ["admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export const PROJECT_ROLES = [
  "owner",
  "process_owner",
  "teoa_approver",
  "vision_approver",
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
/** One line per role, for the assignment step. */
export const PROJECT_ROLE_HELP: Record<ProjectRole, string> = {
  owner: "Owns the project: edits the facts and starts the intake.",
  process_owner: "Signs off the as-is, the to-be, the value and go-live.",
  teoa_approver: "Approves TEOA alignment at stage 4.",
  vision_approver: "Approves Vision alignment at stage 4.",
};
