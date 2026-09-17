// Verified wire DTOs from pallefar/project-contract main 60ae92b8573b666fa19ce3876810d22fde50feea.
// This is an adapter boundary proposal, not a published FlightDeck SDK.
export type FlightDeckRole =
  | "hr_preparer"
  | "hr_reviewer"
  | "wc_liaison"
  | "legal"
  | "admin"
  | "super_admin";

export interface FlightDeckPrincipal {
  username: string;
  displayName: string;
  // The source casts a runtime pending sentinel into Role; account for real wire data.
  role: FlightDeckRole | "pending";
  pending?: boolean;
}
export interface FlightDeckAuthMe {
  required: boolean;
  bootstrap: boolean;
  principal: FlightDeckPrincipal | null;
  effectiveRole: FlightDeckRole | null;
  memberships: Array<{ workspaceId: string; role: FlightDeckRole }>;
}
export interface FlightDeckWorkspace {
  id: string;
  label: string;
  enabled: boolean;
  pending: boolean;
}
export interface FlightDeckWorkspacesResponse {
  workspaces: FlightDeckWorkspace[];
}
export interface FlightDeckProject {
  id: string;
  label: string;
  enabled: boolean;
  createdAt: string;
  isDefault: boolean;
  owners: string[];
}
export interface FlightDeckProjectsResponse {
  workspaceId: string;
  defaultProjectId: string;
  projects: FlightDeckProject[];
}
export interface FlightDeckError {
  error: string;
  code?:
    | "workspace_disabled"
    | "project_disabled"
    | "no_workspace_membership"
    | string;
  workspaceId?: string;
  projectId?: string;
}
// Existing transport: trusted OS cookie session, not an API key or Bearer token.
// Separating this allows replacement with the user's upcoming SDK.
export interface FlightDeckReadAdapter {
  authMe(workspaceId: string): Promise<FlightDeckAuthMe>;
  workspaces(): Promise<FlightDeckWorkspacesResponse>;
  projects(workspaceId: string): Promise<FlightDeckProjectsResponse>;
}
