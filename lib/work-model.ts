import { z } from "zod";
import { advancedFilterSchema } from "./advanced-work";
export const budgetSchema = z.object({
  currency: z.enum(["USD", "EUR", "GBP", "PLN", "DKK", "CNY"]),
  approved: z.number().finite().min(0).max(1e12).nullable(),
  forecast: z.number().finite().min(0).max(1e12).nullable(),
  actual: z.number().finite().min(0).max(1e12).nullable(),
});
export const savedViewSchema = z.object({
  advanced: advancedFilterSchema.optional(),
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  query: z.string().max(200),
  filter: z.enum(["all", "mine", "open", "overdue", "high"]),
  group: z.string().max(60),
  sort: z.enum(["manual", "due", "priority", "owner"]),
  layout: z.enum(["list", "board", "table", "timeline"]),
  owner: z.string().max(254).default(""),
  priority: z.enum(["", "High", "Normal", "Low"]).default(""),
  state: z.enum(["", "todo", "doing", "blocked", "done"]).default(""),
});
export const automationSchema = z.object({
  readyToDoing: z.boolean(),
  blockedToHigh: z.boolean(),
});
export const reviewSnapshotSchema = z.object({
  id: z.string().min(1).max(80),
  role: z.enum(["CEO", "VP", "Director"]),
  horizon: z.enum(["now", "week", "gate"]),
  at: z.string().datetime(),
  sourceRevision: z.number().int().min(1),
  text: z.string().max(12000),
});
export type Budget = z.infer<typeof budgetSchema>;
export type TaskView = z.infer<typeof savedViewSchema>;
