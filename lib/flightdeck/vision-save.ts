import type { Project, ProjectFields } from "../projects";
import type { VisionRead } from "./vision-route";
import type { VisionClient } from "./context-client";
import { visionTransition } from "./vision";
import { deliveryPayload } from "./vision-sync";

/** Explicit fields rather than the whole project: task work, cosmetic names,
 * local send markers and client provenance cannot invalidate a scope review. */
export function visionMaterialFields(project: ProjectFields) {
  const facts = project.onboarding;
  return { description: project.description, category: project.category, functionArea: project.functionArea ?? "",
    successMeasure: project.benefit ?? "",
    objectives: (project.objectives ?? []).map(({ id, title, description, owner, dueDate }) => ({ id, title, description, owner, dueDate })),
    measures: (project.kpis ?? []).map(({ id, name, unit, baseline, target, objectiveId }) => ({ id, name, unit, baseline, target, objectiveId })),
    facts: { countryCode: facts?.countryCode ?? null, worksCouncilRelevant: facts?.worksCouncilRelevant ?? null,
      legalEntity: facts?.legalEntity ?? null, headcountBand: facts?.headcountBand ?? null,
      ownerRoles: { process: facts?.ownerRoles?.process ?? "", data: facts?.ownerRoles?.data ?? "", support: facts?.ownerRoles?.support ?? "" },
      dataSources: facts?.dataSources ?? [], accessRequested: (facts?.accessRequested ?? []).map(({ system, level }) => ({ system, level })) } };
}
export async function visionChangeHash(project: ProjectFields) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(visionMaterialFields(project))));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stage changes use the OS prepare proposal before the Atlas revision is
 * written. Ordinary work on an existing active project does not move a gate. */
export async function prepareVisionChange(previous: Project, next: ProjectFields, deps: { read: () => Promise<VisionRead>; client: () => VisionClient | null }) {
  const keyChange = JSON.stringify(visionMaterialFields(previous)) !== JSON.stringify(visionMaterialFields(next));
  if (!keyChange && previous.status === next.status && previous.onboardingStage === next.onboardingStage && !!previous.archived === !!next.archived) return { ok: true as const, read: null };
  const transition = visionTransition(previous, next);
  const read = await deps.read();
  if (read.state === "not_linked") return { ok: true as const, read: null };
  if (read.state !== "ok") return { ok: false as const, error: "The linked FlightDeck assessment could not be checked. Retry before changing this project's delivery status.", code: "vision_unavailable" };
  if (!read.projection.enrolled) return { ok: true as const, read: null };
  const change = keyChange ? { keyChange: true, changeHash: await visionChangeHash(next) } : {};
  if (keyChange || transition.activation || transition.nextDelivery) {
    const client = deps.client();
    if (!client) return { ok: false as const, error: "FlightDeck assessment is unavailable.", code: "vision_unavailable" };
    const result = await client.delivery(read.link.workspaceId, read.link.osProjectId, deliveryPayload(read.link, read.projection, { ...next, id: previous.id, revision: previous.revision + 1 }, "prepare", change));
    if (result.state !== "ok") return { ok: false as const, error: "Vision assessment approval is required for this delivery stage. Review the project assessment, then retry.", code: result.state === "review_required" ? "vision_review_required" : "vision_unavailable" };
    return { ok: true as const, read: { ...read, projection: result.data }, change };
  }
  return { ok: true as const, read, change };
}
