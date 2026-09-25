import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  projectSchema,
  type Project,
  type ProjectFields,
  type ProjectEvent,
} from "./projects";
import {
  onboardingSchema,
  requesterRequestsEnabled,
} from "./flightdeck/onboarding";
import { metricsFlagOn } from "./flightdeck/metrics";
import { responsePolicyDaysFrom } from "./flightdeck/waiting";
/** ATLAS_REQUESTER_REQUESTS, read per request: off unless exactly "true". */
export const requesterRequestsOn = () =>
  requesterRequestsEnabled(env.ATLAS_REQUESTER_REQUESTS);
export function database() {
  if (!env.DB)
    throw new Error(
      "Project storage is unavailable. Please try again shortly.",
    );
  return env.DB;
}
/** ONB_METRICS_ENABLED: onboarding measures, off unless exactly "true"
 * (lib/flightdeck/metrics.ts). Read on every call. */
export const onboardingMetricsEnabled = () =>
  metricsFlagOn(env.ONB_METRICS_ENABLED);
/** ONB_RESPONSE_POLICY_DAYS (D-037 item 7, owner-owned): unset means no ETA
 * is shown anywhere. Read on every call. */
export const onboardingResponsePolicyDays = () =>
  responsePolicyDaysFrom(env.ONB_RESPONSE_POLICY_DAYS);
export async function owner() {
  const user = await getChatGPTUser();
  return user?.userId || null;
}
export { json, sameOrigin } from "./http";
export async function readFields(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("Send a JSON project.");
  const raw = await request.text();
  if (raw.length > 100_000) throw new Error("This project is too large.");
  const body = JSON.parse(raw);
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Check your project details.",
    );
  if (
    new Set(parsed.data.tasks.map((t) => t.id)).size !==
    parsed.data.tasks.length
  )
    throw new Error("Task IDs must be unique.");
  if (
    body.updateNote !== undefined &&
    (typeof body.updateNote !== "string" || body.updateNote.length > 1000)
  )
    throw new Error("Updates must be 1,000 characters or fewer.");
  return {
    fields: parsed.data,
    revision: body.revision,
    updateNote:
      typeof body.updateNote === "string" ? body.updateNote.trim() : "",
  };
}
/** A field-scoped save: `{ scope: "onboarding", baseRevision, onboarding }`.
 * Null when the body names no scope, so it is an ordinary whole-project save.
 * Anything else in a scoped body is ignored and never saved. */
export async function readScopedSave(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    return null;
  const raw = await request.clone().text();
  if (raw.length > 100_000) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || !("scope" in body)) return null;
  const { scope, baseRevision, onboarding, action, revision } = body as Record<
    string,
    unknown
  >;
  if (scope !== "onboarding")
    throw new Error("Only the onboarding details can be saved on their own.");
  // onb-atlas-ask-withdraw: ask the Super Admin to send revision r, or
  // withdraw the open ask for revision r. Nothing else rides along.
  if (action !== undefined) {
    if (action !== "ask" && action !== "withdraw")
      throw new Error("Unknown onboarding action.");
    if (!Number.isInteger(revision) || (revision as number) < 1)
      throw new Error("The revision to ask about is required.");
    if (
      Object.keys(body).some(
        (k) => !["scope", "action", "revision"].includes(k),
      )
    )
      throw new Error("An onboarding action carries only its revision.");
    return {
      action: action as "ask" | "withdraw",
      revision: revision as number,
    } as const;
  }
  if (!Number.isInteger(baseRevision) || (baseRevision as number) < 1)
    throw new Error("A base project revision is required.");
  const parsed = onboardingSchema.safeParse(onboarding);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Check the onboarding details.",
    );
  return { onboarding: parsed.data, baseRevision: baseRevision as number };
}
export function fromRow(row: Record<string, unknown>): Project {
  return {
    ...JSON.parse(row.data as string),
    id: row.id,
    source: row.source,
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}
export function recordChanges(
  fields: ProjectFields,
  previous?: Project,
  note = "",
  at = new Date().toISOString(),
) {
  const activity: ProjectEvent[] = [...(previous?.activity || [])];
  const add = (kind: ProjectEvent["kind"], text: string, taskId?: string) =>
    activity.push({
      id: crypto.randomUUID(),
      at,
      kind,
      text,
      ...(taskId ? { taskId } : {}),
    });
  if (!previous) add("created", "Project created");
  else {
    if (fields.status !== previous.status)
      add("project", `Status changed to ${fields.status}`);
    if (!!fields.archived !== !!previous.archived)
      add("project", fields.archived ? "Project archived" : "Project restored");
    if (fields.nextAction !== previous.nextAction && fields.nextAction)
      add("project", `Next action: ${fields.nextAction}`);
    if (fields.blocker !== previous.blocker)
      add(
        "project",
        fields.blocker ? `Blocker: ${fields.blocker}` : "Blocker cleared",
      );
    if (
      fields.onboardingStage !== previous.onboardingStage &&
      fields.onboardingStage
    )
      add("project", `Onboarding: ${fields.onboardingStage}`);
    if (
      JSON.stringify(fields.flightdeckDraft ?? null) !==
      JSON.stringify(previous.flightdeckDraft ?? null)
    )
      add(
        "project",
        fields.flightdeckDraft
          ? "FlightDeck onboarding draft prepared or updated"
          : "FlightDeck onboarding draft removed",
      );
    if (
      JSON.stringify(fields.onboarding ?? null) !==
      JSON.stringify(previous.onboarding ?? null)
    )
      add("project", "FlightDeck onboarding details updated");
    for (const old of previous.tasks)
      if (!fields.tasks.some((t) => t.id === old.id))
        add("task-removed", `Removed task: ${old.title}`, old.id);
  }
  if (previous) {
    const details: (keyof ProjectFields)[] = [
      "name",
      "description",
      "category",
      "location",
      "latitude",
      "longitude",
      "dueDate",
      "color",
      "functionArea",
      "priority",
      "sponsor",
      "benefit",
    ];
    if (details.some((key) => fields[key] !== previous[key]))
      add("project", "Project details updated");
    if (
      JSON.stringify(fields.objectives || []) !==
      JSON.stringify(previous.objectives || [])
    )
      add("project", "Strategy goals updated");
    if (
      JSON.stringify(fields.kpis || []) !== JSON.stringify(previous.kpis || [])
    )
      add("project", "KPI measurements updated");
    for (const [key, label] of [
      ["budget", "Budget"],
      ["work", "Work management settings"],
      ["taskViews", "Saved task views"],
      ["automations", "Automation recipes"],
      ["leadershipReviews", "Leadership review snapshots"],
    ] as const)
      if (JSON.stringify(fields[key]) !== JSON.stringify(previous[key]))
        add("project", `${label} updated`);
    for (const task of fields.tasks) {
      const old = previous.tasks.find((t) => t.id === task.id);
      if (
        old &&
        [
          "title",
          "dueDate",
          "priority",
          "assignee",
          "assigneeEmail",
          "dependsOn",
          "recurrence",
          "workflow",
          "description",
          "estimateMinutes",
          "plannedDate",
          "checklist",
          "startDate",
          "milestone",
          "group",
          "timeEntries",
          "parentId",
          "archived",
          "customValues",
          "scheduleLinks",
          "hourlyRate",
          "billable",
        ].some(
          (key) =>
            JSON.stringify(task[key as keyof typeof task]) !==
            JSON.stringify(old[key as keyof typeof old]),
        )
      )
        add("project", `Task details updated: ${task.title}`, task.id);
    }
  }
  const tasks = fields.tasks.map((task) => {
    const old = previous?.tasks.find((t) => t.id === task.id);
    if (!old)
      add(task.done ? "task-completed" : "task-added", task.title, task.id);
    else if (old.done !== task.done)
      add(task.done ? "task-completed" : "task-reopened", task.title, task.id);
    return {
      ...task,
      completedAt: task.done
        ? old?.done
          ? old.completedAt || null
          : at
        : null,
    };
  });
  for (const task of [...tasks]) {
    const old = previous?.tasks.find((t) => t.id === task.id);
    if (
      task.done &&
      !old?.done &&
      task.recurrence &&
      task.recurrence !== "none" &&
      !tasks.some((t) => t.recurrenceSource === task.id)
    ) {
      const today = at.slice(0, 10),
        base = task.dueDate && task.dueDate > today ? task.dueDate : today;
      const next = new Date(`${base}T12:00:00Z`);
      if (task.recurrence === "monthly") {
        const day = next.getUTCDate();
        next.setUTCDate(1);
        next.setUTCMonth(next.getUTCMonth() + 1);
        const last = new Date(
          Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
        ).getUTCDate();
        next.setUTCDate(Math.min(day, last));
      } else
        next.setUTCDate(
          next.getUTCDate() + (task.recurrence === "weekly" ? 7 : 1),
        );
      tasks.push({
        ...task,
        id: crypto.randomUUID(),
        done: false,
        completedAt: null,
        workflow: "todo",
        dueDate: next.toISOString().slice(0, 10),
        plannedDate: "",
        startDate: "",
        timeEntries: [],
        dependsOn: [],
        scheduleLinks: [],
        recurrenceSource: task.id,
        checklist: task.checklist?.map((c) => ({ ...c, done: false })),
      });
      add("task-added", `Next ${task.recurrence} occurrence: ${task.title}`);
    }
  }
  if (note) add("note", note);
  return { ...fields, tasks, activity: activity.slice(-200) };
}
export function newProject(fields: ProjectFields): Project {
  return {
    ...recordChanges(fields),
    id: crypto.randomUUID(),
    source: "atlas",
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
}
