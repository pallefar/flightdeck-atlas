"use client";
import { numericValue } from "@/lib/advanced-work";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  taskState,
  validDate,
  taskBlocked,
  type Project,
  type Task,
  type ProjectFields,
} from "@/lib/projects";
import {
  dayNumber,
  loggedMinutes,
  scheduleConflicts,
} from "@/lib/work-management";
import { localDate } from "@/lib/briefing";
export function TaskTable({
  project,
  tasks,
  readOnly,
  busy,
  members,
  onSave,
  onEdit,
  onReload,
}: {
  project: Project;
  tasks: Task[];
  readOnly: boolean;
  busy: boolean;
  members: { email: string }[];
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
  onEdit: (t: Task) => void;
  onReload?: () => void;
}) {
  const [targets, setTargets] = useState<Project[]>([]),
    [target, setTarget] = useState(""),
    [transferError, setTransferError] = useState(""),
    [transferring, setTransferring] = useState(false);
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<{ projects: Project[] }>)
      .then((b) =>
        setTargets(
          (b.projects || []).filter(
            (p) => p.id !== project.id && p.canEdit !== false && !p.archived,
          ),
        ),
      )
      .catch(() => {});
  }, [project.id, project.revision]);
  const [selected, setSelected] = useState<string[]>([]),
    [action, setAction] = useState("priority"),
    [value, setValue] = useState("High");
  const chosen = tasks.filter((t) => selected.includes(t.id)),
    ids = new Set(chosen.map((t) => t.id));
  return (
    <section className="task-table-view">
      {!readOnly && (
        <div className="bulk-bar">
          <strong>{chosen.length} selected</strong>
          <label>
            Bulk change
            <select
              aria-label="Bulk change"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setValue(
                  e.target.value === "priority"
                    ? "High"
                    : e.target.value === "workflow"
                      ? "todo"
                      : "",
                );
              }}
            >
              <option value="priority">Priority</option>
              <option value="workflow">Workflow</option>
              <option value="assigneeEmail">Assigned member</option>
              <option value="dueDate">Due date</option>
              <option value="plannedDate">Planned day</option>
              <option value="group">Group</option>
            </select>
          </label>
          <label>
            New value
            {action === "priority" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option>High</option>
                <option>Normal</option>
                <option>Low</option>
              </select>
            ) : action === "workflow" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="todo">To do</option>
                <option value="doing">Doing</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            ) : action === "assigneeEmail" ? (
              <select value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Unassign</option>
                {members.map((m) => (
                  <option key={m.email}>{m.email}</option>
                ))}
              </select>
            ) : (
              <Input
                type={action === "group" ? "text" : "date"}
                maxLength={60}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </label>
          <Button
            disabled={!chosen.length || busy}
            onClick={async () => {
              const result = await onSave(
                {
                  ...project,
                  tasks: project.tasks.map((t) =>
                    !ids.has(t.id)
                      ? t
                      : action === "workflow"
                        ? {
                            ...t,
                            done: value === "done",
                            workflow: (value === "done"
                              ? "todo"
                              : value) as Task["workflow"],
                          }
                        : action === "assigneeEmail"
                          ? { ...t, assigneeEmail: value, assignee: value }
                          : { ...t, [action]: value },
                  ),
                },
                project,
              );
              if (result) setSelected([]);
            }}
          >
            Apply to {chosen.length} tasks
          </Button>
          <button disabled={!chosen.length} onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>
      )}
      {!readOnly && chosen.length > 0 && (
        <div className="suite-card">
          <div className="work-inline">
            <Button
              disabled={busy}
              variant="outline"
              onClick={async () => {
                if (
                  await onSave(
                    {
                      ...project,
                      tasks: project.tasks.map((t) =>
                        ids.has(t.id) ? { ...t, archived: true } : t,
                      ),
                    },
                    project,
                  )
                )
                  setSelected([]);
              }}
            >
              Archive {chosen.length} selected tasks
            </Button>
            <label>
              Move selected tasks to
              <select
                aria-label="Move selected tasks to"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Choose project</option>
                {targets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!target || transferring || busy}
              onClick={async () => {
                setTransferring(true);
                setTransferError("");
                try {
                  const r = await fetch("/api/work/transfer", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        source: project.id,
                        target,
                        sourceRevision: project.revision,
                        targetRevision: targets.find((p) => p.id === target)
                          ?.revision,
                        ids: chosen.map((t) => t.id),
                      }),
                    }),
                    b = (await r.json()) as { error: string };
                  if (!r.ok) throw Error(b.error);
                  setSelected([]);
                  onReload?.();
                } catch (e) {
                  setTransferError((e as Error).message);
                } finally {
                  setTransferring(false);
                }
              }}
            >
              Move {chosen.length} tasks
            </Button>
          </div>
          <p>
            Move entire parent/dependency groups together. Destination access,
            assignees, and field definitions are checked before either project
            changes.
          </p>
          {transferError && (
            <p role="alert" className="form-error">
              {transferError}
            </p>
          )}
        </div>
      )}
      <div
        className="work-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Task table. Scroll horizontally for more columns."
      >
        <table className="work-table task-table">
          <thead>
            <tr>
              {!readOnly && (
                <th>
                  <input
                    aria-label="Select all visible tasks"
                    type="checkbox"
                    checked={!!tasks.length && chosen.length === tasks.length}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? tasks.map((t) => t.id) : [],
                      )
                    }
                  />
                </th>
              )}
              <th>Task</th>
              <th>Workflow</th>
              <th>Owner</th>
              <th>Dates</th>
              <th>Priority</th>
              <th>Effort</th>
              <th>Group</th>
              {project.work?.fields.map((f) => (
                <th key={f.id}>{f.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                {!readOnly && (
                  <td>
                    <input
                      aria-label={`Select ${t.title}`}
                      type="checkbox"
                      checked={ids.has(t.id)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id),
                        )
                      }
                    />
                  </td>
                )}
                <th>
                  <button onClick={() => onEdit(t)}>
                    {t.milestone ? "◆ " : ""}
                    {t.title}
                  </button>
                  {taskBlocked(t, project) && (
                    <small className="attention">Waiting / blocked</small>
                  )}
                </th>
                <td>{taskState(t) === "todo" ? "To do" : taskState(t)}</td>
                <td>{t.assigneeEmail || t.assignee || "Unassigned"}</td>
                <td>
                  {t.startDate || "No start"}
                  <br />
                  {t.dueDate || "No due date"}
                </td>
                <td>{t.priority || "Normal"}</td>
                <td>
                  {t.estimateMinutes ?? "—"} est.
                  <br />
                  {loggedMinutes(t)} min logged
                </td>
                <td>{t.group || "Ungrouped"}</td>
                {project.work?.fields.map((f) => (
                  <td key={f.id}>
                    {f.type === "formula"
                      ? (numericValue(
                          t,
                          f.id,
                          project.work!.fields,
                        )?.toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        }) ?? "—")
                      : typeof t.customValues?.[f.id] === "boolean"
                        ? t.customValues[f.id]
                          ? "Yes"
                          : "No"
                        : String(t.customValues?.[f.id] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hub-muted">
        Only selected tasks currently visible in this view will change.
        Completion still requires all prerequisites to be complete.
      </p>
    </section>
  );
}
export function TaskTimeline({
  project,
  tasks,
  onEdit,
  readOnly = true,
  busy = false,
  onSave,
}: {
  project: Project;
  tasks: Task[];
  onEdit: (t: Task) => void;
  readOnly?: boolean;
  busy?: boolean;
  onSave?: (f: ProjectFields, p?: Project) => Promise<Project | null>;
}) {
  const [drag, setDrag] = useState<{
    id: string;
    x: number;
    width: number;
  } | null>(null);
  const [shift, setShift] = useState<{
    task: Task;
    days: number;
    base: Project;
  } | null>(null);
  const [anchor, setAnchor] = useState(""),
    [span, setSpan] = useState(30);
  const dated = tasks.filter(
      (t) =>
        (t.startDate ? validDate(t.startDate) : true) &&
        (t.dueDate ? validDate(t.dueDate) : true) &&
        (t.startDate || t.dueDate),
    ),
    first =
      dated.map((t) => t.startDate || t.dueDate!).sort()[0] || localDate();
  const from = anchor && validDate(anchor) ? anchor : first,
    base = dayNumber(from),
    end = base + span - 1;
  const dateAt = (n: number) =>
    new Date((base + n) * 86400000).toISOString().slice(0, 10);
  const inside = dated.filter(
    (t) =>
      dayNumber(t.dueDate || t.startDate!) >= base &&
      dayNumber(t.startDate || t.dueDate!) <= end,
  );
  const conflicts = scheduleConflicts(project).filter((c) =>
    tasks.some((t) => t.id === c.task.id),
  );
  return (
    <section className="task-timeline">
      <div className="timeline-toolbar">
        <label>
          Timeline starts
          <Input
            type="date"
            value={from}
            onChange={(e) => setAnchor(e.target.value)}
          />
        </label>
        <label>
          Time window
          <select
            value={span}
            onChange={(e) => setSpan(Number(e.target.value))}
          >
            <option value={14}>Two weeks</option>
            <option value={30}>30 days</option>
            <option value={90}>Quarter</option>
          </select>
        </label>
        <Button variant="outline" onClick={() => setAnchor(dateAt(-span))}>
          Earlier
        </Button>
        <Button variant="outline" onClick={() => setAnchor(localDate())}>
          Today
        </Button>
        <Button variant="outline" onClick={() => setAnchor(dateAt(span))}>
          Later
        </Button>
      </div>
      <p className="hub-muted">
        Task dates and milestones. Click a row to inspect or edit dates. Drag a
        dated bar to propose a new schedule, then review and apply the change.
      </p>
      {shift && (
        <div className="suite-card">
          <strong>
            Move {shift.task.title} by {shift.days} calendar days?
          </strong>
          <p>
            Only this task moves. Use Work studio → Scheduling to review
            dependent date changes.
          </p>
          <Button
            disabled={busy || readOnly}
            onClick={async () => {
              const move = (d: string | undefined) =>
                d
                  ? new Date((dayNumber(d) + shift.days) * 86400000)
                      .toISOString()
                      .slice(0, 10)
                  : d;
              const result = await onSave?.(
                {
                  ...shift.base,
                  tasks: shift.base.tasks.map((t) =>
                    t.id === shift.task.id
                      ? {
                          ...t,
                          startDate: move(t.startDate),
                          dueDate: move(t.dueDate),
                        }
                      : t,
                  ),
                },
                shift.base,
              );
              if (result) setShift(null);
            }}
          >
            Apply schedule move
          </Button>
          <Button variant="outline" onClick={() => setShift(null)}>
            Cancel move
          </Button>
        </div>
      )}
      <div
        className="timeline-scroll"
        tabIndex={0}
        role="region"
        aria-label="Task timeline. Scroll horizontally to explore dates."
      >
        <div className="timeline-canvas">
          <div className="timeline-axis">
            <strong>Deliverable</strong>
            <div>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f}>
                  {dateAt(Math.round((span - 1) * f)).slice(5)}
                </span>
              ))}
            </div>
          </div>
          {inside.map((t) => {
            const a = dayNumber(t.startDate || t.dueDate!),
              b = dayNumber(t.dueDate || t.startDate!),
              left = Math.max(0, ((a - base) / span) * 100),
              width = Math.min(
                100 - left,
                Math.max(1, ((b - Math.max(base, a) + 1) / span) * 100),
              );
            return (
              <button
                className="timeline-row"
                key={t.id}
                onClick={() => onEdit(t)}
                aria-label={`Timeline task ${t.title}`}
              >
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    {t.startDate || t.dueDate} → {t.dueDate || t.startDate}
                    {!t.startDate ? " · start not set" : ""}
                    {!t.dueDate ? " · finish not set" : ""}
                  </small>
                  {!!t.dependsOn?.length && (
                    <small>
                      After:{" "}
                      {t.dependsOn
                        .map(
                          (id) => project.tasks.find((x) => x.id === id)?.title,
                        )
                        .join(", ")}
                    </small>
                  )}
                </span>
                <div className="timeline-track">
                  {dayNumber(localDate()) >= base &&
                    dayNumber(localDate()) <= end && (
                      <i
                        className="timeline-today"
                        style={{
                          left: `${((dayNumber(localDate()) - base) / span) * 100}%`,
                        }}
                      />
                    )}
                  <span
                    onPointerDown={(e) => {
                      if (readOnly || busy) return;
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({
                        id: t.id,
                        x: e.clientX,
                        width:
                          e.currentTarget.parentElement!.getBoundingClientRect()
                            .width,
                      });
                    }}
                    onPointerUp={(e) => {
                      if (!drag || drag.id !== t.id) return;
                      e.stopPropagation();
                      const days = Math.round(
                        ((e.clientX - drag.x) / drag.width) * span,
                      );
                      if (days) setShift({ task: t, days, base: project });
                      setDrag(null);
                    }}
                    onPointerCancel={() => setDrag(null)}
                    onClick={(e) => e.stopPropagation()}
                    className={`timeline-bar ${t.done ? "done" : taskBlocked(t, project) ? "waiting" : ""} ${t.milestone ? "milestone" : ""}`}
                    style={{
                      left: `${left}%`,
                      width: t.milestone ? 14 : `${width}%`,
                    }}
                  >
                    {t.milestone
                      ? "◆"
                      : t.done
                        ? "Complete"
                        : taskBlocked(t, project)
                          ? "Waiting"
                          : "Planned"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {!inside.length && <p>No dated tasks in this window.</p>}
      {dated.length > inside.length && (
        <p>
          {dated.length - inside.length} dated tasks outside this window. Use
          Earlier / Later to explore.
        </p>
      )}
      {!!conflicts.length && (
        <div className="timeline-conflicts" role="status">
          <strong>Dependency schedule conflicts</strong>
          {conflicts.map((c) => (
            <p key={`${c.task.id}:${c.before.id}`}>
              {c.task.title} starts {c.task.startDate}, before {c.before.title}{" "}
              finishes {c.before.dueDate}.
            </p>
          ))}
        </div>
      )}
      {!!tasks.filter((t) => !dated.includes(t)).length && (
        <div className="timeline-undated">
          <h4>Unscheduled tasks / dates to check</h4>
          {tasks
            .filter((t) => !dated.includes(t))
            .map((t) => (
              <button key={t.id} onClick={() => onEdit(t)}>
                {t.title} <span>Add dates →</span>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
