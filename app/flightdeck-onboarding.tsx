"use client";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { z } from "zod";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock,
  Layers3,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectFields } from "@/lib/projects";
import { functions } from "@/lib/opportunities";
import type { OsContextEntry } from "@/lib/flightdeck/context";
import {
  createSaveCoordinator,
  type AutosaveState,
} from "@/lib/flightdeck/autosave";
import {
  autosavePill,
  clearHeld,
  confirmLeave,
  hasUnsavedWork,
  readHeld,
  registerLeaveGuard,
  sameOutsideOnboarding,
  stableJson,
  writeHeld,
} from "@/lib/flightdeck/autosave-ux";
import { freshProject } from "@/lib/fresh-export";
import {
  FREE_TEXT_NOTE,
  ISO_COUNTRY_CODES,
  LEGAL_OPEN_NOTE,
  NEVER_SENT,
  accessLevels,
  buildOnboardingPayload,
  applyChecklistSuggestions,
  checklistSuggestions,
  countryName,
  fieldLabel,
  headcountBands,
  isDraftLocked,
  onboardingSummaryLine,
  onboardErrorSchema,
  onboardStagesSchema,
  onboardingStatusSchema,
  personalDataHint,
  personalDataIn,
  ONBOARDING_STEPS,
  meterFor,
  readiness,
  reviewRows,
  stepErrors,
  timelineSteps,
  type OnboardingDraft,
  type SuggestionField,
  withoutPrefill,
  type OnboardingStage,
  type OnboardingStatus,
  type OnboardingStep,
} from "@/lib/flightdeck/onboarding";
import { waitingView } from "@/lib/flightdeck/waiting";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { useLocale } from "@/lib/i18n/react";

// The To FlightDeck form, a guided stepper: Basics (prefilled from the Atlas
// project), the FlightDeck details, Apps (optional), AI agents (locked) and
// Review & send, which lists every field that will travel. Sending files a
// request for an OS admin to review; nothing is created automatically. The
// browser only ever talks to Atlas's own /api/flightdeck/onboard routes.
const STEP_LABEL: Record<OnboardingStep, MessageKey> = {
  basics: "onb.tab.basics",
  details: "onb.tab.details",
  apps: "onb.step.apps",
  agents: "onb.step.agents",
  review: "onb.tab.review",
};
const POLL_MS = 60_000;
/** The first retry after the form could not load its status at all: the
 * draft stays read-only until it has, so the wait starts short. */
const FIRST_RETRY_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000";
const PREVIEW_HASH = "0".repeat(64);
/** A stage's name in the viewer's language (English by default). */
export const stageLabel = (stage: OnboardingStage, locale: Locale = "en") =>
  t(`onb.stage.${stage}`, locale);
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
/** When Atlas last read the send back, for a status that can still change:
 * Atlas has no background job, so it can be out of date. */
export const checkedLine = (checkedAt: string | null, locale: Locale = "en") =>
  checkedAt
    ? t("onb.check.last", locale, { when: when(checkedAt) })
    : t("onb.check.never", locale);
export const checkNote = (locale: Locale = "en") => t("onb.check.note", locale);
/** The words for an OS reason code; an unknown code says nothing. */
const reasonText = (code: string, locale: Locale) => {
  const key = `onb.reason.${code}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey, locale) : "";
};
const COUNTRIES = ISO_COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
})).sort((a, b) => a.name.localeCompare(b.name));
const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 64)
    .replace(/-+$/, "");

type Draft = {
  label: string;
  workspaceHint: string;
  functionArea: string;
  category: string;
  description: string;
  benefit: string;
  status: ProjectFields["status"];
  priority: "" | "High" | "Normal" | "Low";
  dueDate: string;
  location: string;
  ready: boolean;
  onboarding: OnboardingDraft;
};
const draftFrom = (p: Project): Draft => ({
  label: p.flightdeckDraft?.label ?? p.name,
  workspaceHint: p.flightdeckDraft?.workspaceHint ?? "",
  functionArea: p.functionArea ?? "",
  category: p.category,
  description: p.description,
  benefit: p.benefit ?? "",
  status: p.status,
  priority: p.priority ?? "",
  dueDate: p.dueDate,
  location: p.location,
  ready: p.onboardingStage === "Ready for FlightDeck",
  onboarding: structuredClone(p.onboarding ?? {}),
});
function cleanOnboarding(o: OnboardingDraft): OnboardingDraft {
  const roles = Object.fromEntries(
    Object.entries(o.ownerRoles ?? {})
      .map(([role, title]) => [role, (title ?? "").trim()])
      .filter(([, title]) => title),
  );
  return {
    ...(o.proposedProjectId ? { proposedProjectId: o.proposedProjectId } : {}),
    ...(o.countryCode ? { countryCode: o.countryCode } : {}),
    ...(o.worksCouncilRelevant
      ? { worksCouncilRelevant: o.worksCouncilRelevant }
      : {}),
    ...(o.legalEntity?.trim() ? { legalEntity: o.legalEntity.trim() } : {}),
    ...(o.headcountBand ? { headcountBand: o.headcountBand } : {}),
    ...(Object.keys(roles).length ? { ownerRoles: roles } : {}),
    ...(o.dataSources?.length ? { dataSources: o.dataSources } : {}),
    ...(o.accessRequested?.length
      ? { accessRequested: o.accessRequested }
      : {}),
    ...(o.coworkRequested ? { coworkRequested: true } : {}),
    ...(o.prefill && Object.keys(o.prefill).length
      ? { prefill: o.prefill }
      : {}),
  };
}
/** Keeps an optional field absent when it was absent and is still empty,
 * so an unchanged save records no "details updated" history entry. */
const optional = (value: string, before: string | undefined) =>
  value === "" && before === undefined ? undefined : value;
function fieldsFrom(p: Project, d: Draft): ProjectFields {
  return {
    ...p,
    flightdeckDraft: {
      label: d.label.trim(),
      workspaceHint: d.workspaceHint.trim(),
    },
    functionArea: optional(d.functionArea, p.functionArea),
    category: d.category,
    description: d.description,
    benefit: optional(d.benefit, p.benefit),
    status: d.status,
    priority: d.priority || undefined,
    dueDate: d.dueDate,
    location: d.location,
    // Unticking "Ready" steps back one stage rather than leaving onboarding.
    onboardingStage: d.ready
      ? "Ready for FlightDeck"
      : p.onboardingStage === "Ready for FlightDeck"
        ? "Pilot"
        : p.onboardingStage,
    onboarding: cleanOnboarding(d.onboarding),
  };
}

export async function fetchStatus(projectId: string, refresh: boolean) {
  try {
    const response = await fetch(
      `/api/flightdeck/onboard/${encodeURIComponent(projectId)}${refresh ? "?refresh=1" : ""}`,
      { cache: "no-store" },
    );
    const parsed = onboardingStatusSchema.safeParse(
      await response.json().catch(() => null),
    );
    return response.ok && parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
/** How long to wait before the next status read, after a read that gave
 * `next` (null: it failed): a minute normally; FlightDeck's Retry-After when
 * it gave one; doubling (up to 15 minutes) after a failure or a notice.
 * Shared by the form and the project page's FlightDeck card. */
export function nextStatusDelay(
  previous: number,
  next: OnboardingStatus | null,
) {
  if (!next) return Math.min(previous * 2, MAX_BACKOFF_MS);
  return next.retryAfter
    ? Math.max(POLL_MS, next.retryAfter * 1000)
    : next.notice
      ? Math.min(previous * 2, MAX_BACKOFF_MS)
      : POLL_MS;
}
export const STATUS_POLL_MS = POLL_MS;
/** Reads the stored status every minute while it can still change; the
 * Super Admin's view also asks the server to check FlightDeck. Backs off on
 * failures and on FlightDeck's Retry-After: the credential allows 30
 * requests a minute for everything Atlas does, and the server allows one
 * read-back per send a minute. */
function useOnboardingStatus(
  projectId: string,
  superAdmin: boolean,
  onStage: (id: string, stage: OnboardingStage | null) => void,
) {
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const delay = useRef(POLL_MS);
  const firstRetry = useRef(FIRST_RETRY_MS);
  const show = useCallback(
    (next: OnboardingStatus) => {
      setStatus(next);
      onStage(projectId, next.operation?.stage ?? null);
    },
    [projectId, onStage],
  );
  const settle = useCallback(
    (next: OnboardingStatus | null) => {
      delay.current = nextStatusDelay(delay.current, next);
      if (!next) {
        setFailed(true);
        return;
      }
      setFailed(false);
      show(next);
    },
    [show],
  );
  const load = useCallback(
    (refresh: boolean) => fetchStatus(projectId, refresh).then(settle),
    [projectId, settle],
  );
  useEffect(() => {
    let live = true;
    void fetchStatus(projectId, superAdmin).then((next) => {
      if (live) settle(next);
    });
    return () => {
      live = false;
    };
  }, [projectId, superAdmin, settle]);
  // Everyone's open form follows the stored status; only the Super Admin's
  // asks the server to read FlightDeck. A form that never loaded its status
  // keeps asking too (sooner at first), since its draft stays read-only
  // until it knows.
  useEffect(() => {
    const unknown = !status && failed;
    if (!status?.pollable && !unknown) return;
    const wait = unknown ? firstRetry.current : delay.current;
    const timer = window.setTimeout(() => {
      if (unknown) firstRetry.current = Math.min(wait * 2, POLL_MS);
      void load(superAdmin).then(() => setAttempt((n) => n + 1));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [status, failed, attempt, superAdmin, load]);
  return { status, show, failed, load };
}

/** The stored stage of every project the caller can see, and when each send
 * was last checked, reloaded every minute so the list and the dashboard
 * follow FlightDeck. The Super Admin's reload asks the server to check a few
 * due sends first (at most two a call, each at most every five minutes), so
 * no status waits for someone to open its form. */
export function useOnboardingStages(superAdmin: boolean) {
  const [stages, setStages] = useState<Record<string, OnboardingStage> | null>(
    null,
  );
  const [checked, setChecked] = useState<Record<string, string | null>>({});
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    let delay = POLL_MS;
    const run = async () => {
      let next: z.infer<typeof onboardStagesSchema> | null = null;
      try {
        const response = await fetch(
          `/api/flightdeck/onboard${superAdmin ? "?refresh=1" : ""}`,
          { cache: "no-store" },
        );
        const parsed = onboardStagesSchema.safeParse(
          response.ok ? await response.json() : null,
        );
        next = parsed.success ? parsed.data : null;
      } catch {
        next = null;
      }
      if (!live) return;
      if (next) {
        setStages(next.stages);
        setChecked(next.checked);
        setFailed(false);
        delay = next.retryAfter
          ? Math.max(POLL_MS, next.retryAfter * 1000)
          : POLL_MS;
      } else {
        setFailed(true);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
      timer = window.setTimeout(() => void run(), delay);
    };
    void run();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [superAdmin]);
  const mark = useCallback(
    (id: string, stage: OnboardingStage | null) =>
      setStages((current) => {
        const next = { ...(current ?? {}) };
        if (stage) next[id] = stage;
        else delete next[id];
        return next;
      }),
    [],
  );
  return { stages, checked, failed, mark };
}

export function OnboardingTimeline({ stage }: { stage: OnboardingStage }) {
  const locale = useLocale();
  return (
    <ol className="fd-timeline" aria-label={t("onb.timeline.aria", locale)}>
      {timelineSteps(stage).map((step) => (
        <li
          key={step.stage}
          className={step.state === "done" ? "done" : ""}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          {stageLabel(step.stage, locale)}
        </li>
      ))}
    </ol>
  );
}

/** The waiting view (plan J4, onb-atlas-status-timeline): what Atlas saw
 * and when, what happens next, an honest outage line, the owner's response
 * policy if one is set (never a guessed ETA), and the project's earlier
 * sends. Only the viewer's projection feeds it (lib/flightdeck/waiting.ts).
 * `compact`: the card's lines only, without the log and the history. */
export function WaitingDetails({
  status,
  superAdmin,
  compact = false,
}: {
  status: OnboardingStatus;
  superAdmin: boolean;
  compact?: boolean;
}) {
  const locale = useLocale();
  if (!status.operation) return null;
  const view = waitingView(status, { superAdmin, locale, when });
  return (
    <div className="fd-waiting">
      {view.outage && (
        <div className="fd-banner warn" role="status">
          <AlertTriangle size={16} />
          <p>{view.outage}</p>
        </div>
      )}
      {view.next && <p className="fd-hint">{view.next}</p>}
      {view.eta && <p className="fd-hint">{view.eta}</p>}
      {compact && view.freshness && (
        <p className="fd-hint">{view.freshness}</p>
      )}
      {!compact && view.rows.length > 0 && (
        <ol
          className="fd-observed"
          aria-label={t("onb.observed.aria", locale)}
        >
          {view.rows.map((row, i) => (
            <li key={`${i}-${row.stage}`}>{row.text}</li>
          ))}
        </ol>
      )}
      {!compact && view.history.length > 0 && (
        <section
          className="fd-history"
          aria-label={t("onb.history.title", locale)}
        >
          <h4>{t("onb.history.title", locale)}</h4>
          <ol>
            {view.history.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function StatusBanner({
  status,
  workspaces,
  superAdmin,
}: {
  status: OnboardingStatus;
  workspaces: OsContextEntry[];
  superAdmin: boolean;
}) {
  const locale = useLocale();
  const op = status.operation;
  if (!op) return null;
  const reason = op.reasonCode ? reasonText(op.reasonCode, locale) : "";
  const where = op.destinationWorkspaceId
    ? workspaces.find((w) => w.id === op.destinationWorkspaceId)?.label ||
      op.destinationWorkspaceId
    : "";
  let tone = "",
    text = "";
  switch (op.stage) {
    case "not-confirmed":
      tone = "warn";
      text = `FlightDeck has not confirmed this send yet. ${reason} Retry send sends the same request again, with the same key, so it can never be filed twice. The draft stays as it was sent until this send is confirmed or closed.`;
      break;
    case "submitted":
      text = `${op.adopted ? "FlightDeck already held a request for this project, and Atlas now follows it." : `Sent for review${where ? ` to ${where}` : ""}.`} An OS admin decides; nothing is created automatically. The draft is locked while FlightDeck reviews it. ${reason}`;
      break;
    case "linked":
    case "setup-in-progress":
    case "setup-complete":
      text = `${
        status.link
          ? `Linked to FlightDeck project ${status.link.osProjectId} in ${workspaces.find((w) => w.id === status.link!.workspaceId)?.label || status.link.workspaceId}.`
          : "Linked to a FlightDeck project."
      } FlightDeck holds this project now, so the Atlas draft is kept as it was sent.`;
      break;
    case "needs-more-info":
      tone = "warn";
      text =
        "FlightDeck asked for more information. The draft is open again: update it, save, and send again.";
      break;
    case "rejected":
      tone = "warn";
      text = `FlightDeck declined this request. ${reason} The draft is open again.`;
      break;
    case "not-sent":
      tone = "warn";
      text = `FlightDeck refused the request. ${reason} Nothing was filed; you can send again once this is fixed.`;
      break;
    case "closed":
      tone = "warn";
      text =
        "The Atlas Super Admin closed this unconfirmed send, so the draft is open again. If FlightDeck did file it after all, the next send follows that request instead of filing a second one.";
      break;
  }
  // "Last checked" (Super Admin) or "Last update seen" (editor, whose view
  // never checks) belongs to a status that can still change on its own,
  // which the server itself decides (pollable), not to every locked draft.
  const freshness = waitingView(status, { superAdmin, locale, when })
    .freshness;
  return (
    <div className={`fd-banner ${tone}`}>
      {tone ? <AlertTriangle size={16} /> : <Check size={16} />}
      <p>
        {text.trim()}
        {status.notice && <span className="fd-hint"> {status.notice}</span>}
        {freshness && (
          <span className="fd-hint">
            {" "}
            {freshness}.{superAdmin ? "" : ` ${checkNote(locale)}`}
          </span>
        )}
      </p>
    </div>
  );
}

/** `strict`: every field except Summary and Success measure, where the
 * server refuses an email or phone-number shape. */
/** Brings a focused control fully into view between the app's sticky
 * header and the form's sticky action bar. The browser's own focus
 * scrolling leaves a control that is already partly visible where it is,
 * even when the action bar covers it (WCAG 2.4.11 Focus Not Obscured). */
function keepClearOfStickyBars(el: HTMLElement, bar: HTMLElement | null) {
  if (!bar || bar.contains(el)) return;
  // Only keyboard (focus-visible) focus: scrolling on a pointer's focus moves
  // the control out from under the pointer between mousedown and mouseup, so
  // a click on a partly covered button (a stepper step) would be lost.
  if (!el.matches(":focus-visible")) return;
  const gap = 12;
  const top =
    (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) +
    gap;
  const bottom = bar.getBoundingClientRect().top - gap;
  const r = el.getBoundingClientRect();
  if (r.top >= top && r.bottom <= bottom) return;
  el.style.scrollMarginTop = `${Math.max(0, top)}px`;
  el.style.scrollMarginBottom = `${Math.max(0, innerHeight - bottom)}px`;
  el.scrollIntoView({ block: "nearest" });
  el.style.scrollMarginTop = "";
  el.style.scrollMarginBottom = "";
}

function Hint({ text, strict = false }: { text: string; strict?: boolean }) {
  const hint = personalDataHint(text, strict);
  return hint ? (
    <span className="fd-warn" role="note">
      {hint}
    </span>
  ) : null;
}

// ── Autosave (onb-atlas-save-ux) ─────────────────────────────────────────
// The onboarding part of the form saves itself through the single-flight
// coordinator, with the onboarding-scoped PUT (only that field is written,
// so other people's edits to the rest of the project are never overwritten).
// Everything else on the form still waits for Save now.

/** One field of the form, as the conflict view compares and re-applies it. */
type DiffField = {
  label: string;
  basics: boolean;
  get: (d: Draft) => unknown;
  set: (d: Draft, value: unknown) => Draft;
  show?: (value: unknown, locale: Locale) => string;
};
const yesNo = (v: unknown) => (v ? "Yes" : "No");
const basicField = (
  key: Exclude<keyof Draft, "onboarding">,
  label: string,
  show?: DiffField["show"],
): DiffField => ({
  label,
  basics: true,
  get: (d) => d[key],
  set: (d, value) => ({ ...d, [key]: value }),
  show,
});
const detailField = (
  key: Exclude<keyof OnboardingDraft, "ownerRoles">,
  label: string,
  show?: DiffField["show"],
): DiffField => ({
  label,
  basics: false,
  get: (d) => cleanOnboarding(d.onboarding)[key],
  set: (d, value) => ({ ...d, onboarding: { ...d.onboarding, [key]: value } }),
  show,
});
const roleField = (
  role: "process" | "data" | "support",
  label: string,
): DiffField => ({
  label,
  basics: false,
  get: (d) => cleanOnboarding(d.onboarding).ownerRoles?.[role],
  set: (d, value) => ({
    ...d,
    onboarding: {
      ...d.onboarding,
      ownerRoles: { ...d.onboarding.ownerRoles, [role]: value as string },
    },
  }),
});
const DIFF_FIELDS: DiffField[] = [
  basicField("label", "Proposed OS project name"),
  basicField("workspaceHint", "Preferred workspace (optional)"),
  basicField("functionArea", "Function area"),
  basicField("category", "Category"),
  basicField("description", "Summary"),
  basicField("benefit", "Success measure"),
  basicField("status", "Status"),
  basicField("priority", "Priority"),
  basicField("dueDate", "Target date"),
  basicField("location", "Site"),
  basicField("ready", "Ready for FlightDeck", yesNo),
  detailField("proposedProjectId", "Proposed OS project id (optional)"),
  detailField("countryCode", "Country", (v) => countryName(String(v))),
  detailField("worksCouncilRelevant", "Works council relevant"),
  detailField("legalEntity", "Legal entity (optional)"),
  detailField("headcountBand", "Headcount band (optional)", (v, locale) =>
    t(`onb.headcount.${v as NonNullable<OnboardingDraft["headcountBand"]>}`, locale),
  ),
  roleField("process", "Process owner role"),
  roleField("data", "Data owner role"),
  roleField("support", "Support owner role"),
  detailField("dataSources", "Data sources", (v) => (v as string[]).join(", ")),
  detailField("accessRequested", "Access requested", (v) =>
    (v as { system: string; level: string }[])
      .map((a) => `${a.system} (${a.level})`)
      .join(", "),
  ),
  detailField("coworkRequested", "Cowork requested", yesNo),
];
const differs = (f: DiffField, a: Draft, b: Draft) =>
  stableJson(f.get(a) ?? null) !== stableJson(f.get(b) ?? null);
/** "Keep mine": their version with every field this form changed (since the
 * version its edits were based on) put back on top. A field only they
 * changed keeps their value. */
function reapplyMine(base: Draft, mine: Draft, theirs: Draft): Draft {
  return DIFF_FIELDS.reduce(
    (d, f) => (differs(f, base, mine) ? f.set(d, f.get(mine)) : d),
    theirs,
  );
}
/** The fields where Keep mine and Use theirs give different results. */
function conflictRows(base: Draft, mine: Draft, theirs: Draft) {
  return DIFF_FIELDS.filter(
    (f) => differs(f, base, mine) && differs(f, mine, theirs),
  );
}
const basicsDiffer = (a: Draft, b: Draft) =>
  DIFF_FIELDS.some((f) => f.basics && differs(f, a, b));
const showValue = (f: DiffField, value: unknown, locale: Locale) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && !value.length)
    ? t("onb.conflict.empty", locale)
    : f.show
      ? f.show(value, locale)
      : String(value);

type AutosaveSnapshot = {
  state: AutosaveState;
  /** The project the newest acknowledged save answered with. */
  acked: Project | null;
  /** When this form last saw a save succeed. */
  savedAt: Date | null;
};
/** One coordinator for one form, with a snapshot React reads through
 * useSyncExternalStore. It is disposed a tick after its last user lets go,
 * so a StrictMode rehearsal (unmount, mount again) keeps it alive. */
function createAutosave(
  projectId: string,
  revision: number,
  onSaved: (project: Project) => void,
) {
  let answered: Project | null = null;
  const coordinator = createSaveCoordinator<OnboardingDraft>({
    initialRevision: revision,
    send: (onboarding, baseRevision, signal) =>
      fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "onboarding", baseRevision, onboarding }),
        signal,
      }),
    readRevision: (body) => {
      const project = (body as { project?: Project } | null)?.project;
      const r = project?.revision;
      if (typeof r !== "number" || !Number.isInteger(r) || r < 1) return null;
      answered = project!;
      return r;
    },
  });
  let snapshot: AutosaveSnapshot = {
    state: coordinator.getState(),
    acked: null,
    savedAt: null,
  };
  const listeners = new Set<() => void>();
  coordinator.subscribe((state) => {
    const fresh =
      answered &&
      answered !== snapshot.acked &&
      answered.revision === state.acknowledgedRevision
        ? answered
        : null;
    snapshot = {
      state,
      acked: fresh ?? snapshot.acked,
      savedAt: fresh ? new Date() : snapshot.savedAt,
    };
    if (fresh) onSaved(fresh);
    for (const fn of [...listeners]) fn();
  });
  let release: ReturnType<typeof setTimeout> | undefined;
  return {
    coordinator,
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    hold: () => clearTimeout(release),
    release: () => {
      release = setTimeout(() => coordinator.dispose(), 0);
    },
  };
}
type Autosave = ReturnType<typeof createAutosave>;
/** A conflict the viewer has to resolve: the coordinator's 409, a save
 * elsewhere while fields outside the onboarding part were edited, or a copy
 * held from before a reload. `base` is the version the local edits started
 * from. */
type Held = {
  kind: "conflict" | "stale" | "recovered";
  theirs: Project | null;
  failed?: boolean;
  base: Draft;
  /** The revision the local edits started from. */
  baseRevision: number;
};

function ConflictPanel({
  held,
  base,
  mine,
  onKeepMine,
  onUseTheirs,
  disabled,
}: {
  held: Held;
  base: Draft;
  mine: Draft;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  disabled: boolean;
}) {
  const locale = useLocale();
  const theirs = held.theirs;
  const theirsDraft = theirs ? draftFrom(theirs) : null;
  const rows = theirsDraft ? conflictRows(base, mine, theirsDraft) : [];
  const titleId = `fd-conflict-${theirs?.id ?? "loading"}`;
  const title =
    theirs &&
    (held.kind !== "recovered" || theirs.revision > held.baseRevision)
      ? t("onb.conflict.title", locale, { revision: theirs.revision })
      : t("onb.conflict.recoveredTitle", locale);
  return (
    <section className="fd-banner warn fd-conflict" aria-labelledby={titleId}>
      <AlertTriangle size={16} />
      <div>
        <h3 id={titleId}>{title}</h3>
        {!theirs ? (
          <p role="status">
            {held.failed
              ? t("onb.conflict.unavailable", locale)
              : t("onb.conflict.loading", locale)}
          </p>
        ) : (
          <>
            <p>{t("onb.conflict.intro", locale, { revision: theirs.revision })}</p>
            {rows.length ? (
              <div className="fd-conflict-table">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{t("onb.conflict.field", locale)}</th>
                      <th scope="col">{t("onb.conflict.yours", locale)}</th>
                      <th scope="col">{t("onb.conflict.theirs", locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((f) => (
                      <tr key={f.label}>
                        <th scope="row">{f.label}</th>
                        <td>{showValue(f, f.get(mine), locale)}</td>
                        <td>{showValue(f, f.get(theirsDraft!), locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="fd-hint">{t("onb.conflict.same", locale)}</p>
            )}
          </>
        )}
        <div className="bridge-actions">
          <Button
            type="button"
            disabled={disabled || (!theirs && !held.failed)}
            onClick={onKeepMine}
          >
            {t("onb.conflict.keepMine", locale)}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || (!theirs && !held.failed)}
            onClick={onUseTheirs}
          >
            {t("onb.conflict.useTheirs", locale)}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function OnboardingEditor({
  project,
  superAdmin,
  busy,
  workspaces,
  contextState,
  viewerId = "",
  onSave,
  onAutosaved,
  onClose,
  onMessage,
  onStage,
}: {
  project: Project;
  superAdmin: boolean;
  busy: boolean;
  workspaces: OsContextEntry[];
  contextState: string | null;
  /** Who is viewing: the held copy of unsaved work is kept per viewer. */
  viewerId?: string;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  /** A save of the onboarding part landed (the project it returned). */
  onAutosaved?: (project: Project) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
  onStage: (id: string, stage: OnboardingStage | null) => void;
}) {
  const locale = useLocale();
  // Work held from before a reload (a conflict not yet resolved, or a save
  // that never landed), for this viewer and project only. It is offered
  // again only if it would still change something.
  const [recovered] = useState(() => {
    const kept = readHeld<Draft>(viewerId, project.id);
    if (!kept) return null;
    const theirs = draftFrom(project);
    return stableJson(reapplyMine(kept.baseDraft, kept.draft, theirs)) !==
      stableJson(theirs)
      ? kept
      : null;
  });
  const [draft, setDraft] = useState<Draft>(
    () => recovered?.draft ?? draftFrom(project),
  );
  /** Fields outside the autosaved onboarding part were edited. */
  const [basicsDirty, setBasicsDirty] = useState(
    () => recovered?.basicsDirty ?? false,
  );
  /** An onboarding edit held back because the server would refuse it (a
   * project id that is not a valid slug yet). */
  const [unsent, setUnsent] = useState(false);
  // The version the form is based on. Atlas reloads its projects on focus
  // and every minute, and each autosave answers with the saved project, so
  // a newer version can arrive while the form is open: an untouched form
  // follows it, so Review always shows what the server would send; edited
  // fields are never overwritten, and a change elsewhere to a field this
  // form edited asks the viewer to choose (Keep mine / Use theirs).
  const [server, setServer] = useState(project);
  /** The onboarding part the local onboarding edits started from. */
  const [onboardingBase, setOnboardingBase] = useState<OnboardingDraft>(
    () => recovered?.baseDraft.onboarding ?? draftFrom(project).onboarding,
  );
  const [held, setHeld] = useState<Held | null>(() =>
    recovered
      ? {
          kind: "recovered",
          theirs: project,
          base: recovered.baseDraft,
          baseRevision: recovered.base,
        }
      : null,
  );
  const [refreshedTo, setRefreshedTo] = useState<number | null>(null);
  const onAutosavedRef = useRef(onAutosaved);
  useEffect(() => {
    onAutosavedRef.current = onAutosaved;
  });
  const startAutosave = (revision: number) =>
    createAutosave(project.id, revision, (p) => onAutosavedRef.current?.(p));
  const [autosave, setAutosave] = useState<Autosave>(() =>
    startAutosave(project.revision),
  );
  useEffect(() => {
    autosave.hold();
    return () => autosave.release();
  }, [autosave]);
  const snap = useSyncExternalStore(
    autosave.subscribe,
    autosave.getSnapshot,
    autosave.getSnapshot,
  );
  const save = snap.state;
  /** The onboarding part holds local work the server has not taken. */
  const localOnboarding =
    unsent ||
    save.pending ||
    save.status === "conflict" ||
    save.status === "stopped" ||
    save.status === "retrying";
  const newest =
    snap.acked && snap.acked.revision > project.revision
      ? snap.acked
      : project;
  const baseDraft: Draft = { ...draftFrom(server), onboarding: onboardingBase };
  /** Moves the form's base onto a newer version, keeping local work. */
  function adopt(p: Project, keepBasics: boolean) {
    const fresh = draftFrom(p);
    const same =
      stableJson(cleanOnboarding(draft.onboarding)) ===
      stableJson(cleanOnboarding(fresh.onboarding));
    const keepOnboarding = localOnboarding || same;
    setServer(p);
    setDraft({
      ...(keepBasics ? draft : fresh),
      onboarding: keepOnboarding ? draft.onboarding : fresh.onboarding,
    });
    if (p.revision === save.acknowledgedRevision || !keepOnboarding)
      setOnboardingBase(fresh.onboarding);
    // A coordinator with nothing to send starts again on the new revision,
    // so its next save is based on what the form now shows.
    if (!localOnboarding && save.acknowledgedRevision < p.revision)
      setAutosave(startAutosave(p.revision));
  }
  if (newest.revision > server.revision && !held) {
    if (!basicsDirty) {
      adopt(newest, false);
      setRefreshedTo(
        newest.revision !== save.acknowledgedRevision ? newest.revision : null,
      );
    } else if (sameOutsideOnboarding(newest, server)) adopt(newest, true);
    else
      setHeld({
        kind: "stale",
        theirs: newest,
        base: baseDraft,
        baseRevision: server.revision,
      });
  }
  if (save.status === "conflict" && !held)
    setHeld({
      kind: "conflict",
      theirs: null,
      base: baseDraft,
      baseRevision: server.revision,
    });
  // A held choice always compares against the newest version known.
  if (
    held?.theirs &&
    held.kind !== "conflict" &&
    newest.revision > held.theirs.revision
  )
    setHeld({ ...held, theirs: newest });
  // The coordinator's conflict names no version: read the one saved.
  useEffect(() => {
    if (!held || held.theirs || held.failed) return;
    let live = true;
    freshProject(project.id).then(
      (theirs) => {
        if (live) setHeld((h) => (h && !h.theirs ? { ...h, theirs } : h));
      },
      () => {
        if (live) setHeld((h) => (h ? { ...h, failed: true } : h));
      },
    );
    return () => {
      live = false;
    };
  }, [held, project.id]);
  const stale = !!held || newest.revision > server.revision;
  const [tab, setTab] = useState<OnboardingStep>("basics");
  // The step whose 'Next' found missing details; the summary lists what is
  // still missing there, so it empties itself as the viewer fills them in.
  const [summaryStep, setSummaryStep] = useState<OnboardingStep | null>(null);
  const [summaryShown, setSummaryShown] = useState(0);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const [destination, setDestination] = useState("");
  const [sending, setSending] = useState(false);
  /** Save now is running: the form is frozen until it is done. */
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newAccess, setNewAccess] = useState<{
    system: string;
    level: (typeof accessLevels)[number];
  }>({ system: "", level: "read" });
  const pendingFocus = useRef<string | null>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  /** Whether the viewer has changed step yet: opening the form keeps focus
   * where it was; a step change moves it to the new step's heading. */
  const stepChanged = useRef(false);
  const [stepMoved, setStepMoved] = useState(false);
  const { status, show, failed, load } = useOnboardingStatus(
    project.id,
    superAdmin,
    onStage,
  );
  const op = status?.operation ?? null;
  useEffect(() => {
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    } else if (stepChanged.current) stepHeadingRef.current?.focus();
  }, [tab]);
  useEffect(() => {
    if (summaryShown) summaryRef.current?.focus();
  }, [summaryShown]);

  // An open send (reserved, filed, promoted or linked) locks the draft; the
  // readiness meter and "What will be sent" describe a send still to make,
  // so they give way to what FlightDeck holds, or what Retry resends. The
  // list row reads the same predicate off the same stage, so the form and the
  // row cannot disagree about whether the draft may still change.
  const locked = isDraftLocked(op?.stage);
  // Until the status has loaded once, Atlas cannot tell whether FlightDeck
  // holds this draft, so nothing in it may change yet — the same fail-closed
  // rule the To FlightDeck row applies to an unknown stage. The server
  // refuses such a save as well (PUT /api/projects/[id], draft_locked).
  const unknown = !status;
  const frozen = locked || unknown;
  const retrying = !!status?.retryPending;
  const sent = locked && !retrying;
  const target = locked ? op?.destinationWorkspaceId || "" : destination;
  const workspaceLabel = (id: string) =>
    workspaces.find((w) => w.id === id)?.label || id;
  const preview = useMemo(
    () => ({ ...project, ...fieldsFrom(project, draft) }),
    [project, draft],
  );
  // Send is gated on every item, whoever owns it; the meter shows the
  // viewer's own share (plan 2026-09-25 §7: readinessFor by actor).
  const ready = readiness(preview, target || null);
  const viewer = superAdmin ? "superAdmin" : "requester";
  const meter = meterFor(preview, target || null, viewer, tab);
  const summary =
    summaryStep === tab && !frozen
      ? stepErrors(preview, target || null, viewer, tab)
      : [];
  const suggestions = frozen ? [] : checklistSuggestions(preview);
  const payload = buildOnboardingPayload({
    project: preview,
    destinationWorkspaceId: target,
    idempotencyKey: PREVIEW_KEY,
    installationId: "atlas-local",
    requestedBy: PREVIEW_HASH,
  });
  const rows = reviewRows(payload);
  const privacy = personalDataIn(payload);
  /** Exactly what Retry send resends (Super Admin only). */
  const pending = retrying ? (status?.pendingPayload ?? null) : null;
  const changedSince =
    locked && !!op?.atlasRevision && op.atlasRevision !== project.revision;
  const slugOk =
    !draft.onboarding.proposedProjectId ||
    SLUG_RE.test(draft.onboarding.proposedProjectId);
  const selectable = workspaces.filter((w) => w.enabled);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setBasicsDirty(true);
  };
  /** An onboarding edit: shown at once, and handed to the autosave unless
   * the server would refuse it as it stands. While a conflict waits for
   * Keep mine or Use theirs, edits stay local: the form may hold a copy
   * based on an older version (say, recovered after a reload), and sending
   * it would overwrite the other change without a 409. The held copy keeps
   * them, and Keep mine re-applies them on top. */
  function editOnboarding(
    next: OnboardingDraft,
    via: Autosave = autosave,
    local = !!held,
  ) {
    setDraft((d) => ({ ...d, onboarding: next }));
    if (next.proposedProjectId && !SLUG_RE.test(next.proposedProjectId)) {
      setUnsent(true);
      return;
    }
    setUnsent(false);
    if (local) return;
    const c = via.coordinator;
    const state = c.getState();
    // A save refused as it stood (say, a value the server rejected) gets a
    // new chance once the value changes; a locked draft never does.
    if (state.status === "stopped" && state.stopReason === "refused")
      c.resume(state.acknowledgedRevision);
    c.edit(cleanOnboarding(next));
  }
  const setDetail = <K extends keyof OnboardingDraft>(
    key: K,
    value: OnboardingDraft[K],
  ) => editOnboarding({ ...draft.onboarding, [key]: value });
  const setRole = (role: "process" | "data" | "support", value: string) =>
    editOnboarding({
      ...withoutPrefill(draft.onboarding, `ownerRoles.${role}`),
      ownerRoles: { ...draft.onboarding.ownerRoles, [role]: value },
    });
  /** A user edit of a field Atlas may prefill: the value is theirs now, so
   * its provenance chip goes with it. */
  const setPrefillable = (
    key: "functionArea" | "description" | "benefit",
    field: SuggestionField,
    value: string,
  ) => {
    set(key, value);
    if (draft.onboarding.prefill?.[field])
      editOnboarding(withoutPrefill(draft.onboarding, field));
  };
  /** Where a prefilled value came from, shown while the field holds the
   * text the prefill put there. */
  const source = (field: SuggestionField, value: string | undefined) => {
    const from = draft.onboarding.prefill?.[field];
    return from && value?.trim() && from.value?.trim() === value.trim() ? (
      <span className="fd-hint" data-prefill={from.source}>
        {t(`onb.prefill.${from.source}`, locale)}
      </span>
    ) : null;
  };
  function step(next: OnboardingStep) {
    setSummaryStep(null);
    stepChanged.current = true;
    setStepMoved(true);
    setTab(next);
  }
  function goTo(next: OnboardingStep, field: string) {
    if (next === tab) document.getElementById(field)?.focus();
    else {
      pendingFocus.current = field;
      step(next);
    }
  }
  const stepIndex = ONBOARDING_STEPS.findIndex((s) => s.id === tab);
  const prevStep = ONBOARDING_STEPS[stepIndex - 1]?.id;
  const nextStep = ONBOARDING_STEPS[stepIndex + 1]?.id;
  /** 'Next' stops on a step with missing details and says which, in a
   * focused summary; a read-only draft has nothing to fix, so it moves on. */
  function next() {
    if (!nextStep) return;
    if (!frozen && stepErrors(preview, target || null, viewer, tab).length) {
      setSummaryStep(tab);
      setSummaryShown((n) => n + 1);
      return;
    }
    step(nextStep);
  }
  function applySuggestions() {
    const next = applyChecklistSuggestions(
      draft,
      suggestions,
      new Date().toISOString(),
    );
    setDraft(next);
    if (basicsDiffer(next, draft)) setBasicsDirty(true);
    editOnboarding(next.onboarding);
  }
  /** Keep mine: their version with this form's changes put back on top,
   * saved at once. */
  function keepMine() {
    if (!held) return;
    const theirs = held.theirs;
    if (!theirs) {
      setHeld({ ...held, failed: false });
      return;
    }
    const theirsDraft = draftFrom(theirs);
    const next = reapplyMine(held.base, draft, theirsDraft);
    const dirty = basicsDiffer(next, theirsDraft);
    setHeld(null);
    clearHeld(viewerId, project.id);
    setServer(theirs);
    setOnboardingBase(theirsDraft.onboarding);
    setDraft(next);
    setBasicsDirty(dirty);
    setRefreshedTo(null);
    // Always a new coordinator on their revision: the old one may still
    // queue the pre-conflict value, which would be sent over theirs even
    // when the reconciled copy already equals theirs.
    const via = startAutosave(theirs.revision);
    setAutosave(via);
    if (
      stableJson(cleanOnboarding(next.onboarding)) !==
      stableJson(cleanOnboarding(theirsDraft.onboarding))
    )
      editOnboarding(next.onboarding, via, false);
    void saveNow({ server: theirs, draft: next, basicsDirty: dirty, via });
  }
  /** Use theirs: the local changes are discarded. */
  function takeTheirs() {
    if (!held) return;
    const theirs = held.theirs;
    if (!theirs) {
      setHeld({ ...held, failed: false });
      return;
    }
    const fresh = draftFrom(theirs);
    setHeld(null);
    clearHeld(viewerId, project.id);
    setServer(theirs);
    setOnboardingBase(fresh.onboarding);
    setDraft(fresh);
    setBasicsDirty(false);
    setUnsent(false);
    setRefreshedTo(null);
    setAutosave(startAutosave(theirs.revision));
  }
  /** Save now: sends a waiting onboarding edit at once, then saves the rest
   * of the form (and creates the draft) with a whole-project save. */
  async function saveNow(
    over: {
      server?: Project;
      draft?: Draft;
      basicsDirty?: boolean;
      via?: Autosave;
    } = {},
  ) {
    if (frozen || savingRef.current) return;
    // The form takes no edit until the whole save is done: the draft is
    // captured here, and an edit made while the waiting autosave is flushed
    // would be overwritten by the whole-project save that follows.
    savingRef.current = true;
    setSaving(true);
    try {
      await saveAll(over);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  async function saveAll(
    over: {
      server?: Project;
      draft?: Draft;
      basicsDirty?: boolean;
      via?: Autosave;
    },
  ) {
    setError("");
    const via = over.via ?? autosave;
    let d = over.draft ?? draft;
    const dirty = over.basicsDirty ?? basicsDirty;
    let base = over.server ?? server;
    const state = await via.coordinator.flush();
    // Still failing, refused or in conflict: the pill and the conflict view
    // say why, and the rest waits.
    if (state.pending || state.status === "conflict" || state.status === "stopped")
      return;
    const acked = via.getSnapshot().acked;
    if (acked && acked.revision > base.revision) {
      // Someone else changed a field this form edited: the conflict view
      // asks first.
      if (dirty && !sameOutsideOnboarding(acked, base)) return;
      // Untouched Basics follow the acknowledged version: the draft was
      // captured before the flush, so its Basics may predate a save made
      // elsewhere that the onboarding autosave merged over, and sending them
      // against the newer revision would silently put the old values back.
      // The onboarding part is what the flush just saved.
      if (!dirty) d = { ...draftFrom(acked), onboarding: d.onboarding };
      base = acked;
    }
    if (!dirty && base.flightdeckDraft) {
      onMessage(
        "Onboarding draft saved in Atlas. Nothing has been sent to FlightDeck.",
      );
      return;
    }
    // Saved against the revision the form is based on, so a change saved
    // elsewhere meanwhile is refused (409), never overwritten.
    const saved = await onSave(fieldsFrom(base, d), base);
    if (!saved) return;
    const fresh = draftFrom(saved);
    setServer(saved);
    setBasicsDirty(false);
    setRefreshedTo(null);
    const pending = via.coordinator.getState().pending;
    setDraft((cur) => ({
      ...fresh,
      onboarding: pending ? cur.onboarding : fresh.onboarding,
    }));
    if (!pending) {
      setOnboardingBase(fresh.onboarding);
      setAutosave(startAutosave(saved.revision));
    }
    onMessage(
      "Onboarding draft saved in Atlas. Nothing has been sent to FlightDeck.",
    );
  }
  // Leaving (tab close, reload, or an in-app route change) asks while any
  // local work is not on the server; nothing asks once everything is saved.
  const unsaved = hasUnsavedWork(save, basicsDirty || unsent, !!held);
  const unsavedRef = useRef(unsaved);
  useEffect(() => {
    unsavedRef.current = unsaved;
  });
  useEffect(() => {
    const off = registerLeaveGuard(() =>
      unsavedRef.current ? t("onb.autosave.leave", locale) : null,
    );
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!unsavedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      off();
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [locale]);
  // The held copy: kept in this tab while there is unsaved work, so a reload
  // offers it again; dropped once saved or chosen, and when the viewer
  // leaves the form after being asked.
  useEffect(() => {
    if (unsaved && !locked)
      writeHeld(viewerId, project.id, {
        draft,
        baseDraft: held?.base ?? baseDraft,
        basicsDirty,
        base: held?.baseRevision ?? server.revision,
      });
    else clearHeld(viewerId, project.id);
  });
  useEffect(
    () => () => clearHeld(viewerId, project.id),
    [viewerId, project.id],
  );
  async function send() {
    if (!target) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/flightdeck/onboard/${encodeURIComponent(project.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // A retry confirms the reserved revision, which it resends as
          // first sent; a new send confirms the revision Review showed, so
          // anything saved after it is refused (409 project_changed).
          body: JSON.stringify({
            destinationWorkspaceId: target,
            revision:
              retrying && op?.atlasRevision
                ? op.atlasRevision
                : server.revision,
          }),
        },
      );
      const raw: unknown = await response.json().catch(() => null);
      const ok = onboardingStatusSchema.safeParse(raw);
      if (response.ok && ok.success) {
        show(ok.data);
        onMessage(
          "Sent to FlightDeck for review. Nothing is created until an OS admin accepts it.",
        );
        return;
      }
      const refused = onboardErrorSchema.safeParse(raw);
      setError(
        refused.success
          ? refused.data.error +
              (refused.data.fields?.length
                ? ` (${refused.data.fields.map(fieldLabel).join(", ")})`
                : "")
          : "The send could not be completed. Try again.",
      );
      if (refused.success && refused.data.status) show(refused.data.status);
      else void load(false);
    } catch {
      setError("The send could not be completed. Try again.");
      void load(false);
    } finally {
      setSending(false);
    }
  }
  /** Closes the send FlightDeck never confirmed (or no longer knows), so
   * the draft opens again. Names the send this form shows, so a retry or a
   * new send made meanwhile is never closed by mistake. */
  async function closeSend() {
    if (!op) return;
    setClosing(true);
    setError("");
    try {
      const response = await fetch(
        `/api/flightdeck/onboard/${encodeURIComponent(project.id)}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updatedAt: op.updatedAt }),
        },
      );
      const raw: unknown = await response.json().catch(() => null);
      const ok = onboardingStatusSchema.safeParse(raw);
      if (response.ok && ok.success) {
        show(ok.data);
        setConfirmClose(false);
        onMessage(
          "The unconfirmed send is closed and the draft is open again. Nothing was sent to FlightDeck.",
        );
        return;
      }
      const refused = onboardErrorSchema.safeParse(raw);
      setError(
        refused.success
          ? refused.data.error
          : "The send could not be closed. Try again.",
      );
      if (refused.success && refused.data.status) show(refused.data.status);
      else void load(false);
    } catch {
      setError("The send could not be closed. Try again.");
      void load(false);
    } finally {
      setClosing(false);
    }
  }
  // A retry resends the reserved request, so today's draft (its readiness
  // and its text) does not decide whether it can go.
  const sendBlocked = !superAdmin
    ? "Only the Atlas Super Admin can send a project to FlightDeck."
    : !status
      ? "Atlas has not loaded this project's FlightDeck status yet."
      : !status.canSend
        ? "This project has already been sent to FlightDeck."
        : retrying
          ? ""
          : stale
            ? "This project was saved elsewhere. Choose Keep mine or Use theirs, then review it before sending."
            : unsaved
              ? "Save the draft first: FlightDeck receives the saved version."
              : !ready.ready
                ? `Complete the required details first (${ready.done} of ${ready.total}).`
                : privacy.refused.length
                  ? `Remove the email address or phone number from: ${privacy.refused.map(fieldLabel).join(", ")}. FlightDeck receives role titles and system names, not personal details.`
                  : "";
  const freeTextWarnings = (warned: string[]) =>
    warned.map((path) => (
      <p key={path} className="fd-warn" role="note">
        {fieldLabel(path)} is sent as written and looks like it contains an
        email address or phone number.
      </p>
    ));
  const rowList = (list: typeof rows) => (
    <dl>
      {list.map((row) => (
        <div key={row.path}>
          <dt>{row.label}</dt>
          <dd className={row.missing ? "missing" : ""}>
            {row.path === "target.workspaceId" && !row.missing
              ? workspaceLabel(row.value)
              : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );

  // A field's hint, warning or error is its control's description, so a
  // screen reader reads it with the label (WCAG 1.3.1, 3.3.1).
  const field = (
    id: string,
    label: string,
    control: React.ReactNode,
    extra?: React.ReactNode,
    wide = false,
  ) => {
    const described =
      extra !== undefined &&
      isValidElement<{ id?: string }>(control) &&
      control.props.id === id;
    return (
      <div className={`fd-field${wide ? " fd-wide" : ""}`}>
        <label htmlFor={id}>{label}</label>
        {described
          ? cloneElement(control as React.ReactElement<React.AriaAttributes>, {
              "aria-describedby": `${id}-desc`,
            })
          : control}
        {extra !== undefined &&
          (described ? (
            <div id={`${id}-desc`} className="fd-desc">
              {extra}
            </div>
          ) : (
            extra
          ))}
      </div>
    );
  };
  // A held conflict keeps edits local, so the pill never claims they are
  // saved while it waits for Keep mine or Use theirs.
  const pill = autosavePill(
    held && !["conflict", "stopped"].includes(save.status)
      ? { ...save, status: "conflict" }
      : unsent &&
          !["conflict", "stopped", "retrying", "saving"].includes(save.status)
        ? { ...save, status: "pending" }
        : save,
    { locale, savedAt: snap.savedAt, basicsDirty },
  );

  return (
    <form
      className="fd-onboard"
      onFocus={(e) => {
        if (e.target instanceof HTMLElement)
          keepClearOfStickyBars(e.target, actionsRef.current);
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void saveNow();
      }}
    >
      {op && <OnboardingTimeline stage={op.stage} />}
      {status && (
        <StatusBanner
          status={status}
          workspaces={workspaces}
          superAdmin={superAdmin}
        />
      )}
      {status && <WaitingDetails status={status} superAdmin={superAdmin} />}
      {unknown ? (
        <div className={`fd-banner${failed ? " warn" : ""}`} role="status">
          {failed ? <AlertTriangle size={16} /> : <Clock size={16} />}
          <p>
            {failed
              ? "FlightDeck status unavailable. Atlas cannot tell whether FlightDeck holds this draft, so it stays read-only for now. Atlas tries again shortly."
              : "Checking FlightDeck status. The draft stays read-only until Atlas knows whether FlightDeck holds it."}
          </p>
        </div>
      ) : (
        failed && (
          <p className="fd-hint" role="status">
            Onboarding status could not be checked. Atlas will try again.
          </p>
        )
      )}
      {!locked && held && (
        <ConflictPanel
          held={held}
          base={held.base}
          mine={draft}
          disabled={busy || saving}
          onKeepMine={keepMine}
          onUseTheirs={takeTheirs}
        />
      )}
      {!locked && !stale && refreshedTo === server.revision && (
        <p className="fd-hint" role="status">
          This project was saved elsewhere, so this form now shows revision{" "}
          {server.revision}. Review it again before sending.
        </p>
      )}
      <nav aria-label={t("onb.step.aria", locale)}>
        <ol className="filter-tabs fd-onboard-tabs fd-stepper">
          {ONBOARDING_STEPS.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                id={`fd-step-${item.id}`}
                aria-current={tab === item.id ? "step" : undefined}
                className={tab === item.id ? "chosen" : ""}
                onClick={() => step(item.id)}
              >
                <span className="fd-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                {t(STEP_LABEL[item.id], locale)}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {!locked && (
        <div className="fd-readiness">
          <div
            className="fd-meter-row"
            role="meter"
            aria-label="Required FlightDeck details"
            aria-valuemin={0}
            aria-valuemax={meter.total}
            aria-valuenow={meter.done}
            aria-valuetext={t(
              superAdmin ? "onb.meter.required" : "onb.meter.forYou",
              locale,
              { done: meter.done, total: meter.total },
            )}
          >
            <span>
              {t(
                superAdmin ? "onb.meter.required" : "onb.meter.forYou",
                locale,
                { done: meter.done, total: meter.total },
              )}
            </span>
            <span className="fd-meter" aria-hidden="true">
              <span style={{ width: `${(meter.done / meter.total) * 100}%` }} />
            </span>
          </div>
          {!meter.ready && (
            <ul className="fd-missing" aria-label="Missing details">
              {meter.items
                .filter((item) => !item.done)
                .map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => goTo(item.tab, item.field)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {!!summary.length && (
        <div
          ref={summaryRef}
          className="fd-error-summary"
          role="alert"
          tabIndex={-1}
          aria-labelledby={`fd-errors-${project.id}`}
        >
          <p id={`fd-errors-${project.id}`}>
            <AlertTriangle size={15} /> {t("onb.errors.title", locale)}
          </p>
          <ul>
            {summary.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className="text-link"
                  onClick={() => goTo(item.tab, item.field)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!suggestions.length && (
        <div className="fd-suggest">
          <p>
            <Sparkles size={15} /> From the onboarding checklist
          </p>
          <ul>
            {suggestions.map((s) => (
              <li key={s.field}>
                <strong>
                  {s.value.length > 80 ? `${s.value.slice(0, 79)}…` : s.value}
                </strong>{" "}
                <span className="fd-hint">for “{s.source}”</span>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={applySuggestions}
          >
            Apply checklist suggestions
          </Button>
        </div>
      )}
      {/* A step change moves focus here and is announced politely. */}
      <h2
        ref={stepHeadingRef}
        id={`fd-step-title-${project.id}`}
        className="fd-step-title"
        tabIndex={-1}
      >
        {t(STEP_LABEL[tab], locale)}
      </h2>
      <p className="sr-only" role="status" aria-live="polite">
        {stepMoved
          ? t("onb.step.position", locale, {
              n: stepIndex + 1,
              total: ONBOARDING_STEPS.length,
              name: t(STEP_LABEL[tab], locale),
            })
          : ""}
      </p>
      <fieldset
        disabled={frozen || busy || saving}
        id={`fd-panel-${tab}`}
        aria-labelledby={`fd-step-title-${project.id}`}
      >
        {tab === "basics" && (
          <div className="fd-grid">
            {field(
              "fd-label",
              "Proposed OS project name",
              <Input
                id="fd-label"
                required
                maxLength={100}
                value={draft.label}
                onChange={(e) => set("label", e.target.value)}
              />,
              <Hint text={draft.label} strict />,
            )}
            {field(
              "fd-workspace-note",
              "Preferred workspace (optional)",
              <Input
                id="fd-workspace-note"
                maxLength={100}
                placeholder="e.g. Operations Europe"
                value={draft.workspaceHint}
                onChange={(e) => set("workspaceHint", e.target.value)}
              />,
              <span className="fd-hint">
                A planning note for people. It is never sent and never chooses
                the destination.
              </span>,
            )}
            {field(
              "fd-function",
              "Function area",
              <Input
                id="fd-function"
                list="fd-functions"
                maxLength={80}
                value={draft.functionArea}
                onChange={(e) =>
                  setPrefillable("functionArea", "functionArea", e.target.value)
                }
              />,
              <>
                <Hint text={draft.functionArea} strict />
                {source("functionArea", draft.functionArea)}
              </>,
            )}
            <datalist id="fd-functions">
              {functions.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            {field(
              "fd-category",
              "Category",
              <Input
                id="fd-category"
                required
                maxLength={60}
                value={draft.category}
                onChange={(e) => set("category", e.target.value)}
              />,
              <Hint text={draft.category} strict />,
            )}
            {field(
              "fd-summary",
              "Summary",
              <Textarea
                id="fd-summary"
                maxLength={1500}
                rows={4}
                value={draft.description}
                onChange={(e) =>
                  setPrefillable("description", "summary", e.target.value)
                }
              />,
              <>
                <span className="fd-hint">
                  Context for the OS reviewer. Never put into a prompt.
                </span>
                <Hint text={draft.description} />
                {source("summary", draft.description)}
              </>,
              true,
            )}
            {field(
              "fd-success",
              "Success measure",
              <Textarea
                id="fd-success"
                maxLength={500}
                rows={2}
                value={draft.benefit}
                onChange={(e) =>
                  setPrefillable("benefit", "successMeasure", e.target.value)
                }
              />,
              <>
                <Hint text={draft.benefit} />
                {source("successMeasure", draft.benefit)}
              </>,
              true,
            )}
            {field(
              "fd-status",
              "Status",
              <select
                id="fd-status"
                className="fd-select"
                value={draft.status}
                onChange={(e) =>
                  set("status", e.target.value as Draft["status"])
                }
              >
                {["In progress", "Planning", "On hold", "Completed"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>,
            )}
            {field(
              "fd-priority",
              "Priority",
              <select
                id="fd-priority"
                className="fd-select"
                value={draft.priority}
                onChange={(e) =>
                  set("priority", e.target.value as Draft["priority"])
                }
              >
                <option value="">Not set</option>
                {["High", "Normal", "Low"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>,
            )}
            {field(
              "fd-target",
              "Target date",
              <Input
                id="fd-target"
                type="date"
                value={draft.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />,
            )}
            {field(
              "fd-site",
              "Site",
              <Input
                id="fd-site"
                maxLength={100}
                value={draft.location}
                onChange={(e) => set("location", e.target.value)}
              />,
              <Hint text={draft.location} strict />,
            )}
          </div>
        )}
        {tab === "details" && (
          <div className="fd-grid">
            {field(
              "fd-project-id",
              "Proposed OS project id (optional)",
              <Input
                id="fd-project-id"
                maxLength={64}
                placeholder={slugify(draft.label)}
                aria-invalid={!slugOk}
                value={draft.onboarding.proposedProjectId ?? ""}
                onChange={(e) =>
                  setDetail(
                    "proposedProjectId",
                    e.target.value.trim() || undefined,
                  )
                }
              />,
              <span className={slugOk ? "fd-hint" : "fd-warn"}>
                {slugOk
                  ? "Permanent once FlightDeck creates the project. Lowercase letters, digits and dashes."
                  : "Use lowercase letters, digits and dashes, starting with a letter or digit."}
              </span>,
            )}
            {field(
              "fd-country",
              "Country",
              <select
                id="fd-country"
                className="fd-select"
                value={draft.onboarding.countryCode ?? ""}
                onChange={(e) =>
                  setDetail("countryCode", e.target.value || undefined)
                }
              >
                <option value="">Choose a country</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>,
              <span className="fd-hint">
                Where the work happens. A cross-border fact for Legal.
              </span>,
            )}
            {field(
              "fd-works-council",
              "Works council relevant",
              <select
                id="fd-works-council"
                className="fd-select"
                value={draft.onboarding.worksCouncilRelevant ?? ""}
                onChange={(e) =>
                  setDetail(
                    "worksCouncilRelevant",
                    (e.target.value ||
                      undefined) as OnboardingDraft["worksCouncilRelevant"],
                  )
                }
              >
                <option value="">Choose</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Unknown</option>
              </select>,
              <span className="fd-hint">
                A fact for a human reviewer. It never starts or skips a step.
              </span>,
            )}
            {field(
              "fd-legal",
              "Legal entity (optional)",
              <Input
                id="fd-legal"
                maxLength={120}
                value={draft.onboarding.legalEntity ?? ""}
                onChange={(e) =>
                  setDetail("legalEntity", e.target.value || undefined)
                }
              />,
              <Hint text={draft.onboarding.legalEntity ?? ""} strict />,
            )}
            {field(
              "fd-headcount",
              "Headcount band (optional)",
              <select
                id="fd-headcount"
                className="fd-select"
                value={draft.onboarding.headcountBand ?? ""}
                onChange={(e) =>
                  setDetail(
                    "headcountBand",
                    (e.target.value ||
                      undefined) as OnboardingDraft["headcountBand"],
                  )
                }
              >
                <option value="">Not set</option>
                {headcountBands.map((band) => (
                  <option key={band} value={band}>
                    {t(`onb.headcount.${band}`, locale)}
                  </option>
                ))}
              </select>,
              <span className="fd-hint">A band, never a count.</span>,
            )}
            <p className="fd-hint fd-wide">
              Owner roles are role titles only, never names. People are
              appointed in FlightDeck from its own roster.
            </p>
            {(
              [
                ["process", "Process owner role"],
                ["data", "Data owner role"],
                ["support", "Support owner role"],
              ] as const
            ).map(([role, label]) =>
              field(
                `fd-role-${role}`,
                label,
                <Input
                  id={`fd-role-${role}`}
                  maxLength={80}
                  value={draft.onboarding.ownerRoles?.[role] ?? ""}
                  onChange={(e) => setRole(role, e.target.value)}
                />,
                <>
                  <Hint
                    text={draft.onboarding.ownerRoles?.[role] ?? ""}
                    strict
                  />
                  {source(
                    `ownerRoles.${role}`,
                    draft.onboarding.ownerRoles?.[role],
                  )}
                </>,
              ),
            )}
            <div className="fd-field fd-wide">
              <span id="fd-sources-label">Data sources</span>
              <ul className="fd-chips" aria-labelledby="fd-sources-label">
                {(draft.onboarding.dataSources ?? []).map((source, i) => (
                  <li key={`${source}-${i}`}>
                    {source}
                    <button
                      type="button"
                      aria-label={`Remove data source ${source}`}
                      onClick={() =>
                        setDetail(
                          "dataSources",
                          draft.onboarding.dataSources!.filter(
                            (_, j) => j !== i,
                          ),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="fd-add">
                <Input
                  aria-label="New data source"
                  maxLength={80}
                  placeholder="e.g. SAP HCM"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !newSource.trim() ||
                    (draft.onboarding.dataSources?.length ?? 0) >= 10
                  }
                  onClick={() => {
                    setDetail("dataSources", [
                      ...(draft.onboarding.dataSources ?? []),
                      newSource.trim(),
                    ]);
                    setNewSource("");
                  }}
                >
                  <Plus size={14} />
                  Add data source
                </Button>
              </div>
              <Hint
                text={[...(draft.onboarding.dataSources ?? []), newSource].join(
                  " ",
                )}
                strict
              />
            </div>
            <div className="fd-field fd-wide">
              <span id="fd-access-label">Access requested</span>
              <span className="fd-hint">
                Shown to the OS reviewer as to-dos. Nothing is granted by
                sending.
              </span>
              <ul className="fd-chips" aria-labelledby="fd-access-label">
                {(draft.onboarding.accessRequested ?? []).map((a, i) => (
                  <li key={`${a.system}-${i}`}>
                    {a.system} ({a.level})
                    <button
                      type="button"
                      aria-label={`Remove access request ${a.system}`}
                      onClick={() =>
                        setDetail(
                          "accessRequested",
                          draft.onboarding.accessRequested!.filter(
                            (_, j) => j !== i,
                          ),
                        )
                      }
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="fd-add">
                <Input
                  aria-label="System"
                  maxLength={80}
                  placeholder="e.g. SAP HCM"
                  value={newAccess.system}
                  onChange={(e) =>
                    setNewAccess({ ...newAccess, system: e.target.value })
                  }
                />
                <select
                  aria-label="Access level"
                  className="fd-select"
                  value={newAccess.level}
                  onChange={(e) =>
                    setNewAccess({
                      ...newAccess,
                      level: e.target.value as (typeof accessLevels)[number],
                    })
                  }
                >
                  {accessLevels.map((level) => (
                    <option key={level}>{level}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !newAccess.system.trim() ||
                    (draft.onboarding.accessRequested?.length ?? 0) >= 10
                  }
                  onClick={() => {
                    setDetail("accessRequested", [
                      ...(draft.onboarding.accessRequested ?? []),
                      {
                        system: newAccess.system.trim(),
                        level: newAccess.level,
                      },
                    ]);
                    setNewAccess({ system: "", level: "read" });
                  }}
                >
                  <Plus size={14} />
                  Add access request
                </Button>
              </div>
              <Hint
                text={[
                  ...(draft.onboarding.accessRequested ?? []).map(
                    (a) => a.system,
                  ),
                  newAccess.system,
                ].join(" ")}
                strict
              />
            </div>
            <label className="fd-check fd-wide" htmlFor="fd-cowork">
              <input
                id="fd-cowork"
                type="checkbox"
                checked={!!draft.onboarding.coworkRequested}
                onChange={(e) => setDetail("coworkRequested", e.target.checked)}
              />
              Ask FlightDeck to set this project up with Cowork
            </label>
            <label className="fd-check fd-wide" htmlFor="fd-ready">
              <input
                id="fd-ready"
                type="checkbox"
                checked={draft.ready}
                onChange={(e) => set("ready", e.target.checked)}
              />
              Mark this project Ready for FlightDeck
            </label>
          </div>
        )}
        {tab === "apps" && (
          <p className="fd-hint">{t("onb.step.apps.note", locale)}</p>
        )}
        {tab === "agents" && (
          <p className="fd-hint">{t("onb.step.agents.note", locale)}</p>
        )}
        {tab === "review" && (
          <div className="fd-review">
            {locked ? (
              retrying &&
              superAdmin && (
                <p className="fd-hint">
                  Destination workspace:{" "}
                  <strong>{workspaceLabel(target)}</strong> (kept for the retry,
                  so the same request goes to the same place).
                </p>
              )
            ) : superAdmin ? (
              field(
                "fd-destination",
                "Destination workspace",
                <select
                  id="fd-destination"
                  className="fd-select"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                >
                  <option value="">Choose a workspace</option>
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id} disabled={!w.enabled}>
                      {w.label || w.id}
                      {w.enabled ? "" : " (disabled)"}
                    </option>
                  ))}
                </select>,
                <span className="fd-hint">
                  {selectable.length
                    ? "Chosen here for this send only, and checked again with FlightDeck when you press Send."
                    : `FlightDeck workspaces are unavailable${contextState ? ` (${contextState.replace(/_/g, " ")})` : ""}.`}
                </span>,
              )
            ) : (
              <p className="fd-hint">
                The Atlas Super Admin chooses the destination workspace and
                sends the request.
              </p>
            )}
            {sent && op && (
              <section aria-label="Sent to FlightDeck">
                <h3>Sent to FlightDeck</h3>
                <p className="fd-sent">
                  {op.adopted
                    ? "FlightDeck already held a request for this project, and Atlas now follows it. Atlas did not record where it was sent or which revision it carries: FlightDeck's record is what counts."
                    : `FlightDeck received revision ${op.atlasRevision} of this project${target ? ` for ${workspaceLabel(target)}` : ""}. FlightDeck keeps what it received.`}{" "}
                  {changedSince
                    ? `This project is now at revision ${project.revision}; later edits are not sent.`
                    : "Later edits in Atlas are not sent."}
                </p>
              </section>
            )}
            {retrying &&
              (pending ? (
                <section aria-label="What Retry send resends">
                  <h3>What Retry send resends</h3>
                  {changedSince && (
                    <p className="fd-warn" role="note">
                      This project changed after the send (it is now at revision{" "}
                      {project.revision}). Retry send resends revision{" "}
                      {op?.atlasRevision} exactly as it was first sent, and
                      later edits are not included: FlightDeck may already hold
                      revision {op?.atlasRevision}.
                    </p>
                  )}
                  {freeTextWarnings(personalDataIn(pending).warned)}
                  {rowList(reviewRows(pending, { preview: false }))}
                </section>
              ) : (
                <p className="fd-hint">
                  A send of revision {op?.atlasRevision} is waiting for
                  FlightDeck to confirm it
                  {superAdmin
                    ? "."
                    : "; only the Atlas Super Admin can retry it."}
                </p>
              ))}
            {!locked && (
              <section aria-label="What will be sent">
                <h3>What will be sent</h3>
                {freeTextWarnings(privacy.warned)}
                {rowList(rows)}
              </section>
            )}
            <section className="fd-never">
              <h3>Never sent</h3>
              <ul aria-label="Never sent">
                {NEVER_SENT.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="fd-hint">{FREE_TEXT_NOTE}</p>
            </section>
          </div>
        )}
      </fieldset>
      {(prevStep || nextStep) && (
        <div className="fd-step-nav">
          {prevStep && (
            <Button
              type="button"
              variant="outline"
              onClick={() => step(prevStep)}
            >
              {t("onb.step.back", locale)}
            </Button>
          )}
          {nextStep && (
            <Button type="button" variant="outline" onClick={next}>
              {t("onb.step.next", locale)}
            </Button>
          )}
        </div>
      )}
      {tab === "review" && (
        <div className="fd-send">
          <p className="fd-hint">
            Sending files a request for review in FlightDeck. An OS admin
            decides; nothing becomes OS data until they accept it.
          </p>
          <p
            className="fd-warn"
            role="note"
            aria-labelledby={`fd-legal-title-${project.id}`}
          >
            <strong id={`fd-legal-title-${project.id}`}>
              Open Legal question.
            </strong>{" "}
            <span id={`fd-legal-${project.id}`}>{LEGAL_OPEN_NOTE}</span>
          </p>
          {superAdmin && (
            <Button
              type="button"
              aria-describedby={`fd-legal-${project.id}`}
              disabled={!!sendBlocked || sending || !target}
              onClick={() => void send()}
            >
              <Send size={14} />
              {sending
                ? "Sending…"
                : retrying
                  ? "Retry send"
                  : "Send to FlightDeck"}
            </Button>
          )}
          {sendBlocked && <span className="fd-hint">{sendBlocked}</span>}
        </div>
      )}
      {tab === "review" && superAdmin && status?.canClose && (
        <div className="fd-close">
          {confirmClose ? (
            <div role="group" aria-label="Close this unconfirmed send?">
              <p className="fd-warn" role="note">
                {retrying
                  ? "Close this send only when Retry send keeps being refused."
                  : "Close this send only when the OS admin confirms FlightDeck did not receive it."}{" "}
                Atlas stops following it and the draft opens again, so you can
                correct it and send it with a new key. If FlightDeck did file
                it, the next send follows that request instead of filing a
                second one.
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={closing}
                onClick={() => void closeSend()}
              >
                {closing ? "Closing…" : "Close the send"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={closing}
                onClick={() => setConfirmClose(false)}
              >
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmClose(true)}
            >
              Close this unconfirmed send
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {/* Sticky at the foot of the viewport; a focused control is scrolled
          clear of it (keepClearOfStickyBars). */}
      <div ref={actionsRef} className="bridge-actions fd-actions">
        {(!locked || save.pending) && (
          <p
            className={`fd-autosave ${pill.tone}`}
            role="status"
            aria-live="polite"
            aria-label={t("onb.autosave.label", locale)}
          >
            {pill.text}
          </p>
        )}
        <Button
          type="submit"
          disabled={
            busy || saving || frozen || !!held || !draft.label.trim() || !slugOk
          }
        >
          {t("onb.autosave.saveNow", locale)}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (confirmLeave()) onClose();
          }}
        >
          Close
        </Button>
      </div>
    </form>
  );
}

/** The dashboard card: what is actually live. */
export function FlightDeckPromo({
  superAdmin,
  onOpen,
}: {
  superAdmin: boolean;
  onOpen: () => void;
}) {
  const locale = useLocale();
  const { stages, failed } = useOnboardingStages(superAdmin);
  const line = !stages
    ? failed
      ? t("onb.promo.unavailable", locale)
      : t("onb.promo.checking", locale)
    : onboardingSummaryLine(Object.values(stages), locale);
  return (
    <div className="flightdeck-promo">
      <span className="promo-mark">
        <Layers3 size={23} />
      </span>
      <h3>FlightDeck OS</h3>
      <p>{line}</p>
      <button className="text-link" onClick={onOpen}>
        {t("onb.promo.open", locale)} <ArrowUpRight size={16} />
      </button>
      <small>{t("onb.promo.import", locale)}</small>
    </div>
  );
}
