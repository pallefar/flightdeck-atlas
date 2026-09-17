"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  CheckCheck,
  Download,
  CalendarDays,
  Circle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project, ProjectFields } from "@/lib/projects";
import {
  briefing,
  briefingMarkdown,
  downloadText,
  localDate,
} from "@/lib/briefing";
export default function Briefing({
  projects,
  demo,
  busy,
  onOpen,
  onSave,
}: {
  projects: Project[];
  demo: boolean;
  busy: boolean;
  onOpen: (p: Project) => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
}) {
  const [period, setPeriod] = useState<"day" | "week">("day");
  const b = briefing(projects, period);
  return (
    <main className="hub-page">
      <header className="hub-heading">
        <div>
          <span className="eyebrow">YOUR NEXT MOVE</span>
          <h1>{period === "day" ? "Daily briefing" : "Weekly review"}</h1>
          <p>
            {period === "day"
              ? new Date().toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })
              : `${localDate(b.start)} – ${b.through}`}{" "}
            · Your local time
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            downloadText(
              `atlas-${period}-${b.today}.md`,
              briefingMarkdown(projects, period),
            )
          }
        >
          <Download size={16} /> Export summary
        </Button>
      </header>
      <div className="briefing-toolbar">
        <div className="filter-tabs">
          <button
            className={period === "day" ? "chosen" : ""}
            aria-pressed={period === "day"}
            onClick={() => setPeriod("day")}
          >
            Today
          </button>
          <button
            className={period === "week" ? "chosen" : ""}
            aria-pressed={period === "week"}
            onClick={() => setPeriod("week")}
          >
            This week
          </button>
        </div>
        <span>
          {demo
            ? "Example projects · add your own to take action"
            : "Based on your saved projects and activity"}
        </span>
      </div>
      <section className="briefing-metrics" aria-label="Briefing summary">
        <div>
          <span>Open actions</span>
          <strong>{b.actions.length}</strong>
        </div>
        <div>
          <span>Completed {period === "day" ? "today" : "this week"}</span>
          <strong>{b.completed.length}</strong>
        </div>
        <div>
          <span>Overdue actions</span>
          <strong className={b.overdue.length ? "attention" : ""}>
            {b.overdue.length}
          </strong>
        </div>
        <div>
          <span>Blocked projects</span>
          <strong>{b.blocked.length}</strong>
        </div>
      </section>
      <div className="briefing-grid">
        <section className="hub-card">
          <div className="section-heading">
            <h2>Action queue</h2>
            <span>{b.actions.length} open</span>
          </div>
          <p className="hub-muted">
            Overdue work first, then high priorities and upcoming dates.
          </p>
          {b.actions.length ? (
            b.actions.map(({ p, t, due, overdue }) => (
              <div className="action-row" key={`${p.id}-${t.id}`}>
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  disabled={demo || busy || p.canEdit === false}
                  checked={false}
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
                <button className="action-content" onClick={() => onOpen(p)}>
                  <strong>{t.title}</strong>
                  <span>
                    {p.name}
                    {t.assignee ? ` · ${t.assignee}` : ""}
                  </span>
                </button>
                <span className={`action-due ${overdue ? "overdue" : ""}`}>
                  {t.priority === "High" && <b>High</b>}
                  {due || "No date"}
                </span>
              </div>
            ))
          ) : (
            <div className="hub-empty">
              <CheckCheck />
              <h3>No open actions</h3>
              <p>Add a task or choose the next step for a project.</p>
            </div>
          )}
        </section>
        <div className="briefing-side">
          <section className="hub-card">
            <h2>
              <AlertCircle size={18} /> Needs attention
            </h2>
            {b.blocked.map((p) => (
              <button
                className="brief-project"
                key={p.id}
                onClick={() => onOpen(p)}
              >
                <strong>{p.name}</strong>
                <span>{p.blocker}</span>
              </button>
            ))}
            {b.needsNext.map((p) => (
              <button
                className="brief-project"
                key={p.id}
                onClick={() => onOpen(p)}
              >
                <strong>{p.name}</strong>
                <span>Choose a next action</span>
              </button>
            ))}
            {!b.blocked.length && !b.needsNext.length && (
              <p className="hub-muted">
                No blockers recorded. Every unfinished project has a next step.
              </p>
            )}
          </section>
          <section className="hub-card">
            <h2>
              <CalendarDays size={18} /> Project deadlines
            </h2>
            {b.deadlines.map((p) => (
              <button
                className="brief-project"
                key={p.id}
                onClick={() => onOpen(p)}
              >
                <strong>{p.name}</strong>
                <span className={p.dueDate < b.today ? "attention" : ""}>
                  {p.dueDate}
                  {p.dueDate < b.today ? " · overdue" : ""}
                </span>
              </button>
            ))}
            {!b.deadlines.length && (
              <p className="hub-muted">
                No project deadlines due in this period.
              </p>
            )}
          </section>
          <section className="hub-card">
            <h2>Next moves</h2>
            {b.live
              .filter((p) => p.nextAction)
              .map((p) => (
                <button
                  className="brief-project"
                  key={p.id}
                  onClick={() => onOpen(p)}
                >
                  <strong>{p.nextAction}</strong>
                  <span>
                    {p.name} <ArrowUpRight size={13} />
                  </span>
                </button>
              ))}
            {!b.live.some((p) => p.nextAction) && (
              <p className="hub-muted">
                Set a next action in a project to keep it visible here.
              </p>
            )}
          </section>
        </div>
      </div>
      <section className="hub-card activity-section">
        <h2>What changed</h2>
        <p className="hub-muted">
          Recorded updates {period === "day" ? "today" : "this week"}. Older
          projects begin recording activity when you update them.
        </p>
        {b.events.slice(0, 30).map(({ p, e }) => (
          <button className="activity-row" key={e.id} onClick={() => onOpen(p)}>
            {e.kind === "task-completed" ? (
              <CheckCheck size={17} />
            ) : (
              <Circle size={14} />
            )}
            <span>
              <strong>{e.text}</strong>
              <small>{p.name}</small>
            </span>
            <time>
              {new Date(e.at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </button>
        ))}
        {!b.events.length && (
          <p className="hub-muted">No changes recorded in this period yet.</p>
        )}
      </section>
    </main>
  );
}
