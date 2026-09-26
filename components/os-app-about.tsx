"use client";
/** @jsxImportSource react */
// (The pragma keeps React's own JSX runtime when a Playwright spec renders
// this file in Node; Playwright otherwise swaps in its component-test JSX.)
// apps-33: the minimal "About <App>" page behind every FlightDeck card's
// See more / locked link (/apps/os/<id>), so no card link is a dead end.
// It shows only what the apps directory already says for the selected OS
// project. apps-34 replaces it with the published release (hero, highlights,
// media, requirements). Enabling and requesting access never happen here.
import { useT } from "@/lib/i18n/react";
import { appCardModel, type SectionView } from "@/lib/flightdeck/app-card";
import type { OsSelection } from "@/lib/flightdeck/context";

export function OsAppAboutView({
  id,
  view,
  onConfirm,
  confirming = false,
  confirmError,
}: {
  id: string;
  view: SectionView;
  /** Saves the shown-but-unsaved FlightDeck selection (view.confirm). This
   * page has no launcher and no sidebar, so it carries the action itself. */
  onConfirm?: (selection: OsSelection) => void;
  /** A selection save is in flight. */
  confirming?: boolean;
  confirmError?: string;
}) {
  const t = useT();
  const app = view.kind === "cards" ? view.apps.find((a) => a.id === id) : undefined;
  const m = app ? appCardModel(app) : null;
  return (
    <main className="document-page" data-os-app={id}>
      {/* A plain link: next/link cannot load in the Node spec that renders
          this view, and a full load of / is what Atlas's shell expects. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/">← {t("apps.about.back")}</a>
      {confirmError && <p role="alert">{confirmError}</p>}
      {view.kind === "loading" ? (
        <p className="hub-muted">{t("apps.fd.loading")}</p>
      ) : view.kind === "message" ? (
        <>
          <p role="status">{t(view.key)}</p>
          {view.confirm && (
            <button
              type="button"
              className="app-card-action"
              disabled={confirming || !onConfirm}
              aria-busy={confirming || undefined}
              onClick={() => view.confirm && onConfirm?.(view.confirm)}
            >
              {t("apps.fd.confirm")}
            </button>
          )}
        </>
      ) : !app || !m ? (
        <p role="status">{t("apps.about.notListed")}</p>
      ) : (
        <>
          <h1>{t("apps.about.title", { label: app.label })}</h1>
          {app.tagline && <p>{app.tagline}</p>}
          {m.openable ? (
            <p>
              <a href={m.openUrl!} target="_blank" rel="noopener noreferrer">
                {t("apps.card.open")}
              </a>{" "}
              · {t("apps.card.accessNote")}
            </p>
          ) : (
            <p>
              {t(m.reasonKey!)}
              {m.partyKey ? ` ${t(m.partyKey)}` : ""}
            </p>
          )}
          <p className="hub-muted">
            {t("apps.about.version", { version: app.version })}
          </p>
        </>
      )}
    </main>
  );
}
