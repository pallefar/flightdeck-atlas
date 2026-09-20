"use client";
import { useState } from "react";
import FrogPlan from "./frog-plan";
import FeatureHelp from "./feature-help";
import type { WorkspaceData } from "./workspace-tools";
import {
  ArrowUpRight,
  Check,
  ListTodo,
  Plus,
  ShieldAlert,
  Sparkles,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDate } from "@/lib/briefing";
import { dailyAllocation, portfolioAdvice } from "@/lib/advisor";
import type { Project, ProjectFields } from "@/lib/projects";
export default function Today({
  projects,
  demo,
  busy,
  onOpen,
  onSave,
  onFocus,
  capacity,
  onCapacityChange,
}: {
  projects: Project[];
  demo: boolean;
  busy: boolean;
  onOpen: (p: Project) => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  onFocus: () => void;
  capacity: number;
  onCapacityChange: (minutes: number) => void;
}) {
  const [filter, setFilter] = useState("today");
  const [frog, setFrog] = useState<WorkspaceData["preferences"]["frog"]>(null);
  const [projectId, setProjectId] = useState(""),
    [title, setTitle] = useState(""),
    [due, setDue] = useState("");
  const today = localDate(),
    advice = portfolioAdvice(projects, today);
  const editable = demo
    ? []
    : projects.filter(
        (p) => !p.archived && p.canEdit !== false && p.status !== "Completed",
      );
  const captureProject =
    editable.find((p) => p.id === projectId) || editable[0];
  const queue = advice.actions
    .filter(
      ({ t, blocked }) =>
        filter === "all" ||
        (filter === "today" &&
          ((t.id === frog?.taskId &&
            advice.actions.some(
              (a) => a.t === t && a.p.id === frog.projectId,
            )) ||
            (!!t.plannedDate && t.plannedDate <= today) ||
            (!!t.dueDate && t.dueDate <= today))) ||
        (filter === "blocked" && blocked) ||
        (filter === "undated" && !t.dueDate && !t.plannedDate),
    )
    .sort(
      (a, b) =>
        Number(b.p.id === frog?.projectId && b.t.id === frog?.taskId) -
        Number(a.p.id === frog?.projectId && a.t.id === frog?.taskId),
    );
  const {
    total: taskPlannedMinutes,
    completed: taskCompletedMinutes,
    missing: missingEstimates,
  } = dailyAllocation(projects, today);
  const frogProject = projects.find((p) => p.id === frog?.projectId);
  const frogTask = frogProject?.tasks.find((t) => t.id === frog?.taskId);
  const frogReservation =
    frog &&
    frogTask &&
    frogProject &&
    !frogProject.archived &&
    frogProject.status !== "On hold" &&
    frogProject.status !== "Completed"
      ? Math.max(
          0,
          frog.minutes -
            (frogTask.plannedDate === today
              ? frogTask.estimateMinutes || 30
              : 0),
        )
      : 0;
  const plannedMinutes = taskPlannedMinutes + frogReservation;
  const completedMinutes =
    taskCompletedMinutes +
    (frogTask?.done &&
    frogTask.completedAt &&
    localDate(new Date(frogTask.completedAt)) === today
      ? frogReservation
      : 0);
  const recommendations = advice.actions
    .filter((a) => !a.blocked)
    .sort(
      (a, b) =>
        Number(b.p.id === frog?.projectId && b.t.id === frog?.taskId) -
        Number(a.p.id === frog?.projectId && a.t.id === frog?.taskId),
    )
    .slice(0, 3);
  const [showAllWatchouts, setShowAllWatchouts] = useState(false);
  return (
    <main className="hub-page today-page">
      <header className="hub-heading">
        <div>
          <span className="eyebrow">MAKE SPACE FOR WHAT MATTERS</span>
          <div className="heading-with-help">
            <h1>Today, with intention.</h1>
            <FeatureHelp title="Plan your day">
              Choose one important, difficult task as today’s frog. Reserve
              focus time, capture your next actions and review watch-outs.
              Suggestions use your project data; you choose which actions to
              take.
            </FeatureHelp>
          </div>
          <p>
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · Your local time
          </p>
        </div>
        <Button variant="outline" onClick={onFocus}>
          <Timer size={17} /> Start a focus session
        </Button>
      </header>
      {demo && (
        <p className="demo-banner">
          Example projects · Add your own projects to plan and capture actions.
        </p>
      )}
      <FrogPlan
        projects={projects}
        demo={demo}
        busy={busy}
        onSave={onSave}
        onOpen={onOpen}
        onPlan={setFrog}
      />
      <form
        className="quick-capture"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!captureProject || !title.trim()) return;
          const result = await onSave(
            {
              ...captureProject,
              tasks: [
                ...captureProject.tasks,
                {
                  id: crypto.randomUUID(),
                  title: title.trim(),
                  done: false,
                  plannedDate: today,
                  dueDate: due,
                  priority: "Normal",
                  workflow: "todo",
                },
              ],
            },
            captureProject,
          );
          if (result) {
            setTitle("");
            setDue("");
            setFilter("today");
          }
        }}
      >
        <fieldset disabled={busy || !captureProject}>
          <label>
            Quick capture
            <Input
              aria-label="Quick capture task"
              placeholder="What needs to happen next?"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Project
            <select
              aria-label="Capture project"
              value={captureProject?.id || ""}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {!editable.length && (
                <option value="">Create a project first</option>
              )}
              {editable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Deadline (optional)
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <Button
            disabled={
              !title.trim() || (captureProject?.tasks.length || 0) >= 200
            }
          >
            <Plus size={16} /> Add to today
          </Button>
        </fieldset>
      </form>
      <div className="today-grid">
        <section>
          <div className="today-capacity">
            <div>
              <span>TODAY’S ALLOCATION</span>
              <strong>
                {plannedMinutes}
                <small> / {capacity} min</small>
              </strong>
              <p>
                {plannedMinutes > capacity
                  ? `${plannedMinutes - capacity} minutes over your focus budget`
                  : `${Math.max(0, capacity - plannedMinutes)} minutes available`}
              </p>
              <small>
                {completedMinutes} estimated minutes completed; kept in today’s
                allocation.
              </small>
              {frogReservation > 0 && (
                <small>
                  Includes {frogReservation} additional minutes reserved for
                  your frog.
                </small>
              )}
              {missingEstimates > 0 && (
                <small>
                  {missingEstimates} unestimated tasks use a 30-minute
                  allowance.
                </small>
              )}
            </div>
            <label>
              Focus budget
              <select
                aria-label="Daily focus budget"
                value={capacity}
                onChange={(e) => onCapacityChange(Number(e.target.value))}
              >
                {[60, 120, 180, 240, 360].map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
              <small>
                Budget saved in this browser. Calendar not connected.
              </small>
            </label>
            <div className="capacity-meter">
              <span
                style={{
                  width: `${Math.min(100, (plannedMinutes / capacity) * 100)}%`,
                  background: plannedMinutes > capacity ? "#d6684b" : undefined,
                }}
              />
            </div>
          </div>
          <div className="section-heading">
            <h2>
              <ListTodo size={18} /> Action queue
            </h2>
            <span>{queue.length} tasks</span>
          </div>
          <div className="filter-tabs today-filters">
            {[
              { id: "today", label: "Today & overdue" },
              { id: "all", label: "All open" },
              { id: "blocked", label: "Blocked" },
              { id: "undated", label: "Unscheduled" },
            ].map((f) => (
              <button
                key={f.id}
                aria-pressed={filter === f.id}
                className={filter === f.id ? "chosen" : ""}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="today-tasks">
            {queue.map(({ p, t, reason, blocked }) => (
              <article key={`${p.id}:${t.id}`}>
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  checked={false}
                  disabled={demo || busy || p.canEdit === false}
                  onChange={() =>
                    void onSave(
                      {
                        ...p,
                        tasks: p.tasks.map((x) =>
                          x.id === t.id ? { ...x, done: true } : x,
                        ),
                      },
                      p,
                    )
                  }
                />
                <button
                  className="today-task-content"
                  onClick={() => onOpen(p)}
                >
                  <strong>{t.title}</strong>
                  <small>
                    {p.name} · {t.assignee || "Unassigned"}
                  </small>
                  <span>
                    {blocked ? "Blocked · " : ""}
                    {reason}
                    {t.estimateMinutes ? ` · ${t.estimateMinutes} min` : ""}
                  </span>
                </button>
                {t.plannedDate !== today ? (
                  <button
                    className="plan-task-button"
                    disabled={demo || busy || p.canEdit === false}
                    onClick={() =>
                      void onSave(
                        {
                          ...p,
                          tasks: p.tasks.map((x) =>
                            x.id === t.id ? { ...x, plannedDate: today } : x,
                          ),
                        },
                        p,
                      )
                    }
                  >
                    Plan today
                  </button>
                ) : (
                  <button
                    className="plan-task-button"
                    aria-label={`Unplan ${t.title}`}
                    disabled={demo || busy || p.canEdit === false}
                    onClick={() =>
                      void onSave(
                        {
                          ...p,
                          tasks: p.tasks.map((x) =>
                            x.id === t.id ? { ...x, plannedDate: "" } : x,
                          ),
                        },
                        p,
                      )
                    }
                  >
                    <Check size={13} />
                    Planned
                  </button>
                )}
              </article>
            ))}
            {!queue.length && (
              <div className="hub-empty">
                <Check />
                <h3>
                  {filter === "today"
                    ? "Space for a focused day"
                    : "No tasks in this view"}
                </h3>
                <p>Capture an action above or choose a task from All open.</p>
              </div>
            )}
          </div>
        </section>
        <aside className="advisor-rail">
          <section className="advisor-card">
            <div className="section-heading">
              <h2>
                <Sparkles size={18} /> Suggested priorities
              </h2>
              <span className="rules-badge">Rule-based</span>
            </div>
            <p className="hub-muted">
              Your chosen frog first, then overdue work, today’s commitments and
              high priorities. Blocked work needs an unblock action.
            </p>
            {recommendations.map(({ p, t, reason }, i) => (
              <button
                className="priority-suggestion"
                key={`${p.id}:${t.id}`}
                onClick={() => onOpen(p)}
              >
                <b>{i + 1}</b>
                <span>
                  <strong>{t.title}</strong>
                  <small>
                    {p.name} · {reason}
                  </small>
                </span>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {!recommendations.length && (
              <p className="hub-muted">No unblocked actions to suggest.</p>
            )}
          </section>
          <section className="advisor-card">
            <div className="section-heading">
              <h2>
                <ShieldAlert size={18} /> Watch-outs
              </h2>
              <span>{advice.watchouts.length}</span>
            </div>
            <span className="rules-badge">
              Rule-based checks · saved Atlas data
            </span>
            {advice.watchouts
              .slice(0, showAllWatchouts ? undefined : 5)
              .map((w) => (
                <article className={`watchout ${w.severity}`} key={w.id}>
                  <h3>{w.title}</h3>
                  <strong>
                    {projects.find((p) => p.id === w.projectId)?.name}
                  </strong>
                  <p>{w.evidence}</p>
                  <p className="watchout-action">{w.action}</p>
                  <button
                    onClick={() => {
                      const p = projects.find((p) => p.id === w.projectId);
                      if (p) onOpen(p);
                    }}
                  >
                    Review project <ArrowUpRight size={14} />
                  </button>
                </article>
              ))}
            {!advice.watchouts.length && (
              <p className="hub-muted">
                No issues found by these checks. This does not replace a project
                review.
              </p>
            )}
            {advice.watchouts.length > 5 && (
              <button
                className="text-link"
                onClick={() => setShowAllWatchouts(!showAllWatchouts)}
              >
                {showAllWatchouts ? "Show fewer" : "Show all watch-outs"}
              </button>
            )}
          </section>
          <section className="advisor-card ai-pending">
            <Sparkles size={21} />
            <h2>FlightDeck AI review</h2>
            <span className="rules-badge">Awaiting FlightDeck OS</span>
            <p>
              Available now: open a project and choose Think like a leader for
              CEO, VP and Director perspectives with evidence and reviewed
              actions.
            </p>
            <p>
              Once connected: ask for a portfolio review, suggested priorities,
              task breakdowns, and goal or KPI watch-outs—with links to the
              evidence.
            </p>
            <p>
              You’ll review proposed changes before they are applied. No project
              data is sent to an AI service today.
            </p>
            <a href="/integration">
              Connection requirements <ArrowUpRight size={14} />
            </a>
          </section>
        </aside>
      </div>
    </main>
  );
}
