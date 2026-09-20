"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SlidersHorizontal,
  CalendarRange,
  Zap,
  Timer,
  Inbox,
  NotebookPen,
  ChartNoAxesCombined,
  Users,
  Plus,
  Play,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectFields, Task } from "@/lib/projects";
import {
  emptyWork,
  matchesGroup,
  numericValue,
  criticalPath,
  reschedule,
  dateNumber,
  dateFrom,
  widgetValue,
  localLinks,
  type CustomField,
  type WorkRule,
  type WorkWidget,
} from "@/lib/advanced-work";
import { applyTemplate, type WorkTemplate } from "@/lib/work-templates";
import { localDate, downloadText } from "@/lib/briefing";
import { FilterBuilder } from "./advanced-task-fields";
import { useWorkspace } from "./workspace-tools";
type Props = {
  project: Project;
  readOnly: boolean;
  busy: boolean;
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
  onReload: () => void;
};
type RecordItem = {
  id: string;
  kind: string;
  revision: number;
  updated_at: string;
  available_at: string;
  closed: number;
  data: Record<string, any>;
};
type WorkData = {
  requestsCursor: string | null;
  records: RecordItem[];
  people: { email: string }[];
  email: string;
  canEdit: boolean;
  serverTime: string;
};
function useWork(project: Project, onReload?: () => void) {
  const [data, setData] = useState<WorkData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const olderCursor = useRef<string | null | undefined>(undefined);
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;
  const load = useCallback(async () => {
    if (project.id.startsWith("demo-")) return;
    try {
      const r = await fetch(`/api/work?project=${project.id}`),
        b = (await r.json()) as WorkData & { error: string };
      if (!r.ok) throw Error(b.error);
      setData((old) => ({
        ...b,
        requestsCursor:
          olderCursor.current === undefined
            ? b.requestsCursor
            : olderCursor.current,
        records: [
          ...b.records,
          ...(old?.records || []).filter(
            (r) =>
              r.kind === "request" && !b.records.some((x) => x.id === r.id),
          ),
        ],
      }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);
  async function mutate(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/work", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, projectId: project.id }),
        }),
        b = (await r.json()) as { error: string; success: boolean };
      if (!r.ok) throw Error(b.error);
      await load();
      reloadRef.current?.();
      return b;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function loadOlder() {
    if (!data?.requestsCursor) return;
    try {
      const r = await fetch(
          `/api/work?project=${project.id}&requestsBefore=${encodeURIComponent(data.requestsCursor)}`,
        ),
        b = (await r.json()) as WorkData & { error: string };
      if (!r.ok) throw Error(b.error);
      olderCursor.current = b.requestsCursor;
      setData((old) => ({
        ...b,
        records: [
          ...(old?.records || []).filter(
            (r) => !b.records.some((x) => x.id === r.id),
          ),
          ...b.records,
        ],
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return { data, error, busy, load, mutate, loadOlder };
}
export function LiveWorkStatus({
  project,
  onReload,
}: {
  project: Project;
  onReload: () => void;
}) {
  const w = useWork(project),
    session = useRef("");
  const reload = useRef(onReload);
  reload.current = onReload;
  useEffect(() => {
    if (project.id.startsWith("demo-")) return;
    session.current = crypto.randomUUID();
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await fetch("/api/work", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "presence",
            projectId: project.id,
            session: session.current,
          }),
        });
        reload.current();
      } catch {}
    };
    void beat();
    const timer = setInterval(beat, 20000);
    return () => clearInterval(timer);
  }, [project.id]);
  const names = [
    ...new Set(
      w.data?.records
        .filter((r) => r.kind === "presence")
        .map((r) => String(r.data.email)) || [],
    ),
  ];
  return (
    <div className="work-presence">
      <span className="presence-dot" />
      <small>
        {names.length ? `${names.length} active recently` : "Live workspace"} ·
        updates refresh automatically
      </small>
      {names.slice(0, 4).map((n) => (
        <span className="presence-avatar" key={n} title={n}>
          {n.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {w.error && <small role="status">Refresh unavailable</small>}
    </div>
  );
}
const tabs = [
  { id: "fields", label: "Custom fields", icon: SlidersHorizontal },
  { id: "schedule", label: "Scheduling", icon: CalendarRange },
  { id: "rules", label: "Automations", icon: Zap },
  { id: "time", label: "Time & costs", icon: Timer },
  { id: "requests", label: "Request intake", icon: Inbox },
  { id: "notes", label: "Live notes", icon: NotebookPen },
  { id: "resources", label: "Resources", icon: Users },
  { id: "reports", label: "Reports", icon: ChartNoAxesCombined },
  { id: "templates", label: "Playbooks", icon: Plus },
] as const;
export default function WorkStudio(props: Props) {
  const [tab, setTab] = useState<string>(() =>
      typeof window !== "undefined" &&
      tabs.some(
        (t) => t.id === new URLSearchParams(window.location.search).get("work"),
      )
        ? new URLSearchParams(window.location.search).get("work")!
        : "fields",
    ),
    w = useWork(props.project, props.onReload);
  function selectTool(id: string) {
    setTab(id);
    const url = new URL(location.href);
    url.searchParams.set("project", props.project.id);
    url.searchParams.set("work", id);
    if (id !== "requests") url.searchParams.delete("form");
    history.replaceState(null, "", url);
  }
  return (
    <section className="work-studio">
      <div className="work-studio-heading">
        <div>
          <span className="eyebrow">WORK STUDIO</span>
          <h2>Shape the way work moves.</h2>
          <p>Plan the work, remove the friction, keep the team moving.</p>
        </div>
        <span className="studio-badge">
          {props.project.tasks.filter((t) => !t.done && !t.archived).length}{" "}
          active tasks
        </span>
      </div>
      <label className="studio-mobile-switch">
        Work studio tool
        <select
          aria-label="Work studio tool"
          value={tab}
          onChange={(e) => selectTool(e.target.value)}
        >
          {tabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <div
        className="studio-tabs"
        role="tablist"
        aria-label="Work studio tools"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            tabIndex={tab === id ? 0 : -1}
            aria-selected={tab === id}
            onKeyDown={(e) => {
              const index = tabs.findIndex((t) => t.id === id),
                next =
                  e.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : e.key === "ArrowLeft"
                      ? (index + tabs.length - 1) % tabs.length
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? tabs.length - 1
                          : -1;
              if (next >= 0) {
                e.preventDefault();
                selectTool(tabs[next].id);
                (
                  e.currentTarget.parentElement?.children[next] as HTMLElement
                )?.focus();
              }
            }}
            onClick={() => selectTool(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {w.error && (
        <p role="alert" className="form-error">
          {w.error}
        </p>
      )}
      <div className="studio-panel" key={tab}>
        {tab === "fields" ? (
          <Fields {...props} />
        ) : tab === "schedule" ? (
          <Scheduling {...props} />
        ) : tab === "rules" ? (
          <Rules {...props} people={w.data?.people || []} />
        ) : tab === "time" ? (
          <TimeCosts {...props} w={w} />
        ) : tab === "requests" ? (
          <Requests {...props} w={w} />
        ) : tab === "notes" ? (
          <LiveNotes {...props} w={w} />
        ) : tab === "resources" ? (
          <ResourcePlanner
            projects={[props.project]}
            onSave={props.onSave}
            readOnly={props.readOnly}
          />
        ) : tab === "templates" ? (
          <Playbooks {...props} w={w} />
        ) : (
          <Reports {...props} />
        )}
      </div>
    </section>
  );
}
function Fields({ project, readOnly, busy, onSave }: Props) {
  const [draft, setDraft] = useState<CustomField>({
      id: "",
      name: "",
      type: "text",
      options: [],
      formula: "",
    }),
    [base, setBase] = useState<Project | null>(null),
    [options, setOptions] = useState("");
  const work = project.work || emptyWork();
  const reset = () => {
    setDraft({ id: "", name: "", type: "text", options: [], formula: "" });
    setOptions("");
    setBase(null);
  };
  return (
    <>
      <div className="studio-intro">
        <h3>Your board, your fields.</h3>
        <p>
          Add the information your function needs. Values appear in the task
          editor and table; formulas update as the work changes.
        </p>
      </div>
      <div className="studio-split">
        <div className="studio-stack">
          {work.fields.map((f) => (
            <article className="studio-item" key={f.id}>
              <div>
                <strong>{f.name}</strong>
                <small>
                  {f.type} · [{f.id}]
                </small>
                {f.formula && <code>{f.formula}</code>}
              </div>
              <Button
                variant="outline"
                disabled={readOnly || busy}
                onClick={() => {
                  setDraft(f);
                  setOptions(f.options.join(", "));
                  setBase(project);
                }}
              >
                Edit
              </Button>
            </article>
          ))}
          {!work.fields.length && (
            <div className="studio-empty">
              <SlidersHorizontal />
              <h4>Make this project fit your work.</h4>
              <p>Try Impact, Effort, Customer, or a calculated value score.</p>
            </div>
          )}
        </div>
        <form
          className="suite-card"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = base || project,
              f = {
                ...draft,
                options: options
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
              w = p.work || emptyWork();
            const fields = base
              ? w.fields.map((x) => (x.id === f.id ? f : x))
              : [...w.fields, f];
            if (await onSave({ ...p, work: { ...w, fields } }, p)) reset();
          }}
        >
          <h3>{base ? "Edit field" : "Add a custom field"}</h3>
          <fieldset className="studio-stack" disabled={readOnly || busy}>
            <label>
              Field name
              <Input
                required
                maxLength={60}
                value={draft.name}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    name: e.target.value,
                    id: base
                      ? draft.id
                      : e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "_")
                          .replace(/^_+|_+$/g, "")
                          .slice(0, 40),
                  })
                }
              />
            </label>
            <label>
              Field key
              <Input
                required
                pattern="[a-z][a-z0-9_]{0,39}"
                disabled={!!base}
                value={draft.id}
                onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              />
            </label>
            <label>
              Field type
              <select
                value={draft.type}
                disabled={!!base}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    type: e.target.value as CustomField["type"],
                  })
                }
              >
                {[
                  "text",
                  "number",
                  "date",
                  "select",
                  "checkbox",
                  "formula",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {draft.type === "select" && (
              <label>
                Options, separated by commas
                <Input
                  required
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </label>
            )}
            {draft.type === "formula" && (
              <label>
                Formula
                <Input
                  required
                  placeholder="[impact] / [effort]"
                  value={draft.formula}
                  maxLength={500}
                  onChange={(e) =>
                    setDraft({ ...draft, formula: e.target.value })
                  }
                />
                <small>
                  Use + − * / and parentheses. Available built-ins: [estimate],
                  [actual] (minutes), [rate], [cost], [complete]. Missing values
                  and division by zero show —.
                </small>
              </label>
            )}
            <Button type="submit" disabled={!base && work.fields.length >= 20}>
              {base ? "Save field" : "Create field"}
            </Button>
            {base && (
              <Button type="button" variant="outline" onClick={reset}>
                Cancel field edit
              </Button>
            )}
          </fieldset>
        </form>
      </div>
    </>
  );
}
function Scheduling({ project, readOnly, busy, onSave }: Props) {
  const [baselineName, setBaselineName] = useState("Original plan"),
    [selected, setSelected] = useState(""),
    [proposal, setProposal] = useState<{ base: Project; tasks: Task[] } | null>(
      null,
    ),
    [external, setExternal] = useState<Project[]>([]);
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<{ projects: Project[] }>)
      .then((b) => setExternal(b.projects || []))
      .catch(() => {});
  }, []);
  const work = project.work || emptyWork(),
    analysis = criticalPath(project.tasks.filter((t) => !t.archived)),
    baseline =
      work.baselines.find((b) => b.id === selected) || work.baselines.at(-1);
  return (
    <>
      <div className="studio-intro">
        <h3>See the chain. Protect the finish.</h3>
        <p>
          Critical path uses task durations and local dependency types in
          calendar days. Missing dates assume one day; external links are
          reviewed separately.
        </p>
      </div>
      <div className="delivery-metrics">
        <div>
          <small>Network duration</small>
          <strong>
            {analysis.finish}
            <span>days</span>
          </strong>
        </div>
        <div>
          <small>Open critical tasks</small>
          <strong>
            {analysis.rows.filter((r) => r.slack === 0 && !r.task.done).length}
          </strong>
        </div>
        <div>
          <small>Saved baselines</small>
          <strong>
            {work.baselines.length}
            <span>/ 5</span>
          </strong>
        </div>
      </div>
      <div className="work-inline">
        <Input
          aria-label="Baseline name"
          value={baselineName}
          maxLength={60}
          onChange={(e) => setBaselineName(e.target.value)}
        />
        <Button
          disabled={
            readOnly ||
            busy ||
            work.baselines.length >= 5 ||
            !baselineName.trim()
          }
          onClick={() =>
            void onSave(
              {
                ...project,
                work: {
                  ...work,
                  baselines: [
                    ...work.baselines,
                    {
                      id: crypto.randomUUID(),
                      name: baselineName,
                      at: new Date().toISOString(),
                      tasks: project.tasks.map((t) => ({
                        id: t.id,
                        start: t.startDate || "",
                        finish: t.dueDate || "",
                      })),
                    },
                  ],
                },
              },
              project,
            )
          }
        >
          Save schedule baseline
        </Button>
        <Button
          variant="outline"
          disabled={readOnly || busy}
          onClick={() =>
            setProposal({
              base: project,
              tasks: reschedule(project.tasks, external),
            })
          }
        >
          Preview dependency reschedule
        </Button>
      </div>
      {proposal && (
        <div className="suite-card">
          <h3>Review date changes</h3>
          {proposal.tasks
            .filter(
              (t) =>
                t.startDate !==
                  proposal.base.tasks.find((x) => x.id === t.id)?.startDate ||
                t.dueDate !==
                  proposal.base.tasks.find((x) => x.id === t.id)?.dueDate,
            )
            .map((t) => (
              <p key={t.id}>
                {t.title}: {t.startDate} → {t.dueDate}
              </p>
            ))}
          <p>
            Moves tasks later to respect available dependency dates. No
            automatic changes to linked projects.
          </p>
          <Button
            disabled={busy}
            onClick={async () => {
              if (
                await onSave(
                  { ...proposal.base, tasks: proposal.tasks },
                  proposal.base,
                )
              )
                setProposal(null);
            }}
          >
            Apply reviewed dates
          </Button>
          <Button variant="outline" onClick={() => setProposal(null)}>
            Cancel reschedule
          </Button>
        </div>
      )}
      <div className="work-inline">
        <label>
          Compare with baseline
          <select
            value={baseline?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Latest baseline</option>
            {work.baselines.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {baseline && !readOnly && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void onSave(
                {
                  ...project,
                  work: {
                    ...work,
                    baselines: work.baselines.filter(
                      (b) => b.id !== baseline.id,
                    ),
                  },
                },
                project,
              )
            }
          >
            Remove baseline
          </Button>
        )}
      </div>
      <div
        className="work-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Schedule analysis"
      >
        <table className="work-table">
          <thead>
            <tr>
              <th>Task / dependency</th>
              <th>Duration</th>
              <th>Slack</th>
              <th>Current dates</th>
              <th>Finish variance</th>
            </tr>
          </thead>
          <tbody>
            {analysis.rows.map(({ task: t, slack }) => {
              const before = baseline?.tasks.find((x) => x.id === t.id);
              return (
                <tr key={t.id}>
                  <th>
                    <span
                      className={slack === 0 && !t.done ? "critical-label" : ""}
                    >
                      {slack === 0 ? "● " : ""}
                      {t.title}
                      {t.done ? " · Complete" : ""}
                    </span>
                    <small>
                      {localLinks(t)
                        .map(
                          (l) =>
                            `${project.tasks.find((x) => x.id === l.taskId)?.title} → ${l.type}${l.lag >= 0 ? "+" : ""}${l.lag}d`,
                        )
                        .join(" · ") || "No local predecessor"}
                    </small>
                    {t.scheduleLinks
                      ?.filter((l) => l.projectId)
                      .map((l, i) => (
                        <small key={i}>
                          ↗{" "}
                          {external.find((p) => p.id === l.projectId)?.name ||
                            "Unavailable project"}{" "}
                          /{" "}
                          {external
                            .find((p) => p.id === l.projectId)
                            ?.tasks.find((x) => x.id === l.taskId)?.title ||
                            "Unavailable task"}{" "}
                          · {l.type}
                          {l.lag >= 0 ? "+" : ""}
                          {l.lag}d
                        </small>
                      ))}
                  </th>
                  <td>
                    {t.startDate && t.dueDate
                      ? dateNumber(t.dueDate) - dateNumber(t.startDate) + 1
                      : "1 (assumed)"}
                    d
                  </td>
                  <td>
                    {slack}d {slack === 0 ? "· Critical" : ""}
                  </td>
                  <td>
                    {t.startDate || "No start"}
                    <br />
                    {t.dueDate || "No finish"}
                  </td>
                  <td>
                    {before?.finish && t.dueDate
                      ? `${dateNumber(t.dueDate) - dateNumber(before.finish) > 0 ? "+" : ""}${dateNumber(t.dueDate) - dateNumber(before.finish)}d`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details className="dependency-network">
        <summary>Explore dependency network</summary>
        <div
          className="work-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Dependency arrow graph"
        >
          <svg
            role="img"
            aria-label="Local task dependency network"
            width="1000"
            height={Math.max(120, analysis.rows.slice(0, 50).length * 65 + 30)}
          >
            <defs>
              <marker
                id="studio-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#ad6b31" />
              </marker>
            </defs>
            {analysis.rows.slice(0, 50).flatMap((row, i) =>
              localLinks(row.task).flatMap((l) => {
                const j = analysis.rows.findIndex(
                  (r) => r.task.id === l.taskId,
                );
                if (j < 0 || j >= 50) return [];
                const x1 =
                    35 +
                    (analysis.rows[j].early / Math.max(1, analysis.finish)) *
                      650 +
                    190,
                  x2 = 35 + (row.early / Math.max(1, analysis.finish)) * 650,
                  y1 = j * 65 + 40,
                  y2 = i * 65 + 40;
                return (
                  <path
                    key={`${row.task.id}:${l.taskId}:${l.type}`}
                    d={`M${x1},${y1} C${x1 + 35},${y1} ${x2 - 35},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke="#ad6b31"
                    strokeWidth="1.5"
                    markerEnd="url(#studio-arrow)"
                  />
                );
              }),
            )}
            {analysis.rows.slice(0, 50).map((r, i) => (
              <g
                key={r.task.id}
                transform={`translate(${35 + (r.early / Math.max(1, analysis.finish)) * 650},${i * 65 + 20})`}
              >
                <title>
                  {r.task.title}: {r.slack} days slack
                </title>
                <rect
                  width="190"
                  height="40"
                  rx="8"
                  fill="var(--card)"
                  stroke={r.slack === 0 ? "#b95330" : "var(--border)"}
                />
                <text x="10" y="25" fill="var(--foreground)" fontSize="11">
                  {r.task.title.slice(0, 27)}
                  {r.task.title.length > 27 ? "…" : ""}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <p>
          Arrows connect up to 50 visible local tasks. The analysis table
          includes the full network.
        </p>
      </details>
      <p className="hub-muted">
        Use Tasks → Timeline to drag dates, or edit dates with the keyboard.
        Completion gates and schedule links are separate controls.
      </p>
    </>
  );
}
function Rules({
  project,
  readOnly,
  busy,
  onSave,
  people,
}: Props & { people: { email: string }[] }) {
  const blank = (): WorkRule => ({
    id: crypto.randomUUID(),
    name: "",
    enabled: true,
    trigger: "status",
    conditions: { mode: "all", conditions: [] },
    action: "priority",
    value: "High",
  });
  const [draft, setDraft] = useState(blank),
    [base, setBase] = useState<Project | null>(null),
    work = project.work || emptyWork();
  return (
    <>
      <div className="studio-intro">
        <h3>When work changes, move it forward.</h3>
        <p>
          Rules run once on a saved task event, in list order. They do not
          recursively trigger other rules. Every application appears in Updates.
        </p>
      </div>
      <div className="studio-split">
        <div className="studio-stack">
          {work.rules.map((r) => (
            <article className="studio-item" key={r.id}>
              <div>
                <strong>{r.name}</strong>
                <small>
                  {r.enabled ? "On" : "Paused"} · {r.trigger} → {r.action}:{" "}
                  {r.value}
                </small>
              </div>
              <Button
                disabled={readOnly || busy}
                variant="outline"
                onClick={() => {
                  setBase(project);
                  setDraft(r);
                }}
              >
                Edit rule
              </Button>
            </article>
          ))}
          {!work.rules.length && (
            <div className="studio-empty">
              <Zap />
              <h4>Let the routine work take care of itself.</h4>
              <p>
                Example: when a task becomes blocked, set High priority and
                notify its sponsor.
              </p>
            </div>
          )}
        </div>
        <form
          className="suite-card"
          onSubmit={async (e) => {
            e.preventDefault();
            const p = base || project,
              w = p.work || emptyWork();
            if (
              await onSave(
                {
                  ...p,
                  work: {
                    ...w,
                    rules: base
                      ? w.rules.map((r) => (r.id === draft.id ? draft : r))
                      : [...w.rules, draft],
                  },
                },
                p,
              )
            ) {
              setDraft(blank());
              setBase(null);
            }
          }}
        >
          <fieldset className="studio-stack" disabled={readOnly || busy}>
            <label>
              Rule name
              <Input
                required
                value={draft.name}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              When
              <select
                value={draft.trigger}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    trigger: e.target.value as WorkRule["trigger"],
                  })
                }
              >
                <option value="created">A task is created</option>
                <option value="status">Workflow changes</option>
                <option value="assigned">Assigned member changes</option>
                <option value="completed">A task is completed</option>
              </select>
            </label>
            <FilterBuilder
              singleGroup
              fields={work.fields}
              value={{ mode: "all", groups: [draft.conditions] }}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  conditions: v.groups[0] || { mode: "all", conditions: [] },
                })
              }
            />
            <p className="rule-preview">
              Applies to{" "}
              {draft.conditions.conditions.length
                ? `${draft.conditions.mode} of: ${draft.conditions.conditions.map((c) => `${c.field} ${c.operator.replace("_", " ")} ${c.value}`).join("; ")}`
                : "every task matching the chosen event"}
              .
            </p>
            <label>
              Then
              <select
                value={draft.action}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    action: e.target.value as WorkRule["action"],
                    value:
                      e.target.value === "priority"
                        ? "High"
                        : e.target.value === "workflow"
                          ? "doing"
                          : "",
                  })
                }
              >
                <option value="priority">Set priority</option>
                <option value="workflow">Set workflow</option>
                <option value="group">Move to group</option>
                <option value="assigneeEmail">Assign a member</option>
                <option value="notify">Send an in-app notification</option>
              </select>
            </label>
            <label>
              Action value
              {["notify", "assigneeEmail"].includes(draft.action) ? (
                <select
                  required
                  value={draft.value}
                  onChange={(e) =>
                    setDraft({ ...draft, value: e.target.value })
                  }
                >
                  <option value="">Choose member</option>
                  {people.map((p) => (
                    <option key={p.email}>{p.email}</option>
                  ))}
                </select>
              ) : draft.action === "priority" || draft.action === "workflow" ? (
                <select
                  value={draft.value}
                  onChange={(e) =>
                    setDraft({ ...draft, value: e.target.value })
                  }
                >
                  {(draft.action === "priority"
                    ? ["High", "Normal", "Low"]
                    : ["todo", "doing", "blocked"]
                  ).map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              ) : (
                <Input
                  required
                  maxLength={60}
                  value={draft.value}
                  onChange={(e) =>
                    setDraft({ ...draft, value: e.target.value })
                  }
                />
              )}
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              Enabled
            </label>
            <Button disabled={!base && work.rules.length >= 20}>
              {base ? "Save rule" : "Create rule"}
            </Button>
            {base && (
              <div className="work-inline">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBase(null);
                    setDraft(blank());
                  }}
                >
                  Cancel rule edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    if (
                      await onSave(
                        {
                          ...base,
                          work: {
                            ...(base.work || emptyWork()),
                            rules: base.work!.rules.filter(
                              (r) => r.id !== draft.id,
                            ),
                          },
                        },
                        base,
                      )
                    ) {
                      setBase(null);
                      setDraft(blank());
                    }
                  }}
                >
                  Delete rule
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </div>
      <p className="hub-muted">
        Use Time & costs for durable scheduled inbox reminders. Email, webhooks,
        and timed background mutations need the future FlightDeck integration.
      </p>
    </>
  );
}
type WorkHook = ReturnType<typeof useWork>;
function TimeCosts({
  project,
  readOnly,
  busy,
  onSave,
  w,
}: Props & { w: WorkHook }) {
  const [taskId, setTaskId] = useState(""),
    [at, setAt] = useState(""),
    [now, setNow] = useState(Date.now()),
    [minutes, setMinutes] = useState(""),
    [expense, setExpense] = useState({
      date: localDate(),
      description: "",
      amount: 0,
      billable: false,
    });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const timer = w.data?.records.find((r) => r.kind === "timer" && !r.closed),
    work = project.work || emptyWork(),
    elapsed = timer
      ? Math.max(0, Math.floor((now - Date.parse(timer.data.startedAt)) / 1000))
      : 0;
  const recorded = project.tasks.reduce(
      (n, t) => n + (numericValue(t, "cost", work.fields) || 0),
      0,
    ),
    billable = project.tasks
      .filter((t) => t.billable)
      .reduce((n, t) => n + (numericValue(t, "cost", work.fields) || 0), 0),
    currency = project.budget?.currency || "EUR";
  return (
    <>
      <div className="studio-intro">
        <h3>Know where the effort goes.</h3>
        <p>
          The stopwatch survives reloads and records a server-timed session on
          stop. Set hourly rates and billable flags in the task editor.
        </p>
      </div>
      <div className="delivery-metrics">
        <div>
          <small>Recorded labor value</small>
          <strong>
            {recorded.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span>{currency}</span>
          </strong>
        </div>
        <div>
          <small>Billable labor value</small>
          <strong>
            {billable.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span>{currency}</span>
          </strong>
        </div>
        <div>
          <small>Expenses</small>
          <strong>
            {work.expenses.reduce((n, e) => n + e.amount, 0).toLocaleString()}
            <span>{currency}</span>
          </strong>
        </div>
      </div>
      <div className="studio-split">
        <section className="suite-card stopwatch-card">
          <Timer />
          <h3>{timer ? timer.data.title : "Task stopwatch"}</h3>
          <output aria-live="off" className="stopwatch-digits">
            {String(Math.floor(elapsed / 3600)).padStart(2, "0")}:
            {String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}:
            {String(elapsed % 60).padStart(2, "0")}
          </output>
          {timer ? (
            <>
              <label>
                Correct worked minutes (optional)
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  placeholder="Use elapsed time"
                />
              </label>
              <div className="work-inline">
                <Button
                  disabled={w.busy || readOnly}
                  onClick={() =>
                    void w.mutate({
                      action: "stop-timer",
                      token: timer.data.token,
                      ...(minutes ? { minutes: Number(minutes) } : {}),
                    })
                  }
                >
                  <Square size={15} />
                  Stop & record
                </Button>
                <Button
                  variant="outline"
                  disabled={w.busy}
                  onClick={() =>
                    void w.mutate({
                      action: "discard-timer",
                      token: timer.data.token,
                    })
                  }
                >
                  Discard session
                </Button>
              </div>
            </>
          ) : (
            <>
              <label>
                Task to track
                <select
                  value={taskId}
                  onChange={(e) => setTaskId(e.target.value)}
                >
                  <option value="">Choose task</option>
                  {project.tasks
                    .filter((t) => !t.done && !t.archived)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                disabled={!taskId || w.busy || readOnly}
                onClick={() =>
                  void w.mutate({
                    action: "start-timer",
                    taskId,
                    token: crypto.randomUUID(),
                  })
                }
              >
                <Play size={15} />
                Start task timer
              </Button>
            </>
          )}
          <small>
            One active timer per user. Sessions round up to the next minute.
            Labor values use current task rates, separate from manually recorded
            budget spend.
          </small>
        </section>
        <form
          className="suite-card"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await w.mutate({
                action: "reminder",
                id: crypto.randomUUID(),
                taskId,
                at: new Date(at).toISOString(),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })
            )
              setAt("");
          }}
        >
          <h3>Remind me in Atlas</h3>
          <label>
            Reminder task
            <select
              required
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
            >
              <option value="">Choose task</option>
              {project.tasks
                .filter((t) => !t.done && !t.archived)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Remind me at · {Intl.DateTimeFormat().resolvedOptions().timeZone}
            <Input
              type="datetime-local"
              required
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <Button
            disabled={!taskId || w.busy || project.id.startsWith("demo-")}
          >
            Schedule inbox reminder
          </Button>
          <p className="hub-muted">
            Saved on the server. Appears in Team hub → Inbox when due, including
            after you reopen Atlas. Completed, archived, or rescheduled tasks
            cancel the reminder.
          </p>
          {w.data?.records
            .filter((r) => r.kind === "reminder" && !r.closed)
            .map((r) => {
              const t = project.tasks.find((t) => t.id === r.data.taskId),
                active =
                  t &&
                  !t.done &&
                  !t.archived &&
                  (t.dueDate || "") === r.data.dueDate;
              return (
                <div className="studio-item" key={r.id}>
                  <div>
                    <strong>{r.data.title}</strong>
                    <small>
                      {active
                        ? new Date(r.available_at).toLocaleString()
                        : "Cancelled by task change"}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void w.mutate({ action: "cancel-reminder", id: r.id })
                    }
                  >
                    Cancel reminder
                  </Button>
                </div>
              );
            })}
        </form>
      </div>
      <form
        className="suite-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await onSave(
              {
                ...project,
                work: {
                  ...work,
                  expenses: [
                    ...work.expenses,
                    { ...expense, id: crypto.randomUUID() },
                  ],
                },
              },
              project,
            )
          )
            setExpense({ ...expense, description: "", amount: 0 });
        }}
      >
        <h3>Expense ledger</h3>
        <fieldset disabled={readOnly || busy} className="work-form-grid">
          <label>
            Expense date
            <Input
              type="date"
              required
              value={expense.date}
              onChange={(e) => setExpense({ ...expense, date: e.target.value })}
            />
          </label>
          <label>
            Description
            <Input
              required
              maxLength={200}
              value={expense.description}
              onChange={(e) =>
                setExpense({ ...expense, description: e.target.value })
              }
            />
          </label>
          <label>
            Amount · {currency}
            <Input
              type="number"
              min={0}
              max={1e9}
              step="0.01"
              required
              value={expense.amount}
              onChange={(e) =>
                setExpense({ ...expense, amount: Number(e.target.value) })
              }
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={expense.billable}
              onChange={(e) =>
                setExpense({ ...expense, billable: e.target.checked })
              }
            />
            Billable expense
          </label>
          <Button disabled={work.expenses.length >= 100}>Record expense</Button>
        </fieldset>
        {work.expenses.map((e) => (
          <div className="studio-item" key={e.id}>
            <span>
              {e.date} · {e.description}
            </span>
            <strong>
              {e.amount.toLocaleString()} {currency}
              {e.billable ? " · Billable" : ""}
            </strong>
            <Button
              type="button"
              variant="outline"
              disabled={readOnly || busy}
              onClick={() =>
                void onSave(
                  {
                    ...project,
                    work: {
                      ...work,
                      expenses: work.expenses.filter((x) => x.id !== e.id),
                    },
                  },
                  project,
                )
              }
            >
              Remove expense
            </Button>
          </div>
        ))}
      </form>
      <Button
        variant="outline"
        onClick={() => {
          const rows = [
            [
              "Task",
              "Date",
              "Minutes",
              "Author",
              "Rate",
              "Currency",
              "Billable",
            ],
            ...project.tasks.flatMap((t) =>
              (t.timeEntries || []).map((e) => [
                t.title,
                e.date,
                e.minutes,
                e.author || "",
                t.hourlyRate ?? "",
                currency,
                t.billable ? "Yes" : "No",
              ]),
            ),
          ];
          downloadText(
            `${project.name}-time.csv`,
            rows
              .map((row) =>
                row
                  .map(
                    (v) =>
                      `"${String(v)
                        .replaceAll('"', '""')
                        .replace(/^[=+@-]/, "'$&")}"`,
                  )
                  .join(","),
              )
              .join("\n"),
          );
        }}
      >
        Export time ledger CSV
      </Button>
    </>
  );
}
function Requests({ project, readOnly, w }: Props & { w: WorkHook }) {
  const [form, setForm] = useState({
      title: "Project request",
      description: "Tell us the outcome you need.",
      reviewer: "",
      enabled: true,
      questions: [] as string[],
    }),
    [editing, setEditing] = useState<RecordItem | null>(null),
    [question, setQuestion] = useState(""),
    [selected, setSelected] = useState(() =>
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("form") || ""
        : "",
    ),
    [request, setRequest] = useState({
      title: "",
      description: "",
      answers: [] as string[],
    }),
    [message, setMessage] = useState(""),
    [reason, setReason] = useState<Record<string, string>>({}),
    requestId = useRef("");
  if (!requestId.current) requestId.current = crypto.randomUUID();
  const forms = w.data?.records.filter((r) => r.kind === "form") || [],
    active =
      forms.find((f) => f.id === selected) || forms.find((f) => f.data.enabled),
    requests = w.data?.records.filter((r) => r.kind === "request") || [];
  return (
    <>
      <div className="studio-intro">
        <h3>A clear front door for new work.</h3>
        <p>
          Collect requests, review the outcome, then approve into a task or a
          new private project. Links follow Atlas access: invite people before
          sharing a form.
        </p>
      </div>
      {message && (
        <p role="status" className="demo-detail">
          {message}
        </p>
      )}
      <div className="studio-split">
        <section className="suite-card">
          <h3>Request forms</h3>
          {forms.map((f) => (
            <article key={f.id} className="studio-item">
              <div>
                <strong>{f.data.title}</strong>
                <small>
                  {f.data.enabled ? "Open" : "Closed"} · Reviewer:{" "}
                  {f.data.reviewer}
                </small>
              </div>
              <div className="work-inline">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelected(f.id);
                    setRequest({ title: "", description: "", answers: [] });
                  }}
                >
                  Open form
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${location.origin}/?project=${project.id}&work=requests&form=${f.id}`,
                      );
                      setMessage(
                        "Form link copied. Recipients need Atlas and project access.",
                      );
                    } catch {
                      setMessage("Copy is unavailable in this browser.");
                    }
                  }}
                >
                  Copy link
                </Button>
                {!readOnly && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(f);
                      setForm(f.data as typeof form);
                    }}
                  >
                    Edit form
                  </Button>
                )}
              </div>
            </article>
          ))}
          {!forms.length && (
            <p>
              Create a form to collect requests from members with project
              access.
            </p>
          )}
          {!readOnly && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await w.mutate({
                    action: "form",
                    id: editing?.id || crypto.randomUUID(),
                    revision: editing?.revision || 0,
                    data: { ...form, reviewer: form.reviewer || w.data?.email },
                  })
                ) {
                  setEditing(null);
                  setForm({
                    title: "Project request",
                    description: "",
                    reviewer: "",
                    enabled: true,
                    questions: [],
                  });
                }
              }}
            >
              <fieldset className="studio-stack" disabled={w.busy}>
                <h4>{editing ? "Edit request form" : "Create request form"}</h4>
                <label>
                  Form title
                  <Input
                    required
                    maxLength={100}
                    value={form.title}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  Form introduction
                  <Textarea
                    maxLength={1000}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </label>
                <label>
                  Request reviewer
                  <select
                    value={form.reviewer || w.data?.email || ""}
                    onChange={(e) =>
                      setForm({ ...form, reviewer: e.target.value })
                    }
                  >
                    {w.data?.people.map((p) => (
                      <option key={p.email}>{p.email}</option>
                    ))}
                  </select>
                </label>
                <small>
                  Approval also requires project editing permission.
                </small>
                {form.questions.map((q, i) => (
                  <div className="work-inline" key={i}>
                    <span>
                      {i + 1}. {q}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setForm({
                          ...form,
                          questions: form.questions.filter((_, n) => n !== i),
                        })
                      }
                    >
                      Remove question
                    </Button>
                  </div>
                ))}
                <label>
                  Add a required question
                  <Input
                    value={question}
                    maxLength={160}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!question.trim() || form.questions.length >= 8}
                  onClick={() => {
                    setForm({
                      ...form,
                      questions: [...form.questions, question.trim()],
                    });
                    setQuestion("");
                  }}
                >
                  Add question
                </Button>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) =>
                      setForm({ ...form, enabled: e.target.checked })
                    }
                  />
                  Accept requests
                </label>
                <Button>
                  {editing ? "Save request form" : "Create request form"}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditing(null)}
                  >
                    Cancel form edit
                  </Button>
                )}
              </fieldset>
            </form>
          )}
        </section>
        <section className="suite-card">
          {active ? (
            <form
              key={active.id}
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await w.mutate({
                    action: "submit-request",
                    id: requestId.current,
                    formId: active.id,
                    ...request,
                  })
                ) {
                  requestId.current = crypto.randomUUID();
                  setRequest({ title: "", description: "", answers: [] });
                  setMessage(
                    "Request submitted for review. Track its outcome below.",
                  );
                }
              }}
            >
              <h3>{active.data.title}</h3>
              <p>{active.data.description}</p>
              <fieldset
                className="studio-stack"
                disabled={!active.data.enabled || w.busy}
              >
                <label>
                  Request title
                  <Input
                    required
                    value={request.title}
                    maxLength={200}
                    onChange={(e) =>
                      setRequest({ ...request, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  Desired outcome
                  <Textarea
                    value={request.description}
                    maxLength={2000}
                    onChange={(e) =>
                      setRequest({ ...request, description: e.target.value })
                    }
                  />
                </label>
                {(active.data.questions as string[]).map((q, i) => (
                  <label key={i}>
                    {q}
                    <Textarea
                      required
                      maxLength={1000}
                      value={request.answers[i] || ""}
                      onChange={(e) => {
                        const answers = [...request.answers];
                        answers[i] = e.target.value;
                        setRequest({ ...request, answers });
                      }}
                    />
                  </label>
                ))}
                <Button>Submit request</Button>
              </fieldset>
            </form>
          ) : (
            <div className="studio-empty">
              <Inbox />
              <h4>No open form yet.</h4>
              <p>
                Your approved requests will become real work, with a recorded
                decision.
              </p>
            </div>
          )}
        </section>
      </div>
      <h3>
        Request inbox ·{" "}
        {requests.filter((r) => r.data.status === "submitted").length} awaiting
        review
      </h3>
      <div className="studio-stack">
        {requests.map((r) => (
          <article key={r.id} className="suite-card">
            <div className="section-heading">
              <h4>{r.data.title}</h4>
              <span className="studio-badge">{r.data.status}</span>
            </div>
            <small>
              {r.data.submittedBy} · {new Date(r.updated_at).toLocaleString()}
            </small>
            <p>{r.data.description}</p>
            {(r.data.questions as string[]).map((q, i) => (
              <p key={i}>
                <strong>{q}</strong>
                <br />
                {r.data.answers[i]}
              </p>
            ))}
            {r.data.reason && (
              <p>
                <strong>Decision:</strong> {r.data.reason} · {r.data.reviewedBy}
              </p>
            )}
            {r.data.targetType === "project" && (
              <a href={`/?project=${r.data.targetId}`}>
                Open created project →
              </a>
            )}
            {r.data.targetType === "task" && (
              <p>Added to this project’s Tasks → Intake group.</p>
            )}
            {r.data.status === "submitted" && !readOnly && (
              <>
                <label>
                  Review decision and reason
                  <Textarea
                    required
                    maxLength={1000}
                    value={reason[r.id] || ""}
                    onChange={(e) =>
                      setReason({ ...reason, [r.id]: e.target.value })
                    }
                  />
                </label>
                <div className="work-inline">
                  {[
                    ["task", "Approve → task"],
                    ["project", "Approve → new project"],
                    ["reject", "Decline request"],
                  ].map(([decision, label]) => (
                    <Button
                      key={decision}
                      disabled={w.busy || !reason[r.id]?.trim()}
                      variant={decision === "reject" ? "outline" : "default"}
                      onClick={() =>
                        void w.mutate({
                          action: "review-request",
                          id: r.id,
                          revision: r.revision,
                          decision,
                          reason: reason[r.id],
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
      {w.data?.requestsCursor && (
        <Button variant="outline" onClick={() => void w.loadOlder()}>
          Load older requests
        </Button>
      )}
    </>
  );
}
function LiveNotes({ readOnly, w }: Props & { w: WorkHook }) {
  const [draft, setDraft] = useState({ title: "", body: "" }),
    [editing, setEditing] = useState<RecordItem | null>(null),
    id = useRef("");
  if (!id.current) id.current = crypto.randomUUID();
  const blocks = w.data?.records.filter((r) => r.kind === "block") || [];
  return (
    <>
      <div className="studio-intro">
        <h3>One shared place to think.</h3>
        <p>
          Keep decisions, working notes, and handover context in editable
          blocks. Different blocks can be edited simultaneously; conflicting
          edits to the same block preserve your draft.
        </p>
      </div>
      <div className="studio-split">
        <div className="studio-stack">
          {blocks.map((b) => (
            <article className="suite-card" key={b.id}>
              <h3>{b.data.title}</h3>
              <p className="note-content">{b.data.body}</p>
              <small>
                Updated {new Date(b.updated_at).toLocaleString()} · version{" "}
                {b.revision}
              </small>
              {!readOnly && (
                <div className="work-inline">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditing(b);
                      setDraft({ title: b.data.title, body: b.data.body });
                    }}
                  >
                    Edit note block
                  </Button>
                  <Button
                    variant="outline"
                    disabled={w.busy}
                    onClick={() =>
                      void w.mutate({
                        action: "delete-block",
                        id: b.id,
                        revision: b.revision,
                      })
                    }
                  >
                    Remove block
                  </Button>
                </div>
              )}
            </article>
          ))}
          {!blocks.length && (
            <div className="studio-empty">
              <NotebookPen />
              <h4>Put the context next to the work.</h4>
              <p>Add your first shared note.</p>
            </div>
          )}
        </div>
        {!readOnly && (
          <form
            className="suite-card"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await w.mutate({
                  action: "block",
                  id: editing?.id || id.current,
                  revision: editing?.revision || 0,
                  data: draft,
                })
              ) {
                id.current = crypto.randomUUID();
                setEditing(null);
                setDraft({ title: "", body: "" });
              }
            }}
          >
            <fieldset className="studio-stack" disabled={w.busy}>
              <h3>{editing ? "Edit shared block" : "Add shared block"}</h3>
              {editing &&
                blocks.find((b) => b.id === editing.id)?.revision !==
                  editing.revision && (
                  <p role="status" className="form-error">
                    Someone changed this block. Copy your draft before
                    cancelling, then reopen the latest version.
                  </p>
                )}
              <label>
                Block title
                <Input
                  required
                  maxLength={100}
                  value={draft.title}
                  onChange={(e) =>
                    setDraft({ ...draft, title: e.target.value })
                  }
                />
              </label>
              <label>
                Shared note
                <Textarea
                  rows={10}
                  maxLength={5000}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </label>
              <Button>{editing ? "Save note block" : "Add note block"}</Button>
              {editing && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    setDraft({ title: "", body: "" });
                  }}
                >
                  Cancel note edit
                </Button>
              )}
            </fieldset>
          </form>
        )}
      </div>
    </>
  );
}
export function ResourcePlanner({
  projects,
  onSave,
  readOnly = false,
}: {
  projects: Project[];
  onSave: (f: ProjectFields, p?: Project) => Promise<Project | null>;
  readOnly?: boolean;
}) {
  const w = useWorkspace(),
    [all, setAll] = useState<Project[]>([]),
    [weeks, setWeeks] = useState(4),
    [anchor, setAnchor] = useState(localDate()),
    [selected, setSelected] = useState(""),
    [owner, setOwner] = useState(""),
    [date, setDate] = useState(localDate()),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<{ projects: Project[] }>)
      .then((b) => setAll(b.projects || []))
      .catch(() => {});
  }, [projects.map((p) => `${p.id}:${p.revision}`).join(",")]);
  const portfolio = [
      ...all.filter((p) => !projects.some((x) => x.id === p.id)),
      ...projects,
    ].filter((p) => !p.archived),
    rows = portfolio.flatMap((p) =>
      p.tasks.filter((t) => !t.done && !t.archived).map((t) => ({ p, t })),
    ),
    people = [
      ...new Set([
        ...rows.map(({ t }) => t.assigneeEmail || t.assignee || "Unassigned"),
        ...(w.data?.capacity || []).map((p) => p.email),
      ]),
    ].sort();
  const selectedRow = rows.find(({ p, t }) => `${p.id}:${t.id}` === selected),
    base = dateNumber(anchor),
    monday = base - ((new Date(base * 86400000).getUTCDay() + 6) % 7),
    starts = Array.from({ length: weeks }, (_, i) => monday + i * 7);
  function hours(email: string, start: number) {
    return rows
      .filter(
        ({ t }) => (t.assigneeEmail || t.assignee || "Unassigned") === email,
      )
      .reduce((n, { t }) => {
        const a = t.startDate || t.plannedDate || t.dueDate,
          b = t.dueDate || a;
        if (!a || !b) return n;
        const begin = dateNumber(a),
          finish = Math.max(begin, dateNumber(b));
        const business = (s: number, e: number) => {
          let count = 0;
          for (let d = s; d <= e && d - s < 10000; d++) {
            const day = new Date(d * 86400000).getUTCDay();
            if (day !== 0 && day !== 6) count++;
          }
          return count;
        };
        const total = business(begin, finish) || 1,
          overlap = business(
            Math.max(begin, start),
            Math.min(finish, start + 6),
          );
        return n + (((t.estimateMinutes || 0) / 60) * overlap) / total;
      }, 0);
  }
  function capacity(email: string, start: number) {
    const p =
      email === w.data?.email
        ? w.data.preferences
        : w.data?.capacity.find((p) => p.email === email);
    if (!p) return null;
    return Math.max(
      0,
      p.weeklyHours -
        (p.leaveDays.filter(
          (d) => dateNumber(d) >= start && dateNumber(d) < start + 5,
        ).length *
          p.weeklyHours) /
          5,
    );
  }
  return (
    <section className="resource-planner">
      <div className="studio-intro">
        <h3>Balance the next few weeks.</h3>
        <p>
          Estimated effort spreads across scheduled weekdays. Shared capacity
          accounts for leave; unavailable capacity stays unknown. Only projects
          you can access are included.
        </p>
      </div>
      <div className="work-inline">
        <label>
          Planner date
          <Input
            type="date"
            required
            value={anchor}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
          />
        </label>
        <label>
          Planning horizon
          <select
            value={weeks}
            onChange={(e) => setWeeks(Number(e.target.value))}
          >
            <option value={2}>2 weeks</option>
            <option value={4}>4 weeks</option>
            <option value={8}>8 weeks</option>
          </select>
        </label>
      </div>
      <div
        className="work-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Resource planning grid"
      >
        <table className="work-table resource-grid">
          <thead>
            <tr>
              <th>Person</th>
              {starts.map((d) => (
                <th key={d}>Week of {dateFrom(d).slice(5)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person}>
                <th>{person}</th>
                {starts.map((d) => {
                  const h = hours(person, d),
                    cap = capacity(person, d);
                  return (
                    <td
                      key={d}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        setSelected(e.dataTransfer.getData("text/plain"));
                        setOwner(person === "Unassigned" ? "" : person);
                        setDate(dateFrom(d));
                      }}
                      className={cap !== null && h > cap ? "resource-over" : ""}
                    >
                      <strong>{h.toFixed(1)}h</strong>
                      <small>
                        {cap === null
                          ? "Capacity not shared"
                          : `${cap.toFixed(1)}h capacity`}
                      </small>
                      {cap !== null && h > cap && (
                        <span>Over by {(h - cap).toFixed(1)}h</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hub-muted">
        {
          rows.filter(({ t }) => !t.startDate && !t.plannedDate && !t.dueDate)
            .length
        }{" "}
        unscheduled tasks are excluded. Drag a task onto a week, or use the
        controls below, then review the change.
      </p>
      <div className="resource-task-chips">
        {rows.slice(0, 60).map(({ p, t }) => (
          <button
            key={`${p.id}:${t.id}`}
            draggable={!readOnly && p.canEdit !== false}
            onDragStart={(e) =>
              e.dataTransfer.setData("text/plain", `${p.id}:${t.id}`)
            }
            onClick={() => {
              setSelected(`${p.id}:${t.id}`);
              setOwner(t.assigneeEmail || "");
              setDate(t.startDate || t.plannedDate || localDate());
            }}
          >
            {t.title}
            <small>{p.name}</small>
          </button>
        ))}
      </div>
      <form
        className="suite-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!selectedRow) return;
          setBusy(true);
          try {
            const { p, t } = selectedRow,
              span =
                t.startDate && t.dueDate
                  ? dateNumber(t.dueDate) - dateNumber(t.startDate)
                  : 0;
            const result = await onSave(
              {
                ...p,
                tasks: p.tasks.map((x) =>
                  x.id === t.id
                    ? {
                        ...x,
                        assigneeEmail: owner,
                        assignee: owner,
                        startDate: date,
                        dueDate: dateFrom(dateNumber(date) + span),
                        plannedDate: date,
                      }
                    : x,
                ),
              },
              p,
            );
            if (result) {
              setAll((old) =>
                old.map((p) => (p.id === result.id ? result : p)),
              );
              setMessage("Resource assignment and dates saved.");
              setSelected("");
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset
          className="work-form-grid"
          disabled={busy || readOnly || selectedRow?.p.canEdit === false}
        >
          <label>
            Task to schedule
            <select
              required
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                const row = rows.find(
                  ({ p, t }) => `${p.id}:${t.id}` === e.target.value,
                );
                if (row) {
                  setOwner(row.t.assigneeEmail || "");
                  setDate(row.t.startDate || row.t.plannedDate || localDate());
                }
              }}
            >
              <option value="">Choose task</option>
              {rows.map(({ p, t }) => (
                <option key={`${p.id}:${t.id}`} value={`${p.id}:${t.id}`}>
                  {p.name} / {t.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assign to member
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Unassigned</option>
              {w.data?.people.map((p) => (
                <option key={p.email}>{p.email}</option>
              ))}
            </select>
          </label>
          <label>
            Move start to
            <Input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <Button disabled={!selectedRow}>Apply assignment & dates</Button>
        </fieldset>
        {selectedRow && (
          <p>
            Review: {selectedRow.t.title} → {owner || "Unassigned"}, starting{" "}
            {date}. Duration is preserved. The server checks the member’s
            project access.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
export function ReportWidgets({
  project,
  compact = false,
}: {
  project: Project;
  compact?: boolean;
}) {
  const work = project.work || emptyWork();
  return (
    <div className="report-widget-grid">
      {work.widgets.map((w) => {
        const matching = project.tasks.filter(
          (t) => !t.archived && matchesGroup(t, w.filter, work.fields),
        );
        const value = widgetValue(
            project.tasks.filter((t) => !t.archived),
            w,
            work.fields,
          ),
          scale = Math.max(
            1,
            ...matching.map((t) =>
              Math.abs(numericValue(t, w.metric, work.fields) || 0),
            ),
          );
        return (
          <article key={w.id} className="report-widget">
            <small>
              {compact ? `${project.name} · ` : ""}
              {w.name}
            </small>
            <strong>
              {value === null
                ? "—"
                : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </strong>
            <span>
              {w.aggregate === "count"
                ? "Matching tasks"
                : `${w.aggregate} · ${{ estimate: "estimated minutes", actual: "logged minutes", cost: "labor value", complete: "completed tasks" }[w.metric] || work.fields.find((f) => f.id === w.metric)?.name || w.metric}`}
            </span>
            {w.display === "bars" && !compact && (
              <div className="metric-bars">
                {matching.slice(0, 12).map((t) => (
                  <div key={t.id}>
                    <span>{t.title}</span>
                    <i
                      style={{
                        width: `${(Math.abs(numericValue(t, w.metric, work.fields) || 0) / scale) * 100}%`,
                      }}
                    />
                    <small>
                      {numericValue(t, w.metric, work.fields)?.toLocaleString(
                        undefined,
                        { maximumFractionDigits: 1 },
                      ) ?? "—"}
                    </small>
                  </div>
                ))}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
function Reports({ project, readOnly, busy, onSave }: Props) {
  const blank = (): WorkWidget => ({
    id: crypto.randomUUID(),
    name: "",
    metric: "estimate",
    aggregate: "sum",
    filter: { mode: "all", conditions: [] },
    display: "number",
  });
  const [draft, setDraft] = useState(blank),
    [base, setBase] = useState<Project | null>(null),
    work = project.work || emptyWork();
  return (
    <>
      <div className="studio-intro">
        <h3>The measures that matter to you.</h3>
        <p>
          Build project widgets from task data and custom formulas. Saved
          widgets also appear on your main dashboard.
        </p>
      </div>
      <ReportWidgets project={project} />
      <form
        className="suite-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const p = base || project,
            w = p.work || emptyWork();
          if (
            await onSave(
              {
                ...p,
                work: {
                  ...w,
                  widgets: base
                    ? w.widgets.map((x) => (x.id === draft.id ? draft : x))
                    : [...w.widgets, draft],
                },
              },
              p,
            )
          ) {
            setBase(null);
            setDraft(blank());
          }
        }}
      >
        <fieldset disabled={readOnly || busy} className="studio-stack">
          <div className="work-form-grid">
            <label>
              Widget name
              <Input
                required
                maxLength={80}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Metric
              <select
                value={draft.metric}
                onChange={(e) => setDraft({ ...draft, metric: e.target.value })}
              >
                {[
                  { id: "estimate", name: "Estimated minutes" },
                  { id: "actual", name: "Logged minutes" },
                  { id: "cost", name: "Labor value" },
                  { id: "complete", name: "Completed tasks" },
                  ...work.fields.filter((f) =>
                    ["number", "formula", "checkbox"].includes(f.type),
                  ),
                ].map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Calculation
              <select
                value={draft.aggregate}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    aggregate: e.target.value as WorkWidget["aggregate"],
                  })
                }
              >
                {["sum", "average", "count", "min", "max"].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              Display
              <select
                value={draft.display}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    display: e.target.value as WorkWidget["display"],
                  })
                }
              >
                <option value="number">Number</option>
                <option value="bars">Number and task bars</option>
              </select>
            </label>
          </div>
          <FilterBuilder
            singleGroup
            fields={work.fields}
            value={{ mode: "all", groups: [draft.filter] }}
            onChange={(v) =>
              setDraft({
                ...draft,
                filter: v.groups[0] || { mode: "all", conditions: [] },
              })
            }
          />
          <Button disabled={!base && work.widgets.length >= 12}>
            {base ? "Save widget" : "Add dashboard widget"}
          </Button>
          {base && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setBase(null);
                setDraft(blank());
              }}
            >
              Cancel widget edit
            </Button>
          )}
        </fieldset>
      </form>
      {work.widgets.map((widget, i) => (
        <div className="studio-item" key={widget.id}>
          <strong>{widget.name}</strong>
          <div className="work-inline">
            <Button
              variant="outline"
              disabled={readOnly || busy}
              onClick={() => {
                setDraft(widget);
                setBase(project);
              }}
            >
              Edit widget
            </Button>
            <Button
              variant="outline"
              disabled={readOnly || busy || i === 0}
              onClick={() => {
                const widgets = [...work.widgets];
                [widgets[i - 1], widgets[i]] = [widgets[i], widgets[i - 1]];
                void onSave(
                  { ...project, work: { ...work, widgets } },
                  project,
                );
              }}
            >
              Move up
            </Button>
            <Button
              variant="outline"
              disabled={readOnly || busy}
              onClick={() =>
                void onSave(
                  {
                    ...project,
                    work: {
                      ...work,
                      widgets: work.widgets.filter((x) => x.id !== widget.id),
                    },
                  },
                  project,
                )
              }
            >
              Remove widget
            </Button>
          </div>
        </div>
      ))}
    </>
  );
}

export function ActiveTaskTimer() {
  const [timer, setTimer] = useState<{
      token: string;
      title: string;
      projectId: string | null;
      startedAt: string;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/work?timer=active");
        if (r.ok) {
          const b = (await r.json()) as { timer: typeof timer };
          setTimer(b.timer);
        }
      } catch {}
    };
    void load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    return () => clearInterval(interval);
  }, []);
  if (!timer) return null;
  return (
    <div className="active-task-timer">
      <Timer size={16} />
      <span>
        Tracking: <strong>{timer.title}</strong>
      </span>
      {timer.projectId && (
        <a href={`/?project=${timer.projectId}&work=time`}>Open timer →</a>
      )}
      <button
        onClick={async () => {
          const r = await fetch("/api/work", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "discard-timer",
              token: timer.token,
            }),
          });
          if (r.ok) setTimer(null);
          else setError("Could not discard the timer. Retry.");
        }}
      >
        Discard session
      </button>
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

function Playbooks({ project, readOnly, w }: Props & { w: WorkHook }) {
  const [name, setName] = useState("Team delivery playbook"),
    [targets, setTargets] = useState<Project[]>([]),
    [targetId, setTargetId] = useState(""),
    [preview, setPreview] = useState<{
      record: RecordItem;
      target: Project;
      tasks: Task[];
    } | null>(null);
  const refresh = useCallback(() => {
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
  }, [project.id]);
  useEffect(refresh, [refresh]);
  const templates = w.data?.records.filter((r) => r.kind === "template") || [];
  return (
    <>
      <div className="studio-intro">
        <h3>A repeatable way to deliver.</h3>
        <p>
          Capture active task structure as a versioned playbook. Apply it to
          another project, then review future updates before they reach that
          team.
        </p>
      </div>
      <form
        className="suite-card"
        onSubmit={async (e) => {
          e.preventDefault();
          await w.mutate({
            action: "template-save",
            id: crypto.randomUUID(),
            revision: 0,
            projectRevision: project.revision,
            name,
          });
        }}
      >
        <label>
          Playbook name
          <Input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button disabled={readOnly || w.busy}>Capture current tasks</Button>
        <p>
          Includes titles, descriptions, estimates, priority, groups,
          milestones, parent structure, and local dependencies. People, dates,
          time records, and external links stay with their projects.
        </p>
      </form>
      <label>
        Target project
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">Choose an editable project</option>
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {templates.map((t) => (
        <article className="suite-card" key={t.id}>
          <div className="section-heading">
            <h3>{t.data.name}</h3>
            <span>
              Version {t.revision} · {t.data.tasks.length} tasks
            </span>
          </div>
          <div className="work-inline">
            <Button
              variant="outline"
              disabled={readOnly || w.busy}
              onClick={() =>
                void w.mutate({
                  action: "template-save",
                  id: t.id,
                  revision: t.revision,
                  projectRevision: project.revision,
                  name: t.data.name,
                })
              }
            >
              Capture next version
            </Button>
            <Button
              disabled={!targetId || readOnly || w.busy}
              onClick={() => {
                const target = targets.find((p) => p.id === targetId)!;
                setPreview({
                  record: t,
                  target,
                  tasks: applyTemplate(
                    target.tasks,
                    t.data as WorkTemplate,
                    project.id,
                    t.id,
                    t.revision,
                  ),
                });
              }}
            >
              Preview in target project
            </Button>
          </div>
        </article>
      ))}
      {preview && (
        <div className="suite-card">
          <h3>Review changes for {preview.target.name}</h3>
          <p>
            Existing playbook tasks keep progress, owners, dates, and local
            dependency edits. Titles, descriptions, estimates, groups,
            priorities, and milestones update. Removed source tasks remain in
            the target for review.
          </p>
          {preview.tasks
            .filter(
              (t) =>
                JSON.stringify(t) !==
                JSON.stringify(preview.target.tasks.find((x) => x.id === t.id)),
            )
            .map((t) => (
              <p key={t.id}>
                {preview.target.tasks.some((x) => x.id === t.id)
                  ? "Update"
                  : "Add"}
                : {t.title} · {t.estimateMinutes || 0} min
              </p>
            ))}
          <Button
            disabled={w.busy}
            onClick={async () => {
              if (
                await w.mutate({
                  action: "template-apply",
                  id: preview.record.id,
                  revision: preview.record.revision,
                  targetId: preview.target.id,
                  targetRevision: preview.target.revision,
                })
              ) {
                setPreview(null);
                refresh();
              }
            }}
          >
            Apply reviewed playbook
          </Button>
          <Button variant="outline" onClick={() => setPreview(null)}>
            Cancel playbook preview
          </Button>
        </div>
      )}
    </>
  );
}
