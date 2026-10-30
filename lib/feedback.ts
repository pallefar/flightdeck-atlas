// Feedback, as a shape rather than a route.
//
// Structural context only — which screen, which project, which stage, which
// action — plus the person's own words. No page text, no project data, no
// screenshot: the Maps admin overlay's privacy rule, kept in one place so the
// web lane and the desktop app cannot each invent their own.
import { z } from "zod";
export const FEEDBACK_SOURCES = ["macos", "web"] as const;
export const FEEDBACK_RATINGS = ["ok", "minor_issue", "major_issue"] as const;
export const feedbackSchema = z
  .object({
    source: z.enum(FEEDBACK_SOURCES),
    screen: z.string().trim().max(80).default(""),
    projectId: z.string().trim().max(80).nullable().optional(),
    stage: z.string().trim().max(40).nullable().optional(),
    rating: z.enum(FEEDBACK_RATINGS),
    category: z.string().trim().max(60).nullable().optional(),
    comment: z.string().trim().max(4000).default(""),
    appVersion: z.string().trim().max(40).nullable().optional(),
  })
  .strict();
export type Feedback = z.infer<typeof feedbackSchema>;
/** Thirty notes an hour is already far more than a person writes. */
export const FEEDBACK_PER_HOUR = 30;
export const overLimit = (recent: number) => recent >= FEEDBACK_PER_HOUR;
/** One note as a line for the prompt, so a batch can be pasted anywhere. */
export function feedbackPromptLine(
  note: Pick<Feedback, "source" | "screen" | "rating" | "category" | "comment"> & {
    stage?: string | null;
    projectId?: string | null;
  },
): string {
  const where = [
    note.screen || note.source,
    note.projectId ? `project ${note.projectId}` : "",
    note.stage ? `stage ${note.stage}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const tag = note.category ? `${note.rating}/${note.category}` : note.rating;
  return `- [${tag}] ${where}: ${note.comment || "(no comment)"}`;
}
/** Every note as ONE prompt, the way the overlay copies it. */
export function feedbackPrompt(notes: Parameters<typeof feedbackPromptLine>[0][]): string {
  if (notes.length === 0) return "";
  return [
    "Feedback from the Atlas apps:",
    ...notes.map((note) => feedbackPromptLine(note)),
    "",
    "Please address these points.",
  ].join("\n");
}
