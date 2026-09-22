import { z } from "zod";
// Read-only FlightDeck OS workspace/project context over the OS inbound API.
// Shared by the server route and the browser. Keep this module free of
// server-only imports: it must never reach the inbound credential.

/** The OS slug shape (flightdeck server/workspace/registry.ts SLUG_RE and
 * server/project/types.ts PROJECT_SLUG_RE). Existing OS ids have no length
 * bound; 255 is the filesystem path-component cap they live under. */
export const osIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,254}$/);
const integrationIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const isoSchema = z.string().datetime({ offset: true });
/** The OS's stable instance id (proposal §8b decision 10): generated once in
 * the te-ops setting `instance.id`, never written by a route. Accepted
 * before the OS sends it so that adding it cannot break the strict DTO. */
export const osInstanceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const entrySchema = z
  .object({
    id: osIdSchema,
    label: z.string().max(500),
    enabled: z.boolean(),
    isDefault: z.boolean(),
  })
  .strict();
const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;

/** Wire DTOs, validated strictly: an unknown key (for example a root path,
 * owners or createdBy that the contract forbids) rejects the whole response. */
export const osWorkspacesResponseSchema = z
  .object({
    integrationId: integrationIdSchema,
    instanceId: osInstanceIdSchema.optional(),
    workspaces: z
      .array(entrySchema)
      .max(1000)
      .refine(uniqueIds, "Duplicate workspace id"),
    generatedAt: isoSchema,
  })
  .strict();
export const osProjectsResponseSchema = z
  .object({
    workspaceId: osIdSchema,
    projects: z
      .array(entrySchema)
      .max(5000)
      .refine(uniqueIds, "Duplicate project id"),
    generatedAt: isoSchema,
  })
  .strict();
export const osNotFoundSchema = z
  .object({ error: z.literal("not found") })
  .strict();
export const osWorkspaceDisabledSchema = z
  .object({
    error: z.literal("workspace disabled"),
    code: z.literal("workspace_disabled"),
  })
  .strict();
export type OsContextEntry = z.infer<typeof entrySchema>;
export type OsWorkspacesResponse = z.infer<typeof osWorkspacesResponseSchema>;
export type OsProjectsResponse = z.infer<typeof osProjectsResponseSchema>;

/** Atlas already uses "workspace" for an Atlas project (?workspace=). These
 * names are deliberately OS-prefixed so the two can never be confused. */
export const osSelectionSchema = z
  .object({ osWorkspaceId: osIdSchema, osProjectId: osIdSchema.nullable() })
  .strict();
export type OsSelection = z.infer<typeof osSelectionSchema>;
export const osSelectionRequestSchema = z
  .object({
    osWorkspaceId: osIdSchema,
    osProjectId: osIdSchema.nullable().optional(),
  })
  .strict();

export const contextStates = [
  "ok",
  "not_configured",
  "not_permitted",
  "os_unreachable",
  "unauthorized",
  "rate_limited",
  "workspace_not_found",
  "workspace_disabled",
  "invalid_response",
] as const;
export type ContextState = (typeof contextStates)[number];
export type ContextFailureState = Exclude<ContextState, "ok" | "not_permitted">;

/** What /api/flightdeck/context returns. It never carries a credential. */
export const contextResponseSchema = z
  .object({
    state: z.enum(contextStates),
    workspaces: z.array(entrySchema),
    projects: z.array(entrySchema),
    selected: osSelectionSchema.nullable(),
    projectFallback: z.boolean(),
    retryAfter: z.number().int().positive().nullable(),
    checkedAt: isoSchema,
  })
  .strict();
export type ContextResponse = z.infer<typeof contextResponseSchema>;
export type ContextView = Omit<ContextResponse, "checkedAt">;
export const contextErrorSchema = z.object({
  error: z.string(),
  state: z.enum(contextStates),
  retryAfter: z.number().int().positive().nullable().optional(),
});

export function emptyContext(
  state: ContextState,
  retryAfter: number | null = null,
): ContextView {
  return {
    state,
    workspaces: [],
    projects: [],
    selected: null,
    projectFallback: false,
    retryAfter,
  };
}

/** Mirrors the OS sidebar: a disabled project is hidden from anyone who is
 * not a super admin. Disabled workspaces stay listed (greyed, unselectable). */
export function visibleProjects<T extends { enabled: boolean }>(
  projects: T[],
  superAdmin: boolean,
) {
  return projects.filter((project) => project.enabled || superAdmin);
}

/** Which workspace to read. A saved choice is kept while it is still listed
 * and is never swapped for another workspace. Without one, the OS default
 * workspace, then the first enabled workspace. */
export function pickWorkspace(
  workspaces: OsContextEntry[],
  savedWorkspaceId: string | null,
): { workspace: OsContextEntry | null; missing: boolean } {
  if (savedWorkspaceId) {
    const saved = workspaces.find((w) => w.id === savedWorkspaceId) || null;
    return { workspace: saved, missing: !saved };
  }
  const enabled = workspaces.filter((w) => w.enabled);
  return {
    workspace: enabled.find((w) => w.isDefault) || enabled[0] || null,
    missing: false,
  };
}

/** Which project inside the chosen workspace. An unknown or disabled project
 * falls back to that workspace's default project (then its first enabled
 * one); the workspace itself never changes here. */
export function pickProject(
  projects: OsContextEntry[],
  requestedProjectId: string | null,
): { projectId: string | null; fallback: boolean } {
  const selectable = projects.filter((p) => p.enabled);
  if (requestedProjectId && selectable.some((p) => p.id === requestedProjectId))
    return { projectId: requestedProjectId, fallback: false };
  const fallback =
    selectable.find((p) => p.isDefault)?.id || selectable[0]?.id || null;
  return { projectId: fallback, fallback: !!requestedProjectId };
}

/** Mirrors flightdeck web/src/App.tsx projectOptionText: the default project
 * reads "General", long labels are cut with an ellipsis in the text itself,
 * and the id is appended only where a label alone is ambiguous. */
export const PROJECT_OPTION_MAX = 40;
export const projectLabel = (project: OsContextEntry) =>
  project.isDefault ? "General" : project.label || project.id;
export function projectOptionText(
  among: OsContextEntry[],
  project: OsContextEntry,
) {
  const label = projectLabel(project);
  const shown =
    label.length > PROJECT_OPTION_MAX
      ? `${label.slice(0, PROJECT_OPTION_MAX - 1)}…`
      : label;
  const ambiguous = among.some(
    (other) => other.id !== project.id && projectLabel(other) === label,
  );
  return `${ambiguous ? `${shown} (${project.id})` : shown}${project.enabled ? "" : " (disabled)"}`;
}
export const workspaceOptionText = (workspace: OsContextEntry) =>
  `${workspace.label || workspace.id}${workspace.enabled ? "" : " (disabled)"}`;
