import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  projectSchema,
  type Project,
  type ProjectFields,
  type ProjectEvent,
} from "./projects";
export function database() {
  if (!env.DB)
    throw new Error(
      "Project storage is unavailable. Please try again shortly.",
    );
  return env.DB;
}
export async function owner() {
  const user = await getChatGPTUser();
  return user?.userId || null;
}
export function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return (
    request.headers.get("sec-fetch-site") !== "cross-site" &&
    (!origin || origin === new URL(request.url).origin)
  );
}
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
