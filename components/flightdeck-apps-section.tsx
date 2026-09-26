"use client";
/** @jsxImportSource react */
// (The pragma keeps React's own JSX runtime when a Playwright spec renders
// this file in Node; Playwright otherwise swaps in its component-test JSX.)
// apps-33: the 9-dot menu's FlightDeck OS section. It renders what
// flightdeckSection() (lib/flightdeck/app-card.ts) decided from the apps
// directory (apps-32): loading, one honest message (with Retry for a
// transient failure), or the AppCards. It never falls back to the legacy
// /api/flightdeck/apps list.
import type { Ref } from "react";
import { AppCard } from "@/components/AppCard";
import { useT } from "@/lib/i18n/react";
import {
  fdPrefId,
  fdPrefIdFits,
  type SectionView,
} from "@/lib/flightdeck/app-card";

export function FlightdeckAppsSection({
  view,
  favourites,
  recent,
  busy,
  onPin,
  onOpened,
  onRetry,
  gridRef,
}: {
  view: SectionView;
  favourites: string[];
  recent: string[];
  busy: boolean;
  onPin: (prefId: string) => void;
  onOpened: (prefId: string) => void;
  onRetry: () => void;
  /** The card grid, for the launcher's anime.js entrance (lib/motion is
   * wired there, so this file also renders outside a Vite build). */
  gridRef?: Ref<HTMLDivElement>;
}) {
  const t = useT();
  return (
    <section
      className="flightdeck-apps"
      aria-label={t("apps.fd.aria")}
      data-state={view.kind === "message" ? view.key : view.kind}
    >
      <h3 className="eyebrow">{t("apps.fd.heading")}</h3>
      {view.kind === "loading" ? (
        <p className="hub-muted">{t("apps.fd.loading")}</p>
      ) : view.kind === "message" ? (
        <div className="flightdeck-apps-message">
          <p className="hub-muted" role="status">
            {t(view.key)}
          </p>
          {view.retry && (
            <button type="button" className="app-card-action" onClick={onRetry}>
              {t("apps.fd.retry")}
            </button>
          )}
        </div>
      ) : (
        <div className="app-card-grid" ref={gridRef}>
          {view.apps.map((a) => {
            const pref = fdPrefId(a.id);
            const fits = fdPrefIdFits(a.id);
            return (
              <AppCard
                key={a.id}
                app={a}
                pinned={favourites.includes(pref)}
                recent={recent.includes(pref)}
                busy={busy}
                onPin={fits ? () => onPin(pref) : undefined}
                onOpen={fits ? () => onOpened(pref) : undefined}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
