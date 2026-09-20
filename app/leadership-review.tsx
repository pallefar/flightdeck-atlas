"use client";
import { useState } from "react";
import {
  BriefcaseBusiness,
  Building2,
  Compass,
  ArrowUpRight,
  Check,
  Download,
  Save,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, ProjectFields } from "@/lib/projects";
import {
  leadershipReview,
  type LeadershipRole,
  type ReviewHorizon,
} from "@/lib/leadership";
import { localDate, downloadText } from "@/lib/briefing";
import { freshProject } from "@/lib/fresh-export";
export default function LeadershipReview({
  project,
  readOnly,
  busy,
  onSave,
  onSection,
}: {
  project: Project;
  readOnly: boolean;
  busy: boolean;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
    note?: string,
  ) => Promise<Project | null>;
  onSection: (tab: "tasks" | "strategy" | "delivery") => void;
}) {
  const [role, setRole] = useState<LeadershipRole>("CEO"),
    [horizon, setHorizon] = useState<ReviewHorizon>("now"),
    [draft, setDraft] = useState<{
      id: string;
      title: string;
      due: string;
      owner: string;
      priority: "High" | "Normal";
    } | null>(null),
    [notice, setNotice] = useState("");
  const review = leadershipReview(project, role, horizon, localDate());
  const roles = [
    { name: "CEO" as const, icon: Building2, focus: "Value & direction" },
    { name: "VP" as const, icon: Compass, focus: "Alignment & capacity" },
    {
      name: "Director" as const,
      icon: BriefcaseBusiness,
      focus: "Delivery & accountability",
    },
  ];
  async function snapshot() {
    const next = {
      ...project,
      leadershipReviews: [
        {
          id: crypto.randomUUID(),
          role,
          horizon,
          at: new Date().toISOString(),
          sourceRevision: project.revision,
          text: review.text,
        },
        ...(project.leadershipReviews || []),
      ].slice(0, 20),
    };
    while (
      JSON.stringify({ ...next, activity: undefined }).length > 90000 &&
      next.leadershipReviews.length > 1
    )
      next.leadershipReviews.pop();
    if (JSON.stringify({ ...next, activity: undefined }).length > 90000) {
      setNotice(
        "This project is near its storage limit. Export the decision brief or remove older task data before saving a snapshot.",
      );
      return;
    }
    const saved = await onSave(next, project);
    if (saved)
      setNotice(
        "Review snapshot saved. Up to 20 reviews are retained; older reviews roll off when project space is needed.",
      );
  }
  return (
    <section className="leadership-review">
      <div className="leadership-intro">
        <span className="eyebrow">CHANGE YOUR VANTAGE POINT</span>
        <h2>Think like a leader.</h2>
        <p>
          See the questions a CEO, VP or Director may bring to this project—and
          turn the useful ones into action.
        </p>
        <span className="rules-badge">
          Evidence-based review · FlightDeck AI pending
        </span>
      </div>
      <div className="leadership-roles" aria-label="Leadership perspective">
        {roles.map((r) => (
          <button
            key={r.name}
            aria-label={`Think like a ${r.name}`}
            aria-pressed={role === r.name}
            onClick={() => {
              setRole(r.name);
              setDraft(null);
              setNotice("");
            }}
          >
            <r.icon size={23} />
            <strong>Think like a {r.name}</strong>
            <small>{r.focus}</small>
          </button>
        ))}
      </div>
      <div className="leadership-context">
        <label>
          Review moment
          <select
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as ReviewHorizon)}
          >
            <option value="now">Right now</option>
            <option value="week">Next weekly review</option>
            <option value="gate">Before a stage gate</option>
          </select>
        </label>
        <p>
          {review.horizonPrompt}
          <small>
            Based on saved project revision {project.revision}, updated{" "}
            {new Date(project.updatedAt).toLocaleDateString()}. These are review
            prompts, not someone’s actual thoughts.
          </small>
        </p>
      </div>
      <div className="decision-posture">
        <Target size={20} />
        <div>
          <small>DECISION POSTURE</small>
          <h3>{review.posture}</h3>
        </div>
        <span>{review.gaps.length} evidence gaps</span>
      </div>
      <div className="leadership-questions">
        {review.items.map((item, i) => {
          const exists = project.tasks.some((t) =>
            t.description?.includes(`[leadership:${role}:${item.id}]`),
          );
          return (
            <article
              key={item.id}
              className={item.priority === "High" ? "needs-attention" : ""}
            >
              <span className="question-number">0{i + 1}</span>
              <div>
                <h3>{item.question}</h3>
                <p>{item.evidence}</p>
                <small>Suggested next step</small>
                <strong>{item.action}</strong>
                <button
                  disabled={
                    readOnly || busy || exists || project.tasks.length >= 200
                  }
                  onClick={() =>
                    setDraft({
                      id: item.id,
                      title: item.action,
                      due: "",
                      owner: "",
                      priority: item.priority,
                    })
                  }
                >
                  {exists ? <Check size={15} /> : <ArrowUpRight size={15} />}{" "}
                  {exists ? "Action already captured" : "Review & add action"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {draft && (
        <form
          className="suite-card leadership-draft"
          onSubmit={async (e) => {
            e.preventDefault();
            const item = review.items.find((x) => x.id === draft.id);
            if (!item) return;
            const result = await onSave(
              {
                ...project,
                tasks: [
                  ...project.tasks,
                  {
                    id: crypto.randomUUID(),
                    title: draft.title.trim(),
                    done: false,
                    workflow: "todo",
                    priority: draft.priority,
                    dueDate: draft.due,
                    assignee: draft.owner,
                    group: "Leadership actions",
                    description: `[leadership:${role}:${draft.id}]\n${item.question}\nEvidence at revision ${project.revision}: ${item.evidence}`,
                  },
                ],
              },
              project,
            );
            if (result) {
              setDraft(null);
              setNotice(
                "Action added. Assign a member and set its plan in Tasks.",
              );
            }
          }}
        >
          <h3>Review the proposed action</h3>
          <label>
            Action
            <Input
              autoFocus
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <div className="work-form-grid">
            <label>
              Owner label
              <Input
                maxLength={100}
                value={draft.owner}
                onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              />
            </label>
            <label>
              Due date
              <Input
                type="date"
                value={draft.due}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
              />
            </label>
          </div>
          <Button disabled={busy || !draft.title.trim()}>
            Add reviewed action
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft(null)}
          >
            Cancel
          </Button>
        </form>
      )}
      <details className="suite-card evidence-details">
        <summary>Source evidence & missing information</summary>
        <ul>
          {review.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p>
          <strong>Missing:</strong>{" "}
          {review.gaps.join(" · ") ||
            "Core fields recorded; confirm their freshness with the owners."}
        </p>
        <div className="work-inline-actions">
          <Button variant="outline" onClick={() => onSection("strategy")}>
            Review goals & KPIs
          </Button>
          <Button variant="outline" onClick={() => onSection("delivery")}>
            Review budget & effort
          </Button>
          <Button variant="outline" onClick={() => onSection("tasks")}>
            Review tasks
          </Button>
        </div>
      </details>
      <div className="work-inline-actions">
        <Button disabled={busy || readOnly} onClick={() => void snapshot()}>
          <Save size={15} />
          Save review snapshot
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            try {
              const latest = project.id.startsWith("demo-")
                ? project
                : await freshProject(project.id);
              downloadText(
                `atlas-${role.toLowerCase()}-review.md`,
                leadershipReview(latest, role, horizon, localDate()).text,
              );
            } catch (e) {
              setNotice((e as Error).message);
            }
          }}
        >
          <Download size={15} />
          Export decision brief
        </Button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {!!project.leadershipReviews?.length && (
        <details className="suite-card review-history">
          <summary>Saved reviews · {project.leadershipReviews.length}</summary>
          {project.leadershipReviews.map((r) => (
            <details key={r.id}>
              <summary>
                {r.role} · {new Date(r.at).toLocaleString()} · revision{" "}
                {r.sourceRevision}
              </summary>
              <pre>{r.text}</pre>
              {!readOnly && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void onSave(
                      {
                        ...project,
                        leadershipReviews: project.leadershipReviews?.filter(
                          (x) => x.id !== r.id,
                        ),
                      },
                      project,
                    )
                  }
                >
                  Delete this snapshot
                </Button>
              )}
            </details>
          ))}
        </details>
      )}
    </section>
  );
}
