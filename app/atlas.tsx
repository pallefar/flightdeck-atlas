"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Circle,
  Compass,
  Folder,
  Globe2,
  Layers3,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MapPin,
  Plus,
  Search,
  Target,
  X,
  Sun,
  Moon,
  Settings2,
  CalendarDays,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  examples,
  progress,
  type Project,
  type ProjectFields,
} from "@/lib/projects";
import Globe from "./globe";
import { useTheme } from "next-themes";
import Settings from "./settings";
import Briefing from "./briefing";
import AccessManagement from "./access-management";
import type { AccessProfile } from "@/lib/access-policy";
import Ideas from "./ideas";
import ProjectWorkspace from "./project-workspace";
import { onboardingTasks, type Opportunity } from "@/lib/opportunities";
import {
  defaultSettings,
  readSettings,
  SETTINGS_KEY,
  type AtlasSettings,
} from "@/lib/settings";
type View =
  "dashboard" | "globe" | "connection" | "briefing" | "ideas" | "access";
const blank: ProjectFields = {
  name: "",
  description: "",
  status: "Planning",
  category: "Project",
  location: "",
  latitude: null,
  longitude: null,
  dueDate: "",
  color: "orange",
  tasks: [],
};
export default function Atlas() {
  const { theme, setTheme } = useTheme();
  const [access, setAccess] = useState<AccessProfile | null>(null);
  const [settings, setSettings] = useState<AtlasSettings>(defaultSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [settingsTab, setSettingsTab] = useState<"dashboard" | "globe">(
    "dashboard",
  );
  const [storageError, setStorageError] = useState("");
  function updateSettings(next: AtlasSettings) {
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      setStorageError("");
    } catch {
      setStorageError(
        "Applied for now. Browser storage is unavailable, so these changes may not survive a reload.",
      );
    }
  }
  const [view, setView] = useState<View>("dashboard"),
    [projects, setProjects] = useState<Project[]>([]),
    [loaded, setLoaded] = useState(false),
    [demo, setDemo] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All projects"),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Project | null>(null),
    [editing, setEditing] = useState<Project | null>(null),
    [creating, setCreating] = useState(false),
    [saving, setSaving] = useState(false),
    [flightTarget, setFlightTarget] = useState<Project | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/projects");
      const body = (await r.json()) as {
        projects: Project[];
        access?: AccessProfile;
        error?: string;
      };
      if (!r.ok) throw Error(body.error || "Projects could not be loaded.");
      setAccess(body.access || null);
      setProjects(body.projects);
      setDemo(body.projects.length === 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const restored = readSettings();
    setSettings(restored);
    const v = new URLSearchParams(location.search).get("view");
    setView(
      v === "globe" ||
        v === "connection" ||
        v === "dashboard" ||
        v === "briefing" ||
        v === "ideas" ||
        v === "access"
        ? v
        : restored.startView,
    );
  }, [load]);
  function navigate(next: View) {
    setView(next);
    history.replaceState(null, "", `/?view=${next}`);
    setFlightTarget(null);
  }
  const isDark = loaded && theme === "dark";
  const allData = demo ? examples : projects;
  const globeProjects = allData.filter((p) => !p.archived);
  const data = allData.filter((p) =>
    filter === "Archived" ? !!p.archived : !p.archived,
  );
  const filtered = data
    .filter(
      (p) =>
        (filter === "All projects" ||
          filter === "Archived" ||
          p.status === filter) &&
        `${p.name} ${p.location} ${p.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => {
      if (settings.dashboard.sort === "name")
        return a.name.localeCompare(b.name);
      if (settings.dashboard.sort === "due")
        return (
          (a.dueDate || "9999-12-31").localeCompare(
            b.dueDate || "9999-12-31",
          ) || a.name.localeCompare(b.name)
        );
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  const active = data.filter((p) => p.status === "In progress").length,
    done = data.reduce((s, p) => s + p.tasks.filter((t) => t.done).length, 0),
    tasks = data.flatMap((p) =>
      p.tasks.filter((t) => !t.done).map((t) => ({ p, t })),
    );
  async function save(
    fields: ProjectFields,
    existing?: Project,
    updateNote?: string,
  ) {
    setSaving(true);
    setError("");
    try {
      const r = await fetch(
        existing ? `/api/projects/${existing.id}` : "/api/projects",
        {
          method: existing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            activity: undefined,
            updateNote,
            ...(existing ? { revision: existing.revision } : {}),
          }),
        },
      );
      const body = (await r.json()) as { project: Project; error?: string };
      if (!r.ok) throw Error(body.error || "Your changes could not be saved.");
      setProjects((prev) =>
        existing
          ? prev.map((p) => (p.id === existing.id ? body.project : p))
          : [body.project, ...prev],
      );
      setDemo(false);
      setCreating(false);
      setEditing(null);
      if (existing && selected?.id === existing.id) setSelected(body.project);
      return body.project;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function startPilot(idea: Opportunity) {
    const project = await save({
      ...blank,
      name: idea.title,
      description: idea.pilot,
      category: "Consultancy pilot",
      functionArea: idea.area,
      nextAction: idea.discovery,
      benefit: idea.measure,
      onboardingStage: "Discovery",
      priority: "Normal",
      tasks: onboardingTasks(idea),
    });
    if (project) openProject(project);
  }
  function openProject(p: Project) {
    setSelected(p);
    setError("");
  }
  const date = new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
  return (
    <div className="atlas-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Atlas home">
          <img
            src="/te-logo.png"
            alt="TE Connectivity"
            className="te-logo"
            width="147"
            height="77"
          />
          <span className="atlas-wordmark">
            ATLAS<span>Project workspace</span>
          </span>
        </a>
        <div className="workspace-label">TE CONNECTIVITY</div>
        <nav aria-label="Main navigation">
          <button
            aria-label="Dashboard"
            aria-current={view === "dashboard" ? "page" : undefined}
            disabled={!loaded}
            className={view === "dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("dashboard")}
          >
            <LayoutDashboard />
            Dashboard<span className="nav-shortcut">01</span>
          </button>
          <button
            aria-label="God’s Eye"
            aria-current={view === "globe" ? "page" : undefined}
            disabled={!loaded}
            className={view === "globe" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("globe")}
          >
            <Globe2 />
            God’s Eye<span className="nav-shortcut">02</span>
          </button>
          {access?.permissions.includes("briefings.read") && (
            <button
              aria-label="Briefings"
              aria-current={view === "briefing" ? "page" : undefined}
              disabled={!loaded}
              className={view === "briefing" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("briefing")}
            >
              <CalendarDays /> Briefings<span className="nav-shortcut">03</span>
            </button>
          )}
          {access?.permissions.includes("ideas.use") && (
            <button
              aria-label="Ideas and AI"
              aria-current={view === "ideas" ? "page" : undefined}
              disabled={!loaded}
              className={view === "ideas" ? "nav-item active" : "nav-item"}
              onClick={() => navigate("ideas")}
            >
              <Lightbulb /> Ideas & AI<span className="nav-shortcut">04</span>
            </button>
          )}
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">CONNECTED WORKSPACES</div>
        <button
          className={view === "connection" ? "nav-item active" : "nav-item"}
          onClick={() => navigate("connection")}
        >
          <Link2 />
          FlightDeck OS
          <span className="pending-dot" />
        </button>
        {access?.superAdmin && (
          <button
            aria-label="People and access"
            className={view === "access" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("access")}
          >
            <ShieldCheck /> People & access
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="system-label">
            <span className="tiny-orbit" /> A WIDER PERSPECTIVE
          </div>
          <div className="profile">
            <span className="avatar">ME</span>
            <div>
              <strong>{access?.name || "My workspace"}</strong>
              <small>
                {access?.roleName ||
                  (demo ? "Exploring demo projects" : "Personal projects")}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span>{" "}
            <strong>
              {view === "dashboard"
                ? "Overview"
                : view === "globe"
                  ? "God’s Eye"
                  : view === "briefing"
                    ? "Briefings"
                    : view === "ideas"
                      ? "Ideas & AI"
                      : view === "access"
                        ? "Access"
                        : "Connections"}
            </strong>
          </div>
          <div className="topbar-right">
            <button
              className="theme-toggle"
              ref={settingsTrigger}
              aria-label="Open settings"
              title="Settings"
              disabled={!loaded}
              onClick={() => {
                setSettingsTab(view === "globe" ? "globe" : "dashboard");
                setSettingsOpen(true);
              }}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="theme-toggle"
              disabled={!loaded}
              aria-label={
                isDark ? "Switch to light mode" : "Switch to dark mode"
              }
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <span className="date-label">{date}</span>
            <Button
              disabled={
                !loaded || !access?.permissions.includes("projects.create")
              }
              onClick={() => {
                setError("");
                setCreating(true);
              }}
              className="add-button"
            >
              <Plus />
              New project
            </Button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {view === "access" ? (
          access?.superAdmin ? (
            <AccessManagement />
          ) : (
            <main className="hub-page">
              <h1>Super Admin access required</h1>
            </main>
          )
        ) : view === "briefing" &&
          access?.permissions.includes("briefings.read") ? (
          <Briefing
            projects={allData}
            demo={demo}
            busy={saving}
            onOpen={openProject}
            onSave={save}
          />
        ) : view === "ideas" && access?.permissions.includes("ideas.use") ? (
          <Ideas
            projects={projects}
            busy={saving || !access?.permissions.includes("projects.create")}
            onOpen={openProject}
            onCreate={(idea) => void startPilot(idea)}
          />
        ) : view === "connection" ? (
          <section className="connection-page">
            <span className="eyebrow">YOUR WORK, CONNECTED</span>
            <h1>FlightDeck connection</h1>
            <p className="lead">
              Bring your FlightDeck projects into the same view.
            </p>
            <div className="connection-card">
              <div className="connection-icon">
                <Link2 size={32} />
              </div>
              <div>
                <span className="status planning">Awaiting integration</span>
                <h2>FlightDeck OS</h2>
                <p>
                  The connection is not configured yet. Your Atlas projects are
                  saved independently.
                </p>
                <p>
                  Shared sign-in and project sync will be enabled once
                  FlightDeck’s authentication and project API are available.
                </p>
                <a className="text-link" href="/integration">
                  View integration requirements <ArrowUpRight size={16} />
                </a>
              </div>
            </div>
            <div className="connection-card">
              <div className="connection-icon">
                <Target size={28} />
              </div>
              <div>
                <span className="status planning">SDK preparation</span>
                <h2>TEOA Advantage</h2>
                <p>
                  Bring in permitted scorecards, objectives, improvement cycles,
                  meetings, and escalations. Keep workspace and project context
                  attached to every item.
                </p>
                <p>
                  Waiting for delegated access and a deployed OS. No Advantage
                  data has been imported.
                </p>
                <a
                  className="text-link"
                  href="https://github.com/pallefar/flightdeck-atlas/blob/main/docs/MASTER-APP-CONTRACT.md"
                >
                  Master-app and Advantage handoff <ArrowUpRight size={16} />
                </a>
              </div>
            </div>
            <div className="integration-steps">
              <div>
                <span>01</span>
                <h3>Connect your identity</h3>
                <p>
                  Use your FlightDeck account across both apps, with access
                  checked for each workspace.
                </p>
              </div>
              <div>
                <span>02</span>
                <h3>Bring in your projects</h3>
                <p>
                  Keep the original project IDs, permissions, and update
                  history.
                </p>
              </div>
              <div>
                <span>03</span>
                <h3>See the whole picture</h3>
                <p>
                  Open the same project from your dashboard, the globe, or
                  FlightDeck.
                </p>
              </div>
            </div>
          </section>
        ) : view === "globe" ? (
          <div className="globe-page">
            <Globe
              projects={globeProjects}
              target={flightTarget}
              onOpen={openProject}
              settings={settings.globe}
            />
            <div className="globe-heading">
              <span className="eyebrow">A WORLD OF WORK</span>
              <h1>God’s Eye</h1>
              <p>
                {globeProjects.filter((p) => p.latitude !== null).length}{" "}
                project locations. One perspective.
              </p>
            </div>
            {settings.globe.projectList && (
              <div className="globe-projects">
                <div className="panel-caption">
                  PROJECT LOCATIONS <span>{demo ? "DEMO" : "ATLAS"}</span>
                </div>
                {globeProjects
                  .filter((p) => p.latitude !== null)
                  .map((p) => (
                    <button
                      className={`location-row ${flightTarget?.id === p.id ? "selected" : ""}`}
                      key={p.id}
                      onClick={() => setFlightTarget(p)}
                    >
                      <span className={`project-symbol ${p.color}`}>
                        {p.name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.location}</small>
                      </span>
                      <ArrowUpRight size={17} />
                    </button>
                  ))}
              </div>
            )}
          </div>
        ) : (
          <main className="dashboard">
            <div className="page-heading">
              <div>
                <span className="eyebrow">THE BIG PICTURE</span>
                <h1>
                  Everything in motion<span>.</span>
                </h1>
                <p>Your projects, your progress, your next move.</p>
              </div>
              <button className="globe-link" onClick={() => navigate("globe")}>
                <span className="globe-link-icon">
                  <Globe2 size={30} />
                </span>
                <span>
                  Explore your world
                  <small>
                    Open God’s Eye <ArrowUpRight size={13} />
                  </small>
                </span>
              </button>
            </div>
            {demo && (
              <div className="demo-banner">
                <Compass size={17} />
                <span>
                  <strong>Demo workspace</strong> · These are example projects.
                  Add a project to start your own workspace.
                </span>
                <button
                  onClick={() => {
                    setDemo(false);
                    setFilter("All projects");
                  }}
                >
                  Start fresh <ArrowRight size={15} />
                </button>
              </div>
            )}
            {settings.dashboard.showMetrics && (
              <section className="metrics" aria-label="Project overview">
                <Metric
                  label="TOTAL PROJECTS"
                  value={data.length.toString()}
                  detail="Across your workspace"
                  icon={<Folder />}
                />
                <Metric
                  label="IN PROGRESS"
                  value={active.toString().padStart(2, "0")}
                  detail="Ideas becoming reality"
                  icon={<Layers3 />}
                />
                <Metric
                  label="TASKS COMPLETE"
                  value={done.toString().padStart(2, "0")}
                  detail={`Of ${data.reduce((s, p) => s + p.tasks.length, 0)} total tasks`}
                  icon={<Check />}
                />
                <Metric
                  label="ON THE MAP"
                  value={data
                    .filter((p) => p.latitude !== null)
                    .length.toString()
                    .padStart(2, "0")}
                  detail="Projects with a location"
                  icon={<Globe2 />}
                />
              </section>
            )}
            <div
              className={`work-grid ${settings.dashboard.showFocus ? "" : "without-focus"}`}
            >
              <section className="projects-section">
                <div className="section-heading">
                  <h2>
                    Your projects <span>{data.length}</span>
                  </h2>
                  <select
                    className="project-sort"
                    aria-label="Sort projects"
                    value={settings.dashboard.sort}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        dashboard: {
                          ...settings.dashboard,
                          sort: e.target
                            .value as AtlasSettings["dashboard"]["sort"],
                        },
                      })
                    }
                  >
                    <option value="updated">Recently updated</option>
                    <option value="name">Name A–Z</option>
                    <option value="due">Due date</option>
                  </select>
                </div>
                <div className="project-toolbar">
                  <div className="filter-tabs" aria-label="Filter projects">
                    {[
                      "All projects",
                      "In progress",
                      "Planning",
                      "On hold",
                      "Completed",
                      "Archived",
                    ].map((s) => (
                      <button
                        key={s}
                        className={filter === s ? "chosen" : ""}
                        aria-pressed={filter === s}
                        onClick={() => setFilter(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <label className="search-box">
                    <Search size={16} />
                    <Input
                      aria-label="Search projects"
                      placeholder="Find a project…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                </div>
                <div
                  className={`project-grid ${settings.dashboard.layout === "list" ? "project-list" : ""}`}
                >
                  {filtered.map((p) => (
                    <button
                      key={p.id}
                      className="project-card"
                      onClick={() => openProject(p)}
                    >
                      <div className="project-card-top">
                        <span className={`project-symbol ${p.color}`}>
                          {p.name
                            .split(" ")
                            .slice(0, 2)
                            .map((s) => s[0])
                            .join("")}
                        </span>
                        <span
                          className={`status ${p.status.toLowerCase().replaceAll(" ", "-")}`}
                        >
                          {p.status}
                        </span>
                      </div>
                      <div className="project-category">{p.category}</div>
                      <h3>
                        {p.name}
                        <ArrowUpRight size={17} />
                      </h3>
                      <p className="project-description">{p.description}</p>
                      <div className="project-progress">
                        <span>Progress</span>
                        <strong>{progress(p)}%</strong>
                      </div>
                      <Progress
                        aria-label={`${p.name} progress`}
                        value={progress(p)}
                        className={`progress-bar ${p.color}`}
                      />
                      <div className="project-card-footer">
                        <span>
                          <MapPin size={13} />
                          {p.dueDate
                            ? `Due ${p.dueDate}`
                            : p.location || "Location not set"}
                        </span>
                        <span>
                          {p.tasks.filter((t) => t.done).length}/
                          {p.tasks.length} tasks
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {!filtered.length && (
                  <div className="empty-state">
                    <Folder size={32} />
                    <h3>
                      {query
                        ? "No matching projects"
                        : "Room for your next idea"}
                    </h3>
                    <p>
                      {query
                        ? "Try another name or location."
                        : "Add a project and give it a place in your world."}
                    </p>
                    {!query && (
                      <Button
                        disabled={!loaded}
                        onClick={() => setCreating(true)}
                      >
                        <Plus />
                        New project
                      </Button>
                    )}
                  </div>
                )}
              </section>
              {settings.dashboard.showFocus && (
                <aside className="focus-panel">
                  <div className="section-heading">
                    <h2>Next moves</h2>
                    <Target size={18} />
                  </div>
                  <p className="secondary-text">Small steps. Real momentum.</p>
                  <div className="focus-tasks">
                    {tasks.slice(0, 5).map(({ p, t }) => (
                      <button
                        key={`${p.id}-${t.id}`}
                        onClick={() => openProject(p)}
                        className="focus-task"
                      >
                        <Circle size={18} />
                        <span>
                          <strong>{t.title}</strong>
                          <small>
                            <span className={`color-dot ${p.color}`} />
                            {p.name}
                          </small>
                        </span>
                      </button>
                    ))}
                    {!tasks.length && (
                      <p className="secondary-text">
                        All caught up. Add tasks inside a project.
                      </p>
                    )}
                  </div>
                  <div className="flightdeck-promo">
                    <span className="promo-mark">
                      <Layers3 size={23} />
                    </span>
                    <h3>A connected workspace.</h3>
                    <p>Your FlightDeck projects belong here, too.</p>
                    <button
                      className="text-link"
                      onClick={() => navigate("connection")}
                    >
                      FlightDeck connection <ArrowUpRight size={16} />
                    </button>
                    <small>Not connected</small>
                  </div>
                </aside>
              )}
            </div>
            <footer className="dashboard-footer">
              <span>TE CONNECTIVITY / ATLAS</span>
              <a href="/progress">
                Build progress <ArrowUpRight size={13} />
              </a>
            </footer>
          </main>
        )}
      </div>
      <Settings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        settings={settings}
        onChange={updateSettings}
        storageError={storageError}
        onReturnFocus={() => settingsTrigger.current?.focus()}
      />
      {selected && (
        <ProjectWorkspace
          key={selected.id}
          project={selected}
          demo={demo}
          busy={saving}
          error={error}
          onClose={() => setSelected(null)}
          onSave={save}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onGlobe={() => {
            const p = selected;
            setSelected(null);
            navigate("globe");
            setFlightTarget(p);
          }}
        />
      )}
      <ProjectForm
        open={creating || !!editing}
        project={editing}
        busy={saving}
        error={error}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSave={save}
      />
      {!loaded && (
        <span className="loading-indicator">
          <LoaderCircle size={16} className="spin" />
          Loading workspace
        </span>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
function ProjectForm({
  open,
  project,
  busy,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project | null;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (fields: ProjectFields, existing?: Project) => Promise<unknown>;
}) {
  const [fields, setFields] = useState<ProjectFields>(blank);
  useEffect(() => {
    if (open) setFields(project ? { ...project } : { ...blank, tasks: [] });
  }, [open, project]);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !busy) onClose();
      }}
    >
      <DialogContent className="project-dialog">
        <DialogTitle>
          {project ? "Edit project" : "Make room for a new project"}
        </DialogTitle>
        <DialogDescription>
          Give it a name. Add a location to put it on the globe.
        </DialogDescription>
        <form
          className="project-form"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(fields, project || undefined);
          }}
        >
          <label>
            Project name
            <Input
              required
              maxLength={100}
              value={fields.name}
              onChange={(e) => setFields({ ...fields, name: e.target.value })}
              placeholder="The next big thing"
            />
          </label>
          <label>
            Description
            <Textarea
              maxLength={1500}
              value={fields.description}
              onChange={(e) =>
                setFields({ ...fields, description: e.target.value })
              }
              placeholder="What are you working towards?"
            />
          </label>
          <div className="form-columns">
            <label>
              Status
              <select
                value={fields.status}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    status: e.target.value as ProjectFields["status"],
                  })
                }
              >
                {["Planning", "In progress", "On hold", "Completed"].map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              Category
              <Input
                required
                maxLength={60}
                value={fields.category}
                onChange={(e) =>
                  setFields({ ...fields, category: e.target.value })
                }
              />
            </label>
          </div>
          <div className="form-columns">
            <label>
              Function
              <Input
                maxLength={80}
                placeholder="Operations / TEOA, Quality…"
                value={fields.functionArea || ""}
                onChange={(e) =>
                  setFields({ ...fields, functionArea: e.target.value })
                }
              />
            </label>
            <label>
              Priority
              <select
                value={fields.priority || "Normal"}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    priority: e.target.value as ProjectFields["priority"],
                  })
                }
              >
                <option>Normal</option>
                <option>High</option>
                <option>Low</option>
              </select>
            </label>
          </div>
          <label>
            Next action
            <Input
              maxLength={300}
              placeholder="The one next step that moves this forward"
              value={fields.nextAction || ""}
              onChange={(e) =>
                setFields({ ...fields, nextAction: e.target.value })
              }
            />
          </label>
          <label>
            Blocker
            <Input
              maxLength={500}
              placeholder="What needs resolving?"
              value={fields.blocker || ""}
              onChange={(e) =>
                setFields({ ...fields, blocker: e.target.value })
              }
            />
          </label>
          <label>
            Success measure
            <Textarea
              maxLength={500}
              placeholder="The outcome and how you will measure it"
              value={fields.benefit || ""}
              onChange={(e) =>
                setFields({ ...fields, benefit: e.target.value })
              }
            />
          </label>
          <div className="form-columns">
            <label>
              Sponsor
              <Input
                maxLength={100}
                value={fields.sponsor || ""}
                onChange={(e) =>
                  setFields({ ...fields, sponsor: e.target.value })
                }
              />
            </label>
            <label>
              Onboarding stage
              <select
                value={fields.onboardingStage || ""}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    onboardingStage: e.target.value
                      ? (e.target.value as ProjectFields["onboardingStage"])
                      : undefined,
                  })
                }
              >
                <option value="">Not an onboarding project</option>
                {[
                  "Discovery",
                  "Pilot",
                  "Ready for FlightDeck",
                  "Rolled out",
                ].map((stage) => (
                  <option key={stage}>{stage}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Location
            <Input
              maxLength={100}
              placeholder="City, country"
              value={fields.location}
              onChange={(e) =>
                setFields({ ...fields, location: e.target.value })
              }
            />
          </label>
          <div className="form-columns">
            <label>
              Latitude
              <Input
                type="number"
                min="-90"
                max="90"
                step="any"
                placeholder="55.6761"
                value={fields.latitude ?? ""}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    latitude:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Longitude
              <Input
                type="number"
                min="-180"
                max="180"
                step="any"
                placeholder="12.5683"
                value={fields.longitude ?? ""}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    longitude:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <div className="form-columns">
            <label>
              Target date
              <Input
                type="date"
                value={fields.dueDate}
                onChange={(e) =>
                  setFields({ ...fields, dueDate: e.target.value })
                }
              />
            </label>
            <label>
              Project color
              <select
                value={fields.color}
                onChange={(e) =>
                  setFields({
                    ...fields,
                    color: e.target.value as ProjectFields["color"],
                  })
                }
              >
                {["orange", "blue", "green", "violet"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" /> : <Plus />}
              {project ? "Save changes" : "Create project"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
