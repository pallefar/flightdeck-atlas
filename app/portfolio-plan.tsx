"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ShieldAlert,
} from "lucide-react";
import type { Project } from "@/lib/projects";
import { portfolioPlan } from "@/lib/portfolio-plan";

export default function PortfolioPlan({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [offset, setOffset] = useState(0),
    [chosen, setChosen] = useState("");
  const plan = portfolioPlan(projects, offset);
  const selection = chosen || plan.today;
  const entries =
    selection === "attention"
      ? []
      : selection === "overdue"
        ? plan.overdue
        : plan.deadlines.filter((d) => d.date === selection);
  function move(by: number) {
    setOffset(offset + by);
    setChosen(portfolioPlan(projects, offset + by).days[0].key);
  }
  return (
    <section className="portfolio-plan" aria-label="Portfolio planner">
      <div className="plan-heading">
        <h2>
          <CalendarDays size={18} /> Plan your next seven days
        </h2>
        <button
          className="planner-disclosure"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Collapse planner" : "Open planner"}
        </button>
        {expanded && (
          <div className="plan-navigation">
            <button aria-label="Previous seven days" onClick={() => move(-1)}>
              <ChevronLeft size={17} />
            </button>
            <button
              onClick={() => {
                setOffset(0);
                setChosen("");
              }}
            >
              Today
            </button>
            <button aria-label="Next seven days" onClick={() => move(1)}>
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="plan-days">
          {plan.days.map(({ key, date }) => {
            const count = plan.deadlines.filter((d) => d.date === key).length;
            return (
              <button
                key={key}
                aria-pressed={selection === key}
                aria-label={`${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${count} deadlines`}
                onClick={() => setChosen(key)}
              >
                <span>
                  {date.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <strong>{date.getDate()}</strong>
                <small>{count ? `${count} due` : "—"}</small>
                {key === plan.today && <i aria-label="Today" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="plan-alerts">
        <button
          aria-pressed={selection === "overdue"}
          onClick={() => {
            setChosen("overdue");
            setExpanded(true);
          }}
        >
          <CalendarDays size={14} />
          {plan.overdue.length} overdue deadlines
        </button>
        <button
          aria-pressed={selection === "attention"}
          onClick={() => {
            setChosen("attention");
            setExpanded(true);
          }}
        >
          <ShieldAlert size={14} />
          {plan.attention.length} need a check-in
        </button>
        <span>
          {plan.days[0].date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          –{" "}
          {plan.days[6].date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
      {expanded && (
        <div className="plan-agenda" aria-live="polite">
          {selection === "attention" ? (
            plan.attention.length ? (
              plan.attention.map(({ p, reason }) => (
                <button key={p.id} onClick={() => onOpen(p)}>
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      {reason}
                      {p.blocker ? ` · ${p.blocker}` : ""}
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <p>No blocked, overdue or stale projects.</p>
            )
          ) : entries.length ? (
            entries.map((d) => (
              <button key={d.id} onClick={() => onOpen(d.p)}>
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {d.kind} · {d.p.name}
                    {selection === "overdue" ? ` · ${d.date}` : ""}
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <p>
              No deadlines{" "}
              {selection === "overdue" ? "are overdue" : `on ${selection}`}. Add
              dates to projects and tasks to see them here.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
