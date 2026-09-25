"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FREE_TEXT_NOTE,
  ISO_COUNTRY_CODES,
  LEGAL_OPEN_NOTE,
  NEVER_SENT,
  accessLevels,
  buildOnboardingPayload,
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
  readiness,
  reviewRows,
  timelineSteps,
  type OnboardingDraft,
  type OnboardingStage,
  type OnboardingStatus,
  type OnboardingTab,
} from "@/lib/flightdeck/onboarding";

// The To FlightDeck form: Basics (prefilled from the Atlas project), the
// FlightDeck details, and Review & send, which lists every field that will
// travel. Sending files a request for an OS admin to review; nothing is
// created automatically. The browser only ever talks to Atlas's own
// /api/flightdeck/onboard routes.
const TABS: { id: OnboardingTab; label: string }[] = [
  { id: "basics", label: "Basics" },
  { id: "details", label: "FlightDeck details" },
  { id: "review", label: "Review & send" },
];
const POLL_MS = 60_000;
/** The first retry after the form could not load its status at all: the
 * draft stays read-only until it has, so the wait starts short. */
const FIRST_RETRY_MS = 5_000;
const MAX_BACKOFF_MS = 15 * 60_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PREVIEW_KEY = "00000000-0000-4000-8000-000000000000";
const PREVIEW_HASH = "0".repeat(64);
export const STAGE_LABEL: Record<OnboardingStage, string> = {
  "not-confirmed": "Not confirmed",
  submitted: "Submitted",
  linked: "Linked",
  "setup-in-progress": "Setup in progress",
  "setup-complete": "Setup complete",
  "needs-more-info": "Needs more info",
  rejected: "Declined",
  "not-sent": "Not sent",
  closed: "Send closed",
};
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
/** When Atlas last read the send back, for a status that can still change:
 * Atlas has no background job, so it can be out of date. */
export const checkedLine = (checkedAt: string | null) =>
  checkedAt
    ? `Last checked with FlightDeck: ${when(checkedAt)}`
    : "Not checked with FlightDeck yet";
export const CHECK_NOTE =
  "Atlas checks FlightDeck only while the Atlas Super Admin has Atlas open.";
const REASON_TEXT: Record<string, string> = {
  os_unreachable: "FlightDeck could not be reached.",
  invalid_response: "FlightDeck answered unexpectedly.",
  rate_limited: "FlightDeck was busy.",
  already_submitted: "FlightDeck already holds a request for this project.",
  invalid_submission: "FlightDeck rejected the request format.",
  unauthorized: "FlightDeck refused Atlas's credential.",
  refused:
    "Project onboarding is not enabled for Atlas in FlightDeck, or Atlas's credential lacks submit:proposal.",
  invalid_payload: "Some details were not in the agreed format.",
  project_not_visible:
    "FlightDeck accepted it and is creating the project; Atlas is waiting to see it listed.",
  destination_not_shared:
    "FlightDeck accepted it into a workspace that is not shared with Atlas, so Atlas cannot confirm it.",
  credential_scope:
    "FlightDeck accepted it, but Atlas's credential lacks read:context, so Atlas cannot see the outcome.",
  lock_unreadable:
    "FlightDeck needs an operator to inspect this request's lock.",
  idempotency_key_conflict:
    "FlightDeck holds this request's key for a different Atlas project, so nothing was filed.",
  instance_unknown:
    "FlightDeck does not publish its instance id yet, so Atlas cannot record the link.",
  link_conflict:
    "That FlightDeck project is already linked elsewhere, so Atlas did not link it.",
  submission_not_found: "FlightDeck does not know this request.",
  // An editor's view of a send FlightDeck holds but has not yet linked.
  waiting_to_be_filed: "Sent, waiting for FlightDeck to file it.",
  abandoned: "The Atlas Super Admin closed it before FlightDeck confirmed it.",
  duplicate: "It duplicates another request.",
  "out-of-scope": "It is out of scope for FlightDeck.",
  other: "No reason code was given.",
};
const COUNTRIES = ISO_COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
})).sort((a, b) => a.name.localeCompare(b.name));
const HEADCOUNT_LABEL: Record<(typeof headcountBands)[number], string> = {
  "<50": "Fewer than 50",
  "50-249": "50 to 249",
  "250+": "250 or more",
  unknown: "Unknown",
};
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
      if (!next) {
        delay.current = Math.min(delay.current * 2, MAX_BACKOFF_MS);
        setFailed(true);
        return;
      }
      delay.current = next.retryAfter
        ? Math.max(POLL_MS, next.retryAfter * 1000)
        : next.notice
          ? Math.min(delay.current * 2, MAX_BACKOFF_MS)
          : POLL_MS;
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
  return (
    <ol className="fd-timeline" aria-label="FlightDeck status">
      {timelineSteps(stage).map((step) => (
        <li
          key={step.stage}
          className={step.state === "done" ? "done" : ""}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          {STAGE_LABEL[step.stage]}
        </li>
      ))}
    </ol>
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
  const op = status.operation;
  if (!op) return null;
  const reason = op.reasonCode ? REASON_TEXT[op.reasonCode] || "" : "";
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
  // "Last checked" belongs to a status that can still change on its own,
  // which the server itself decides (pollable) — not to every locked draft.
  const open = status.pollable;
  return (
    <div className={`fd-banner ${tone}`}>
      {tone ? <AlertTriangle size={16} /> : <Check size={16} />}
      <p>
        {text.trim()}
        {status.notice && <span className="fd-hint"> {status.notice}</span>}
        {open && (
          <span className="fd-hint">
            {" "}
            {checkedLine(op.checkedAt)}.{superAdmin ? "" : ` ${CHECK_NOTE}`}
          </span>
        )}
      </p>
    </div>
  );
}

/** `strict`: every field except Summary and Success measure, where the
 * server refuses an email or phone-number shape. */
function Hint({ text, strict = false }: { text: string; strict?: boolean }) {
  const hint = personalDataHint(text, strict);
  return hint ? (
    <span className="fd-warn" role="note">
      {hint}
    </span>
  ) : null;
}

export function OnboardingEditor({
  project,
  superAdmin,
  busy,
  workspaces,
  contextState,
  onSave,
  onClose,
  onMessage,
  onStage,
}: {
  project: Project;
  superAdmin: boolean;
  busy: boolean;
  workspaces: OsContextEntry[];
  contextState: string | null;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  onClose: () => void;
  onMessage: (message: string) => void;
  onStage: (id: string, stage: OnboardingStage | null) => void;
}) {
  const [draft, setDraft] = useState(() => draftFrom(project));
  const [dirty, setDirty] = useState(false);
  // The revision the draft was built from. Atlas reloads its projects on
  // focus and every minute, so a save elsewhere can arrive while the form
  // is open: an untouched draft follows it, so Review always shows what the
  // server would send; an edited one keeps the edits, but may neither save
  // over that change nor be sent until the latest version is loaded.
  const [base, setBase] = useState(project.revision);
  const [refreshedTo, setRefreshedTo] = useState<number | null>(null);
  if (project.revision !== base && !dirty) {
    setBase(project.revision);
    setDraft(draftFrom(project));
    setRefreshedTo(project.revision);
  }
  const stale = project.revision !== base;
  const [tab, setTab] = useState<OnboardingTab>("basics");
  const [destination, setDestination] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [error, setError] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newAccess, setNewAccess] = useState<{
    system: string;
    level: (typeof accessLevels)[number];
  }>({ system: "", level: "read" });
  const pendingFocus = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { status, show, failed, load } = useOnboardingStatus(
    project.id,
    superAdmin,
    onStage,
  );
  const op = status?.operation ?? null;
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [tab]);

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
  const ready = readiness(preview, target || null);
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
    setDirty(true);
  };
  const setDetail = <K extends keyof OnboardingDraft>(
    key: K,
    value: OnboardingDraft[K],
  ) => {
    setDraft((d) => ({ ...d, onboarding: { ...d.onboarding, [key]: value } }));
    setDirty(true);
  };
  const setRole = (role: "process" | "data" | "support", value: string) =>
    setDetail("ownerRoles", { ...draft.onboarding.ownerRoles, [role]: value });
  function goTo(next: OnboardingTab, field: string) {
    if (next === tab) document.getElementById(field)?.focus();
    else {
      pendingFocus.current = field;
      setTab(next);
    }
  }
  function applySuggestions() {
    setDraft((d) => {
      const next = {
        ...d,
        onboarding: {
          ...d.onboarding,
          ownerRoles: { ...d.onboarding.ownerRoles },
        },
      };
      for (const s of suggestions) {
        if (s.field === "functionArea") next.functionArea = s.value;
        else if (s.field === "summary") next.description = s.value;
        else if (s.field === "successMeasure") next.benefit = s.value;
        else
          next.onboarding.ownerRoles[
            s.field.slice("ownerRoles.".length) as
              "process" | "data" | "support"
          ] = s.value;
      }
      return next;
    });
    setDirty(true);
  }
  function loadLatest() {
    setBase(project.revision);
    setDraft(draftFrom(project));
    setDirty(false);
    setRefreshedTo(null);
  }
  async function save() {
    if (frozen) return;
    setError("");
    // Saved against the revision the edits were made on, so a change saved
    // elsewhere meanwhile is refused (409), never overwritten.
    const saved = await onSave(fieldsFrom(project, draft), {
      ...project,
      revision: base,
    });
    if (saved) {
      setBase(saved.revision);
      setDraft(draftFrom(saved));
      setRefreshedTo(null);
      setDirty(false);
      onMessage(
        "Onboarding draft saved in Atlas. Nothing has been sent to FlightDeck.",
      );
    }
  }
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
            revision: retrying && op?.atlasRevision ? op.atlasRevision : base,
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
            ? "This project was saved elsewhere. Load the latest version and review it before sending."
            : dirty
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

  const field = (
    id: string,
    label: string,
    control: React.ReactNode,
    extra?: React.ReactNode,
    wide = false,
  ) => (
    <div className={`fd-field${wide ? " fd-wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {control}
      {extra}
    </div>
  );
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next =
      TABS[
        (index + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length
      ];
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <form
      className="fd-onboard"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
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
      {!locked && stale && (
        <div className="fd-banner warn" role="alert">
          <AlertTriangle size={16} />
          <p>
            This project was saved elsewhere (now revision {project.revision})
            after you started editing revision {base}. Your edits are kept here,
            but saving them would overwrite that change, so Save and Send wait
            until you load the latest version.{" "}
            <Button type="button" variant="outline" onClick={loadLatest}>
              Discard my edits and load revision {project.revision}
            </Button>
          </p>
        </div>
      )}
      {!locked && !stale && refreshedTo === project.revision && (
        <p className="fd-hint" role="status">
          This project was saved elsewhere, so this form now shows revision{" "}
          {project.revision}. Review it again before sending.
        </p>
      )}
      <div
        role="tablist"
        aria-label="FlightDeck onboarding"
        className="filter-tabs fd-onboard-tabs"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`fd-tab-${t.id}`}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            aria-selected={tab === t.id}
            // Only the chosen tab's panel is rendered, so only that tab
            // names one: an id that is not in the page is a dead reference.
            aria-controls={tab === t.id ? `fd-panel-${t.id}` : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "chosen" : ""}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {!locked && (
        <div className="fd-readiness">
          <div
            className="fd-meter-row"
            role="meter"
            aria-label="Required FlightDeck details"
            aria-valuemin={0}
            aria-valuemax={ready.total}
            aria-valuenow={ready.done}
            aria-valuetext={`${ready.done} of ${ready.total} required`}
          >
            <span>
              {ready.done} of {ready.total} required
            </span>
            <span className="fd-meter" aria-hidden="true">
              <span style={{ width: `${(ready.done / ready.total) * 100}%` }} />
            </span>
          </div>
          {!ready.ready && (
            <ul className="fd-missing" aria-label="Missing details">
              {ready.items
                .filter((item) => !item.done)
                .map((item) => (
                  <li key={item.key}>
                    {item.key === "destination" && !superAdmin ? (
                      <span className="fd-hint">
                        {item.label} (chosen by the Atlas Super Admin)
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => goTo(item.tab, item.field)}
                      >
                        {item.label}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          )}
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
          <Button type="button" variant="outline" onClick={applySuggestions}>
            Apply checklist suggestions
          </Button>
        </div>
      )}
      <fieldset
        disabled={frozen || busy}
        id={`fd-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`fd-tab-${tab}`}
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
              <>
                <Input
                  id="fd-function"
                  list="fd-functions"
                  maxLength={80}
                  value={draft.functionArea}
                  onChange={(e) => set("functionArea", e.target.value)}
                />
                <datalist id="fd-functions">
                  {functions.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </>,
              <Hint text={draft.functionArea} strict />,
            )}
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
                onChange={(e) => set("description", e.target.value)}
              />,
              <>
                <span className="fd-hint">
                  Context for the OS reviewer. Never put into a prompt.
                </span>
                <Hint text={draft.description} />
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
                onChange={(e) => set("benefit", e.target.value)}
              />,
              <Hint text={draft.benefit} />,
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
                    {HEADCOUNT_LABEL[band]}
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
                <Hint
                  text={draft.onboarding.ownerRoles?.[role] ?? ""}
                  strict
                />,
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
      <div className="bridge-actions">
        <Button
          type="submit"
          disabled={busy || frozen || stale || !draft.label.trim() || !slugOk}
        >
          Save onboarding draft
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
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
  const { stages, failed } = useOnboardingStages(superAdmin);
  const line = !stages
    ? failed
      ? "Onboarding status is unavailable right now."
      : "Checking onboarding status…"
    : onboardingSummaryLine(Object.values(stages));
  return (
    <div className="flightdeck-promo">
      <span className="promo-mark">
        <Layers3 size={23} />
      </span>
      <h3>FlightDeck OS</h3>
      <p>{line}</p>
      <button className="text-link" onClick={onOpen}>
        FlightDeck connection <ArrowUpRight size={16} />
      </button>
      <small>Import from FlightDeck: not enabled</small>
    </div>
  );
}
