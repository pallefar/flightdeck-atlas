"use client";
import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  taskState,
  type Task,
  type Project,
  type ProjectFields,
} from "@/lib/projects";
import { localDate } from "@/lib/briefing";
const states = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "blocked", label: "Blocked" },
  { id: "done", label: "Done" },
] as const;
export default function TaskWorkbench({
  project,
  readOnly,
  busy,
  onSave,
}: {
  project: Project;
  readOnly: boolean;
  busy: boolean;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
}) {
  const [members, setMembers] = useState<{ email: string }[]>([]),
    [myEmail, setMyEmail] = useState("");
  useEffect(() => {
    if (project.id.startsWith("demo-")) return;
    fetch(`/api/projects/${project.id}/collaboration`)
      .then(async (r) =>
        r.ok
          ? ((await r.json()) as { people: { email: string }[]; email: string })
          : null,
      )
      .then((b) => {
        if (b) {
          setMembers(b.people);
          setMyEmail(b.email);
        }
      })
      .catch(() => {});
  }, [project.id]);
  const [layout, setLayout] = useState<"list" | "board">("list"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState<Task["priority"]>("Normal"),
    [owner, setOwner] = useState("");
  const [editing, setEditing] = useState<Task | null>(null),
    [step, setStep] = useState("");
  const visible = project.tasks.filter(
    (t) =>
      `${t.title} ${t.assignee || ""} ${t.description || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "mine" && t.assigneeEmail === myEmail && !t.done) ||
        (filter === "open" && !t.done) ||
        (filter === "overdue" &&
          !t.done &&
          !!t.dueDate &&
          t.dueDate < localDate()) ||
        (filter === "high" && t.priority === "High" && !t.done)),
  );
  async function saveTask(task: Task) {
    const result = await onSave(
      {
        ...project,
        tasks: project.tasks.map((t) => (t.id === task.id ? task : t)),
      },
      project,
    );
    if (result) setEditing(null);
  }
  function changeState(t: Task, state: string) {
    void saveTask({
      ...t,
      done: state === "done",
      workflow: state === "done" ? "todo" : (state as Task["workflow"]),
    });
  }
  function card(t: Task) {
    return (
      <article
        className={`workbench-task ${t.done ? "is-done" : ""}`}
        key={t.id}
      >
        <div className="workbench-task-title">
          <label>
            <input
              type="checkbox"
              aria-label={t.title}
              checked={t.done}
              disabled={readOnly || busy}
              onChange={() => void saveTask({ ...t, done: !t.done })}
            />
            <strong>{t.title}</strong>
          </label>
          {!readOnly && (
            <button
              aria-label={`Edit ${t.title}`}
              disabled={busy}
              onClick={() => {
                setEditing({ ...t, checklist: [...(t.checklist || [])] });
                setStep("");
              }}
            >
              <Pencil size={15} />
            </button>
          )}
        </div>
        <p>
          {t.assignee || "Unassigned"} ·{" "}
          <span
            className={
              !t.done && t.dueDate && t.dueDate < localDate() ? "attention" : ""
            }
          >
            {t.dueDate || "No due date"}
          </span>
          {t.priority === "High" ? " · High priority" : ""}
        </p>
        {!!t.checklist?.length && (
          <small>
            {t.checklist.filter((c) => c.done).length}/{t.checklist.length}{" "}
            checklist steps
          </small>
        )}
        {!!t.dependsOn?.length && (
          <small>
            Depends on {t.dependsOn.length} task
            {t.dependsOn.length > 1 ? "s" : ""} ·{" "}
            {
              t.dependsOn.filter(
                (id) => !project.tasks.find((x) => x.id === id)?.done,
              ).length
            }{" "}
            unfinished
          </small>
        )}
        {t.recurrence && t.recurrence !== "none" && (
          <small>Repeats {t.recurrence}</small>
        )}
        {!!t.estimateMinutes && <small>{t.estimateMinutes} min estimate</small>}
        <select
          aria-label={`Workflow for ${t.title}`}
          value={taskState(t)}
          disabled={readOnly || busy}
          onChange={(e) => changeState(t, e.target.value)}
        >
          {states.map((s) => (
            <option value={s.id} key={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </article>
    );
  }
  return (
    <fieldset className="task-workbench" disabled={busy}>
      <div className="task-workbench-toolbar">
        <Input
          aria-label="Search tasks"
          placeholder="Find a task or owner…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Filter tasks"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All tasks</option>
          <option value="mine">Assigned to me</option>
          <option value="open">Open tasks</option>
          <option value="overdue">Overdue</option>
          <option value="high">High priority</option>
        </select>
        <div className="project-layout-switch">
          {(["list", "board"] as const).map((l) => (
            <button
              key={l}
              aria-pressed={layout === l}
              onClick={() => setLayout(l)}
            >
              {l === "list" ? "Task list" : "Task board"}
            </button>
          ))}
        </div>
      </div>
      {editing ? (
        <form
          className="task-detail-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void saveTask(editing);
          }}
        >
          <div className="section-heading">
            <h3>Task details</h3>
            <button
              type="button"
              aria-label="Close task details"
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          <Input
            aria-label="Task title"
            required
            maxLength={200}
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
          <Textarea
            aria-label="Task description"
            placeholder="Definition of done, context, or useful links…"
            maxLength={2000}
            value={editing.description || ""}
            onChange={(e) =>
              setEditing({ ...editing, description: e.target.value })
            }
          />
          <div className="task-detail-grid">
            <label>
              Assigned member
              <select
                value={editing.assigneeEmail || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    assigneeEmail: e.target.value,
                    assignee: e.target.value || editing.assignee,
                  })
                }
              >
                <option value="">Unassigned / manual owner</option>
                {members.map((m) => (
                  <option key={m.email}>{m.email}</option>
                ))}
              </select>
            </label>
            <label>
              Repeat after completion
              <select
                value={editing.recurrence || "none"}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    recurrence: e.target.value as Task["recurrence"],
                  })
                }
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <label>
              Depends on tasks
              <select
                multiple
                value={editing.dependsOn || []}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    dependsOn: Array.from(
                      e.target.selectedOptions,
                      (x) => x.value,
                    ),
                  })
                }
              >
                {project.tasks
                  .filter((t) => t.id !== editing.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Due date
              <Input
                type="date"
                value={editing.dueDate || ""}
                onChange={(e) =>
                  setEditing({ ...editing, dueDate: e.target.value })
                }
              />
            </label>
            <label>
              Priority
              <select
                value={editing.priority || "Normal"}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    priority: e.target.value as Task["priority"],
                  })
                }
              >
                <option>Normal</option>
                <option>High</option>
                <option>Low</option>
              </select>
            </label>
            <label>
              Task owner
              <Input
                maxLength={100}
                value={editing.assignee || ""}
                onChange={(e) =>
                  setEditing({ ...editing, assignee: e.target.value })
                }
              />
            </label>
            <label>
              Planned for
              <Input
                type="date"
                value={editing.plannedDate || ""}
                onChange={(e) =>
                  setEditing({ ...editing, plannedDate: e.target.value })
                }
              />
            </label>
            <label>
              Estimate (minutes)
              <Input
                type="number"
                min={0}
                max={100000}
                value={editing.estimateMinutes || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    estimateMinutes: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  })
                }
              />
            </label>
          </div>
          <h4>Checklist</h4>
          <div className="task-checklist">
            {(editing.checklist || []).map((c) => (
              <div key={c.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={c.done}
                    onChange={() =>
                      setEditing({
                        ...editing,
                        checklist: editing.checklist?.map((x) =>
                          x.id === c.id ? { ...x, done: !x.done } : x,
                        ),
                      })
                    }
                  />
                  {c.title}
                </label>
                <button
                  type="button"
                  aria-label={`Remove step ${c.title}`}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      checklist: editing.checklist?.filter(
                        (x) => x.id !== c.id,
                      ),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <div className="checklist-add">
            <Input
              aria-label="Checklist step"
              placeholder="Break the task into a small step…"
              maxLength={200}
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!step.trim() || (editing.checklist?.length || 0) >= 30}
              onClick={() => {
                setEditing({
                  ...editing,
                  checklist: [
                    ...(editing.checklist || []),
                    {
                      id: crypto.randomUUID(),
                      title: step.trim(),
                      done: false,
                    },
                  ],
                });
                setStep("");
              }}
            >
              Add step
            </Button>
          </div>
          <div className="task-edit-actions">
            <Button type="submit" disabled={busy || readOnly}>
              Save task
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <button
              type="button"
              aria-label={`Remove ${editing.title}`}
              disabled={busy || readOnly}
              onClick={() =>
                void onSave(
                  {
                    ...project,
                    tasks: project.tasks
                      .filter((t) => t.id !== editing.id)
                      .map((t) => ({
                        ...t,
                        dependsOn: t.dependsOn?.filter(
                          (id) => id !== editing.id,
                        ),
                      })),
                  },
                  project,
                ).then((r) => {
                  if (r) setEditing(null);
                })
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        </form>
      ) : (
        <>
          {layout === "board" ? (
            <div className="task-kanban">
              {states.map((s) => (
                <section key={s.id}>
                  <h3>
                    {s.label}
                    <span>
                      {visible.filter((t) => taskState(t) === s.id).length}
                    </span>
                  </h3>
                  {visible.filter((t) => taskState(t) === s.id).map(card)}
                  {!visible.some((t) => taskState(t) === s.id) && (
                    <p className="board-empty">No tasks</p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <div className="task-workbench-list">{visible.map(card)}</div>
          )}
          {!visible.length && (
            <p className="hub-muted">
              {project.tasks.length
                ? "No tasks match these filters."
                : "Add your first task to turn this project into a plan."}
            </p>
          )}
        </>
      )}
      {!readOnly && !editing && (
        <form
          className="add-action-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            const result = await onSave(
              {
                ...project,
                tasks: [
                  ...project.tasks,
                  {
                    id: crypto.randomUUID(),
                    title: title.trim(),
                    done: false,
                    workflow: "todo",
                    dueDate: due,
                    priority,
                    assignee: owner,
                  },
                ],
              },
              project,
            );
            if (result) {
              setTitle("");
              setDue("");
              setPriority("Normal");
              setOwner("");
              setFilter("all");
              setQuery("");
            }
          }}
        >
          <Input
            aria-label="New task"
            required
            maxLength={200}
            placeholder="Capture the next action…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="task-detail-grid">
            <label>
              Task due date
              <Input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              Task priority
              <select
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as Task["priority"])
                }
              >
                <option>Normal</option>
                <option>High</option>
                <option>Low</option>
              </select>
            </label>
            <label>
              Assign to
              <Input
                maxLength={100}
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Owner name"
              />
            </label>
            <Button
              type="submit"
              disabled={busy || !title.trim() || project.tasks.length >= 200}
            >
              <Plus size={15} /> Add
            </Button>
          </div>
        </form>
      )}
    </fieldset>
  );
}
