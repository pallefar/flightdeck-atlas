import { z } from "zod";
import type {
  FlightDeckReadAdapter,
  FlightDeckAuthMe,
  FlightDeckProjectsResponse,
  FlightDeckWorkspacesResponse,
} from "./types";

const role = z.enum([
  "hr_preparer",
  "hr_reviewer",
  "wc_liaison",
  "legal",
  "admin",
  "super_admin",
]);
const authSchema = z.object({
  required: z.boolean(),
  bootstrap: z.boolean(),
  principal: z
    .object({
      username: z.string(),
      displayName: z.string(),
      role: z.union([role, z.literal("pending")]),
      pending: z.boolean().optional(),
    })
    .nullable(),
  effectiveRole: role.nullable(),
  memberships: z.array(z.object({ workspaceId: z.string(), role })),
});
const workspaceSchema = z.object({
  workspaces: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      enabled: z.boolean(),
      pending: z.boolean(),
    }),
  ),
});
const projectsSchema = z.object({
  workspaceId: z.string(),
  defaultProjectId: z.string(),
  projects: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      enabled: z.boolean(),
      createdAt: z.string(),
      isDefault: z.boolean(),
      owners: z.array(z.string()),
    }),
  ),
});

/** Supply an authenticated transport from the forthcoming FlightDeck SDK.
 * This boundary does not invent a token exchange, store OS cookies, or claim an active connection.
 * It accepts the verified current wire DTOs. If the SDK changes its contract, version this adapter.
 */
export type FlightDeckTransport = (
  path: "/api/auth/me" | "/api/workspaces" | "/api/projects",
  options: { workspaceId?: string },
) => Promise<unknown>;
export function createFlightDeckReadAdapter(
  transport: FlightDeckTransport,
): FlightDeckReadAdapter {
  return {
    async authMe(workspaceId): Promise<FlightDeckAuthMe> {
      const result = authSchema.parse(
        await transport("/api/auth/me", { workspaceId }),
      );
      if (
        !result.principal ||
        result.principal.pending ||
        result.principal.role === "pending"
      )
        throw Error("A current, approved FlightDeck session is required.");
      if (!result.effectiveRole)
        throw Error("This account has no effective workspace access.");
      return result;
    },
    async workspaces(): Promise<FlightDeckWorkspacesResponse> {
      return workspaceSchema.parse(await transport("/api/workspaces", {}));
    },
    async projects(workspaceId): Promise<FlightDeckProjectsResponse> {
      if (!workspaceId.trim()) throw Error("Select a workspace.");
      const result = projectsSchema.parse(
        await transport("/api/projects", { workspaceId }),
      );
      if (result.workspaceId !== workspaceId)
        throw Error(
          "FlightDeck returned a different workspace. Import stopped.",
        );
      return result;
    },
  };
}
/** Workspace-local IDs must never collapse into one global project ID. */
export const flightDeckProjectKey = (workspaceId: string, projectId: string) =>
  JSON.stringify([workspaceId, projectId]);
export function mapFlightDeckProjects(response: FlightDeckProjectsResponse) {
  return response.projects
    .filter((p) => p.enabled)
    .map((p) => ({
      externalKey: flightDeckProjectKey(response.workspaceId, p.id),
      workspaceId: response.workspaceId,
      projectId: p.id,
      name: p.label,
      createdAt: p.createdAt,
      isDefault: p.isDefault,
      source: "flightdeck" as const,
    }));
}
