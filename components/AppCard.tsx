"use client";
/** @jsxImportSource react */
// (The pragma keeps React's own JSX runtime when a Playwright spec renders
// this file in Node; Playwright otherwise swaps in its component-test JSX.)
// apps-33: Atlas's ONE app card, the same contract as the OS's SubAppCard
// (apps-07; plan 2026-09-25 Lane B, "One card specification for OS and
// Atlas"; D-037). It renders one apps-directory entry and decides nothing:
//
//   openable  two sibling links: "Open in FlightDeck OS" (a new tab, since
//             the OS is another site) and "See more" to /apps/os/<id>, plus
//             the visible "Access is checked when you open it" (Atlas signs
//             in with a machine credential and cannot answer for the user).
//   locked    exactly ONE link, "<label>, see more", to /apps/os/<id>. Its
//             ::after is stretched over the card (suite.css .app-card-stretch)
//             so a click anywhere on the card follows it. The reason and who
//             can change it are VISIBLE text in full contrast, attached with
//             aria-describedby.
//   pin       enabled only: a sibling <button>, never inside a link.
import { useId } from "react";
import { Lock, Star } from "lucide-react";
import { useT } from "@/lib/i18n/react";
import { appCardModel } from "@/lib/flightdeck/app-card";
import type { DirectoryApp } from "@/lib/flightdeck/apps-directory-route";

export function AppCard({
  app,
  pinned = false,
  recent = false,
  busy = false,
  onPin,
  onOpen,
}: {
  app: DirectoryApp;
  pinned?: boolean;
  recent?: boolean;
  busy?: boolean;
  /** Enabled apps only: toggles the favourite. Absent = no pin. */
  onPin?: () => void;
  /** Enabled apps only: called when Open is followed (Recently opened). */
  onOpen?: () => void;
}) {
  const t = useT();
  const uid = useId();
  const titleId = `${uid}-title`;
  const reasonId = `${uid}-reason`;
  const m = appCardModel(app);
  const icon = (
    <span className="app-icon app-monogram" aria-hidden="true">
      {app.icon || app.label.slice(0, 2).toUpperCase()}
    </span>
  );
  const title = (
    <strong id={titleId} className="app-card-title">
      {app.label}
    </strong>
  );
  return (
    <article
      className={`app-card${m.openable ? "" : " locked"}`}
      aria-labelledby={titleId}
      data-app-id={app.id}
      data-openable={m.openable ? "true" : "false"}
    >
      {m.openable && onPin && (
        <button
          type="button"
          className="app-pin"
          aria-label={t(pinned ? "apps.card.unpin" : "apps.card.pin", {
            label: app.label,
          })}
          aria-pressed={pinned}
          disabled={busy}
          onClick={onPin}
        >
          <Star size={14} fill={pinned ? "currentColor" : "none"} />
        </button>
      )}
      <div className="app-card-head">
        {icon}
        {m.openable ? (
          title
        ) : (
          <a
            href={m.bridgeHref}
            className="app-card-stretch"
            aria-label={t("apps.card.lockedAria", { label: app.label })}
            aria-describedby={reasonId}
          >
            {title}
          </a>
        )}
      </div>
      {app.tagline && <p className="app-card-line">{app.tagline}</p>}
      {m.openable ? (
        <>
          <p className="app-card-note">{t("apps.card.accessNote")}</p>
          <div className="app-card-actions">
            <a
              href={m.openUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="app-card-action primary"
              aria-label={t("apps.card.openAria", { label: app.label })}
              onClick={onOpen}
            >
              {t("apps.card.open")}
            </a>
            <a
              href={m.bridgeHref}
              className="app-card-action"
              aria-label={t("apps.card.seeMoreAria", { label: app.label })}
            >
              {t("apps.card.seeMore")}
            </a>
          </div>
          {recent && <span className="app-recent">{t("apps.card.recent")}</span>}
        </>
      ) : (
        <p className="app-card-reason" id={reasonId}>
          <Lock size={13} aria-hidden="true" className="app-card-lock" />
          {t(m.reasonKey!)}
          {m.partyKey ? ` ${t(m.partyKey)}` : ""}
        </p>
      )}
    </article>
  );
}
