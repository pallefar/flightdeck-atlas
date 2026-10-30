"use client";
// The onboarding wizard, the same four steps the macOS app opens on: choose
// what it is (two large illustrated cards), say where it belongs, name it and
// say what is wrong today, then review before anything is created.
//
// It holds no rules of its own: whether a workspace may be used, who the owner
// is and what the API accepts are decided by the server. The wizard only makes
// the order of the questions obvious.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageKey } from "@/lib/i18n";
type Translate = (key: MessageKey, params?: Record<string, string>) => string;
export type WizardCreate = {
  kind: "project" | "process";
  name: string;
  problem: string;
};
type Props = {
  t: Translate;
  workspaces: { id: string; name: string; role?: string }[];
  workspaceId: string;
  onWorkspace: (id: string) => void;
  ownerEmail: string;
  onOwner: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  /** Resolves true when the project was created and its intake opened. */
  onCreate: (input: WizardCreate) => Promise<boolean>;
};
const STEPS = [
  "brain.wizard.step.what",
  "brain.wizard.step.where",
  "brain.wizard.step.details",
  "brain.wizard.step.review",
] as const;
export default function BrainWizard({
  t,
  workspaces,
  workspaceId,
  onWorkspace,
  ownerEmail,
  onOwner,
  busy,
  onClose,
  onCreate,
}: Props) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"project" | "process">("project");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const canContinue =
    step === 0 ? true : step === 1 ? workspaceId !== "" : step === 2 ? name.trim().length > 0 : true;
  const create = useCallback(async () => {
    const created = await onCreate({ kind, name: name.trim(), problem: problem.trim() });
    if (created) onClose();
  }, [kind, name, problem, onCreate, onClose]);
  const advance = useCallback(() => {
    if (step < STEPS.length - 1) setStep((current) => current + 1);
    else void create();
  }, [step, create]);
  return (
    <div className="brain-wizard" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
      <div
        className="brain-wizard-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="brain-wizard-title"
        ref={panel}
      >
        <header className="brain-wizard-head">
          <div>
            <h2 id="brain-wizard-title">{t("brain.wizard.title")}</h2>
            <p>{t("brain.wizard.subtitle")}</p>
          </div>
          <ol className="brain-wizard-steps" aria-label={t("brain.wizard.title")}>
            {STEPS.map((key, index) => (
              <li key={key} aria-current={index === step ? "step" : undefined}>
                <span className={index <= step ? "is-done" : ""} aria-hidden="true" />
                <span className="brain-wizard-step-label">{t(key)}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="brain-wizard-close"
            onClick={onClose}
            ref={closeRef}
            aria-label={t("brain.wizard.close")}
          >
            ×
          </button>
        </header>
        <div className="brain-wizard-body">
          {step === 0 && (
            <section aria-label={t("brain.wizard.kind.question")}>
              <h3>{t("brain.wizard.kind.question")}</h3>
              <div className="brain-kind-grid">
                <KindCard
                  t={t}
                  kind="project"
                  selected={kind === "project"}
                  onChoose={() => setKind("project")}
                />
                <KindCard
                  t={t}
                  kind="process"
                  selected={kind === "process"}
                  onChoose={() => setKind("process")}
                />
              </div>
              <p className="brain-hint">{t("brain.wizard.kind.note")}</p>
            </section>
          )}
          {step === 1 && (
            <section aria-label={t("brain.wizard.where.title")}>
              <h3>{t("brain.wizard.where.title")}</h3>
              {workspaces.length === 0 ? (
                <p className="brain-hint" role="alert">
                  {t("brain.workspace.none")}
                </p>
              ) : (
                <fieldset className="brain-wizard-choices">
                  <legend>{t("brain.workspace.choose")}</legend>
                  {workspaces.map((item) => (
                    <label key={item.id}>
                      <input
                        type="radio"
                        name="brain-wizard-workspace"
                        value={item.id}
                        checked={workspaceId === item.id}
                        onChange={() => onWorkspace(item.id)}
                      />
                      {item.name}
                      {item.role ? ` · ${item.role}` : ""}
                    </label>
                  ))}
                </fieldset>
              )}
              <label>
                {t("brain.owner")}
                <input
                  value={ownerEmail}
                  onChange={(event) => onOwner(event.target.value)}
                  placeholder="owner@te.com"
                />
              </label>
              <p className="brain-hint">{t("brain.wizard.where.ownerHint")}</p>
            </section>
          )}
          {step === 2 && (
            <section aria-label={t("brain.wizard.details.title")}>
              <h3>{t("brain.wizard.details.title")}</h3>
              <label>
                {t("brain.wizard.name")}
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={
                    kind === "process" ? "Billing dispute process" : "Contract intake"
                  }
                />
              </label>
              <label>
                {t("brain.wizard.problem")}
                <textarea
                  rows={3}
                  value={problem}
                  onChange={(event) => setProblem(event.target.value)}
                />
              </label>
              <p className="brain-hint">{t("brain.wizard.details.hint")}</p>
            </section>
          )}
          {step === 3 && (
            <section aria-label={t("brain.wizard.review.title")}>
              <h3>{t("brain.wizard.review.title")}</h3>
              <dl className="brain-wizard-review">
                <dt>{t("brain.wizard.review.kind")}</dt>
                <dd>
                  {kind === "process"
                    ? t("brain.wizard.kind.process")
                    : t("brain.wizard.kind.project")}
                </dd>
                <dt>{t("brain.wizard.review.workspace")}</dt>
                <dd>{workspaces.find((item) => item.id === workspaceId)?.name ?? "—"}</dd>
                <dt>{t("brain.wizard.review.owner")}</dt>
                <dd>{ownerEmail.trim() || t("brain.owner")}</dd>
                <dt>{t("brain.wizard.review.name")}</dt>
                <dd>{name.trim()}</dd>
              </dl>
              <p className="brain-hint">{t("brain.wizard.review.note")}</p>
            </section>
          )}
        </div>
        <footer className="brain-wizard-foot">
          {step > 0 && (
            <button type="button" className="brain-secondary" onClick={() => setStep(step - 1)}>
              {t("brain.wizard.back")}
            </button>
          )}
          <span className="brain-wizard-hint">
            {step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            className="brain-primary"
            onClick={advance}
            disabled={!canContinue || busy}
          >
            {step === STEPS.length - 1
              ? t(
                  kind === "process"
                    ? "brain.wizard.create.process"
                    : "brain.wizard.create.project",
                )
              : t("brain.wizard.continue")}
          </button>
        </footer>
      </div>
    </div>
  );
}
function KindCard({
  t,
  kind,
  selected,
  onChoose,
}: {
  t: Translate;
  kind: "project" | "process";
  selected: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={selected ? "brain-kind is-selected" : "brain-kind"}
      onClick={onChoose}
      aria-pressed={selected}
    >
      <span className="brain-kind-art" aria-hidden="true">
        {kind === "project" ? <ProjectArt /> : <ProcessArt />}
      </span>
      <span className="brain-kind-title">
        {kind === "process" ? t("brain.wizard.kind.process") : t("brain.wizard.kind.project")}
      </span>
      <span className="brain-kind-summary">
        {kind === "process"
          ? t("brain.wizard.kind.process.summary")
          : t("brain.wizard.kind.project.summary")}
      </span>
      <span className="brain-kind-state">
        {selected ? t("brain.wizard.kind.selected") : t("brain.wizard.kind.choose")}
      </span>
    </button>
  );
}
/** Three overlapping cards with a seal: a piece of work with an outcome. */
function ProjectArt() {
  return (
    <svg viewBox="0 0 220 120" role="presentation">
      <g stroke="currentColor" fill="none">
        <rect x="34" y="34" width="104" height="62" rx="8" transform="rotate(-8 86 65)" opacity="0.45" strokeWidth="2" />
        <rect x="42" y="30" width="104" height="62" rx="8" transform="rotate(-2 94 61)" opacity="0.7" strokeWidth="2" />
        <rect x="52" y="26" width="104" height="62" rx="8" fill="currentColor" fillOpacity="0.16" strokeWidth="2" />
        <path d="M64 44h54M64 56h68M64 68h40" strokeWidth="5" strokeLinecap="round" opacity="0.75" />
        <path d="M150 76 l12 12 l24 -26" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}
/** Three nodes joined by arrows, the middle one in focus: how work runs. */
function ProcessArt() {
  return (
    <svg viewBox="0 0 220 120" role="presentation">
      <g stroke="currentColor" fill="none">
        <circle cx="40" cy="60" r="14" fill="currentColor" fillOpacity="0.22" strokeWidth="2" />
        <circle cx="110" cy="60" r="18" fill="currentColor" fillOpacity="0.75" />
        <circle cx="180" cy="60" r="14" fill="currentColor" fillOpacity="0.22" strokeWidth="2" />
        <path d="M56 60h32M132 60h32" strokeWidth="3" strokeLinecap="round" />
        <path d="M84 55l7 5l-7 5M160 55l7 5l-7 5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M103 60l5 5l9 -11" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="110" cy="60" r="24" strokeWidth="2" opacity="0.65" />
      </g>
    </svg>
  );
}
