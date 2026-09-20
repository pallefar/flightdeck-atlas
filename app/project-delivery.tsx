"use client";
import { useState } from "react";
import { Clock3, Coins, Layers3, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, ProjectFields } from "@/lib/projects";
import type { Budget } from "@/lib/work-model";
import { loggedMinutes, taskTemplate } from "@/lib/work-management";
export default function ProjectDelivery({
  project,
  readOnly,
  busy,
  onSave,
}: {
  project: Project;
  readOnly: boolean;
  busy: boolean;
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
}) {
  const [budget, setBudget] = useState<Budget | null>(null),
    [template, setTemplate] = useState<"delivery" | "improvement" | "launch">(
      "delivery",
    ),
    [preview, setPreview] = useState(false);
  const [budgetBase, setBudgetBase] = useState<Project | null>(null);
  function editBudget(next: Budget) {
    if (!budget) setBudgetBase(project);
    setBudget(next);
  }
  const b = budget ||
    project.budget || {
      currency: "EUR",
      approved: null,
      forecast: null,
      actual: null,
    };
  const hours = (n: number) => (n / 60).toFixed(1),
    estimated = project.tasks.reduce((n, t) => n + (t.estimateMinutes || 0), 0),
    actual = project.tasks.reduce((n, t) => n + loggedMinutes(t), 0);
  const rules = project.automations || {
    readyToDoing: false,
    blockedToHigh: false,
  };
  return (
    <section className="delivery-workspace">
      <div className="work-section-heading">
        <div>
          <span className="eyebrow">DELIVERY CONTROL</span>
          <h2>Time, cost & repeatable work.</h2>
        </div>
      </div>
      <div className="delivery-metrics">
        <div>
          <Clock3 />
          <small>Estimated effort</small>
          <strong>
            {hours(estimated)} <span>hours</span>
          </strong>
        </div>
        <div>
          <Clock3 />
          <small>Recorded effort</small>
          <strong>
            {hours(actual)} <span>hours</span>
          </strong>
        </div>
        <div>
          <Coins />
          <small>Forecast vs approved</small>
          <strong>
            {b.forecast != null && b.approved != null
              ? `${b.forecast > b.approved ? "+" : ""}${(b.forecast - b.approved).toLocaleString()}`
              : "—"}{" "}
            <span>{b.currency}</span>
          </strong>
        </div>
      </div>
      <form
        className="suite-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const base = budgetBase || project;
          if (await onSave({ ...base, budget: b }, base)) {
            setBudget(null);
            setBudgetBase(null);
          }
        }}
      >
        <div className="section-heading">
          <h3>Project budget</h3>
          <span>Manually recorded</span>
        </div>
        <p>
          Keep approved funding, forecast total cost and actual spend separate.
          Task time is effort, not an automatic cost calculation.
        </p>
        <fieldset disabled={busy || readOnly} className="work-form-grid">
          {budget && budgetBase && budgetBase.revision !== project.revision && (
            <p role="status" className="form-error">
              The project changed while you were editing. Discard this budget
              draft to review the latest values before saving.
            </p>
          )}
          <label>
            Currency
            <select
              value={b.currency}
              onChange={(e) =>
                editBudget({
                  ...b,
                  currency: e.target.value as Budget["currency"],
                })
              }
            >
              {["EUR", "USD", "GBP", "PLN", "DKK", "CNY"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {(["approved", "forecast", "actual"] as const).map((k) => (
            <label key={k}>
              {k === "approved"
                ? "Approved budget"
                : k === "forecast"
                  ? "Forecast total cost"
                  : "Actual spend"}
              <Input
                type="number"
                min={0}
                max={1e12}
                step="0.01"
                placeholder="Not recorded"
                value={b[k] ?? ""}
                onChange={(e) =>
                  editBudget({
                    ...b,
                    [k]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
          <Button disabled={!budget}>Save budget</Button>
          {budget && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setBudget(null)}
            >
              Discard budget changes
            </Button>
          )}
        </fieldset>
      </form>
      <section className="suite-card">
        <div className="section-heading">
          <h3>
            <Zap size={18} /> Automation recipes
          </h3>
          <span>On project save</span>
        </div>
        <p>
          Opt in to each recipe. Changes appear in Updates. These recipes run
          when a project is saved; they do not send scheduled reminders.
        </p>
        {[
          {
            key: "readyToDoing" as const,
            title:
              "When the final prerequisite is completed → move the waiting task to Doing",
            body: "Only To do tasks with dependencies are moved. Manually blocked tasks stay blocked.",
          },
          {
            key: "blockedToHigh" as const,
            title: "When a task changes to Blocked → set High priority",
            body: "Flags newly blocked tasks for the next review. Existing blocked tasks are unchanged.",
          },
        ].map((r) => (
          <label className="work-recipe" key={r.key}>
            <input
              type="checkbox"
              checked={rules[r.key]}
              disabled={readOnly || busy}
              onChange={() =>
                void onSave(
                  {
                    ...project,
                    automations: { ...rules, [r.key]: !rules[r.key] },
                  },
                  project,
                )
              }
            />
            <span>
              <strong>{r.title}</strong>
              <small>{r.body}</small>
            </span>
          </label>
        ))}
        <p className="hub-muted">
          Task recurrence is configured in each task’s details.
        </p>
      </section>
      <section className="suite-card">
        <div className="section-heading">
          <h3>
            <Layers3 size={18} /> Project playbooks
          </h3>
        </div>
        <p>
          Add a starter sequence with phases, dependencies and a final
          milestone. Existing tasks are preserved; dates and owners are yours to
          set.
        </p>
        <div className="work-inline-actions">
          <label>
            Task playbook
            <select
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value as typeof template);
                setPreview(false);
              }}
            >
              <option value="delivery">Project delivery</option>
              <option value="improvement">Continuous improvement</option>
              <option value="launch">Product launch</option>
            </select>
          </label>
          <Button
            variant="outline"
            disabled={readOnly || busy || project.tasks.length > 196}
            onClick={() => setPreview(!preview)}
          >
            Preview playbook
          </Button>
        </div>
        {preview && (
          <div className="template-preview">
            <ol>
              {taskTemplate(template).map((t, i) => (
                <li key={i}>
                  {t.title} {t.milestone ? "◆ Milestone" : ""}
                </li>
              ))}
            </ol>
            <Button
              disabled={busy || readOnly}
              onClick={async () => {
                if (
                  await onSave(
                    {
                      ...project,
                      tasks: [...project.tasks, ...taskTemplate(template)],
                    },
                    project,
                  )
                )
                  setPreview(false);
              }}
            >
              Add four playbook tasks
            </Button>
          </div>
        )}
      </section>
      <section className="suite-card">
        <h3>Effort by task</h3>
        <p>
          Log or correct dated work sessions in Tasks → task details. Estimates
          stay separate from actual time.
        </p>
        <div className="work-table-scroll">
          <table className="work-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Estimate</th>
                <th>Recorded</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {project.tasks.map((t) => (
                <tr key={t.id}>
                  <th>{t.title}</th>
                  <td>
                    {t.estimateMinutes == null
                      ? "—"
                      : `${t.estimateMinutes} min`}
                  </td>
                  <td>{loggedMinutes(t)} min</td>
                  <td>
                    {t.estimateMinutes == null
                      ? "—"
                      : `${loggedMinutes(t) - t.estimateMinutes} min`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!project.tasks.length && <p>No tasks yet.</p>}
      </section>
    </section>
  );
}
