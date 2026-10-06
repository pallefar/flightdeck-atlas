"use client";
import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { VisionProjection } from "@/lib/flightdeck/vision";
import { visionProjectionSchema } from "@/lib/flightdeck/vision";
import { useT, useLocale } from "@/lib/i18n/react";
type View = { state: string; projection?: VisionProjection; openUrl?: string | null; syncPending?: boolean };

/** Approved shared assessment projection; the private app is never embedded. */
export default function VisionProjectStatus({ projectId, revision, canEdit }: { projectId: string; revision: number; canEdit: boolean }) {
  const tr = useT(), locale = useLocale();
  const [read, setRead] = useState<{ projectId: string; revision: number; view: View }>();
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    fetch(`/api/flightdeck/vision?project=${encodeURIComponent(projectId)}`, { cache: "no-store" })
      .then(async (res) => res.ok ? await res.json() as View : null)
      .then((view) => { if (current) setRead({ projectId, revision, view: view ?? { state: "unavailable" } }); }, () => { if (current) setRead({ projectId, revision, view: { state: "unavailable" } }); });
    return () => { current = false; };
  }, [projectId, revision, refresh]);
  const view = read?.projectId === projectId && read.revision === revision ? read.view : null;
  const parsed = view?.state === "ok" ? visionProjectionSchema.safeParse(view.projection) : null;
  if (!view || view.state === "not_linked" || (parsed?.success && !parsed.data.enrolled)) return null;
  if (!parsed?.success) return <div className="vision-project-status" role="status">{tr("apps.vision.unavailable")}</div>;
  const projection = parsed.data;
  async function retry() {
    setBusy(true);
    try { await fetch(`/api/flightdeck/vision/sync?project=${encodeURIComponent(projectId)}`, { method: "POST" }); }
    catch { /* The durable marker remains; the refreshed view states the failure. */ }
    finally { setBusy(false); setRefresh((value) => value + 1); }
  }
  return <section className="vision-project-status" aria-label={tr("apps.vision.title")}>
    <header><ShieldCheck size={16} /><strong>{tr("apps.vision.title")}</strong><span>{tr(`apps.vision.status.${projection.status}`)}</span>
      {view.openUrl && <a href={view.openUrl} target="_blank" rel="noopener noreferrer">{tr("apps.vision.open")} <ExternalLink size={13} /></a>}
    </header>
    {!!projection.approvedGoals.length && <p>{tr("apps.vision.goals")}: {projection.approvedGoals.join(" · ")}</p>}
    {!!projection.requiredActions.length && <ul>{projection.requiredActions.map((action, index) => <li key={index}>{action}</li>)}</ul>}
    {projection.pendingStage && <p>{tr("apps.vision.stage")}: {projection.pendingStage}</p>}
    {view.syncPending && <p role="status">{tr("apps.vision.syncPending")} {canEdit && <button disabled={busy} onClick={() => void retry()}>{tr(busy ? "apps.vision.retrying" : "apps.vision.retry")}</button>}</p>}
    <small>{tr("apps.vision.checked")} {new Date(projection.checkedAt).toLocaleString(locale)}</small>
  </section>;
}
