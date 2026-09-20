import { z } from "zod";
import {
  advancedWorkSchema,
  scheduleLinkSchema,
  calculate,
  localLinks,
} from "./advanced-work";
import {
  budgetSchema,
  savedViewSchema,
  reviewSnapshotSchema,
  automationSchema,
} from "./work-model";
export const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(`${s}T12:00:00Z`)) &&
  new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const dateField = z
  .string()
  .refine((s) => s === "" || validDate(s), "Choose a valid calendar date.");
export const taskSchema = z.object({
  id: z.string().max(80),
  title: z.string().trim().min(1).max(200),
  done: z.boolean(),
  dueDate: dateField.optional(),
  priority: z.enum(["High", "Normal", "Low"]).optional(),
  assignee: z.string().max(100).optional(),
  assigneeEmail: z
    .union([z.literal(""), z.string().email().max(254)])
    .optional(),
  dependsOn: z.array(z.string().max(80)).max(50).optional(),
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
  recurrenceSource: z.string().max(80).optional(),
  plannedDate: dateField.optional(),
  workflow: z.enum(["todo", "doing", "blocked"]).optional(),
  description: z.string().max(2000).optional(),
  estimateMinutes: z.number().int().min(0).max(100000).optional(),
  startDate: dateField.optional(),
  milestone: z.boolean().optional(),
  group: z.string().trim().max(60).optional(),
  timeEntries: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        minutes: z.number().int().min(1).max(1440),
        note: z.string().trim().max(300),
        author: z.string().max(254).optional(),
      }),
    )
    .max(100)
    .optional(),
  checklist: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        title: z.string().trim().min(1).max(200),
        done: z.boolean(),
      }),
    )
    .max(30)
    .optional(),
  templateRef: z
    .object({
      projectId: z.string().max(80),
      templateId: z.string().max(80),
      taskId: z.string().max(80),
      version: z.number().int().min(1),
    })
    .optional(),
  parentId: z.string().max(80).optional(),
  archived: z.boolean().optional(),
  customValues: z
    .record(
      z.union([
        z.string().max(1000),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    )
    .optional(),
  scheduleLinks: z.array(scheduleLinkSchema).max(30).optional(),
  hourlyRate: z.number().finite().min(0).max(100000).optional(),
  billable: z.boolean().optional(),
  completedAt: z.string().nullable().optional(),
});
export const objectiveSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).default(""),
  owner: z.string().max(100).default(""),
  dueDate: dateField.default(""),
  status: z.enum(["Planned", "In progress", "Achieved"]).default("Planned"),
});
export const kpiSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(100),
    unit: z.string().max(30).default(""),
    baseline: z.number().finite(),
    current: z.number().finite(),
    target: z.number().finite(),
    objectiveId: z.string().max(80).default(""),
  })
  .refine(
    (k) => k.target !== k.baseline,
    "KPI target must differ from its baseline.",
  );
export type Objective = z.infer<typeof objectiveSchema>;
export type KPI = z.infer<typeof kpiSchema>;
export function kpiProgress(k: KPI) {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(((k.current - k.baseline) / (k.target - k.baseline)) * 100),
    ),
  );
}
export type Task = z.infer<typeof taskSchema>;
export function taskState(t: Task) {
  return t.done ? "done" : t.workflow || "todo";
}
export function taskBlocked(t: Task, p: { tasks: Task[] }) {
  return (
    !t.archived &&
    !t.done &&
    (t.workflow === "blocked" ||
      (t.dependsOn || []).some((id) => !p.tasks.find((x) => x.id === id)?.done))
  );
}
export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(1500).default(""),
    status: z.enum(["In progress", "Planning", "On hold", "Completed"]),
    category: z.string().trim().min(1).max(60),
    location: z.string().max(100),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    dueDate: dateField,
    color: z.enum(["orange", "blue", "green", "violet"]),
    tasks: z.array(taskSchema).max(200),
    objectives: z.array(objectiveSchema).max(30).optional(),
    kpis: z.array(kpiSchema).max(40).optional(),
    budget: budgetSchema.optional(),
    work: advancedWorkSchema.optional(),
    taskViews: z.array(savedViewSchema).max(12).optional(),
    automations: automationSchema.optional(),
    leadershipReviews: z.array(reviewSnapshotSchema).max(20).optional(),
    functionArea: z.string().max(80).optional(),
    priority: z.enum(["High", "Normal", "Low"]).optional(),
    sponsor: z.string().max(100).optional(),
    nextAction: z.string().max(300).optional(),
    blocker: z.string().max(500).optional(),
    benefit: z.string().max(500).optional(),
    archived: z.boolean().optional(),
    flightdeckDraft: z
      .object({
        label: z.string().trim().min(1).max(100),
        workspaceHint: z.string().trim().max(100),
      })
      .nullable()
      .optional(),
    onboardingStage: z
      .enum(["Discovery", "Pilot", "Ready for FlightDeck", "Rolled out"])
      .optional(),
  })
  .refine(
    (p) => (p.latitude === null) === (p.longitude === null),
    "Provide both coordinates or neither",
  )
  .superRefine((p, ctx) => {
    for (const items of [
      p.tasks,
      p.work?.fields || [],
      p.work?.rules || [],
      p.work?.widgets || [],
      p.work?.baselines || [],
      p.work?.expenses || [],
      p.objectives || [],
      p.kpis || [],
      p.taskViews || [],
      p.leadershipReviews || [],
      ...p.tasks.map((t) => t.checklist || []),
      ...p.tasks.map((t) => t.timeEntries || []),
    ]) {
      if (new Set(items.map((x) => x.id)).size !== items.length)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Record IDs must be unique.",
        });
    }
    const ids = new Set(p.tasks.map((t) => t.id));
    if (
      p.tasks.some((t) => t.startDate && t.dueDate && t.startDate > t.dueDate)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task start must be on or before its due date.",
      });
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    for (const t of p.tasks) {
      const parents = new Set([t.id]);
      let parent = t.parentId,
        depth = 0;
      while (parent) {
        if (parents.has(parent) || !ids.has(parent) || ++depth > 6) {
          issue(
            "Subtasks need an existing parent, no cycles, and at most six levels.",
          );
          break;
        }
        parents.add(parent);
        parent = p.tasks.find((x) => x.id === parent)?.parentId;
      }
      if (t.done && p.tasks.some((x) => x.parentId === t.id && !x.done))
        issue("Complete all subtasks before completing their parent.");
      if (
        t.recurrence &&
        t.recurrence !== "none" &&
        (t.parentId || p.tasks.some((x) => x.parentId === t.id))
      )
        issue(
          "Repeating tasks cannot have a parent or subtasks. Repeat standalone tasks.",
        );
      for (const [key, value] of Object.entries(t.customValues || {})) {
        const f = p.work?.fields.find((f) => f.id === key);
        if (!f) {
          issue("Custom values must reference an existing field.");
          continue;
        }
        if (value === null || value === "") continue;
        if (
          f.type === "formula" ||
          (f.type === "number" && typeof value !== "number") ||
          (f.type === "checkbox" && typeof value !== "boolean") ||
          (["text", "date", "select"].includes(f.type) &&
            typeof value !== "string") ||
          (f.type === "date" && !validDate(String(value))) ||
          (f.type === "select" && !f.options.includes(String(value)))
        )
          issue(`Check the value for ${f.name}.`);
      }
    }
    const fields = p.work?.fields || [];
    const formulaMemo = new Map<string, boolean>();
    const checkFormula = (key: string, seen: Set<string>): boolean => {
      if (seen.has(key)) return false;
      if (formulaMemo.has(key)) return formulaMemo.get(key)!;
      const f = fields.find((f) => f.id === key);
      if (!f)
        return ["estimate", "actual", "rate", "cost", "complete"].includes(key);
      if (f.type !== "formula") return ["number", "checkbox"].includes(f.type);
      const refs = [...f.formula.matchAll(/\[([a-z][a-z0-9_]*)\]/g)].map(
        (m) => m[1],
      );
      const valid =
        calculate(f.formula, () => 1, true) !== null &&
        refs.every((k) => checkFormula(k, new Set([...seen, key])));
      formulaMemo.set(key, valid);
      return valid;
    };
    for (const f of fields) {
      if (
        [
          "estimate",
          "actual",
          "rate",
          "cost",
          "complete",
          "state",
          "priority",
          "owner",
          "group",
          "title",
        ].includes(f.id)
      )
        issue("This field key is reserved.");
      if (
        f.type === "select" &&
        (!f.options.length || new Set(f.options).size !== f.options.length)
      )
        issue("Select fields need unique options.");
      if (f.type === "formula" && !checkFormula(f.id, new Set()))
        issue(
          "Use valid arithmetic and numeric field references, without formula cycles.",
        );
    }
    for (const b of p.work?.baselines || [])
      if (
        b.tasks.some(
          (t) =>
            (t.start && !validDate(t.start)) ||
            (t.finish && !validDate(t.finish)),
        )
      )
        issue("Baseline dates must be valid.");
    for (const e of p.work?.expenses || [])
      if (!validDate(e.date)) issue("Use a valid expense date.");
    for (const r of p.work?.rules || []) {
      if (
        r.action === "priority" &&
        !["High", "Normal", "Low"].includes(r.value)
      )
        issue("Choose a valid rule priority.");
      if (
        r.action === "workflow" &&
        !["todo", "doing", "blocked"].includes(r.value)
      )
        issue("Choose a valid workflow action.");
      if (r.action === "group" && r.value.length > 60)
        issue("Group names allow 60 characters.");
    }
    const state = new Map<string, number>();
    const visit = (id: string): boolean => {
      if (state.get(id) === 1) return true;
      if (state.get(id) === 2) return false;
      state.set(id, 1);
      if (
        (p.tasks.find((t) => t.id === id)
          ? localLinks(p.tasks.find((t) => t.id === id)!)
          : []
        ).some((l) => visit(l.taskId))
      )
        return true;
      state.set(id, 2);
      return false;
    };
    if (
      p.tasks.some(
        (t) => localLinks(t).some((l) => !ids.has(l.taskId)) || visit(t.id),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Dependencies must use existing tasks and cannot form a cycle.",
      });
    if (
      p.tasks.some(
        (t) =>
          t.done &&
          (t.dependsOn || []).some(
            (d) => !p.tasks.find((x) => x.id === d)?.done,
          ),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Complete dependency tasks before completing this task.",
      });
    if (
      p.kpis?.some(
        (k) =>
          k.objectiveId && !p.objectives?.some((o) => o.id === k.objectiveId),
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose an existing strategy goal for this KPI.",
      });
  });
export type ProjectFields = z.infer<typeof projectSchema>;
export type ProjectEvent = {
  id: string;
  at: string;
  kind:
    | "created"
    | "project"
    | "task-completed"
    | "task-reopened"
    | "task-added"
    | "task-removed"
    | "note";
  text: string;
  taskId?: string;
};
export type Project = ProjectFields & {
  activity?: ProjectEvent[];
  canEdit?: boolean;
  canShare?: boolean;
  canComment?: boolean;
  canArchive?: boolean;
  ownedByMe?: boolean;
  id: string;
  source: "atlas" | "flightdeck";
  updatedAt: string;
  revision: number;
};
export const progress = (p: Project) => {
  const active = p.tasks.filter((t) => !t.archived);
  return active.length
    ? Math.round((active.filter((t) => t.done).length / active.length) * 100)
    : p.status === "Completed"
      ? 100
      : 0;
};
export const examples: Project[] = [
  {
    id: "demo-1",
    name: "FlightDeck OS",
    description: "One workspace for the projects, people, and ideas in motion.",
    status: "In progress",
    category: "Platform",
    location: "Copenhagen, Denmark",
    latitude: 55.6761,
    longitude: 12.5683,
    dueDate: "2026-10-15",
    color: "orange",
    tasks: [
      { id: "a", title: "Define the sub-app experience", done: true },
      { id: "b", title: "Connect the project API", done: false },
      { id: "c", title: "Review shared sign-in", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-17",
    revision: 1,
  },
  {
    id: "demo-2",
    name: "Northstar Studio",
    description:
      "A new home for a creative practice with a global perspective.",
    status: "In progress",
    category: "Design",
    location: "New York, United States",
    latitude: 40.7128,
    longitude: -74.006,
    dueDate: "2026-10-02",
    color: "blue",
    tasks: [
      { id: "a", title: "Map the customer journey", done: true },
      { id: "b", title: "Build the visual identity", done: true },
      { id: "c", title: "Review the first prototype", done: false },
      { id: "d", title: "Publish the studio site", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-16",
    revision: 1,
  },
  {
    id: "demo-3",
    name: "Kyoto Field Notes",
    description:
      "An independent journal documenting places and the people who shape them.",
    status: "Planning",
    category: "Editorial",
    location: "Kyoto, Japan",
    latitude: 35.0116,
    longitude: 135.7681,
    dueDate: "2026-11-01",
    color: "green",
    tasks: [
      { id: "a", title: "Choose the first three stories", done: false },
      { id: "b", title: "Plan the field research", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-15",
    revision: 1,
  },
  {
    id: "demo-4",
    name: "Casa Horizon",
    description: "A considered space to work, gather, and make new things.",
    status: "On hold",
    category: "Spaces",
    location: "Lisbon, Portugal",
    latitude: 38.7223,
    longitude: -9.1393,
    dueDate: "",
    color: "violet",
    tasks: [
      { id: "a", title: "Shortlist locations", done: true },
      { id: "b", title: "Review the space plan", done: false },
    ],
    source: "atlas",
    updatedAt: "2026-09-12",
    revision: 1,
  },
];
