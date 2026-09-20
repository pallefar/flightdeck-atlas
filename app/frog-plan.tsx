"use client";
import { useState } from "react";
import { Check, Play, Target, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDate } from "@/lib/briefing";
import { taskBlocked, type Project, type ProjectFields } from "@/lib/projects";
import { useWorkspace, type WorkspaceData } from "./workspace-tools";
import { useWellbeing } from "./wellbeing";
export default function FrogPlan({
  projects,
  demo,
  busy,
  onSave,
  onOpen,
  onPlan,
}: {
  projects: Project[];
  demo: boolean;
  busy: boolean;
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
  onOpen: (p: Project) => void;
  onPlan: (plan: WorkspaceData["preferences"]["frog"]) => void;
}) {
  const w = useWorkspace(),
    wellness = useWellbeing(),
    today = localDate();
  const saved = w.data?.preferences.frog,
    frog = saved?.date === today ? saved : null;
  const p = projects.find((p) => p.id === frog?.projectId),
    task = p?.tasks.find((t) => t.id === frog?.taskId);
  const [editing, setEditing] = useState(false),
    [chosen, setChosen] = useState(""),
    [step, setStep] = useState(""),
    [start, setStart] = useState("09:00"),
    [minutes, setMinutes] = useState(25),
    [started, setStarted] = useState(false);
  const candidates = projects
    .filter(
      (p) =>
        !p.archived &&
        p.status !== "Completed" &&
        p.status !== "On hold" &&
        !p.blocker?.trim(),
    )
    .flatMap((p) =>
      p.tasks
        .filter((t) => !t.done && !taskBlocked(t, p))
        .map((t) => ({ p, t })),
    );
  const selection = candidates.find((x) => `${x.p.id}/${x.t.id}` === chosen);
  const blocked =
    !!p &&
    !!task &&
    (taskBlocked(task, p) ||
      !!p.blocker?.trim() ||
      p.archived ||
      p.status === "On hold" ||
      p.status === "Completed");
  const unavailable = !!frog && (!p || !task);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!w.data || !selection) return;
    const next = {
      date: today,
      projectId: selection.p.id,
      taskId: selection.t.id,
      firstStep: step.trim(),
      start,
      minutes,
    };
    if (
      await w.mutate({
        action: "preferences",
        revision: w.data.preferenceRevision,
        data: { ...w.data.preferences, frog: next },
      })
    ) {
      setEditing(false);
      setStarted(false);
      onPlan(next);
    }
  }
  return (
    <section
      className={`frog-plan ${task?.done ? "frog-done" : ""}`}
      aria-label="Eat the Frog planner"
    >
      <div className="frog-symbol" aria-hidden="true">
        {task?.done ? <Check size={29} /> : <Target size={29} />}
      </div>
      <div className="frog-main">
        <span className="eyebrow">EAT THE FROG</span>
        <h2>
          {task?.done
            ? "Your frog is done. Keep the momentum."
            : "The important, difficult thing. First."}
        </h2>
        <p>
          Choose one meaningful task you might put off. Make the first step
          small and protect time for it before routine work.
        </p>
        {!editing && frog && task && p && (
          <div className="frog-commitment">
            <strong>{task.title}</strong>
            <small>
              {p.name} · {frog.start} · {frog.minutes} min focus block · Your
              local time
            </small>
            <p>
              <b>First step:</b> {frog.firstStep}
            </p>
            {blocked && !task.done && (
              <p role="status">
                This task is now blocked or inactive. Resolve the blocker or
                choose a different frog.
              </p>
            )}
            <div className="work-inline-actions">
              {!task.done && (
                <>
                  <Button
                    disabled={
                      blocked ||
                      !wellness.data ||
                      wellness.data.timer.status !== "idle"
                    }
                    onClick={() => {
                      wellness.update((s) =>
                        s.timer.status !== "idle"
                          ? s
                          : {
                              ...s,
                              notice: null,
                              timer: {
                                mode: "focus",
                                status: "running",
                                duration: frog.minutes * 60,
                                remaining: frog.minutes * 60,
                                endAt: Date.now() + frog.minutes * 60000,
                              },
                            },
                      );
                      setStarted(true);
                    }}
                  >
                    <Play size={15} />
                    {started ? "Focus started" : "Start frog focus"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={demo || busy || p.canEdit === false || blocked}
                    onClick={() =>
                      void onSave(
                        {
                          ...p,
                          tasks: p.tasks.map((t) =>
                            t.id === task.id ? { ...t, done: true } : t,
                          ),
                        },
                        p,
                      )
                    }
                  >
                    <Check size={15} />
                    Mark frog complete
                  </Button>
                </>
              )}
              <button onClick={() => onOpen(p)}>
                Open task’s project <ArrowUpRight size={14} />
              </button>
            </div>
            {wellness.data?.timer.status !== "idle" && !task.done && (
              <small>
                A focus timer is active or paused. Manage it from the timer in
                the top bar.
              </small>
            )}
          </div>
        )}
        {unavailable && (
          <p role="status">
            Your saved task is no longer available. Choose another task.
          </p>
        )}
        {!editing && (
          <Button
            variant="outline"
            disabled={demo || !w.data || w.busy}
            onClick={() => {
              setEditing(true);
              setChosen(task && p && !task.done ? `${p.id}/${task.id}` : "");
              setStep(task && !task.done ? frog?.firstStep || "" : "");
              setStart(frog?.start || "09:00");
              setMinutes(frog?.minutes || 25);
            }}
          >
            {frog ? "Choose or change frog" : "Choose today’s frog"}
          </Button>
        )}
        {editing && (
          <form className="frog-form" onSubmit={save}>
            <fieldset disabled={w.busy || demo}>
              <label>
                Your most important difficult task
                <select
                  required
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                >
                  <option value="">Choose deliberately…</option>
                  {candidates.map((x) => (
                    <option
                      key={`${x.p.id}/${x.t.id}`}
                      value={`${x.p.id}/${x.t.id}`}
                    >
                      {x.t.title} · {x.p.name}
                      {x.t.priority === "High" ? " · High priority" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Make the first step small
                <Input
                  required
                  maxLength={300}
                  placeholder="For example: draft the first three points…"
                  value={step}
                  onChange={(e) => setStep(e.target.value)}
                />
              </label>
              <div className="work-form-grid">
                <label>
                  Protected start time
                  <Input
                    type="time"
                    required
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  Focus minutes
                  <Input
                    type="number"
                    min={5}
                    max={90}
                    required
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
              </div>
              <Button disabled={!selection || !step.trim()}>
                Save today’s frog
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
            </fieldset>
          </form>
        )}
        <small className="frog-privacy">
          Your daily choice is private and saved to your Atlas account. The
          block is a personal plan; it does not book your calendar.
        </small>
        {w.error && (
          <p role="alert">
            {w.error} <button onClick={() => void w.load()}>Reload plan</button>
          </p>
        )}
      </div>
      <FrogSync frog={frog} onPlan={onPlan} />
    </section>
  );
}
import { useEffect } from "react";
function FrogSync({
  frog,
  onPlan,
}: {
  frog: WorkspaceData["preferences"]["frog"];
  onPlan: (p: WorkspaceData["preferences"]["frog"]) => void;
}) {
  useEffect(() => onPlan(frog), [frog, onPlan]);
  return null;
}
