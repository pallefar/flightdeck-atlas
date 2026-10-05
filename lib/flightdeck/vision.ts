import { z } from "zod";
import { osIdSchema, isoSchema } from "./context";

// Narrow approved projection only. Private answers, source documents and reviewer
// notes must never be added here. Both peers reject undeclared fields.
export const visionProjectionSchema = z.object({
  schema: z.literal("vision-projection/1"), workspaceId: osIdSchema, projectId: osIdSchema.optional(),
  enrolled: z.boolean(), status: z.enum(["not_required", "required", "pending", "needs_changes", "approved", "review_due", "unavailable"]),
  canActivate: z.boolean(), canOperate: z.boolean(), canDeliver: z.boolean(), assessmentRevision: z.number().int().nonnegative().nullable(),
  visionRevision: z.number().int().nonnegative().nullable(), approvedGoals: z.array(z.string().max(400)).max(50),
  requiredActions: z.array(z.string().max(400)).max(50), checkedAt: isoSchema,
  approvedStage: z.string().max(100).nullable(), pendingStage: z.string().max(100).nullable(),
  deliveryStatus: z.string().max(100).nullable(), atlasRevision: z.number().int().nonnegative().nullable(),
}).strict().refine((value) => value.enrolled === (value.status !== "not_required"), "Inconsistent enrollment");
export type VisionProjection = z.infer<typeof visionProjectionSchema>;
export const visionDeliverySchema = z.object({
  schema: z.literal("vision-delivery/1"), intent: z.enum(["prepare", "commit"]),
  osInstanceId: z.string().min(1).max(128), atlasProjectId: z.string().min(1).max(128),
  atlasRevision: z.number().int().positive(), expectedAssessmentRevision: z.number().int().nonnegative().nullable(),
  expectedVisionRevision: z.number().int().nonnegative().nullable(), stage: z.string().min(1).max(100),
  status: z.enum(["Planning", "In progress", "On hold", "Completed"]), keyChange: z.boolean().optional(),
  changeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().refine((value) => !value.keyChange || !!value.changeHash, "Material changes need a digest");
export type VisionDelivery = z.infer<typeof visionDeliverySchema>;
export type VisionTransition = { activation: boolean; nextDelivery: boolean };
type TransitionProject = { status: string; onboardingStage?: string; archived?: boolean };
const STAGES = ["Discovery", "Pilot", "Ready for FlightDeck", "Rolled out"];
export function visionTransition(previous: TransitionProject, next: TransitionProject): VisionTransition {
  return {
    activation: next.status === "In progress" && (previous.status !== "In progress" || (!!previous.archived && !next.archived)),
    nextDelivery: (next.status === "Completed" && previous.status !== "Completed") ||
      (!!next.onboardingStage && next.onboardingStage !== previous.onboardingStage && STAGES.indexOf(next.onboardingStage) > Math.max(0, STAGES.indexOf(previous.onboardingStage ?? "Discovery"))),
  };
}
export function projectionRefusal(projection: VisionProjection, transition: VisionTransition): { code: string; error: string } | null {
  if (!projection.enrolled) return null;
  if (transition.activation && !projection.canActivate) return { code: "vision_assessment_required", error: "The HR workspace and project need approved Vision assessments before activation." };
  if (transition.nextDelivery && !projection.canDeliver) return { code: "vision_delivery_review_required", error: "Vision review is required before the next delivery stage." };
  return null;
}
