"use client";
// The onboarding brain's web surface: a pipeline board by stage and one
// project's brain beside it.
//
// It is deliberately thin. Every rule (who may pass a gate, which
// prerequisites are missing, which classification is blocked) is decided by
// the server in lib/onboarding/routes.ts and only *shown* here: a button that
// would be refused is disabled, and a refusal is printed as it came back. No
// figure is computed in the browser, and no value is ever labelled "measured"
// unless its record says so.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/lib/i18n/react";
import BrainWizard from "./brain-wizard";
import BrainAnalysisPanel, { type SectionAnchor } from "./brain-analysis";
import type { BrainView } from "@/lib/domain/brain-view";
import { STAGES, RETIRED } from "@/lib/domain/stages";
type Workspace = { id: string; name: string; slug: string; role?: string };
type ListRow = {
  projectId: string;
  name: string;
  stage: string;
  status: string;
  revision: number;
  updatedAt: string;
};
const CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "export-restricted",
  "itar",
  "cui",
  "customer-pii",
] as const;
const KINDS = ["recording", "voice", "document", "connector", "interview", "capture"] as const;
/** Only the editable keys, and only as form values: a null becomes "", a
 * boolean stays a boolean. */
function initialFields(
  data: Record<string, unknown> | undefined,
): Record<string, string | boolean> {
  if (!data) return {};
  return Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) => typeof value === "string" || typeof value === "boolean",
    ),
  ) as Record<string, string | boolean>;
}
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
/** Jump to the section that does the next action, and mark it so the eye
 * follows: the analysis says what to do, this takes you there. */
function focusSection(anchor: SectionAnchor) {
  const target = document.getElementById(`brain-section-${anchor}`);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.add("is-focus");
  window.setTimeout(() => target.classList.remove("is-focus"), 1400);
}
export default function BrainLane() {
  const t = useT();
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<BrainView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [startId, setStartId] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [roleDraft, setRoleDraft] = useState({ role: "process_owner", email: "" });
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string | boolean>>({});
  const [reuseReason, setReuseReason] = useState("");
  const [gateReason, setGateReason] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    // No setState before the first await: a synchronous setState inside the
    // mount effect is what the hooks lint refuses, and it also makes the
    // first paint flash an empty error.
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { projects: ListRow[] };
      setRows(body.projects);
    } catch {
      setError(t("brain.error"));
    }
  }, [t]);
  useEffect(() => {
    // State is set from the promise callbacks, never synchronously in the
    // effect body: the first paint stays the loading line, and the hooks lint
    // rule about cascading renders is satisfied by construction.
    let live = true;
    fetch("/api/onboarding", { cache: "no-store" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ projects: ListRow[] }>)
          : Promise.reject(new Error(String(response.status))),
      )
      .then((body) => live && setRows(body.projects))
      .catch(() => live && setError(t("brain.error")));
    // The projects this person may edit: the intake can only be opened where
    // they already have edit rights, which the API checks again.
    fetch("/api/projects", { cache: "no-store" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              projects: { id: string; name: string; canEdit?: boolean }[];
            }>)
          : Promise.reject(new Error(String(response.status))),
      )
      .then(
        (body) =>
          live &&
          setCandidates(
            body.projects
              .filter((project) => project.canEdit !== false)
              .map((project) => ({ id: project.id, name: project.name })),
          ),
      )
      .catch(() => live && setCandidates([]));
    fetch("/api/workspaces", { cache: "no-store" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ workspaces: Workspace[] }>)
          : Promise.reject(new Error(String(response.status))),
      )
      .then((body) => {
        if (!live) return;
        setWorkspaces(body.workspaces);
        setWorkspaceId((current) => current || body.workspaces[0]?.id || "");
      })
      .catch(() => live && setWorkspaces([]));
    return () => {
      live = false;
    };
  }, [t]);
  const open = useCallback(
    async (id: string) => {
      setSelected(id);
      setView(null);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch(`/api/onboarding/${id}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as BrainView;
        setView(body);
        setFields(initialFields(body.data));
      } catch {
        setError(t("brain.detailError"));
      }
    },
    [t],
  );
  // A direct link from the app (or a bookmark): ?view=brain&project=<id>
  // opens that project's brain once the list has loaded. State is set from a
  // promise callback so the mount path stays free of synchronous setState.
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("project");
    if (!target || !rows?.some((row) => row.projectId === target)) return;
    if (selected === target) return;
    void Promise.resolve().then(() => open(target));
  }, [rows, selected, open]);
  // Start an intake on a project the person may edit. The lane is the only
  // place that opens one; the API (POST /api/onboarding/:id) does the rest.
  const startIntake = useCallback(async () => {
    if (!startId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/onboarding/${startId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setNotice(payload.error ?? t("brain.start.failed"));
        return;
      }
      const chosen = startId;
      setStartId("");
      const refreshed = await fetch("/api/onboarding", { cache: "no-store" });
      if (refreshed.ok) {
        const body = (await refreshed.json()) as { projects: ListRow[] };
        setRows(body.projects);
      }
      await open(chosen);
      // After open(): open() clears the notice, so a message set before it
      // would flash and vanish.
      setNotice(t("brain.start.done"));
    } catch {
      setNotice(t("brain.start.failed"));
    } finally {
      setBusy(false);
    }
  }, [startId, t, open]);
  /** The one flow that creates a project AND opens its intake, so a person
   * never leaves the lane to start onboarding. Two calls, in order: Atlas's
   * existing project create, then the intake on its id. Returns whether the
   * wizard may close. */
  const createOnboard = useCallback(
    async (input: { kind: "project" | "process"; name: string; problem: string }) => {
      const name = input.name.trim();
      if (!name) return false;
      if (!workspaceId) {
        setNotice(t("brain.create.workspaceRequired"));
        return false;
      }
      setBusy(true);
      try {
        const created = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            description: "",
            status: "In progress",
            category: input.kind === "process" ? "Process" : "Project",
            location: "",
            latitude: null,
            longitude: null,
            dueDate: "",
            color: "orange",
            tasks: [],
          }),
        });
        const createdBody = (await created.json().catch(() => ({}))) as {
          error?: string;
          project?: { id: string };
        };
        if (!created.ok || !createdBody.project?.id) {
          setNotice(createdBody.error ?? t("brain.onboard.failed"));
          return false;
        }
        const id = createdBody.project.id;
        const opened = await fetch(`/api/onboarding/${id}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entryType: input.kind,
            workspaceId,
            problem: input.problem,
            ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
          }),
        });
        if (!opened.ok) {
          const payload = (await opened.json().catch(() => ({}))) as { error?: string };
          setNotice(payload.error ?? t("brain.onboard.failed"));
          return false;
        }
        const refreshed = await fetch("/api/onboarding", { cache: "no-store" });
        if (refreshed.ok) {
          const body = (await refreshed.json()) as { projects: ListRow[] };
          setRows(body.projects);
        }
        await open(id);
        setNotice(t("brain.onboard.done"));
        return true;
      } catch {
        setNotice(t("brain.onboard.failed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, ownerEmail, t, open],
  );
  const assignRole = useCallback(async () => {
    if (!view) return;
    const email = roleDraft.email.trim();
    if (!email) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/onboarding/${view.record.projectId}/roles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: roleDraft.role, email }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setNotice(payload.error ?? t("brain.roles.failed"));
        return;
      }
      setView((await response.json()) as BrainView);
      setNotice(t("brain.roles.assigned"));
    } catch {
      setNotice(t("brain.roles.failed"));
    } finally {
      setBusy(false);
    }
  }, [view, roleDraft, t]);
  const send = useCallback(
    async (
      path: string,
      method: string,
      body: unknown,
    ): Promise<{ ok: boolean; message: string }> => {
      setBusy(true);
      try {
        const response = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
          problems?: string[];
          missing?: string[];
        };
        if (!response.ok) {
          const missing = payload.missing?.length
            ? ` (${payload.missing.join(", ")})`
            : "";
          const problems = payload.problems?.length
            ? ` (${payload.problems.join(", ")})`
            : "";
          return {
            ok: false,
            message: `${payload.error ?? t("brain.gate.failed")}${missing}${problems}`,
          };
        }
        if (method !== "GET" && selected) {
          const refreshed = await fetch(`/api/onboarding/${selected}`, {
            cache: "no-store",
          });
          if (refreshed.ok) setView((await refreshed.json()) as BrainView);
        }
        return { ok: true, message: "" };
      } catch {
        return { ok: false, message: t("brain.error") };
      } finally {
        setBusy(false);
      }
    },
    [selected, t],
  );
  const save = useCallback(async () => {
    if (!view) return;
    const result = await send(`/api/onboarding/${view.record.projectId}`, "PATCH", {
      revision: view.record.revision,
      fields,
    });
    setNotice(result.ok ? t("brain.saved") : result.message);
  }, [view, fields, send, t]);
  const decide = useCallback(
    async (decision: "pass" | "reject") => {
      if (!view) return;
      const result = await send(`/api/onboarding/${view.record.projectId}/gate`, "POST", {
        stage: view.stage.current,
        decision,
        reason: gateReason,
        revision: view.record.revision,
      });
      setNotice(result.ok ? t("brain.gate.done") : result.message);
      if (result.ok) setGateReason("");
    },
    [view, gateReason, send, t],
  );
  const recordReuse = useCallback(async () => {
    if (!view) return;
    const result = await send(`/api/onboarding/${view.record.projectId}/reuse`, "POST", {
      decision: fields.reuseDecision ?? "new",
      reason: reuseReason,
      matches: [],
    });
    setNotice(result.ok ? t("brain.saved") : result.message);
  }, [view, fields.reuseDecision, reuseReason, send, t]);
  const addEvidence = useCallback(async () => {
    if (!view) return;
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const digest = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    const result = await send(`/api/onboarding/${view.record.projectId}/evidence`, "POST", {
      kind: fields.evidenceKind ?? "document",
      source: file.name,
      sha256: digest,
      bytes: file.size,
      classification: fields.evidenceClassification ?? "internal",
      status: "pending",
    });
    setNotice(result.ok ? t("brain.evidence.hashed") : result.message);
  }, [view, fields, send, t]);
  const addValue = useCallback(async () => {
    if (!view) return;
    const result = await send(`/api/onboarding/${view.record.projectId}/value`, "POST", {
      basis: fields.valueBasis ?? "estimate",
      period: fields.valuePeriod ?? "baseline",
      figures: {
        ...(fields.valueHours ? { hours: Number(fields.valueHours) } : {}),
        ...(fields.valueCost ? { cost: Number(fields.valueCost) } : {}),
      },
      method: "ai-jam-value-case",
      methodVersion: "provisional-1",
      confidence: fields.valueConfidence ?? "medium",
      sourceRef: fields.valueSource ? String(fields.valueSource) : null,
    });
    setNotice(result.ok ? t("brain.saved") : result.message);
  }, [view, fields, send, t]);
  const columns = useMemo(() => [...STAGES, RETIRED] as const, []);
  const stageLabel = useCallback(
    (stage: string) => t(`brain.stage.${stage}` as never),
    [t],
  );
  const requirementLabel = useCallback(
    (code: string) => t(`brain.requirement.${code}` as never),
    [t],
  );
  if (error && !rows)
    return (
      <main className="brain-page">
        <h1>{t("brain.title")}</h1>
        <div className="brain-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {t("brain.retry")}
          </button>
        </div>
      </main>
    );
  if (!rows)
    return (
      <main className="brain-page">
        <h1>{t("brain.title")}</h1>
        <p aria-live="polite">{t("brain.loading")}</p>
      </main>
    );
  return (
    <main className="brain-page">
      <header className="brain-head">
        <div>
          <h1>{t("brain.title")}</h1>
          <p>{t("brain.subtitle")}</p>
        </div>
        <button
          type="button"
          className="brain-secondary"
          onClick={() => {
            setError(null);
            void load();
          }}
        >
          {t("brain.refresh")}
        </button>
      </header>
      {notice && (
        <p className="brain-notice" role="status">
          {notice}
        </p>
      )}
      <section className="brain-start" aria-label={t("brain.onboard.title")}>
        <div className="brain-cta">
          <div>
            <h2>{t("brain.onboard.title")}</h2>
            <p className="brain-hint">{t("brain.onboard.hint")}</p>
          </div>
          <button
            type="button"
            className="brain-primary"
            onClick={() => setWizardOpen(true)}
            disabled={busy || workspaces.length === 0}
          >
            {t("brain.onboard.open")}
          </button>
        </div>
      </section>
      {wizardOpen && (
        <BrainWizard
          t={t}
          workspaces={workspaces}
          workspaceId={workspaceId}
          onWorkspace={setWorkspaceId}
          ownerEmail={ownerEmail}
          onOwner={setOwnerEmail}
          busy={busy}
          onClose={() => setWizardOpen(false)}
          onCreate={createOnboard}
        />
      )}
      <section className="brain-start" aria-label={t("brain.start.title")}>
        <h2>{t("brain.start.title")}</h2>
        <p className="brain-hint">{t("brain.start.hint")}</p>
        {candidates.length === 0 ? (
          <p className="brain-hint">{t("brain.start.none")}</p>
        ) : (
          <div className="brain-row">
            <label>
              {t("brain.start.choose")}
              <select
                value={startId}
                onChange={(event) => setStartId(event.target.value)}
              >
                <option value="">—</option>
                {candidates
                  .filter((candidate) => !rows.some((row) => row.projectId === candidate.id))
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="brain-primary"
              disabled={busy || !startId}
              onClick={() => void startIntake()}
            >
              {t("brain.start.action")}
            </button>
          </div>
        )}
      </section>
      {rows.length === 0 ? (
        <p className="brain-empty">{t("brain.empty")}</p>
      ) : (
        <div className="brain-board">
          {columns.map((stage) => {
            const cards = rows.filter((row) => row.stage === stage);
            return (
              <section key={stage} className="brain-column" aria-label={stageLabel(stage)}>
                <h2>
                  {stageLabel(stage)} <span>{cards.length}</span>
                </h2>
                <ul>
                  {cards.map((card) => (
                    <li key={card.projectId}>
                      <button
                        type="button"
                        className={
                          selected === card.projectId ? "brain-card is-open" : "brain-card"
                        }
                        onClick={() => void open(card.projectId)}
                        aria-current={selected === card.projectId || undefined}
                      >
                        <strong>{card.name}</strong>
                        <span>
                          {t("brain.revision", { revision: card.revision })} ·{" "}
                          {t("brain.updated", { at: card.updatedAt.slice(0, 10) })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {selected && (
        <aside className="brain-detail" aria-label={t("brain.detail")}>
          <div className="brain-detail-head">
            <h2>{view?.record.name ?? t("brain.detail")}</h2>
            <button type="button" onClick={() => setSelected(null)}>
              {t("brain.close")}
            </button>
          </div>
          {!view ? (
            <p aria-live="polite">{t("brain.loading")}</p>
          ) : (
            <>
              <section aria-label={t("brain.requirements.title")}>
                <h3>{t("brain.requirements.title")}</h3>
                {view.stage.missing.length === 0 ? (
                  <p>{t("brain.requirements.met")}</p>
                ) : (
                  <ul className="brain-need">
                    {view.stage.missing.map((code) => (
                      <li key={code}>{requirementLabel(code)}</li>
                    ))}
                  </ul>
                )}
                <p className="brain-hint">{t("brain.requirements.note")}</p>
              </section>
              <BrainAnalysisPanel view={view} t={t} onGo={focusSection} />
              <section id="brain-section-intake" aria-label={t("brain.intake.title")}>
                <h3>{t("brain.intake.title")}</h3>
                <label>
                  {t("brain.field.classification")}
                  <select
                    value={String(fields.classification ?? "")}
                    onChange={(event) =>
                      setFields((f) => ({
                        ...f,
                        classification: event.target.value,
                        classificationDeclared: true,
                      }))
                    }
                  >
                    <option value="">—</option>
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(`brain.class.${c}` as never)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="brain-hint">{t("brain.field.classificationHint")}</p>
                {(
                  [
                    ["problem", "brain.field.problem"],
                    ["requester", "brain.field.requester"],
                    ["functionArea", "brain.field.function"],
                    ["site", "brain.field.site"],
                    ["objective", "brain.field.objective"],
                    ["successMeasure", "brain.field.successMeasure"],
                    ["teoaScopeId", "brain.field.teoaScope"],
                    ["asIsMapRef", "brain.field.asIsMap"],
                    ["toBeMapRef", "brain.field.toBeMap"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {t(label)}
                    <input
                      value={String(fields[key] ?? "")}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, [key]: event.target.value }))
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="brain-primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? t("brain.saving") : t("brain.save")}
                </button>
              </section>
              <section id="brain-section-reuse" aria-label={t("brain.reuse.title")}>
                <h3>{t("brain.reuse.title")}</h3>
                {view.reuse ? (
                  <p>
                    {t(`brain.reuse.${view.reuse.decision}` as never)} —{" "}
                    {view.reuse.reason}
                  </p>
                ) : (
                  <p className="brain-hint">{t("brain.reuse.none")}</p>
                )}
                <label>
                  {t("brain.reuse.decision")}
                  <select
                    value={String(fields.reuseDecision ?? "new")}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, reuseDecision: event.target.value }))
                    }
                  >
                    <option value="reuse">{t("brain.reuse.reuse")}</option>
                    <option value="extend">{t("brain.reuse.extend")}</option>
                    <option value="new">{t("brain.reuse.new")}</option>
                  </select>
                </label>
                <label>
                  {t("brain.reuse.reason")}
                  <textarea
                    value={reuseReason}
                    onChange={(event) => setReuseReason(event.target.value)}
                    rows={2}
                  />
                </label>
                <button
                  type="button"
                  className="brain-secondary"
                  disabled={busy}
                  onClick={() => void recordReuse()}
                >
                  {t("brain.reuse.record")}
                </button>
              </section>
              <section id="brain-section-evidence" aria-label={t("brain.evidence.title")}>
                <h3>{t("brain.evidence.title")}</h3>
                {view.evidence.length === 0 ? (
                  <p className="brain-hint">{t("brain.evidence.none")}</p>
                ) : (
                  <ul className="brain-evidence">
                    {view.evidence.map((item) => (
                      <li key={item.id}>
                        <strong>{item.source}</strong>{" "}
                        <span>
                          {t(`brain.kind.${item.kind}` as never)} ·{" "}
                          {t(`brain.scan.${item.scanState}` as never)} ·{" "}
                          {t(`brain.status.${item.status}` as never)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <label>
                  {t("brain.evidence.kind")}
                  <select
                    value={String(fields.evidenceKind ?? "document")}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, evidenceKind: event.target.value }))
                    }
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`brain.kind.${k}` as never)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("brain.evidence.classification")}
                  <select
                    value={String(fields.evidenceClassification ?? "internal")}
                    onChange={(event) =>
                      setFields((f) => ({
                        ...f,
                        evidenceClassification: event.target.value,
                      }))
                    }
                  >
                    {CLASSIFICATIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(`brain.class.${c}` as never)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("brain.evidence.file")}
                  <input type="file" ref={fileRef} />
                </label>
                <p className="brain-hint">{t("brain.evidence.note")}</p>
                <button
                  type="button"
                  className="brain-secondary"
                  disabled={busy}
                  onClick={() => void addEvidence()}
                >
                  {t("brain.evidence.add")}
                </button>
              </section>
              <section id="brain-section-value" aria-label={t("brain.value.title")}>
                <h3>{t("brain.value.title")}</h3>
                {view.values.length === 0 ? (
                  <p className="brain-hint">{t("brain.value.none")}</p>
                ) : (
                  <ul className="brain-values">
                    {view.values.map((item) => (
                      <li key={item.id}>
                        {t(`brain.basis.${item.basis}` as never)} ·{" "}
                        {t(`brain.period.${item.period}` as never)}
                        {item.figures.hours ? ` · ${item.figures.hours} h` : ""}
                        {item.figures.cost ? ` · ${item.figures.cost}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="brain-row">
                  <label>
                    {t("brain.value.basis")}
                    <select
                      value={String(fields.valueBasis ?? "estimate")}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, valueBasis: event.target.value }))
                      }
                    >
                      <option value="estimate">{t("brain.basis.estimate")}</option>
                      <option value="measured">{t("brain.basis.measured")}</option>
                      <option value="not-tracked">{t("brain.basis.not-tracked")}</option>
                    </select>
                  </label>
                  <label>
                    {t("brain.value.period")}
                    <select
                      value={String(fields.valuePeriod ?? "baseline")}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, valuePeriod: event.target.value }))
                      }
                    >
                      <option value="baseline">{t("brain.period.baseline")}</option>
                      <option value="d30">{t("brain.period.d30")}</option>
                      <option value="d90">{t("brain.period.d90")}</option>
                    </select>
                  </label>
                </div>
                <div className="brain-row">
                  <label>
                    {t("brain.value.hours")}
                    <input
                      inputMode="decimal"
                      value={String(fields.valueHours ?? "")}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, valueHours: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    {t("brain.value.cost")}
                    <input
                      inputMode="decimal"
                      value={String(fields.valueCost ?? "")}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, valueCost: event.target.value }))
                      }
                    />
                  </label>
                </div>
                <label>
                  {t("brain.value.source")}
                  <input
                    value={String(fields.valueSource ?? "")}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, valueSource: event.target.value }))
                    }
                  />
                </label>
                <button
                  type="button"
                  className="brain-secondary"
                  disabled={busy}
                  onClick={() => void addValue()}
                >
                  {t("brain.value.add")}
                </button>
              </section>
              <section id="brain-section-roles" aria-label={t("brain.roles.title")}>
                <h3>{t("brain.roles.title")}</h3>
                <ul className="brain-roles">
                  {(
                    [
                      ["owner", view.assignments.owner],
                      ["process_owner", view.assignments.processOwner],
                      ["teoa_approver", view.assignments.teoaApprover],
                      ["vision_approver", view.assignments.visionApprover],
                    ] as const
                  )
                    .filter(([, email]) => email)
                    .map(([role, email]) => (
                      <li key={role}>
                        <strong>{t(`brain.roles.${role}` as never)}</strong> {email}
                      </li>
                    ))}
                </ul>
                {view.access.canAssignRoles ? (
                  <div className="brain-row">
                    <label>
                      {t("brain.roles.title")}
                      <select
                        value={roleDraft.role}
                        onChange={(event) =>
                          setRoleDraft((draft) => ({ ...draft, role: event.target.value }))
                        }
                      >
                        <option value="owner">{t("brain.roles.owner")}</option>
                        <option value="process_owner">{t("brain.roles.process_owner")}</option>
                        <option value="teoa_approver">{t("brain.roles.teoa_approver")}</option>
                        <option value="vision_approver">{t("brain.roles.vision_approver")}</option>
                      </select>
                    </label>
                    <label>
                      {t("brain.roles.assign")}
                      <input
                        value={roleDraft.email}
                        onChange={(event) =>
                          setRoleDraft((draft) => ({ ...draft, email: event.target.value }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="brain-secondary"
                      disabled={busy}
                      onClick={() => void assignRole()}
                    >
                      {t("brain.roles.assign")}
                    </button>
                  </div>
                ) : (
                  <p className="brain-hint">{t("brain.roles.onlyAdmin")}</p>
                )}
              </section>
              <section id="brain-section-gate" aria-label={t("brain.gate.title")}>
                <h3>{t("brain.gate.title")}</h3>
                <label>
                  {t("brain.gate.reason")}
                  <textarea
                    value={gateReason}
                    onChange={(event) => setGateReason(event.target.value)}
                    rows={2}
                  />
                </label>
                <div className="brain-row">
                  <button
                    type="button"
                    className="brain-primary"
                    disabled={busy || !view.canGate[view.stage.current]}
                    onClick={() => void decide("pass")}
                  >
                    {t("brain.gate.pass")}
                  </button>
                  <button
                    type="button"
                    className="brain-secondary"
                    disabled={busy || !view.canGate[view.stage.current]}
                    onClick={() => void decide("reject")}
                  >
                    {t("brain.gate.reject")}
                  </button>
                </div>
                {!view.canGate[view.stage.current] && (
                  <p className="brain-hint">{t("brain.gate.noRole")}</p>
                )}
                {view.stage.next && (
                  <p className="brain-hint">
                    {t("brain.next")}: {stageLabel(view.stage.next)}
                  </p>
                )}
              </section>
              <section aria-label={t("brain.timeline.title")}>
                <h3>{t("brain.timeline.title")}</h3>
                {view.gates.length === 0 ? (
                  <p className="brain-hint">{t("brain.timeline.empty")}</p>
                ) : (
                  <ol className="brain-timeline">
                    {view.gates.map((gate, index) => (
                      <li key={`${gate.at}-${index}`}>
                        <strong>{stageLabel(gate.stage)}</strong>{" "}
                        {t(`brain.decision.${gate.decision}` as never)}{" "}
                        <time dateTime={gate.at}>{gate.at.slice(0, 10)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <p className="brain-meta">
                {view.workspace ? `${view.workspace.name} · ` : ""}
                {t(`brain.entry.${view.record.entryType === "process" ? "process" : "project"}` as never)} ·{" "}
                {stageLabel(view.stage.current)} ·{" "}
                {t("brain.revision", { revision: view.record.revision })}
              </p>
              <p
                className={view.chain.ok ? "brain-chain ok" : "brain-chain broken"}
                role="status"
              >
                {view.chain.ok
                  ? t("brain.chain.ok", { length: view.chain.length ?? 0 })
                  : t("brain.chain.broken", { seq: view.chain.brokenAt ?? 0 })}
              </p>
            </>
          )}
        </aside>
      )}
    </main>
  );
}
