"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Presentation } from "lucide-react";
import { useT } from "@/lib/i18n/react";
import type { FlightdeckAppLink } from "@/lib/flightdeck/context";

/** The OS sub-app the Slides tool links to. */
const STUDIO_APP_ID = "presentation-studio";

type Answer = { state: string; apps: FlightdeckAppLink[] };

/** deck-atlas-link (plan 2026-09-26 R1-J1): above the legacy slide editor,
 * a link to Presentation Studio on the OS project LINKED to this Atlas
 * project (/api/flightdeck/apps?project=, Super Admin only on the server).
 * Not linked: a notice and no link. The app off for that project, the
 * project disabled, FlightDeck not configured or unreachable: nothing, and
 * the legacy editor below works as before. */
export default function FlightdeckSlidesLink({
  projectId,
}: {
  projectId: string;
}) {
  const tr = useT();
  // Kept with the project it answers, so a project switch never shows the
  // previous project's link while the new answer loads.
  const [read, setRead] = useState<{ for: string; body: Answer | null }>();
  useEffect(() => {
    let live = true;
    fetch(`/api/flightdeck/apps?project=${encodeURIComponent(projectId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Answer>) : null))
      .then(
        (body) => live && setRead({ for: projectId, body }),
        () => live && setRead({ for: projectId, body: null }),
      );
    return () => {
      live = false;
    };
  }, [projectId]);
  const answer = read?.for === projectId ? read.body : null;
  if (answer?.state === "not_linked")
    return (
      <div className="fd-banner warn fd-slides-link" role="status">
        <AlertTriangle size={16} />
        <p>
          <strong>{tr("decks.link.notLinked")}</strong>{" "}
          <span className="fd-hint">{tr("decks.link.notLinkedHint")}</span>
        </p>
      </div>
    );
  const studio =
    answer?.state === "ok"
      ? answer.apps.find((a) => a.id === STUDIO_APP_ID)
      : undefined;
  if (!studio) return null;
  return (
    <div className="fd-banner fd-slides-link">
      <Presentation size={16} />
      <p>
        {tr("decks.link.legacy")}{" "}
        <a href={studio.url} target="_blank" rel="noopener noreferrer">
          {tr("decks.link.open")}
          <ExternalLink size={13} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
