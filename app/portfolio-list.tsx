"use client";
import { useRef, useState } from "react";
import { ArrowUpRight, Folder, PanelRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { progress, type Project } from "@/lib/projects";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/react";

/** The inspector reads the same accessible, filtered records as the portfolio.
 * It has no separate cache, permissions, or speculative project metadata. */
export default function PortfolioList({ projects, loaded, onOpen }: {
  projects: Project[];
  loaded: boolean;
  onOpen: (project: Project) => void;
}) {
  const locale = useLocale();
  const [selectedId, setSelectedId] = useState("");
  const selected = projects.find((p) => p.id === selectedId);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function close() {
    setSelectedId("");
    requestAnimationFrame(() => trigger.current?.focus());
  }
  const labels = {
    project: t("apps.compact.project", locale),
    sponsor: t("apps.compact.sponsor", locale),
    status: t("apps.compact.status", locale),
    priority: t("apps.compact.priority", locale),
    target: t("apps.compact.target", locale),
    progress: t("apps.compact.progress", locale),
    details: t("apps.compact.details", locale),
    open: t("apps.compact.open", locale),
    empty: t("apps.compact.empty", locale),
    close: t("apps.compact.close", locale),
    next: t("apps.compact.next", locale),
    tasks: t("apps.compact.tasks", locale),
    updates: t("apps.compact.updates", locale),
    none: t("apps.compact.none", locale),
    archived: t("apps.compact.archived", locale),
  };
  return (
    <div className={`compact-portfolio ${selected ? "has-inspector" : ""}`}>
      <div className="portfolio-table-scroll project-grid project-list">
        <table className="portfolio-table">
          <caption className="sr-only">{t("apps.compact.accessible", locale)}</caption>
          <thead><tr>
            <th scope="col">{labels.project}</th><th scope="col">{labels.sponsor}</th>
            <th scope="col">{labels.priority}</th><th scope="col">{labels.status}</th>
            <th scope="col">{labels.target}</th><th scope="col">{labels.progress}</th>
            <th scope="col"><span className="sr-only">{labels.details}</span></th>
          </tr></thead>
          <tbody>{projects.map((p) => (
            <tr key={p.id} className={selected?.id === p.id ? "selected-project" : ""}>
              <td><button className="project-card portfolio-project-link" disabled={!loaded} onClick={() => onOpen(p)}>
                <strong>{p.name}<ArrowUpRight size={14} /></strong>
                <span>{p.description || p.category}</span>
              </button></td>
              <td>{p.sponsor || <span className="hub-muted">—</span>}</td>
              <td>{p.priority || <span className="hub-muted">—</span>}</td>
              <td><span className={`status ${p.status.toLowerCase().replaceAll(" ", "-")}`}>{p.archived ? labels.archived : p.status}</span></td>
              <td>{p.dueDate || <span className="hub-muted">—</span>}</td>
              <td><div className="portfolio-progress"><span>{progress(p)}%</span><Progress aria-label={`${p.name} ${labels.progress.toLowerCase()}`} value={progress(p)} className={`progress-bar ${p.color}`} /></div></td>
              <td><button className="portfolio-inspect-button" aria-label={`${labels.details}: ${p.name}`} aria-expanded={selected?.id === p.id} aria-controls={selected?.id === p.id ? "portfolio-inspector" : undefined} disabled={!loaded} onClick={(e) => {
                trigger.current = e.currentTarget;
                setSelectedId(selected?.id === p.id ? "" : p.id);
              }}><PanelRight size={17} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {selected && (
        <aside id="portfolio-inspector" className="portfolio-inspector" aria-label={`${labels.details}: ${selected.name}`} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}>
          <div className="portfolio-inspector-heading"><Folder size={18} /><span>{labels.details}</span><button aria-label={labels.close} onClick={close}><X size={18} /></button></div>
          <h2>{selected.name}</h2>
          {selected.description && <p>{selected.description}</p>}
          <Button className="portfolio-open" onClick={() => onOpen(selected)}><ArrowUpRight size={16} />{labels.open}</Button>
          <dl>
            <div><dt>{labels.sponsor}</dt><dd>{selected.sponsor || labels.empty}</dd></div>
            <div><dt>{labels.status}</dt><dd>{selected.archived ? labels.archived : selected.status}</dd></div>
            <div><dt>{labels.priority}</dt><dd>{selected.priority || labels.empty}</dd></div>
            <div><dt>{labels.target}</dt><dd>{selected.dueDate || labels.empty}</dd></div>
            <div><dt>{labels.tasks}</dt><dd>{selected.tasks.filter(t => !t.archived && t.done).length} / {selected.tasks.filter(t => !t.archived).length}</dd></div>
          </dl>
          {selected.nextAction && <section><h3>{labels.next}</h3><p>{selected.nextAction}</p></section>}
          <section><h3>{labels.updates}</h3>{selected.activity?.length ? <ul>{selected.activity.slice(-4).reverse().map((event) => <li key={event.id}>{event.text}</li>)}</ul> : <p>{labels.none}</p>}</section>
        </aside>
      )}
    </div>
  );
}
