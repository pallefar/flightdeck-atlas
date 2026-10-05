import { z } from "zod";
import type { OnboardDb } from "./onboard-route";
import type { VisionClient } from "./context-client";
import { visionDeliverySchema, type VisionDelivery, type VisionProjection } from "./vision";
import type { VisionLink } from "./vision-route";

const linkSchema = z.object({ installationId: z.string().min(1), osInstanceId: z.string().min(1), workspaceId: z.string().min(1), osProjectId: z.string().min(1), accessState: z.literal("active") }).strict();
const outboxSchema = z.object({ link: linkSchema, payload: visionDeliverySchema }).strict();
export function deliveryPayload(link: VisionLink, projection: VisionProjection, project: { id: string; revision: number; status: "Planning" | "In progress" | "On hold" | "Completed"; onboardingStage?: string }, intent: "prepare" | "commit", change: { keyChange?: boolean; changeHash?: string } = {}): VisionDelivery {
  return { schema: "vision-delivery/1", intent, osInstanceId: link.osInstanceId, atlasProjectId: project.id, atlasRevision: project.revision,
    expectedAssessmentRevision: projection.assessmentRevision, expectedVisionRevision: projection.visionRevision,
    stage: project.status === "Completed" ? "Completed" : project.onboardingStage ?? project.status, status: project.status, ...change };
}
/** This must directly follow the guarded project UPDATE in its D1 batch. */
export function visionOutboxStatement<D extends OnboardDb>(db: D, link: VisionLink, payload: VisionDelivery, updatedAt: string): ReturnType<ReturnType<D["prepare"]>["bind"]> {
  const parsed = outboxSchema.parse({ link, payload });
  return db.prepare("INSERT INTO atlas_vision_delivery_outbox (project_id,atlas_revision,data,updated_at) SELECT ?,?,?,? WHERE changes()>0 ON CONFLICT(project_id) DO UPDATE SET atlas_revision=excluded.atlas_revision,data=excluded.data,updated_at=excluded.updated_at WHERE excluded.atlas_revision>=atlas_vision_delivery_outbox.atlas_revision")
    .bind(payload.atlasProjectId, payload.atlasRevision, JSON.stringify(parsed), updatedAt) as ReturnType<ReturnType<D["prepare"]>["bind"]>;
}
export async function hasVisionSync(db: OnboardDb, projectId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT project_id FROM atlas_vision_delivery_outbox WHERE project_id=?").bind(projectId).first());
}
/** Retries the latest committed revision only, under the current confirmed
 * link. A failed/mismatched send retains the durable marker, never success. */
export async function drainVisionSync(db: OnboardDb, projectId: string, current: VisionLink, client: VisionClient, freshProjection?: VisionProjection): Promise<boolean> {
  const row = await db.prepare("SELECT atlas_revision,data FROM atlas_vision_delivery_outbox WHERE project_id=?").bind(projectId).first<{ atlas_revision: number; data: string }>();
  if (!row) return true;
  let parsed;
  try { parsed = outboxSchema.safeParse(JSON.parse(row.data)); } catch { return false; }
  if (!parsed.success) return false;
  const { link, payload } = parsed.data;
  if (payload.intent !== "commit" || payload.atlasProjectId !== projectId || payload.atlasRevision !== row.atlas_revision ||
    ["installationId", "osInstanceId", "workspaceId", "osProjectId", "accessState"].some((key) => link[key as keyof VisionLink] !== current[key as keyof VisionLink])) return false;
  if (freshProjection && (freshProjection.workspaceId !== link.workspaceId || freshProjection.projectId !== link.osProjectId)) return false;
  // Approval may change while a committed event is waiting for a retry. Only
  // rebase the optimistic OS revisions; the saved Atlas event and material
  // digest remain immutable and are still judged against the current gate.
  const send = freshProjection ? { ...payload, expectedAssessmentRevision: freshProjection.assessmentRevision, expectedVisionRevision: freshProjection.visionRevision } : payload;
  const result = await client.delivery(link.workspaceId, link.osProjectId, send);
  if (result.state !== "ok" || result.data.atlasRevision !== payload.atlasRevision || result.data.deliveryStatus !== payload.status) return false;
  await db.prepare("DELETE FROM atlas_vision_delivery_outbox WHERE project_id=? AND atlas_revision=? AND data=?").bind(projectId, row.atlas_revision, row.data).run();
  return true;
}
