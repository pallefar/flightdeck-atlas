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
import type { OnboardingStatus } from "@/lib/flightdeck/onboarding";
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
  checkedLine,
  fetchStatus,
  stageLabel,
} from "./flightdeck-onboarding";

const POLL_MS = 60_000;

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
  project,
  superAdmin,
  busy,
  onSave,
}: {
  project: Project;
  superAdmin: boolean;
  busy: boolean;
  onSave: SaveFn;
}) {
  const locale = useLocale();
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
  const load = useCallback(
    () =>
      fetchStatus(project.id, superAdmin).then((next) => {
        if (next) setStatus(next);
        setFailed(!next);
        return next;
      }),
    [project.id, superAdmin],
  );
  // Load on open and after each edit; reload every minute while FlightDeck
  // may still move it (or while it could not be read). Only the Super
  // Admin's read may ask the server to check FlightDeck (fetchStatus).
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    void load().then((next) => {
      if (live && (!next || next.pollable))
        timer = window.setTimeout(() => setAttempt((n) => n + 1), POLL_MS);
    });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [load, project.revision, attempt]);
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
      extra = checkedLine(view.checkedAt, locale);
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
            busy={busy}
            onSave={onSave}
            onMessage={setMessage}
            onClose={() => {
              setEditing(false);
              void load();
              heading.current?.focus();
            }}
            onStage={() => void load()}
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
  busy,
  onSave,
  onMessage,
  onClose,
  onStage,
}: {
  project: Project;
  superAdmin: boolean;
  busy: boolean;
  onSave: SaveFn;
  onMessage: (message: string) => void;
  onClose: () => void;
  onStage: () => void;
}) {
  const context = useFlightDeckContext(superAdmin);
  return (
    <OnboardingEditor
      project={project}
      superAdmin={superAdmin}
      busy={busy}
      workspaces={superAdmin ? context.workspaces : []}
      contextState={superAdmin ? context.state : null}
      onSave={onSave}
      onClose={onClose}
      onMessage={onMessage}
      onStage={onStage}
    />
  );
}
