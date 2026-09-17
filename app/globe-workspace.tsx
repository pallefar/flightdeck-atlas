"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Crosshair,
  ListFilter,
  MapPin,
  Pause,
  Play,
  Radar,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import Globe from "./globe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project } from "@/lib/projects";
import { motionScale, type GlobeSettings } from "@/lib/settings";
import {
  projectSignals,
  scanFilters,
  scanProjects,
  type ScanFilter,
} from "@/lib/project-scan";
export default function GlobeWorkspace({
  projects,
  target,
  onOpen,
  settings,
  onSettingsChange,
  demo,
}: {
  projects: Project[];
  target: Project | null;
  onOpen: (p: Project) => void;
  settings: GlobeSettings;
  onSettingsChange: (patch: Partial<GlobeSettings>) => void;
  demo: boolean;
}) {
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<ScanFilter>("all");
  const [submitted, setSubmitted] = useState<{
    query: string;
    filter: ScanFilter;
  } | null>(null);
  const [scan, setScan] = useState<{
      id: number;
      started: number;
      duration: number;
    } | null>(null),
    [scanProgress, setScanProgress] = useState(0);
  const [localTarget, setLocalTarget] = useState<Project | null>(target),
    [command, setCommand] = useState(0),
    [stopCommand, setStopCommand] = useState(0),
    [tour, setTour] = useState(false),
    [tourIndex, setTourIndex] = useState(0),
    [panelOpen, setPanelOpen] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null),
    summary = useRef<HTMLDivElement>(null);
  const matches = useMemo(
    () =>
      submitted
        ? scanProjects(projects, submitted.query, submitted.filter)
        : projects,
    [projects, submitted],
  );
  const mapped = useMemo(
    () => matches.filter((p) => projectSignals(p).located),
    [matches],
  );
  const scanning = !!scan;
  const scanMode = settings.mode === "scan";
  const visibleProjects =
    scanMode && submitted && !scanning ? matches : projects;
  useEffect(() => {
    setLocalTarget(target);
    setTour(false);
  }, [target]);
  useEffect(() => {
    if (!scan) return;
    const timer = window.setInterval(() => {
      const next = Math.min(
        100,
        ((performance.now() - scan.started) / scan.duration) * 100,
      );
      setScanProgress(next);
      if (next >= 100) setScan(null);
    }, 50);
    return () => clearInterval(timer);
  }, [scan]);
  useEffect(() => {
    if (!scanMode) {
      setScan(null);
      setTour(false);
      setSubmitted(null);
    }
  }, [scanMode]);
  useEffect(() => {
    if (
      scanning ||
      !submitted ||
      !window.matchMedia("(max-width:760px)").matches
    )
      return;
    const id = requestAnimationFrame(() => {
      const p = panel.current,
        s = summary.current;
      if (p && s)
        p.scrollTo({
          top:
            p.scrollTop +
            s.getBoundingClientRect().top -
            p.getBoundingClientRect().top -
            14,
          behavior: motionScale(settings.motion) === 0 ? "instant" : "smooth",
        });
    });
    return () => cancelAnimationFrame(id);
  }, [scanning, submitted, settings.motion]);
  useEffect(() => {
    if (!tour || !mapped.length) return;
    setLocalTarget({ ...mapped[tourIndex % mapped.length] });
    const id = window.setTimeout(
      () => setTourIndex((i) => (i + 1) % mapped.length),
      6500,
    );
    return () => clearTimeout(id);
  }, [tour, tourIndex, mapped]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (scanning) cancelScan();
        stopTour();
      }
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],[role=dialog]",
        )
      ) {
        e.preventDefault();
        onSettingsChange({ mode: "scan" });
        setPanelOpen(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  function stopTour() {
    setTour(false);
    setStopCommand((c) => c + 1);
  }
  function runScan(criteria = { query, filter }) {
    panel.current?.scrollTo({ top: 0, behavior: "instant" });
    setTour(false);
    setTourIndex(0);
    setLocalTarget(null);
    setCommand((c) => c + 1);
    setSubmitted(criteria);
    const duration = 2400 * motionScale(settings.motion);
    setScanProgress(duration ? 0 : 100);
    setScan(
      duration
        ? { id: Date.now(), started: performance.now(), duration }
        : null,
    );
  }
  function choose(p: Project) {
    setTour(false);
    if (window.matchMedia("(max-width:760px)").matches) setPanelOpen(false);
    if (projectSignals(p).located) setLocalTarget({ ...p });
    else onOpen(p);
  }
  function cancelScan() {
    setScan(null);
    setSubmitted(null);
    setScanProgress(0);
  }
  function reset() {
    panel.current?.scrollTo({ top: 0, behavior: "instant" });
    setTour(false);
    setScan(null);
    setSubmitted(null);
    setQuery("");
    setFilter("all");
    setScanProgress(0);
    setLocalTarget(null);
    setCommand((c) => c + 1);
  }
  function openProject(p: Project) {
    setTour(false);
    onOpen(p);
  }
  const totals = projects.reduce(
    (s, p) => {
      const x = projectSignals(p);
      return {
        blocked: s.blocked + Number(x.blocked),
        overdue: s.overdue + x.overdue,
        unmapped: s.unmapped + Number(!x.located),
      };
    },
    { blocked: 0, overdue: 0, unmapped: 0 },
  );
  const stages = [
    `Indexing ${projects.length} ${demo ? "example" : "Atlas"} projects`,
    `Matching names, functions and tasks`,
    `Checking deadlines and blockers`,
    `Locating ${mapped.length} matching sites`,
    `Found ${matches.length} matching ${matches.length === 1 ? "project" : "projects"}`,
  ];
  const stage = Math.min(4, Math.floor(scanProgress / 22));
  return (
    <div
      className={`globe-page globe-workspace ${scanMode ? "scan-mode" : ""} ${scanning ? "is-scanning" : ""} ${panelOpen ? "panel-open" : "panel-closed"}`}
      role="tabpanel"
      id="globe-panel"
      aria-labelledby="globe-tab"
      tabIndex={0}
    >
      <Globe
        projects={visibleProjects}
        target={localTarget}
        onOpen={openProject}
        settings={settings}
        resetCommand={command}
        stopCommand={stopCommand}
        onInteract={() => setTour(false)}
        onSelectionChange={setLocalTarget}
      />
      <div className="globe-command-bar">
        <div className="globe-title">
          <span className="eyebrow">ATLAS / WORLDSPACE</span>
          <h1>God’s Eye</h1>
          <span className="globe-source">
            {demo ? "Demo projects" : "Atlas project data"}
          </span>
        </div>
        <div className="globe-mode-switch" aria-label="Globe experience">
          <button
            aria-pressed={!scanMode}
            onClick={() => onSettingsChange({ mode: "explore" })}
          >
            <MapPin size={15} />
            Explore
          </button>
          <button
            aria-pressed={scanMode}
            onClick={() => {
              onSettingsChange({ mode: "scan" });
              setPanelOpen(true);
            }}
          >
            <Radar size={15} />
            Cinematic scan
          </button>
        </div>
      </div>
      {(scanMode || settings.projectList) && (
        <button
          className="globe-panel-toggle"
          aria-expanded={panelOpen}
          aria-controls="globe-discovery-panel"
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <ListFilter size={15} />
          {panelOpen
            ? "Hide panel"
            : scanMode
              ? "Search projects"
              : "Project list"}
        </button>
      )}
      {scanning && (
        <div className="scan-visual" aria-hidden="true">
          <div className="scan-reticle">
            <span />
            <span />
            <span />
            <i />
          </div>
          <div className="scan-lines" />
        </div>
      )}
      {panelOpen && (scanMode || settings.projectList) && (
        <section
          ref={panel}
          id="globe-discovery-panel"
          className={`globe-discovery ${submitted && !scanning ? "scan-complete" : ""}`}
        >
          {scanMode ? (
            <>
              <div className="discovery-heading">
                <Radar size={17} />
                <span>PROJECT SCANNER</span>
                <kbd>/</kbd>
              </div>
              <p className="scan-description">
                Find projects, actions and locations in your portfolio.
              </p>
              <div className="scan-channels" aria-label="Search data sources">
                {[
                  ["PROJECTS", projects.length],
                  [
                    "TASKS",
                    projects.reduce((sum, p) => sum + p.tasks.length, 0),
                  ],
                  [
                    "LOCATIONS",
                    projects.filter((p) => projectSignals(p).located).length,
                  ],
                ].map(([name, count], index) => (
                  <div
                    key={name}
                    className={
                      scanning && stage === index + 1 ? "channel-active" : ""
                    }
                  >
                    <span>{name}</span>
                    <strong>{count}</strong>
                    <i aria-hidden="true" />
                  </div>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runScan();
                }}
              >
                <label className="scan-search">
                  <Search size={17} />
                  <Input
                    ref={input}
                    aria-label="Search project intelligence"
                    value={query}
                    maxLength={160}
                    placeholder="Project, city, function or task…"
                    onChange={(e) => {
                      setQuery(e.target.value);
                      if (scanning) cancelScan();
                    }}
                  />
                </label>
                <div className="scan-filters" aria-label="Scan project filter">
                  {scanFilters.map((f) => (
                    <button
                      type="button"
                      key={f.value}
                      aria-pressed={filter === f.value}
                      onClick={() => {
                        setFilter(f.value);
                        if (scanning) cancelScan();
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="scan-actions">
                  <Button type="submit" disabled={scanning}>
                    <Crosshair size={15} />
                    {submitted ? "Scan again" : "Scan portfolio"}
                  </Button>
                  {scanning ? (
                    <button
                      type="button"
                      className="scan-text-button"
                      onClick={cancelScan}
                    >
                      Cancel
                    </button>
                  ) : (
                    submitted && (
                      <button
                        type="button"
                        className="scan-text-button"
                        onClick={reset}
                      >
                        Clear
                      </button>
                    )
                  )}
                </div>
              </form>
              {scanning ? (
                <div className="scan-status">
                  <div
                    className="scan-progress"
                    role="progressbar"
                    aria-label="Project scan"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(scanProgress)}
                  >
                    <span style={{ width: `${scanProgress}%` }} />
                  </div>
                  <span className="scan-stage" role="status">
                    {stages[stage]}
                  </span>
                  <ol>
                    {stages.slice(0, stage).map((s) => (
                      <li key={s}>
                        <Check size={12} />
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : submitted ? (
                <div
                  className="scan-result-summary"
                  role="status"
                  ref={summary}
                >
                  <Check size={14} />
                  {matches.length} {matches.length === 1 ? "match" : "matches"}{" "}
                  · {mapped.length} on the map
                  {(query !== submitted.query ||
                    filter !== submitted.filter) && (
                    <small>
                      Criteria changed. Run a new scan to update results.
                    </small>
                  )}
                </div>
              ) : (
                <div className="scan-idle">
                  <Sparkles size={17} />
                  <span>
                    Animated scan of {projects.length}{" "}
                    {demo ? "example" : "saved"} projects
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="discovery-heading">
              <MapPin size={17} />
              <span>PROJECT LOCATIONS</span>
              <small>{projects.length}</small>
            </div>
          )}
          {!scanning && (
            <>
              <div className="scan-result-tools">
                <span>
                  {scanMode && submitted ? "MATCHES" : "YOUR PORTFOLIO"}
                </span>
                <button
                  disabled={mapped.length < 2}
                  aria-pressed={tour}
                  onClick={() => {
                    if (tour) stopTour();
                    else {
                      setTourIndex(0);
                      setTour(true);
                      if (window.matchMedia("(max-width:760px)").matches)
                        setPanelOpen(false);
                    }
                  }}
                >
                  {tour ? <Pause size={12} /> : <Play size={12} />}{" "}
                  {tour ? "Stop tour" : "Tour locations"}
                </button>
              </div>
              <div className="discovery-results">
                {(scanMode ? matches : projects).map((p) => {
                  const signals = projectSignals(p);
                  return (
                    <button
                      className={`scan-project-row ${localTarget?.id === p.id ? "selected" : ""}`}
                      key={p.id}
                      onClick={() => choose(p)}
                    >
                      <span className={`project-symbol ${p.color}`}>
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {signals.located
                            ? p.location || "Mapped location"
                            : "Location not set · Open project"}
                        </small>
                        <span className="scan-project-signals">
                          {signals.blocked && <b>Blocked</b>}
                          {signals.overdue > 0 && (
                            <b>{signals.overdue} overdue</b>
                          )}
                          {p.priority === "High" && <em>High priority</em>}
                        </span>
                      </span>
                      <ArrowUpRight size={14} />
                    </button>
                  );
                })}
                {!matches.length && (
                  <div className="scan-empty">
                    <Search size={25} />
                    <h3>No matching projects</h3>
                    <p>
                      Try another name, task or location, or clear the filters.
                    </p>
                    <button onClick={reset}>
                      Show all projects <ArrowRight size={13} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="scan-provenance">
            {demo ? "EXAMPLE DATA" : "ATLAS PROJECT INDEX"}
            <span>Search covers saved projects and tasks.</span>
          </div>
        </section>
      )}
      {scanMode && (
        <div className="globe-signal-strip" aria-label="Portfolio signals">
          <button
            onClick={() => {
              setFilter("attention");
              setQuery("");
              setPanelOpen(true);
              runScan({ query: "", filter: "attention" });
            }}
          >
            <ShieldAlert size={15} />
            <strong>{totals.blocked}</strong>blocked<span>Filter projects</span>
          </button>
          <div>
            <strong>{totals.overdue}</strong>overdue tasks
          </div>
          <div>
            <strong>{totals.unmapped}</strong>need a location
          </div>
        </div>
      )}
      {tour && (
        <div className="globe-tour-status" role="status">
          <span className="tour-pulse" />
          PORTFOLIO TOUR · {tourIndex + 1} / {mapped.length}
          <button onClick={stopTour} aria-label="Stop portfolio tour">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
