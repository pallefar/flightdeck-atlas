"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Layers3,
  ListTodo,
  FolderKanban,
  BriefcaseBusiness,
  Wrench,
  Users,
  Link2,
  BookOpen,
} from "lucide-react";
import { workTools, type View, type WorkTool } from "@/lib/navigation";
import type { AccessProfile } from "@/lib/access-policy";
import type { Project } from "@/lib/projects";
import FlightDeckContextSwitcher from "./flightdeck-context-switcher";
import { useDisclosure } from "@/lib/motion/useMotion";
export default function AtlasNavigation({
  view,
  tool,
  loaded,
  access,
  navigate,
  project,
}: {
  project?: Project;
  view: View;
  tool: WorkTool;
  loaded: boolean;
  access: AccessProfile | null;
  navigate: (view: View, tool?: WorkTool) => void;
}) {
  const [collapsed, setCollapsed] = useState<string[]>([
    "Work tools",
    "Team & personal",
    "Connections & admin",
  ]);
  // Group open/close through the shared motion layer (lib/motion/disclosure.ts):
  // the opened links unfold and the groups below glide instead of jumping.
  // The chevron keeps its own CSS turn (navigation.css), so none is passed.
  // capture() goes right before a change of `collapsed`; with motion off it
  // measures nothing, and the new state simply renders.
  const nav = useRef<HTMLElement>(null);
  const groupMotion = useDisclosure(nav, {
    selector: ".nav-group-toggle, .nav-submenu, .help-nav-link",
  });
  // False until the mount's own effects (the stored groups, the first
  // auto-expand) have run: those settle without motion, and so does the
  // view a link or a reload opens while the workspace is still loading.
  const mounted = useRef(false);
  useEffect(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem("atlas-nav-groups") || "null",
      );
      if (Array.isArray(value) && value.every((x) => typeof x === "string"))
        setCollapsed(value);
    } catch {}
  }, []);
  const activeGroup =
    view === "manage"
      ? workTools.find((t) => t.id === tool)?.group
      : ["team", "briefing", "ideas", "wellbeing", "presentations"].includes(
            view,
          )
        ? "Team & personal"
        : ["connection", "access", "apps"].includes(view)
          ? "Connections & admin"
          : "";
  useEffect(() => {
    if (!activeGroup) return;
    // A navigation made elsewhere (a project card, the command menu) opens
    // its group: that moves the sidebar, so it unfolds like a click.
    if (mounted.current && loaded) groupMotion.capture();
    setCollapsed((old) => old.filter((x) => x !== activeGroup));
    // Only a new group opens it. groupMotion is stable (useDisclosure returns
    // the same object) and `loaded` is read, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroup]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function toggle(group: string) {
    groupMotion.capture();
    setCollapsed((old) => {
      const next = old.includes(group)
        ? old.filter((x) => x !== group)
        : [...old, group];
      try {
        localStorage.setItem("atlas-nav-groups", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  function item(
    label: string,
    target: View,
    sub?: WorkTool,
    ariaLabel?: string,
  ) {
    const active = view === target && (!sub || tool === sub);
    return (
      <button
        key={label}
        disabled={!loaded}
        className={`nav-item ${active ? "active" : ""}`}
        aria-label={ariaLabel}
        aria-current={active ? "page" : undefined}
        onClick={() => navigate(target, sub)}
      >
        <span>{label}</span>
      </button>
    );
  }
  const groups = [
    ...(project
      ? [
          {
            name: "Project",
            icon: FolderKanban,
            content: workTools
              .filter((t) => t.group === "Project")
              .map((t) => item(t.title, "manage", t.id)),
          },
          {
            name: "Project management",
            icon: FolderKanban,
            content: workTools
              .filter(
                (t) => t.group === "Project management" && t.id !== "projects",
              )
              .map((t) => item(t.title, "manage", t.id)),
          },
          {
            name: "Leadership",
            icon: BriefcaseBusiness,
            content: workTools
              .filter((t) => t.group === "Leadership")
              .map((t) => item(t.title, "manage", t.id)),
          },
          {
            name: "Work tools",
            icon: Wrench,
            content: workTools
              .filter((t) => t.group === "Work tools")
              .map((t) => item(t.title, "manage", t.id)),
          },
        ]
      : []),
    {
      name: "Team & personal",
      icon: Users,
      content: (
        <>
          {item("Team workspace", "team")}
          {access?.permissions.includes("briefings.read") &&
            item("Briefings", "briefing")}
          {item("Presentations", "presentations")}
          {access?.permissions.includes("ideas.use") &&
            item("Ideas & AI", "ideas", undefined, "Ideas and AI")}
          {item("Wellbeing", "wellbeing")}
        </>
      ),
    },
    {
      name: "Connections & admin",
      icon: Link2,
      content: (
        <>
          {item("FlightDeck OS", "connection")}
          {access?.superAdmin && (
            <>
              {item(
                "People & access",
                "access",
                undefined,
                "People and access",
              )}
              {item("Apps & connections", "apps")}
            </>
          )}
        </>
      ),
    },
  ];
  return (
    <nav ref={nav} className="atlas-navigation" aria-label="Main navigation">
      <FlightDeckContextSwitcher access={access} />
      <div className="primary-nav-link">
        <ListTodo size={17} />
        {item("Today & advisor", "today", undefined, "Today and advisor")}
      </div>
      <div className="primary-nav-link">
        <Layers3 size={17} />
        {item("Portfolio dashboard", "dashboard", undefined, "Portfolio")}
      </div>
      {project ? (
        <div className="nav-project-identity">
          <span className="eyebrow">SELECTED PROJECT</span>
          <strong>{project.name}</strong>
          <span>{project.status}</span>
          <button onClick={() => navigate("manage", "projects")}>
            Switch project
          </button>
        </div>
      ) : (
        <div className="nav-project-entry">
          <button
            className="nav-item"
            disabled={!loaded}
            onClick={() => navigate("manage", "projects")}
          >
            <FolderKanban size={16} />
            <span>Choose a project</span>
          </button>
          <p>Open a project for tasks, planning, leadership and work tools.</p>
        </div>
      )}
      {groups.map((g) => (
        <section className="navigation-group" key={g.name}>
          <button
            className="nav-group-toggle"
            aria-expanded={!collapsed.includes(g.name)}
            onClick={() => toggle(g.name)}
          >
            <g.icon size={16} />
            <span>{g.name}</span>
            <ChevronDown size={14} />
          </button>
          <div className="nav-submenu" hidden={collapsed.includes(g.name)}>
            {g.content}
          </div>
        </section>
      ))}
      <div className="primary-nav-link help-nav-link">
        <BookOpen size={17} />
        {item("Help & getting started", "help")}
      </div>
    </nav>
  );
}
