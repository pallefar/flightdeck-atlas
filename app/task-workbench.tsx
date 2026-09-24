"use client";
import { useEffect, useState, useRef } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  taskState,
  taskBlocked,
  type Task,
  type Project,
  type ProjectFields,
} from "@/lib/projects";
import { AdvancedTaskFields, FilterBuilder } from "./advanced-task-fields";
import type { AdvancedFilter } from "@/lib/advanced-work";
import { TaskTable, TaskTimeline } from "./task-views";
import { filteredTasks, loggedMinutes } from "@/lib/work-management";
import type { TaskView } from "@/lib/work-model";
import { localDate } from "@/lib/briefing";
import FeatureHelp from "./feature-help";
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
  onReload,
  initialLayout = "list",
  onLayoutChange,
}: {
  initialLayout?: TaskView["layout"];
  onLayoutChange?: (layout: TaskView["layout"]) => void;
  project: Project;
  onReload?: () => void;
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
  const [layout, setLayout] = useState<TaskView["layout"]>(initialLayout),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  // A new initial layout from the saved view replaces the local choice.
  const [layoutFrom, setLayoutFrom] = useState(initialLayout);
  if (layoutFrom !== initialLayout) {
    setLayoutFrom(initialLayout);
    setLayout(initialLayout);
  }
  const drag = useRef<{ task: Task; base: Project } | null>(null);
  const [dropState, setDropState] = useState("");
  const [moveNotice, setMoveNotice] = useState("");
  const [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState<Task["priority"]>("Normal"),
    [owner, setOwner] = useState("");
  const [member, setMember] = useState("");
  const [createParent, setCreateParent] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Task | null>(null),
    [step, setStep] = useState("");
  const [draftBase, setDraftBase] = useState<Project | null>(null);
  const searchRef = useRef<HTMLInputElement>(null),
    wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) searchRef.current?.focus();
    wasEditing.current = !!editing;
  }, [editing]);
  const [group, setGroup] = useState(""),
    [sort, setSort] = useState<TaskView["sort"]>("manual"),
    [filterOwner, setFilterOwner] = useState(""),
    [filterPriority, setFilterPriority] = useState<TaskView["priority"]>(""),
    [filterState, setFilterState] = useState<TaskView["state"]>(""),
    [viewName, setViewName] = useState("");
  const [entryDate, setEntryDate] = useState(localDate),
    [entryMinutes, setEntryMinutes] = useState(25),
    [entryNote, setEntryNote] = useState(""),
    [entryEdit, setEntryEdit] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedFilter>({
    mode: "all",
    groups: [],
  });
  const view = {
    advanced,
    layout,
    filter: filter as TaskView["filter"],
    query,
    group,
    sort,
    owner: filterOwner,
    priority: filterPriority,
    state: filterState,
  };
  const visible = filteredTasks(project, view, localDate(), myEmail);
  const treeRows: Task[] = [];
  const addTree = (t: Task) => {
    treeRows.push(t);
    if (!collapsed.has(t.id))
      visible.filter((x) => x.parentId === t.id).forEach(addTree);
  };
  visible
    .filter((t) => !t.parentId || !visible.some((x) => x.id === t.parentId))
    .forEach(addTree);
  function openTask(t: Task) {
    setDraftBase(project);
    setEditing({ ...t, checklist: [...(t.checklist || [])] });
    setStep("");
    setEntryEdit(null);
  }
  function applyView(v: TaskView) {
    setAdvanced(v.advanced || { mode: "all", groups: [] });
    setLayout(v.layout);
    onLayoutChange?.(v.layout);
    setFilter(v.filter);
    setQuery(v.query);
    setGroup(v.group);
    setSort(v.sort);
    setFilterOwner(v.owner || "");
    setFilterPriority(v.priority || "");
    setFilterState(v.state || "");
  }
  async function saveTask(task: Task) {
    const base = editing?.id === task.id && draftBase ? draftBase : project;
    const result = await onSave(
      {
        ...base,
        tasks: base.tasks.map((t) => (t.id === task.id ? task : t)),
      },
      base,
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
        draggable={layout === "board" && !readOnly && !busy && !editing}
        onDragStart={(e) => {
          drag.current = { task: t, base: project };
          e.dataTransfer.setData("text/plain", t.id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          drag.current = null;
          setDropState("");
        }}
      >
        {t.parentId && (
          <small className="subtask-path">
            ↳{" "}
            {project.tasks.find((x) => x.id === t.parentId)?.title ||
              "Parent task"}
          </small>
        )}
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
          {
            <button
              aria-label={`${readOnly ? "View" : "Edit"} ${t.title}`}
              disabled={busy}
              onClick={() => {
                openTask(t);
              }}
            >
              <Pencil size={15} />
            </button>
          }
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
        {project.tasks.some((x) => x.parentId === t.id && !x.archived) && (
          <button
            type="button"
            className="subtask-control"
            aria-expanded={!collapsed.has(t.id)}
            aria-label={`${collapsed.has(t.id) ? "Expand" : "Collapse"} subtasks for ${t.title}`}
            onClick={() =>
              setCollapsed((old) => {
                const next = new Set(old);
                if (next.has(t.id)) next.delete(t.id);
                else next.add(t.id);
                return next;
              })
            }
          >
            {collapsed.has(t.id) ? "▸" : "▾"}{" "}
            {
              project.tasks.filter((x) => x.parentId === t.id && !x.archived)
                .length
            }{" "}
            subtasks
          </button>
        )}
        {t.recurrence && t.recurrence !== "none" && (
          <small>Repeats {t.recurrence}</small>
        )}
        {taskBlocked(t, project) && (
          <small className="attention">Waiting / blocked</small>
        )}
        {!!t.estimateMinutes && <small>{t.estimateMinutes} min estimate</small>}
        {!!loggedMinutes(t) && <small>{loggedMinutes(t)} min recorded</small>}
        {t.milestone && <small>◆ Milestone</small>}
        {t.group && <small>{t.group}</small>}
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
      {project.tasks.some((t) => t.archived) && (
        <details className="advanced-filter">
          <summary>
            Archived tasks · {project.tasks.filter((t) => t.archived).length}
          </summary>
          {project.tasks
            .filter((t) => t.archived)
            .map((t) => (
              <div className="work-inline" key={t.id}>
                <span>{t.title}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={readOnly || busy}
                  onClick={() => void saveTask({ ...t, archived: false })}
                >
                  Restore task
                </Button>
              </div>
            ))}
        </details>
      )}
      <FilterBuilder
        value={advanced}
        onChange={setAdvanced}
        fields={project.work?.fields}
      />
      <div className="task-workbench-toolbar">
        <Input
          ref={searchRef}
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
          {(["list", "board", "table", "timeline"] as const).map((l) => (
            <button
              key={l}
              aria-pressed={layout === l}
              onClick={() => {
                setLayout(l);
                onLayoutChange?.(l);
              }}
            >
              {
                {
                  list: "Task list",
                  board: "Task board",
                  table: "Task table",
                  timeline: "Timeline",
                }[l]
              }
            </button>
          ))}
        </div>
        <FeatureHelp title="Task views">
          Use the list for subtasks, the board for workflow, the table for bulk
          changes and the timeline for dates. Refine and save a view to return
          to the same filters. On Kanban, drag cards or use each task’s status
          menu.
        </FeatureHelp>
      </div>
      <details className="task-view-controls">
        <summary>Refine & save this view</summary>
        <div className="work-form-grid">
          <label>
            Group
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">All groups</option>
              {[
                ...new Set(project.tasks.map((t) => t.group).filter(Boolean)),
              ].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            Owner filter
            <select
              value={filterOwner}
              onChange={(e) => setFilterOwner(e.target.value)}
            >
              <option value="">All owners</option>
              {[
                ...new Set(
                  project.tasks
                    .map((t) => t.assigneeEmail || t.assignee)
                    .filter(Boolean),
                ),
              ].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            Priority filter
            <select
              value={filterPriority}
              onChange={(e) =>
                setFilterPriority(e.target.value as TaskView["priority"])
              }
            >
              <option value="">All priorities</option>
              <option>High</option>
              <option>Normal</option>
              <option>Low</option>
            </select>
          </label>
          <label>
            Workflow filter
            <select
              value={filterState}
              onChange={(e) =>
                setFilterState(e.target.value as TaskView["state"])
              }
            >
              <option value="">All workflows</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort tasks
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as TaskView["sort"])}
            >
              <option value="manual">Original order</option>
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        </div>
        <div className="saved-task-views">
          {project.taskViews?.map((v) => (
            <div key={v.id}>
              <button onClick={() => applyView(v)}>{v.name}</button>
              {!readOnly && (
                <button
                  aria-label={`Delete view ${v.name}`}
                  onClick={() =>
                    void onSave(
                      {
                        ...project,
                        taskViews: project.taskViews?.filter(
                          (x) => x.id !== v.id,
                        ),
                      },
                      project,
                    )
                  }
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="work-inline-actions">
            <Input
              aria-label="View name"
              maxLength={60}
              placeholder="Name this shared project view…"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
            <Button
              variant="outline"
              disabled={
                !viewName.trim() || (project.taskViews?.length || 0) >= 12
              }
              onClick={async () => {
                if (
                  await onSave(
                    {
                      ...project,
                      taskViews: [
                        ...(project.taskViews || []),
                        {
                          ...view,
                          id: crypto.randomUUID(),
                          name: viewName.trim(),
                        },
                      ],
                    },
                    project,
                  )
                )
                  setViewName("");
              }}
            >
              Save view
            </Button>
          </div>
        )}
        <button
          className="text-link"
          onClick={() => {
            setAdvanced({ mode: "all", groups: [] });
            setFilter("all");
            setQuery("");
            setGroup("");
            setFilterOwner("");
            setFilterPriority("");
            setFilterState("");
          }}
        >
          Clear filters
        </button>
      </details>
      {editing ? (
        <form
          className="task-detail-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void saveTask(editing);
          }}
        >
          <fieldset disabled={readOnly}>
            {draftBase && draftBase.revision !== project.revision && (
              <p className="form-error" role="status">
                This project changed while you were editing. Your draft is
                preserved. Cancel and reopen the task to review the latest
                version before saving.
              </p>
            )}
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
              autoFocus
              required
              maxLength={200}
              value={editing.title}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
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
            <div className="work-form-grid">
              <label>
                Start date
                <Input
                  type="date"
                  value={editing.startDate || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, startDate: e.target.value })
                  }
                />
              </label>
              <label>
                Task group
                <Input
                  maxLength={60}
                  placeholder="For example: Discovery"
                  value={editing.group || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, group: e.target.value })
                  }
                />
              </label>
              <label className="milestone-toggle">
                <input
                  type="checkbox"
                  checked={!!editing.milestone}
                  onChange={(e) =>
                    setEditing({ ...editing, milestone: e.target.checked })
                  }
                />
                Mark as a milestone
              </label>
            </div>
            <section className="task-time-log">
              <h4>Time log · {loggedMinutes(editing)} min</h4>
              <p>
                Record actual work separately from the estimate. Entries are
                saved with the task.
              </p>
              {editing.timeEntries?.map((entry) => (
                <div className="time-log-row" key={entry.id}>
                  <span>
                    {entry.date} · {entry.minutes} min ·{" "}
                    {entry.note || "Work session"}
                    {entry.author ? ` · ${entry.author}` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`Correct time entry ${entry.id}`}
                    onClick={() => {
                      setEntryDate(entry.date);
                      setEntryMinutes(entry.minutes);
                      setEntryNote(entry.note);
                      setEntryEdit(entry.id);
                    }}
                  >
                    Correct
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove time entry ${entry.id}`}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        timeEntries: editing.timeEntries?.filter(
                          (x) => x.id !== entry.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="work-form-grid">
                <label>
                  Work date
                  <Input
                    type="date"
                    max={localDate()}
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                  />
                </label>
                <label>
                  Minutes worked
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={entryMinutes}
                    onChange={(e) => setEntryMinutes(Number(e.target.value))}
                  />
                </label>
                <label>
                  Session note
                  <Input
                    maxLength={300}
                    value={entryNote}
                    onChange={(e) => setEntryNote(e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !entryDate ||
                    entryDate > localDate() ||
                    !Number.isInteger(entryMinutes) ||
                    entryMinutes < 1 ||
                    entryMinutes > 1440 ||
                    (!entryEdit && (editing.timeEntries?.length || 0) >= 100)
                  }
                  onClick={() => {
                    const entry = {
                      id: entryEdit || crypto.randomUUID(),
                      date: entryDate,
                      minutes: entryMinutes,
                      note: entryNote.trim(),
                    };
                    setEditing({
                      ...editing,
                      timeEntries: entryEdit
                        ? (editing.timeEntries || []).map((x) =>
                            x.id === entryEdit ? entry : x,
                          )
                        : [...(editing.timeEntries || []), entry],
                    });
                    setEntryNote("");
                    setEntryEdit(null);
                  }}
                >
                  {entryEdit
                    ? "Apply time correction"
                    : "Add time entry to draft"}
                </Button>
                {entryEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEntryEdit(null);
                      setEntryNote("");
                    }}
                  >
                    Cancel time correction
                  </Button>
                )}
              </div>
            </section>
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
                disabled={
                  !step.trim() || (editing.checklist?.length || 0) >= 30
                }
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
            <AdvancedTaskFields
              task={editing}
              project={project}
              onChange={setEditing}
            />
            <div className="task-edit-actions">
              <Button type="submit" disabled={busy || readOnly || !!entryEdit}>
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
                          parentId: t.parentId === editing.id ? "" : t.parentId,
                          scheduleLinks: t.scheduleLinks?.filter(
                            (l) => l.projectId || l.taskId !== editing.id,
                          ),
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
          </fieldset>
          {readOnly && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
            >
              Back to tasks
            </Button>
          )}
        </form>
      ) : (
        <>
          {layout === "table" ? (
            <TaskTable
              project={project}
              tasks={visible}
              readOnly={readOnly}
              busy={busy}
              members={members}
              onSave={onSave}
              onEdit={openTask}
              onReload={onReload}
            />
          ) : layout === "timeline" ? (
            <TaskTimeline
              project={project}
              tasks={visible}
              onEdit={openTask}
              readOnly={readOnly}
              busy={busy}
              onSave={onSave}
            />
          ) : layout === "board" ? (
            <div className="task-kanban" aria-label="Task Kanban board">
              {states.map((s) => (
                <section
                  key={s.id}
                  aria-label={`${s.label} tasks`}
                  className={dropState === s.id ? "kanban-drop-target" : ""}
                  onDragOver={(e) => {
                    if (drag.current && !readOnly && !busy) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDropState(s.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      setDropState("");
                  }}
                  onDrop={async (e) => {
                    e.preventDefault();
                    const item = drag.current;
                    drag.current = null;
                    setDropState("");
                    if (
                      !item ||
                      readOnly ||
                      busy ||
                      taskState(item.task) === s.id
                    )
                      return;
                    const task = {
                      ...item.task,
                      done: s.id === "done",
                      workflow: s.id === "done" ? ("todo" as const) : s.id,
                    };
                    const saved = await onSave(
                      {
                        ...item.base,
                        tasks: item.base.tasks.map((t) =>
                          t.id === task.id ? task : t,
                        ),
                      },
                      item.base,
                    );
                    if (saved)
                      setMoveNotice(
                        `${task.title} saved in ${states.find((x) => x.id === taskState(saved.tasks.find((t) => t.id === task.id)!))?.label || s.label}.`,
                      );
                  }}
                >
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
            <div className="task-workbench-list">{treeRows.map(card)}</div>
          )}
          {!visible.length && (
            <p className="hub-muted">
              {project.tasks.length
                ? "No tasks match these filters."
                : "Add your first task to turn this project into a plan."}
            </p>
          )}
          {moveNotice && (
            <p role="status" className="kanban-save-notice">
              {moveNotice}
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
                    assignee: member || owner,
                    assigneeEmail: member,
                    parentId: createParent,
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
              setMember("");
              setCreateParent("");
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
              New task parent
              <select
                value={createParent}
                onChange={(e) => setCreateParent(e.target.value)}
              >
                <option value="">Top-level task</option>
                {project.tasks
                  .filter(
                    (t) =>
                      !t.archived &&
                      !t.done &&
                      (!t.recurrence || t.recurrence === "none"),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
              </select>
            </label>
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
              Assign member
              <select
                value={member}
                onChange={(e) => setMember(e.target.value)}
              >
                <option value="">Unassigned / manual owner</option>
                {members.map((m) => (
                  <option key={m.email}>{m.email}</option>
                ))}
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
