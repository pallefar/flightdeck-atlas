"use client";
// The FlightDeck card on the Atlas project page (plan 2026-09-25 J1): the
// requester starts where they already work. Its state (Prepare / Continue /
// Waiting / Fix / Created) follows the draft and the viewer's approved status
// projection; the rules live in lib/flightdeck/project-card.ts. The form it
// opens is the same OnboardingEditor the connection page uses, so Send stays
// the Atlas Super Admin's (Decision 7) and an editor never sees workspaces.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpRight, Check, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project, ProjectFields } from "@/lib/projects";
import type {
  OnboardingStage,
  OnboardingStatus,
} from "@/lib/flightdeck/onboarding";
import {
  CARD_ANCHOR,
  cardVisible,
  projectCardView,
} from "@/lib/flightdeck/project-card";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/react";
import { useFlightDeckContext } from "./flightdeck-context-switcher";
import { useWorkspace } from "./workspace-tools";
import {
  OnboardingEditor,
  STATUS_POLL_MS,
  WaitingDetails,
  fetchStatus,
  nextStatusDelay,
  stageLabel,
} from "./flightdeck-onboarding";

type SaveFn = (
  fields: ProjectFields,
  existing?: Project,
) => Promise<Project | null>;

export default function FlightDeckProjectCard(props: {
  project: Project;
  superAdmin: boolean;
  requesterRequests: boolean;
  demo: boolean;
  busy: boolean;
  onSave: SaveFn;
}) {
  const visible = cardVisible({
    superAdmin: props.superAdmin,
    canEdit: props.project.canEdit !== false && !props.project.archived,
    requesterRequests: props.requesterRequests,
    demo: props.demo,
  });
  return visible ? <Card {...props} /> : null;
}

function Card({
  project: given,
  superAdmin,
  requesterRequests,
  busy,
  onSave,
}: {
  project: Project;
  superAdmin: boolean;
  requesterRequests: boolean;
  busy: boolean;
  onSave: SaveFn;
}) {
  const locale = useLocale();
  // The form's own saves (an autosave, an ask, a withdraw) answer with the
  // saved project; the card follows the newest version it has seen, so it
  // reads "Waiting for Super Admin" as soon as the ask lands.
  const [saved, setSaved] = useState<Project | null>(null);
  const project =
    saved && saved.id === given.id && saved.revision > given.revision
      ? saved
      : given;
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const { data: workspace } = useWorkspace();
  const osOrigin = (
    workspace?.apps.find((x) => x.id === "flightdeck")?.url ?? ""
  ).replace(/\/+$/, "");
  // The wait before the next read (nextStatusDelay: a minute, FlightDeck's
  // Retry-After, or doubling after a failure) and the stage last shown.
  const delay = useRef(STATUS_POLL_MS);
  const shownStage = useRef<OnboardingStage | null | undefined>(undefined);
  const load = useCallback(
    (refresh: boolean) =>
      fetchStatus(project.id, refresh).then((next) => {
        delay.current = nextStatusDelay(delay.current, next);
        if (next) {
          setStatus(next);
          shownStage.current = next.operation?.stage ?? null;
        }
        setFailed(!next);
      }),
    [project.id],
  );
  // Load on open and after each saved edit. Only the Super Admin's read may
  // ask the server to check FlightDeck (fetchStatus).
  useEffect(() => {
    void load(superAdmin);
  }, [load, superAdmin, project.revision]);
  // Read again while FlightDeck may still move it (or while it could not be
  // read), whenever a read (the poll's, the open's or the form's) left it
  // so; the delay honours Retry-After and backs off. While the form is open
  // it reads the status itself and reports stage changes (onStage).
  useEffect(() => {
    if (editing || !(failed || status?.pollable)) return;
    const timer = window.setTimeout(
      () => void load(superAdmin).then(() => setAttempt((n) => n + 1)),
      delay.current,
    );
    return () => window.clearTimeout(timer);
  }, [status, failed, attempt, editing, superAdmin, load]);
  // Stable: the form's status hook depends on it, and calls it after every
  // read; a new function each render restarted the form's read, in a loop.
  // The form has just read (and, for the Super Admin, checked) the status,
  // so the card only re-reads the stored one, and only when the stage moved.
  const onStage = useCallback(
    (_id: string, stage: OnboardingStage | null) => {
      if (stage !== shownStage.current) void load(false);
    },
    [load],
  );
  const onClose = useCallback(() => {
    setEditing(false);
    void load(false);
    heading.current?.focus();
  }, [load]);
  // The connection page's rows link here (#flightdeck).
  useEffect(() => {
    if (location.hash !== `#${CARD_ANCHOR}`) return;
    heading.current?.scrollIntoView({ block: "start" });
    heading.current?.focus();
  }, []);

  const view = projectCardView({
    project,
    status,
    failed,
    superAdmin,
    osOrigin,
    requesterRequests,
  });
  let title = "",
    text = "",
    action = "",
    warn = false,
    extra = "";
  switch (view.kind) {
    case "checking":
      text = t("onb.promo.checking", locale);
      break;
    case "unavailable":
      text = t("onb.promo.unavailable", locale);
      warn = true;
      break;
    case "prepare":
      title = t("onb.card.prepare", locale);
      text = t("onb.card.prepare.text", locale);
      action = title;
      break;
    case "continue":
      title = t("onb.card.continue", locale, {
        done: view.done,
        total: view.total,
      });
      text = t("onb.card.continue.text", locale);
      action = t("onb.card.continue", locale, {
        done: view.done,
        total: view.total,
      });
      if (view.stage)
        extra = t("onb.card.lastStage", locale, {
          stage: stageLabel(view.stage, locale),
        });
      break;
    case "waiting":
      title = t(
        view.on === "superAdmin"
          ? "onb.card.waitingSuperAdmin"
          : "onb.card.waitingFlightDeck",
        locale,
      );
      text = t(
        view.on === "superAdmin"
          ? "onb.card.waitingSuperAdmin.text"
          : "onb.card.waitingFlightDeck.text",
        locale,
      );
      warn = view.on === "superAdmin";
      action = t("onb.card.view", locale);
      break;
    case "asked":
      // The editor waits on the Super Admin; the Super Admin is the one
      // asked. A stale ask asks the editor to look again.
      title = superAdmin
        ? t("onb.waiting.card", locale, { revision: view.revision })
        : view.stale
          ? t("onb.ask.changed", locale)
          : t("onb.ask.waiting", locale, { revision: view.revision });
      text = superAdmin
        ? view.stale
          ? t("onb.waiting.changed", locale)
          : t("onb.card.continue.text", locale)
        : t(
            view.stale ? "onb.ask.changed.text" : "onb.ask.waiting.text",
            locale,
            { revision: view.revision },
          );
      warn = view.stale;
      action = superAdmin
        ? t("onb.waiting.review", locale)
        : view.stale
          ? t("onb.ask.changed", locale)
          : t("onb.card.view", locale);
      break;
    case "fix":
      title = t("onb.card.fix", locale);
      text = t("onb.card.fix.text", locale);
      warn = true;
      action = title;
      break;
    case "created":
      title = t("onb.card.created", locale);
      text = `${t("onb.card.created.text", locale)} ${stageLabel(view.stage, locale)}.`;
      action = t("onb.card.view", locale);
      break;
  }
  const headingId = `${CARD_ANCHOR}-title`;
  return (
    <section
      className="hub-card fd-project-card"
      id={CARD_ANCHOR}
      aria-labelledby={headingId}
    >
      <span className="fd-project-card-mark" aria-hidden="true">
        <Layers3 size={21} />
      </span>
      <div className="fd-project-card-body">
        <h3 id={headingId} ref={heading} tabIndex={-1}>
          {t("onb.card.title", locale)}
          {title && <span className="fd-project-card-state">{title}</span>}
        </h3>
        <div className={`fd-banner ${warn ? "warn" : ""}`}>
          {warn ? <AlertTriangle size={16} /> : <Check size={16} />}
          <p>
            {text}
            {extra && <span className="fd-hint"> {extra}</span>}
          </p>
        </div>
        {/* Next step, outage, response policy and freshness; the log and
            the earlier sends are in the form behind View status. */}
        {!editing &&
          status &&
          view.kind !== "continue" &&
          view.kind !== "asked" && (
          <WaitingDetails status={status} superAdmin={superAdmin} compact />
        )}
        {message && (
          <p className="fd-hint" role="status">
            {message}
          </p>
        )}
        {!editing && (action || (view.kind === "created" && view.openHref)) && (
          <div className="bridge-actions">
            {action && (
              <Button
                variant={view.kind === "created" ? "outline" : "default"}
                disabled={busy}
                onClick={() => {
                  setMessage("");
                  setEditing(true);
                }}
              >
                {action}
              </Button>
            )}
            {view.kind === "created" && view.openHref && (
              <a
                className="text-link"
                href={view.openHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("onb.card.open", locale)} <ArrowUpRight size={14} />
              </a>
            )}
          </div>
        )}
        {editing && (
          <CardEditor
            project={project}
            superAdmin={superAdmin}
            requesterRequests={requesterRequests}
            busy={busy}
            onSave={onSave}
            onSaved={setSaved}
            onMessage={setMessage}
            onClose={onClose}
            onStage={onStage}
          />
        )}
      </div>
    </section>
  );
}

/** Mounted only while open, so the Super Admin's workspace lists are read
 * only when a destination may actually be chosen. */
function CardEditor({
  project,
  superAdmin,
  requesterRequests,
  busy,
  onSave,
  onSaved,
  onMessage,
  onClose,
  onStage,
}: {
  project: Project;
  superAdmin: boolean;
  requesterRequests: boolean;
  busy: boolean;
  onSave: SaveFn;
  onSaved: (project: Project) => void;
  onMessage: (message: string) => void;
  onClose: () => void;
  onStage: (id: string, stage: OnboardingStage | null) => void;
}) {
  const context = useFlightDeckContext(superAdmin);
  return (
    <OnboardingEditor
      project={project}
      superAdmin={superAdmin}
      busy={busy}
      workspaces={superAdmin ? context.workspaces : []}
      contextState={superAdmin ? context.state : null}
      requesterRequests={requesterRequests}
      onSave={onSave}
      onAutosaved={onSaved}
      onClose={onClose}
      onMessage={onMessage}
      onStage={onStage}
    />
  );
}
