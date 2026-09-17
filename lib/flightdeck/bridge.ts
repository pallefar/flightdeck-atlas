import { z } from "zod";
// Proposed normalized SDK boundary. Current FlightDeck wire DTOs remain in types.ts.
export const projectRefSchema = z.object({
  instanceId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
});
export type FlightDeckProjectRef = z.infer<typeof projectRefSchema>;
export const projectRefKey = (ref: FlightDeckProjectRef) =>
  JSON.stringify([ref.instanceId, ref.workspaceId, ref.projectId]);
export const candidateSchema = z.object({
  ref: projectRefSchema,
  name: z.string().min(1),
  workspaceName: z.string(),
  canImport: z.boolean(),
});
export type ImportCandidate = z.infer<typeof candidateSchema>;
export const catalogSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false), reason: z.string() }),
  z.object({
    connected: z.literal(true),
    candidates: z.array(candidateSchema),
    nextCursor: z.string().nullable(),
    checkedAt: z.string(),
  }),
]);
export type ProjectCatalog = z.infer<typeof catalogSchema>;
/** Only call with an already-authorized SDK page and installation-scoped confirmed links.
 * A missing entry on a page does not unlink a previously connected project.
 */
export function unlinkedProjects(
  candidates: ImportCandidate[],
  links: FlightDeckProjectRef[],
  expected: { instanceId: string; workspaceId: string },
) {
  const linked = new Set(links.map(projectRefKey));
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (
      candidate.ref.instanceId !== expected.instanceId ||
      candidate.ref.workspaceId !== expected.workspaceId
    )
      throw Error("Unexpected FlightDeck context; discovery stopped.");
    const key = projectRefKey(candidate.ref);
    if (!candidate.canImport || linked.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export interface ProjectOnboardingSdk {
  // SDK enforces membership, project visibility, app entitlement and Atlas installation audience.
  listProjects(input: {
    workspaceId: string;
    cursor?: string;
  }): Promise<{
    instanceId: string;
    workspaceId: string;
    projects: ImportCandidate[];
    nextCursor: string | null;
  }>;
  getProject(ref: FlightDeckProjectRef): Promise<ImportCandidate>;
  createProject(input: {
    workspaceId: string;
    label: string;
    origin: {
      appId: "flightdeck-atlas";
      installationId: string;
      projectId: string;
    };
    idempotencyKey: string;
  }): Promise<ProjectOnboardingOperation>;
  getOperation(operationId: string): Promise<ProjectOnboardingOperation>;
}
export type ProjectOnboardingOperation =
  | { operationId: string; state: "pending" }
  | { operationId: string; state: "failed"; message: string }
  | { operationId: string; state: "succeeded"; project: FlightDeckProjectRef };
