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
  Heart,
  ListTodo,
  Users,
  Presentation,
  Grid3X3,
  Menu,
  CircleHelp,
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
import { ReportWidgets, ActiveTaskTimer } from "./work-studio";
import { AppLauncher, AppAdministration, TeamHub } from "./workspace-tools";
import PresentationStudio from "./presentation-studio";
import Today from "./today";
import PortfolioPlan from "./portfolio-plan";
import ProjectBoard from "./project-board";
import CommandMenu from "./command-menu";
import { briefing } from "@/lib/briefing";
import GlobeWorkspace from "./globe-workspace";
import ViewFlight, { type PortfolioView } from "./view-flight";
import { useTheme } from "next-themes";
import Settings from "./settings";
import Briefing from "./briefing";
import WellbeingPage, {
  WellbeingProvider,
  WellbeingDashboard,
  WellbeingNotice,
  FocusBadge,
} from "./wellbeing";
import FlightDeckConnection from "./flightdeck-connection";
import { FlightDeckPromo } from "./flightdeck-onboarding";
import AccessManagement from "./access-management";
import type { AccessProfile } from "@/lib/access-policy";
import Ideas from "./ideas";
import AtlasNavigation from "./atlas-navigation";
import ProjectManagement from "./project-management";
import HelpCenter from "./help-center";
import FeatureHelp from "./feature-help";
import {
  validViews,
  workTools,
  workTool,
  type View,
  type WorkTool,
} from "@/lib/navigation";
import { onboardingTasks, type Opportunity } from "@/lib/opportunities";
import {
  motionScale,
  defaultSettings,
  readSettings,
  SETTINGS_KEY,
  type AtlasSettings,
} from "@/lib/settings";
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
  const [flight, setFlight] = useState<{
    from: PortfolioView;
    to: PortfolioView;
    snapshot: HTMLElement | null;
    duration: number;
  } | null>(null);
  const tabRefs = useRef<Record<PortfolioView, HTMLButtonElement | null>>({
    dashboard: null,
    globe: null,
  });
  const lastPortfolioView = useRef<PortfolioView>("dashboard");
  const dashboardScroll = useRef(0);
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
  const [tool, setTool] = useState<WorkTool>("projects");
  const [workspaceId, setWorkspaceId] = useState("");
  const workspaceRef = useRef("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>("dashboard"),
    [projects, setProjects] = useState<Project[]>([]),
    [loaded, setLoaded] = useState(false),
    [demo, setDemo] = useState(true),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All projects"),
    [error, setError] = useState(""),
    [presentationProject, setPresentationProject] = useState<string | null>(
      null,
    ),
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
      const url = new URL(location.href);
      const requested = url.searchParams.get("project");
      if (requested) {
        const found = (body.projects.length ? body.projects : examples).find(
          (p) => p.id === requested,
        );
        if (found) {
          const destination = url.searchParams.has("work")
            ? workTool(url.searchParams.get("work"))
            : "list";
          setView("manage");
          setTool(destination);
          workspaceRef.current = found.id;
          setWorkspaceId(found.id);
          url.searchParams.set("view", "manage");
          url.searchParams.set("workspace", found.id);
          url.searchParams.set("tool", destination);
          for (const key of ["project", "work", "scope"])
            url.searchParams.delete(key);
          history.replaceState(null, "", url);
        } else
          setError("That project is unavailable or you do not have access.");
      }
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
    const look = new URLSearchParams(location.search).get("look");
    if (
      look &&
      ["normal", "crt", "nvg", "thermal", "anime", "noir", "snow"].includes(
        look,
      )
    )
      restored.globe.look = look as AtlasSettings["globe"]["look"];
    setSettings(restored);
    const v = new URLSearchParams(location.search).get("view");
    if (v === "globe" || v === "dashboard") lastPortfolioView.current = v;
    else lastPortfolioView.current = restored.startView;
    setView(validViews.includes(v as View) ? (v as View) : restored.startView);
    setTool(workTool(new URLSearchParams(location.search).get("tool")));
    const requestedWorkspace =
      new URLSearchParams(location.search).get("workspace") || "";
    workspaceRef.current = requestedWorkspace;
    setWorkspaceId(requestedWorkspace);
  }, [load]);
  useEffect(() => {
    function restoreNavigation() {
      const params = new URLSearchParams(location.search);
      const destination = params.get("view") as View;
      setView(validViews.includes(destination) ? destination : "dashboard");
      setTool(workTool(params.get("tool")));
      workspaceRef.current = params.get("workspace") || "";
      setWorkspaceId(workspaceRef.current);
      setFlight(null);
      setMenuOpen(false);
      void load();
    }
    window.addEventListener("popstate", restoreNavigation);
    return () => window.removeEventListener("popstate", restoreNavigation);
  }, [load]);
  useEffect(() => {
    const reload = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", reload);
    const interval = window.setInterval(reload, 60000);
    return () => {
      window.removeEventListener("focus", reload);
      clearInterval(interval);
    };
  }, [load]);
  function finishFlight(destination: PortfolioView) {
    const wasSkipping = !!document.activeElement?.closest(".view-flight");
    setFlight(null);
    if (destination === "dashboard")
      window.scrollTo({ top: dashboardScroll.current, behavior: "instant" });
    if (wasSkipping)
      requestAnimationFrame(() => tabRefs.current[destination]?.focus());
  }
  function chooseWorkspace(id: string) {
    navigate("manage", tool === "projects" ? "overview" : tool, id);
  }
  function navigate(next: View, nextTool?: WorkTool, projectId?: string) {
    setMenuOpen(false);
    if (
      next === view &&
      !flight &&
      (!nextTool || nextTool === tool) &&
      (!projectId || projectId === workspaceId)
    )
      return;
    const portfolio = (value: View): value is PortfolioView =>
      value === "dashboard" || value === "globe";
    if (portfolio(next)) lastPortfolioView.current = next;
    if (view === "dashboard" && next !== "dashboard")
      dashboardScroll.current = window.scrollY;
    const scale = motionScale(settings.viewAnimation);
    if (portfolio(view) && portfolio(next) && view !== next && scale > 0) {
      if (flight) setFlight({ ...flight, to: next });
      else {
        const surface = document.querySelector<HTMLElement>(".dashboard");
        const snapshot =
          view === "dashboard" && surface
            ? (surface.cloneNode(true) as HTMLElement)
            : null;
        if (snapshot && surface) {
          snapshot.style.width = `${surface.getBoundingClientRect().width}px`;
          snapshot.style.margin = "0";
          snapshot.style.transform = `translateY(${-window.scrollY}px)`;
          snapshot.removeAttribute("id");
          snapshot.removeAttribute("role");
          snapshot.removeAttribute("aria-labelledby");
          snapshot
            .querySelectorAll("[id]")
            .forEach((element) => element.removeAttribute("id"));
        }
        setFlight({ from: view, to: next, snapshot, duration: 4.8 * scale });
      }
    } else setFlight(null);
    setView(next);
    const params = new URLSearchParams({ view: next });
    if (next === "manage") {
      const destination = nextTool || tool;
      setTool(destination);
      params.set("tool", destination);
      const id =
        destination === "projects"
          ? ""
          : (projectId ?? (view === "manage" ? workspaceRef.current : ""));
      workspaceRef.current = id;
      setWorkspaceId(id);
      if (id) params.set("workspace", id);
    } else {
      workspaceRef.current = "";
      setWorkspaceId("");
    }
    history.pushState(null, "", "/?" + params);
    setFlightTarget(null);
    window.scrollTo({
      top:
        next === "dashboard" && (scale === 0 || view !== "globe")
          ? dashboardScroll.current
          : 0,
      behavior: "instant",
    });
  }
  function handleTabKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: PortfolioView,
  ) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "dashboard"
        : event.key === "End"
          ? "globe"
          : current === "dashboard"
            ? "globe"
            : "dashboard";
    tabRefs.current[next]?.focus();
    navigate(next);
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
    tasks = briefing(allData, "day").actions;
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
      if (!existing) setCreating(false);
      if (existing && editing?.id === existing.id) setEditing(null);
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
    if (!loaded) return;
    setError("");
    navigate("manage", "overview", p.id);
  }
  const date = loaded
    ? new Intl.DateTimeFormat("en", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date())
    : "";
  return (
    <WellbeingProvider
      key={access?.userId || "loading"}
      userId={access?.userId}
    >
      <div
        className={`atlas-shell ${view === "globe" ? "immersive-globe" : ""}`}
      >
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
          <AtlasNavigation
            view={view}
            tool={tool}
            loaded={loaded}
            access={access}
            project={
              loaded && view === "manage" && tool !== "projects"
                ? allData.find((p) => p.id === workspaceId)
                : undefined
            }
            navigate={navigate}
          />
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
            <button
              ref={menuTrigger}
              className="theme-toggle mobile-navigation-trigger"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={20} />
            </button>
            {view === "globe" && (
              <a
                className="globe-top-brand"
                href="/?view=dashboard"
                aria-label="Atlas dashboard"
              >
                <img src="/te-logo.png" alt="TE Connectivity" />
                <span>ATLAS</span>
              </a>
            )}
            <div className="view-tabs-bar">
              <div
                className="view-tabs"
                role="tablist"
                aria-label="Project views"
                style={
                  {
                    "--active-tab": view === "globe" ? 1 : 0,
                  } as React.CSSProperties
                }
              >
                {(view === "dashboard" || view === "globe") && (
                  <span className="view-tab-indicator" aria-hidden="true" />
                )}
                <button
                  id="dashboard-tab"
                  role="tab"
                  aria-label="Dashboard"
                  aria-selected={view === "dashboard"}
                  aria-controls="dashboard-panel"
                  tabIndex={view === "globe" ? -1 : 0}
                  disabled={!loaded}
                  ref={(el) => {
                    tabRefs.current.dashboard = el;
                  }}
                  onKeyDown={(e) => handleTabKey(e, "dashboard")}
                  onClick={() => navigate("dashboard")}
                >
                  <LayoutDashboard size={17} />
                  <span>Dashboard</span>
                </button>
                <button
                  id="globe-tab"
                  role="tab"
                  aria-label="Project Eye"
                  aria-selected={view === "globe"}
                  aria-controls="globe-panel"
                  tabIndex={view === "globe" ? 0 : -1}
                  disabled={!loaded}
                  ref={(el) => {
                    tabRefs.current.globe = el;
                  }}
                  onKeyDown={(e) => handleTabKey(e, "globe")}
                  onClick={() => navigate("globe")}
                >
                  <Globe2 size={17} />
                  <span>Project Eye</span>
                </button>
              </div>
              <FeatureHelp title="Dashboard & Project Eye">
                Dashboard brings your projects and next actions together.
                Project Eye shows projects with map coordinates. Switch with
                these tabs; use the settings icon for each view’s layout, layers
                and animation controls.
              </FeatureHelp>
            </div>
            <div className="topbar-right">
              <button
                className="theme-toggle global-help"
                aria-label="Open help"
                title="Help & getting started"
                onClick={() => navigate("help")}
              >
                <CircleHelp size={18} />
              </button>
              <AppLauncher
                access={access}
                onAdmin={() => navigate("apps")}
                onInbox={() => navigate("team")}
              />
              <FocusBadge onOpen={() => navigate("wellbeing")} />
              <CommandMenu
                projects={allData}
                onOpen={openProject}
                disabled={!loaded || !!flight || creating || settingsOpen}
                commands={[
                  ...workTools
                    .filter((t) =>
                      view === "manage" && workspaceId
                        ? t.id !== "projects"
                        : t.id === "projects",
                    )
                    .map((t) => ({
                      id: "work-" + t.id,
                      label: t.group + ": " + t.title,
                      run: () => navigate("manage", t.id),
                    })),
                  {
                    id: "help",
                    label: "Help & getting started",
                    run: () => navigate("help"),
                  },
                  {
                    id: "team",
                    label: "Team workspace, notifications & capacity",
                    run: () => navigate("team"),
                  },
                  {
                    id: "presentations",
                    label: "Presentation studio",
                    run: () => navigate("presentations"),
                  },
                  ...(access?.superAdmin
                    ? [
                        {
                          id: "apps",
                          label: "Manage apps",
                          run: () => navigate("apps"),
                        },
                      ]
                    : []),
                  {
                    id: "today",
                    label: "Today, quick capture & advisor",
                    run: () => navigate("today"),
                  },
                  {
                    id: "dashboard",
                    label: "Dashboard",
                    run: () => navigate("dashboard"),
                  },
                  {
                    id: "globe",
                    label: "Project Eye",
                    run: () => navigate("globe"),
                  },
                  {
                    id: "wellbeing",
                    label: "Wellbeing & focus timer",
                    run: () => navigate("wellbeing"),
                  },
                  {
                    id: "connection",
                    label: "FlightDeck connection",
                    run: () => navigate("connection"),
                  },
                  ...(access?.permissions.includes("briefings.read")
                    ? [
                        {
                          id: "briefing",
                          label: "Daily & weekly briefings",
                          run: () => navigate("briefing"),
                        },
                      ]
                    : []),
                  ...(access?.permissions.includes("ideas.use")
                    ? [
                        {
                          id: "ideas",
                          label: "Ideas & AI",
                          run: () => navigate("ideas"),
                        },
                      ]
                    : []),
                  ...(access?.superAdmin
                    ? [
                        {
                          id: "access",
                          label: "People & access",
                          run: () => navigate("access"),
                        },
                      ]
                    : []),
                  ...(access?.permissions.includes("projects.create")
                    ? [
                        {
                          id: "new",
                          label: "New project",
                          run: () => {
                            setError("");
                            setCreating(true);
                          },
                        },
                      ]
                    : []),
                ]}
              />
              <button
                className={`theme-toggle ${view === "globe" ? "globe-settings-trigger" : ""}`}
                ref={settingsTrigger}
                aria-label={
                  view === "globe"
                    ? "Open Project Eye settings"
                    : "Open settings"
                }
                title="Settings"
                disabled={!loaded}
                onClick={() => {
                  setSettingsTab(view === "globe" ? "globe" : "dashboard");
                  setSettingsOpen(true);
                }}
              >
                <Settings2 size={18} />
                {view === "globe" && <span>Project Eye settings</span>}
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
                  !loaded ||
                  saving ||
                  !access?.permissions.includes("projects.create")
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
          {!demo && <ActiveTaskTimer />}
          <div className="view-content" inert={!!flight} aria-busy={!!flight}>
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {view === "manage" ? (
              <ProjectManagement
                projects={allData}
                projectId={workspaceId}
                tool={tool}
                demo={demo}
                loaded={loaded}
                busy={saving}
                canCreate={!!access?.permissions.includes("projects.create")}
                onProject={chooseWorkspace}
                onTool={(t) => navigate("manage", t)}
                onBack={() => navigate("dashboard")}
                onEdit={(p) => {
                  setError("");
                  setEditing(p);
                }}
                onGlobe={(p) => {
                  navigate("globe");
                  setFlightTarget(p);
                }}
                onNew={() => {
                  setError("");
                  setCreating(true);
                }}
                onSave={save}
                onReload={load}
              />
            ) : view === "help" ? (
              <HelpCenter navigate={navigate} />
            ) : view === "apps" ? (
              access?.superAdmin ? (
                <AppAdministration />
              ) : (
                <main className="hub-page">
                  <h1>Super Admin access required</h1>
                </main>
              )
            ) : view === "team" ? (
              <TeamHub
                access={access}
                projects={projects}
                onOpen={openProject}
                onCreate={save}
                onSave={save}
              />
            ) : view === "presentations" ? (
              <PresentationStudio
                projects={projects}
                demo={demo}
                initialProjectId={presentationProject}
              />
            ) : view === "today" ? (
              <Today
                projects={allData}
                demo={demo}
                busy={saving}
                onOpen={openProject}
                onSave={save}
                onFocus={() => navigate("wellbeing")}
                capacity={settings.dailyFocusMinutes}
                onCapacityChange={(minutes) =>
                  updateSettings({
                    ...settings,
                    dailyFocusMinutes:
                      minutes as AtlasSettings["dailyFocusMinutes"],
                  })
                }
              />
            ) : view === "wellbeing" ? (
              <WellbeingPage />
            ) : view === "access" ? (
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
            ) : view === "ideas" &&
              access?.permissions.includes("ideas.use") ? (
              <Ideas
                projects={projects}
                busy={
                  saving || !access?.permissions.includes("projects.create")
                }
                onOpen={openProject}
                onCreate={(idea) => void startPilot(idea)}
              />
            ) : view === "connection" ? (
              <FlightDeckConnection
                projects={projects}
                busy={saving}
                canCreate={!!access?.permissions.includes("projects.create")}
                superAdmin={!!access?.superAdmin}
                onNew={() => {
                  setError("");
                  setCreating(true);
                }}
                onOpen={openProject}
                onSave={save}
                onImported={load}
              />
            ) : view === "globe" ? (
              <GlobeWorkspace
                projects={globeProjects}
                target={flightTarget}
                onOpen={openProject}
                settings={settings.globe}
                onSettingsChange={(patch) =>
                  updateSettings({
                    ...settings,
                    globe: { ...settings.globe, ...patch },
                  })
                }
                demo={demo}
              />
            ) : (
              <main
                className="dashboard"
                role="tabpanel"
                id="dashboard-panel"
                aria-labelledby="dashboard-tab"
                tabIndex={0}
              >
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">THE BIG PICTURE</span>
                    <h1>
                      Everything in motion<span>.</span>
                    </h1>
                    <p>Your projects, your progress, your next move.</p>
                  </div>
                  <button
                    className="today-launch"
                    onClick={() => navigate("today")}
                  >
                    <ListTodo size={18} />
                    Plan today <ArrowUpRight size={14} />
                  </button>
                  <button
                    className="globe-link"
                    onClick={() => navigate("globe")}
                  >
                    <span className="globe-link-icon">
                      <Globe2 size={30} />
                    </span>
                    <span>
                      Explore your world
                      <small>
                        Open Project Eye <ArrowUpRight size={13} />
                      </small>
                    </span>
                  </button>
                </div>
                {demo && (
                  <div className="demo-banner">
                    <Compass size={17} />
                    <span>
                      <strong>Demo workspace</strong> · These are example
                      projects. Add a project to start your own workspace.
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
                <div className="project-navigation-hint">
                  <Folder size={19} />
                  <span>
                    <strong>One workspace for every project.</strong> Select a
                    project below to open its overview, tasks, Kanban,
                    leadership reviews and work tools.
                  </span>
                </div>
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
                {settings.dashboard.showPlanner && loaded && (
                  <PortfolioPlan projects={allData} onOpen={openProject} />
                )}
                <div
                  className={`work-grid ${settings.dashboard.showFocus || settings.dashboard.showWellbeing ? "" : "without-focus"}`}
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
                    <div
                      className="project-layout-switch"
                      aria-label="Project layout"
                    >
                      {(["cards", "list", "board"] as const).map((layout) => (
                        <button
                          key={layout}
                          disabled={!loaded}
                          aria-pressed={settings.dashboard.layout === layout}
                          onClick={() =>
                            updateSettings({
                              ...settings,
                              dashboard: { ...settings.dashboard, layout },
                            })
                          }
                        >
                          {layout[0].toUpperCase() + layout.slice(1)}
                        </button>
                      ))}
                    </div>
                    {projects.some(
                      (p) => !p.archived && p.work?.widgets.length,
                    ) && (
                      <section className="portfolio-widgets">
                        <h3>Your project measures</h3>
                        {projects
                          .filter((p) => !p.archived && p.work?.widgets.length)
                          .map((p) => (
                            <ReportWidgets key={p.id} project={p} compact />
                          ))}
                      </section>
                    )}
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
                    {settings.dashboard.layout === "board" ? (
                      <ProjectBoard
                        projects={filtered}
                        onOpen={openProject}
                        onSave={save}
                        busy={saving}
                        demo={demo}
                      />
                    ) : (
                      <div
                        className={`project-grid ${settings.dashboard.layout === "list" ? "project-list" : ""}`}
                      >
                        {filtered.map((p) => (
                          <button
                            key={p.id}
                            className="project-card"
                            disabled={!loaded}
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
                            <p className="project-description">
                              {p.description}
                            </p>
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
                    )}
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
                  {(settings.dashboard.showFocus ||
                    settings.dashboard.showWellbeing) && (
                    <div className="personal-rail">
                      {settings.dashboard.showWellbeing && (
                        <WellbeingDashboard
                          onOpen={() => navigate("wellbeing")}
                        />
                      )}
                      {settings.dashboard.showFocus && (
                        <aside className="focus-panel">
                          <div className="section-heading">
                            <h2>Next moves</h2>
                            <Target size={18} />
                          </div>
                          <p className="secondary-text">
                            Small steps. Real momentum.
                          </p>
                          <div className="focus-tasks">
                            {tasks.slice(0, 5).map(({ p, t }) => (
                              <div
                                key={`${p.id}-${t.id}`}
                                className="focus-task actionable-focus"
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`Complete ${t.title}`}
                                  checked={false}
                                  disabled={
                                    demo || saving || p.canEdit === false
                                  }
                                  onChange={() =>
                                    void save(
                                      {
                                        ...p,
                                        tasks: p.tasks.map((x) =>
                                          x.id === t.id
                                            ? { ...x, done: true }
                                            : x,
                                        ),
                                      },
                                      p,
                                    )
                                  }
                                />
                                <button onClick={() => openProject(p)}>
                                  <span>
                                    <strong>{t.title}</strong>
                                    <small>
                                      <span
                                        className={`color-dot ${p.color}`}
                                      />
                                      {p.name}
                                    </small>
                                  </span>
                                </button>
                              </div>
                            ))}
                            {!tasks.length && (
                              <p className="secondary-text">
                                All caught up. Add tasks inside a project.
                              </p>
                            )}
                          </div>
                          <FlightDeckPromo
                            superAdmin={!!access?.superAdmin}
                            onOpen={() => navigate("connection")}
                          />
                        </aside>
                      )}
                    </div>
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
          {flight && (
            <ViewFlight
              from={flight.from}
              to={flight.to}
              snapshot={flight.snapshot}
              duration={flight.duration}
              dark={isDark}
              projects={globeProjects}
              onComplete={finishFlight}
            />
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
        <ProjectForm
          open={creating || !!editing}
          project={editing}
          busy={saving}
          error={error}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (fields, existing) => {
            const project = await save(fields, existing);
            if (project && !existing) openProject(project);
            return project;
          }}
        />
        {!loaded && (
          <span className="loading-indicator">
            <LoaderCircle size={16} className="spin" />
            Loading workspace
          </span>
        )}
        <WellbeingNotice />
      </div>
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent
          className="mobile-navigation-dialog"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            menuTrigger.current?.focus();
          }}
        >
          <DialogTitle>Atlas navigation</DialogTitle>
          <DialogDescription>
            Choose a workspace or expand a section.
          </DialogDescription>
          <AtlasNavigation
            view={view}
            tool={tool}
            loaded={loaded}
            access={access}
            project={
              loaded && view === "manage" && tool !== "projects"
                ? allData.find((p) => p.id === workspaceId)
                : undefined
            }
            navigate={navigate}
          />
        </DialogContent>
      </Dialog>
    </WellbeingProvider>
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
