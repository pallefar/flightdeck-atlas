import type { Project, ProjectFields } from "./projects";
import { projectSchema } from "./projects";
import { recordChanges } from "./server-projects";
import { applyWorkRules } from "./work-management";
import { evaluateRules } from "./advanced-work";
export function processWorkMutation(
  fields: ProjectFields,
  previous: Project,
  note: string,
  at: string,
  actor = "",
) {
  const recorded = recordChanges(fields, previous, note, at),
    basic = applyWorkRules(recorded, previous),
    advanced = evaluateRules(basic.fields, previous),
    validated = projectSchema.parse(advanced.fields);
  const activity = [
    ...recorded.activity,
    ...[...basic.applied, ...advanced.applied].map((text) => ({
      id: crypto.randomUUID(),
      at,
      kind: "project" as const,
      text: `Automation: ${text}`,
    })),
  ].slice(-200);
  const assignments = validated.tasks
    .filter(
      (t) =>
        t.assigneeEmail &&
        t.assigneeEmail !== actor &&
        previous.tasks.find((x) => x.id === t.id)?.assigneeEmail !==
          t.assigneeEmail,
    )
    .map((t) => ({
      taskId: t.id,
      recipient: t.assigneeEmail!,
      text: `Assigned to you: ${t.title}`,
    }));
  const notices = [...advanced.notices, ...assignments];
  if (notices.length > 100)
    throw Error(
      "This change would send more than 100 notifications. Update fewer tasks at once or narrow the rules.",
    );
  return { recorded: { ...validated, activity }, notices };
}
export function cancellationStatement(
  db: D1Database,
  previous: Project,
  next: ProjectFields,
) {
  const ids = previous.tasks
    .filter((t) => {
      const after = next.tasks.find((x) => x.id === t.id);
      return (
        !!next.archived ||
        !after ||
        (!t.done && after.done) ||
        (!t.archived && after.archived) ||
        (t.dueDate || "") !== (after.dueDate || "") ||
        (t.assigneeEmail || "") !== (after.assigneeEmail || "")
      );
    })
    .map((t) => t.id);
  return ids.length
    ? db
        .prepare(
          "UPDATE atlas_work_records SET closed=1,revision=revision+1 WHERE kind='reminder' AND project_id=? AND closed=0 AND json_extract(data,'$.taskId') IN (SELECT value FROM json_each(?)) AND changes()>0",
        )
        .bind(previous.id, JSON.stringify(ids))
    : null;
}
