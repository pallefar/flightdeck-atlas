import { z } from "zod";
import type { Project, Task, ProjectFields } from "./projects";
const id = z.string().min(1).max(80);
export const fieldSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  name: z.string().trim().min(1).max(60),
  type: z.enum(["text", "number", "date", "select", "checkbox", "formula"]),
  options: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  formula: z.string().max(500).default(""),
});
export type CustomField = z.infer<typeof fieldSchema>;
export const conditionSchema = z.object({
  field: z.string().min(1).max(60),
  operator: z.enum(["is", "is_not", "contains", "gt", "lt"]),
  value: z.string().max(200),
});
export const filterGroupSchema = z.object({
  mode: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(8),
});
export const advancedFilterSchema = z.object({
  mode: z.enum(["all", "any"]),
  groups: z.array(filterGroupSchema).max(6),
});
export type AdvancedFilter = z.infer<typeof advancedFilterSchema>;
export const ruleSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  trigger: z.enum(["created", "status", "assigned", "completed"]),
  conditions: filterGroupSchema,
  action: z.enum(["priority", "workflow", "group", "assigneeEmail", "notify"]),
  value: z.string().max(254),
});
export type WorkRule = z.infer<typeof ruleSchema>;
export const scheduleLinkSchema = z.object({
  taskId: id,
  projectId: z.string().max(80).default(""),
  type: z.enum(["FS", "SS", "FF", "SF"]),
  lag: z.number().int().min(-365).max(365),
});
export type ScheduleLink = z.infer<typeof scheduleLinkSchema>;
export const widgetSchema = z.object({
  id,
  name: z.string().trim().min(1).max(80),
  metric: z.string().min(1).max(60),
  aggregate: z.enum(["sum", "average", "count", "min", "max"]),
  filter: filterGroupSchema,
  display: z.enum(["number", "bars"]),
});
export type WorkWidget = z.infer<typeof widgetSchema>;
export const advancedWorkSchema = z.object({
  fields: z.array(fieldSchema).max(20).default([]),
  rules: z.array(ruleSchema).max(20).default([]),
  baselines: z
    .array(
      z.object({
        id,
        name: z.string().trim().min(1).max(60),
        at: z.string().datetime(),
        tasks: z
          .array(z.object({ id, start: z.string(), finish: z.string() }))
          .max(200),
      }),
    )
    .max(5)
    .default([]),
  widgets: z.array(widgetSchema).max(12).default([]),
  expenses: z
    .array(
      z.object({
        id,
        date: z.string(),
        description: z.string().trim().min(1).max(200),
        amount: z.number().finite().min(0).max(1e9),
        billable: z.boolean(),
      }),
    )
    .max(100)
    .default([]),
});
export const emptyWork = () =>
  ({
    fields: [],
    rules: [],
    baselines: [],
    widgets: [],
    expenses: [],
  }) as z.infer<typeof advancedWorkSchema>;

// A small arithmetic parser. Never execute a formula as JavaScript.
export function calculate(
  expression: string,
  resolve: (key: string) => number | null,
  syntaxOnly = false,
): number | null {
  try {
    const tokens =
      expression.match(
        /\[[a-z][a-z0-9_]*\]|(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/]/g,
      ) || [];
    if (!tokens.length || tokens.join("") !== expression.replace(/\s/g, ""))
      return null;
    let i = 0;
    const atom = (): number => {
      const t = tokens[i++];
      if (t === "-") return -atom();
      if (t === "+") return atom();
      if (t === "(") {
        const n = sum();
        if (tokens[i++] !== ")") throw Error();
        return n;
      }
      if (t?.startsWith("[")) {
        const n = resolve(t.slice(1, -1));
        if (n === null) throw Error();
        return n;
      }
      if (!t || !/^\d|^\./.test(t)) throw Error();
      return Number(t);
    };
    const product = (): number => {
      let n = atom();
      while (tokens[i] === "*" || tokens[i] === "/") {
        const op = tokens[i++],
          r = atom();
        if (op === "/" && r === 0 && !syntaxOnly) throw Error();
        n = syntaxOnly ? 1 : op === "*" ? n * r : n / r;
      }
      return n;
    };
    const sum = (): number => {
      let n = product();
      while (tokens[i] === "+" || tokens[i] === "-") {
        const op = tokens[i++],
          r = product();
        n = op === "+" ? n + r : n - r;
      }
      return n;
    };
    const result = sum();
    return i === tokens.length && (syntaxOnly || Number.isFinite(result))
      ? syntaxOnly
        ? 0
        : result
      : null;
  } catch {
    return null;
  }
}
export function numericValue(
  task: Task,
  key: string,
  fields: CustomField[],
  seen = new Set<string>(),
  memo = new Map<string, number | null>(),
): number | null {
  if (key === "estimate") return task.estimateMinutes ?? null;
  if (key === "actual")
    return (task.timeEntries || []).reduce((n, e) => n + e.minutes, 0);
  if (key === "rate") return task.hourlyRate ?? null;
  if (key === "cost") {
    const rate = task.hourlyRate;
    return rate === undefined
      ? null
      : ((numericValue(task, "actual", fields) || 0) / 60) * rate;
  }
  if (key === "complete") return task.done ? 1 : 0;
  if (memo.has(key)) return memo.get(key)!;
  if (seen.has(key)) return null;
  const f = fields.find((f) => f.id === key);
  if (!f) return null;
  if (f.type === "formula") {
    const result = calculate(f.formula, (k) =>
      numericValue(task, k, fields, new Set([...seen, key]), memo),
    );
    memo.set(key, result);
    return result;
  }
  const v = task.customValues?.[key];
  return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : null;
}
export function conditionMatches(
  t: Task,
  c: z.infer<typeof conditionSchema>,
  fields: CustomField[] = [],
): boolean {
  const n = numericValue(t, c.field, fields);
  const value =
    c.field === "state"
      ? t.done
        ? "done"
        : t.workflow || "todo"
      : c.field === "priority"
        ? t.priority || "Normal"
        : c.field === "owner"
          ? t.assigneeEmail || t.assignee || ""
          : c.field === "group"
            ? t.group || ""
            : c.field === "title"
              ? t.title
              : (n ?? t.customValues?.[c.field] ?? "");
  if (c.operator === "gt" || c.operator === "lt")
    return (
      n !== null &&
      c.value.trim() !== "" &&
      Number.isFinite(Number(c.value)) &&
      (c.operator === "gt" ? n > Number(c.value) : n < Number(c.value))
    );
  const a = String(value).toLowerCase(),
    b = c.value.toLowerCase();
  return c.operator === "is"
    ? a === b
    : c.operator === "is_not"
      ? a !== b
      : a.includes(b);
}
export function matchesGroup(
  t: Task,
  g: z.infer<typeof filterGroupSchema>,
  fields: CustomField[] = [],
) {
  return (
    !g.conditions.length ||
    (g.mode === "all"
      ? g.conditions.every((c) => conditionMatches(t, c, fields))
      : g.conditions.some((c) => conditionMatches(t, c, fields)))
  );
}
export function matchesFilter(
  t: Task,
  f: AdvancedFilter | undefined,
  fields: CustomField[] = [],
) {
  return (
    !f?.groups.length ||
    (f.mode === "all"
      ? f.groups.every((g) => matchesGroup(t, g, fields))
      : f.groups.some((g) => matchesGroup(t, g, fields)))
  );
}
export function evaluateRules(fields: ProjectFields, previous: Project) {
  const notices: { taskId: string; recipient: string; text: string }[] = [],
    applied: string[] = [];
  const tasks = fields.tasks.map((t) => {
    const old = previous.tasks.find((x) => x.id === t.id);
    let next = { ...t };
    for (const rule of fields.work?.rules || []) {
      const fires =
        rule.trigger === "created"
          ? !old
          : rule.trigger === "completed"
            ? !!old && !old.done && t.done
            : rule.trigger === "assigned"
              ? !!old && old.assigneeEmail !== t.assigneeEmail
              : !!old &&
                (old.done ? "done" : old.workflow || "todo") !==
                  (t.done ? "done" : t.workflow || "todo");
      if (
        !rule.enabled ||
        !fires ||
        !matchesGroup(t, rule.conditions, fields.work?.fields)
      )
        continue;
      if (rule.action === "notify")
        notices.push({
          taskId: t.id,
          recipient: rule.value,
          text: `${rule.name}: ${t.title}`,
        });
      else if (
        rule.action === "priority" &&
        ["High", "Normal", "Low"].includes(rule.value)
      )
        next.priority = rule.value as Task["priority"];
      else if (
        rule.action === "workflow" &&
        ["todo", "doing", "blocked"].includes(rule.value) &&
        !t.done
      )
        next.workflow = rule.value as Task["workflow"];
      else if (rule.action === "group") next.group = rule.value;
      else if (rule.action === "assigneeEmail") {
        next.assigneeEmail = rule.value;
        next.assignee = rule.value;
      }
      applied.push(`${rule.name} → ${t.title}`);
    }
    return next;
  });
  return { fields: { ...fields, tasks }, applied, notices };
}
export const dateNumber = (s: string) =>
  Date.parse(`${s}T12:00:00Z`) / 86400000;
export const dateFrom = (n: number) =>
  new Date(n * 86400000).toISOString().slice(0, 10);
export function localLinks(t: Task): ScheduleLink[] {
  return [
    ...(t.dependsOn || []).map((taskId) => ({
      taskId,
      projectId: "",
      type: "FS" as const,
      lag: 0,
    })),
    ...(t.scheduleLinks || []).filter((l) => !l.projectId),
  ];
}
export function duration(t: Task) {
  return t.milestone
    ? 0
    : Math.max(
        1,
        t.startDate &&
          t.dueDate &&
          Number.isFinite(dateNumber(t.startDate)) &&
          Number.isFinite(dateNumber(t.dueDate))
          ? dateNumber(t.dueDate) - dateNumber(t.startDate) + 1
          : 1,
      );
}
export function linkOffset(
  type: ScheduleLink["type"],
  before: number,
  after: number,
  lag: number,
) {
  return (
    (type === "FS"
      ? before
      : type === "SS"
        ? 0
        : type === "FF"
          ? before - after
          : -after) + lag
  );
}
export function criticalPath(tasks: Task[]) {
  const ordered: Task[] = [],
    seen = new Set<string>();
  const visit = (t: Task) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    for (const l of localLinks(t)) {
      const p = tasks.find((x) => x.id === l.taskId);
      if (p) visit(p);
    }
    ordered.push(t);
  };
  tasks.forEach(visit);
  const early = new Map<string, number>();
  for (const t of ordered) {
    let s = 0;
    for (const l of localLinks(t)) {
      const p = tasks.find((x) => x.id === l.taskId);
      if (p)
        s = Math.max(
          s,
          (early.get(p.id) || 0) +
            linkOffset(l.type, duration(p), duration(t), l.lag),
        );
    }
    early.set(t.id, s);
  }
  const finish = Math.max(
      0,
      ...tasks.map((t) => (early.get(t.id) || 0) + duration(t)),
    ),
    late = new Map(tasks.map((t) => [t.id, finish - duration(t)]));
  for (const t of [...ordered].reverse())
    for (const l of localLinks(t)) {
      const p = tasks.find((x) => x.id === l.taskId);
      if (p)
        late.set(
          p.id,
          Math.min(
            late.get(p.id)!,
            late.get(t.id)! -
              linkOffset(l.type, duration(p), duration(t), l.lag),
          ),
        );
    }
  return {
    finish,
    rows: tasks.map((t) => ({
      task: t,
      early: early.get(t.id) || 0,
      slack: Math.max(0, (late.get(t.id) || 0) - (early.get(t.id) || 0)),
    })),
  };
}
export function reschedule(tasks: Task[], external: Project[] = []) {
  const updated = new Map<string, Task>(),
    visiting = new Set<string>();
  const visit = (t: Task): Task => {
    if (updated.has(t.id)) return updated.get(t.id)!;
    if (visiting.has(t.id)) throw Error("Dependency cycle");
    visiting.add(t.id);
    let start = t.startDate || t.dueDate;
    if (!start || !Number.isFinite(dateNumber(start))) {
      visiting.delete(t.id);
      updated.set(t.id, t);
      return t;
    }
    let n = dateNumber(start);
    for (const l of [
      ...localLinks(t),
      ...(t.scheduleLinks || []).filter((l) => l.projectId),
    ]) {
      const p = l.projectId
        ? external
            .find((p) => p.id === l.projectId)
            ?.tasks.find((x) => x.id === l.taskId)
        : tasks.find((x) => x.id === l.taskId);
      if (!p) continue;
      const prior = l.projectId ? p : visit(p);
      if (Number.isFinite(dateNumber(prior.startDate || prior.dueDate || "")))
        n = Math.max(
          n,
          dateNumber(prior.startDate || prior.dueDate!) +
            linkOffset(l.type, duration(prior), duration(t), l.lag),
        );
    }
    const next = {
      ...t,
      startDate: dateFrom(n),
      dueDate: dateFrom(n + Math.max(0, duration(t) - 1)),
    };
    updated.set(t.id, next);
    visiting.delete(t.id);
    return next;
  };
  return tasks.map(visit);
}
export function widgetValue(
  tasks: Task[],
  w: WorkWidget,
  fields: CustomField[] = [],
) {
  const selected = tasks.filter((t) => matchesGroup(t, w.filter, fields));
  if (w.aggregate === "count") return selected.length;
  const values = selected
    .map((t) => numericValue(t, w.metric, fields))
    .filter((n): n is number => n !== null);
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return w.aggregate === "sum"
    ? sum
    : w.aggregate === "average"
      ? sum / values.length
      : w.aggregate === "min"
        ? Math.min(...values)
        : Math.max(...values);
}
