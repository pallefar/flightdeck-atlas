"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Lightbulb, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  functions,
  opportunities,
  type Opportunity,
} from "@/lib/opportunities";
import { newsSources, type NewsItem } from "@/lib/ai-news";
import type { Project } from "@/lib/projects";
async function fetchNews() {
  const r = await fetch("/api/ai-news");
  const data = (await r.json()) as {
    items: NewsItem[];
    checkedAt: string;
    unavailable: string[];
    stale?: boolean;
    error?: string;
  };
  if (!r.ok) throw Error(data.error || "AI updates could not be loaded.");
  return data;
}
export default function Ideas({
  projects,
  onCreate,
  onOpen,
  busy,
}: {
  projects: Project[];
  onCreate: (idea: Opportunity) => void;
  onOpen: (p: Project) => void;
  busy: boolean;
}) {
  const [area, setArea] = useState("All functions");
  const [news, setNews] = useState<{
    items: NewsItem[];
    checkedAt: string;
    unavailable: string[];
    stale?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setNews(await fetchNews());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // loading starts true and error empty, as refresh() would set them.
    fetchNews()
      .then(setNews, (e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  return (
    <main className="hub-page">
      <header className="hub-heading">
        <div>
          <span className="eyebrow">FROM SIGNAL TO PILOT</span>
          <h1>Ideas & AI updates</h1>
          <p>
            Find a useful problem. Start small. Bring another function into
            FlightDeck.
          </p>
        </div>
        <Lightbulb className="hub-heading-icon" size={34} />
      </header>
      <section className="hub-card ai-news">
        <div className="section-heading">
          <h2>AI radar</h2>
          <button
            className="text-link"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
            {loading ? "Checking sources…" : "Refresh"}
          </button>
        </div>
        <p className="hub-muted">
          Headlines from official sources. Open the original update before
          choosing a use case.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="news-grid">
          {news?.items.slice(0, 6).map((item) => (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="news-item"
              key={item.url}
            >
              <span>
                {item.source} ·{" "}
                {new Date(item.publishedAt).toLocaleDateString()}
              </span>
              <h3>
                {item.title} <ArrowUpRight size={15} />
              </h3>
            </a>
          ))}
        </div>
        {news && !news.items.length && (
          <p className="hub-muted">
            The feeds are unavailable right now. You can still visit the sources
            below.
          </p>
        )}
        <div className="news-sources">
          {newsSources.map((s) => (
            <a key={s.name} href={s.home} target="_blank" rel="noreferrer">
              {s.name} ↗
            </a>
          ))}
          {news?.checkedAt && (
            <span>
              {news.stale ? "Last successful check" : "Checked"}{" "}
              {new Date(news.checkedAt).toLocaleString()} · refreshes every 30
              minutes
            </span>
          )}
        </div>
        {!!news?.unavailable.length && (
          <p className="hub-muted">
            Unavailable: {news.unavailable.join(", ")}.{" "}
            {news.stale
              ? "Showing the last available headlines."
              : "Other sources are shown above."}
          </p>
        )}
      </section>
      <div className="opportunities-heading">
        <div>
          <h2>Consultancy opportunities</h2>
          <p className="hub-muted">
            Suggested playbooks to validate with each function. These are
            hypotheses, with no assumed savings.
          </p>
        </div>
        <select
          aria-label="Filter opportunities by function"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          <option>All functions</option>
          {functions.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <div className="opportunity-grid">
        {opportunities
          .filter((i) => area === "All functions" || i.area === area)
          .map((idea) => {
            const existing = projects.find(
              (p) =>
                !p.archived &&
                p.name === idea.title &&
                p.functionArea === idea.area,
            );
            return (
              <article className="hub-card opportunity-card" key={idea.id}>
                <span className="opportunity-area">{idea.area}</span>
                <h3>{idea.title}</h3>
                <p>{idea.problem}</p>
                <dl>
                  <dt>Pilot</dt>
                  <dd>{idea.pilot}</dd>
                  <dt>How to measure it</dt>
                  <dd>{idea.measure}</dd>
                </dl>
                <footer>
                  <span>{idea.effort}</span>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      existing ? onOpen(existing) : onCreate(idea)
                    }
                  >
                    {existing ? <ArrowUpRight size={15} /> : <Plus size={15} />}
                    {existing ? "Open pilot" : "Start a pilot"}
                  </Button>
                </footer>
              </article>
            );
          })}
      </div>
      <section className="hub-card onboarding-pipeline">
        <h2>Your onboarding pipeline</h2>
        <p className="hub-muted">
          Track discovery, pilots, readiness, and rollout. Each pilot includes
          an editable checklist and an exportable handoff.
        </p>
        {projects
          .filter((p) => !p.archived && p.onboardingStage)
          .map((p) => (
            <button
              className="pipeline-row"
              key={p.id}
              onClick={() => onOpen(p)}
            >
              <span>
                <strong>{p.name}</strong>
                <small>
                  {p.functionArea} · {p.sponsor || "Sponsor to confirm"}
                </small>
              </span>
              <span className="status planning">{p.onboardingStage}</span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        {!projects.some((p) => !p.archived && p.onboardingStage) && (
          <p className="hub-muted">
            Start a pilot above or add an onboarding stage to an existing
            project.
          </p>
        )}
      </section>
    </main>
  );
}
