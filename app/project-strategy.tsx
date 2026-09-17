"use client";
import { useState } from "react";
import { Target, TrendingUp, Plus, Pencil, Trash2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  kpiProgress,
  type Objective,
  type KPI,
  type Project,
  type ProjectFields,
} from "@/lib/projects";
export default function ProjectStrategy({
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
  const [goal, setGoal] = useState<Objective | null>(null),
    [metric, setMetric] = useState<KPI | null>(null);
  const [numbers, setNumbers] = useState({
    baseline: "0",
    current: "0",
    target: "100",
  });
  const validNumbers =
    Object.values(numbers).every(
      (n) => n.trim() !== "" && Number.isFinite(Number(n)),
    ) && Number(numbers.target) !== Number(numbers.baseline);
  function editMetric(k: KPI) {
    setMetric(k);
    setNumbers({
      baseline: String(k.baseline),
      current: String(k.current),
      target: String(k.target),
    });
  }
  const goals = project.objectives || [],
    kpis = project.kpis || [];
  return (
    <fieldset className="project-strategy" disabled={busy}>
      <div className="strategy-source">
        <Link2 size={20} />
        <div>
          <strong>FlightDeck OS · Awaiting connection</strong>
          <p>
            Linked strategy goals, KPIs and TEOA Advantage results will appear
            here after the SDK is connected. Goals and measurements below are
            maintained in Atlas.
          </p>
        </div>
      </div>
      <div className="section-heading">
        <h3>
          <Target size={18} /> Strategy goals
        </h3>
        {!readOnly && (
          <Button
            variant="outline"
            disabled={busy || goals.length >= 30}
            onClick={() => {
              setMetric(null);
              setGoal({
                id: crypto.randomUUID(),
                title: "",
                description: "",
                owner: "",
                dueDate: "",
                status: "Planned",
              });
            }}
          >
            <Plus size={15} /> Add goal
          </Button>
        )}
      </div>
      {goal && (
        <form
          className="strategy-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await onSave(
              {
                ...project,
                objectives: goals.some((o) => o.id === goal.id)
                  ? goals.map((o) => (o.id === goal.id ? goal : o))
                  : [...goals, goal],
              },
              project,
            );
            if (result) setGoal(null);
          }}
        >
          <label>
            Goal title
            <Input
              required
              maxLength={200}
              value={goal.title}
              onChange={(e) => setGoal({ ...goal, title: e.target.value })}
            />
          </label>
          <label>
            Desired outcome
            <Textarea
              maxLength={1000}
              value={goal.description}
              onChange={(e) =>
                setGoal({ ...goal, description: e.target.value })
              }
            />
          </label>
          <div className="task-detail-grid">
            <label>
              Goal owner
              <Input
                maxLength={100}
                value={goal.owner}
                onChange={(e) => setGoal({ ...goal, owner: e.target.value })}
              />
            </label>
            <label>
              Goal target date
              <Input
                type="date"
                value={goal.dueDate}
                onChange={(e) => setGoal({ ...goal, dueDate: e.target.value })}
              />
            </label>
            <label>
              Goal status
              <select
                value={goal.status}
                onChange={(e) =>
                  setGoal({
                    ...goal,
                    status: e.target.value as Objective["status"],
                  })
                }
              >
                <option>Planned</option>
                <option>In progress</option>
                <option>Achieved</option>
              </select>
            </label>
          </div>
          <div className="task-edit-actions">
            <Button disabled={busy || readOnly}>Save goal</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGoal(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div className="strategy-goals">
        {goals.map((o) => (
          <article key={o.id}>
            <div className="section-heading">
              <span className="eyebrow">ATLAS GOAL · {o.status}</span>
              {!readOnly && (
                <div>
                  <button
                    aria-label={`Edit goal ${o.title}`}
                    disabled={busy}
                    onClick={() => {
                      setGoal({ ...o });
                      setMetric(null);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={`Remove goal ${o.title}`}
                    disabled={busy}
                    onClick={() =>
                      void onSave(
                        {
                          ...project,
                          objectives: goals.filter((x) => x.id !== o.id),
                          kpis: kpis.map((k) =>
                            k.objectiveId === o.id
                              ? { ...k, objectiveId: "" }
                              : k,
                          ),
                        },
                        project,
                      ).then((r) => {
                        if (r && goal?.id === o.id) setGoal(null);
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <h4>{o.title}</h4>
            <p>{o.description}</p>
            <small>
              {o.owner || "Owner to assign"} · {o.dueDate || "No target date"} ·{" "}
              {kpis.filter((k) => k.objectiveId === o.id).length} KPIs
            </small>
          </article>
        ))}
      </div>
      {!goals.length && !goal && (
        <p className="hub-muted">
          Define the outcome this project should contribute to, then link a
          measurable KPI.
        </p>
      )}
      <div className="section-heading">
        <h3>
          <TrendingUp size={18} /> Key performance indicators
        </h3>
        {!readOnly && (
          <Button
            variant="outline"
            disabled={busy || kpis.length >= 40}
            onClick={() => {
              setGoal(null);
              editMetric({
                id: crypto.randomUUID(),
                name: "",
                unit: "",
                baseline: 0,
                current: 0,
                target: 100,
                objectiveId: "",
              });
            }}
          >
            <Plus size={15} /> Add KPI
          </Button>
        )}
      </div>
      {metric && (
        <form
          className="strategy-editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!validNumbers) return;
            const nextMetric = {
              ...metric,
              baseline: Number(numbers.baseline),
              current: Number(numbers.current),
              target: Number(numbers.target),
            };
            const result = await onSave(
              {
                ...project,
                kpis: kpis.some((k) => k.id === metric.id)
                  ? kpis.map((k) => (k.id === metric.id ? nextMetric : k))
                  : [...kpis, nextMetric],
              },
              project,
            );
            if (result) setMetric(null);
          }}
        >
          <div className="task-detail-grid">
            <label>
              KPI name
              <Input
                required
                maxLength={100}
                value={metric.name}
                onChange={(e) => setMetric({ ...metric, name: e.target.value })}
              />
            </label>
            <label>
              Unit
              <Input
                maxLength={30}
                placeholder="%, days, EUR…"
                value={metric.unit}
                onChange={(e) => setMetric({ ...metric, unit: e.target.value })}
              />
            </label>
            <label>
              Linked goal
              <select
                aria-label="Linked goal"
                value={metric.objectiveId}
                onChange={(e) =>
                  setMetric({ ...metric, objectiveId: e.target.value })
                }
              >
                <option value="">Project-level KPI</option>
                {goals.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="task-detail-grid">
            {(["baseline", "current", "target"] as const).map((key) => (
              <label key={key}>
                {key[0].toUpperCase() + key.slice(1)}
                <Input
                  type="number"
                  step="any"
                  required
                  value={numbers[key]}
                  onChange={(e) =>
                    setNumbers({ ...numbers, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="hub-muted">
            A lower target measures a reduction; a higher target measures
            growth. Progress runs from your baseline to your target.
          </p>
          {!validNumbers && (
            <p role="alert">
              Enter valid numbers and a target different from the baseline.
            </p>
          )}
          <div className="task-edit-actions">
            <Button disabled={busy || readOnly || !validNumbers}>
              Save KPI
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMetric(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <div className="kpi-grid">
        {kpis.map((k) => (
          <article key={k.id} className="kpi-card">
            <div className="section-heading">
              <span className="eyebrow">ATLAS · MANUAL MEASUREMENT</span>
              {!readOnly && (
                <div>
                  <button
                    aria-label={`Edit KPI ${k.name}`}
                    disabled={busy}
                    onClick={() => {
                      editMetric({ ...k });
                      setGoal(null);
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={`Remove KPI ${k.name}`}
                    disabled={busy}
                    onClick={() =>
                      void onSave(
                        { ...project, kpis: kpis.filter((x) => x.id !== k.id) },
                        project,
                      ).then((r) => {
                        if (r && metric?.id === k.id) setMetric(null);
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <h4>{k.name}</h4>
            <div className="kpi-value">
              {k.current.toLocaleString()}
              <span>{k.unit}</span>
            </div>
            <p>
              Baseline {k.baseline.toLocaleString()} → Target{" "}
              {k.target.toLocaleString()}
            </p>
            <div
              className="kpi-meter"
              role="progressbar"
              aria-label={`${k.name} target progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={kpiProgress(k)}
            >
              <span style={{ width: `${kpiProgress(k)}%` }} />
            </div>
            <small>
              {kpiProgress(k)}% toward target ·{" "}
              {goals.find((o) => o.id === k.objectiveId)?.title ||
                "Project-level KPI"}
            </small>
          </article>
        ))}
      </div>
      {!kpis.length && !metric && (
        <p className="hub-muted">
          No measurements yet. Add a baseline, current value and target to track
          the outcome.
        </p>
      )}
    </fieldset>
  );
}
