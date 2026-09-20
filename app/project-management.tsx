"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, FolderKanban, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  progress,
  taskState,
  type Project,
  type ProjectFields,
} from "@/lib/projects";
import { workTools, workTool, type WorkTool } from "@/lib/navigation";
import type { LeadershipRole } from "@/lib/leadership";
import ProjectBoard from "./project-board";
import TaskWorkbench from "./task-workbench";
import LeadershipReview from "./leadership-review";
import ProjectStrategy from "./project-strategy";
import ProjectDelivery from "./project-delivery";
import WorkStudio, { LiveWorkStatus, ResourcePlanner } from "./work-studio";
import FeatureHelp from "./feature-help";

export default function ProjectManagement({
  projects,
  projectId,
  tool,
  demo,
  loaded,
  busy,
  canCreate,
  onProject,
  onTool,
  onOpen,
  onNew,
  onSave,
  onReload,
}: {
  projects: Project[];
  projectId: string;
  tool: WorkTool;
  demo: boolean;
  loaded: boolean;
  busy: boolean;
  canCreate: boolean;
  onProject: (id: string) => void;
  onTool: (tool: WorkTool) => void;
  onOpen: (project: Project) => void;
  onNew: () => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  onReload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(location.search).get("scope") === "tasks"
      ? "tasks"
      : "projects",
  );
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    setScope(
      new URLSearchParams(location.search).get("scope") === "tasks"
        ? "tasks"
        : "projects",
    );
  }, [tool, projectId]);
  const project =
    projects.find((p) => p.id === projectId) ||
    (!projectId ? projects.find((p) => !p.archived) || projects[0] : undefined);
  useEffect(() => {
    if (!loaded) return;
    if (!projectId || (!demo && projectId.startsWith("demo-"))) {
      const first = projects.find((p) => !p.archived) || projects[0];
      if (first) onProject(first.id);
    }
  }, [loaded, projectId, demo, projects, onProject]);
  const info = workTools.find((t) => t.id === tool)!;
  const filtered = projects.filter(
    (p) =>
      !!p.archived === archived &&
      `${p.name} ${p.category} ${p.location}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const portfolio =
    tool === "projects" ||
    (tool === "kanban" && scope === "projects") ||
    tool === "resources";
  const readOnly = demo || project?.canEdit === false || !!project?.archived;
  const props = project ? { project, readOnly, busy, onSave, onReload } : null;
  return (
    <main className="management-page">
      <header className="management-heading">
        <div>
          <span className="eyebrow">{info.group.toUpperCase()}</span>
          <div className="heading-with-help">
            <h1>{info.title}</h1>
            <FeatureHelp title={info.title}>{info.help}</FeatureHelp>
          </div>
          <p>
            {tool === "kanban"
              ? "Make work visible. Keep it moving."
              : info.group === "Leadership"
                ? "A different perspective. A clearer next decision."
                : "Your work, with room to get things done."}
          </p>
        </div>
        <Button onClick={onNew} disabled={!canCreate || busy}>
          <Plus size={16} />
          New project
        </Button>
      </header>
      {demo && (
        <div className="management-notice">
          You’re exploring sample projects. Create a project to save tasks,
          boards and reviews.
        </div>
      )}
      <div className="management-context">
        <label>
          Working project
          <select
            aria-label="Working project"
            value={project?.id || ""}
            onChange={(e) => onProject(e.target.value)}
          >
            <option disabled value="">
              Choose a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.archived ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </label>
        {project && (
          <>
            <span className="context-status">
              {project.status} · {progress(project)}% complete
            </span>
            <Button variant="outline" onClick={() => onOpen(project)}>
              Project details <ArrowUpRight size={15} />
            </Button>
          </>
        )}
      </div>
      {tool === "kanban" && (
        <div className="kanban-scope" aria-label="Kanban scope">
          <button
            aria-pressed={scope === "projects"}
            onClick={() => {
              setScope("projects");
              const url = new URL(location.href);
              url.searchParams.set("scope", "projects");
              history.replaceState(null, "", url);
            }}
          >
            Portfolio projects
          </button>
          <button
            aria-pressed={scope === "tasks"}
            onClick={() => {
              setScope("tasks");
              const url = new URL(location.href);
              url.searchParams.set("scope", "tasks");
              history.replaceState(null, "", url);
            }}
          >
            Selected project’s tasks
          </button>
          <span>Drag cards or use their status menus.</span>
        </div>
      )}
      {portfolio ? (
        <>
          {tool === "resources" ? (
            <ResourcePlanner
              projects={projects.filter(
                (p) => !p.archived && !p.id.startsWith("demo-"),
              )}
              onSave={onSave}
              readOnly={demo}
            />
          ) : (
            <>
              <div className="management-filters">
                <div>
                  <Search size={17} />
                  <Input
                    aria-label="Search project management"
                    placeholder="Search projects…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={archived}
                    onChange={(e) => setArchived(e.target.checked)}
                  />
                  Archived projects
                </label>
                <span>{filtered.length} projects</span>
              </div>
              {tool === "kanban" ? (
                <ProjectBoard
                  projects={filtered}
                  onOpen={(p) => {
                    onProject(p.id);
                    setScope("tasks");
                    const url = new URL(location.href);
                    url.searchParams.set("scope", "tasks");
                    history.replaceState(null, "", url);
                  }}
                  onSave={onSave}
                  busy={busy}
                  demo={demo}
                />
              ) : (
                <div className="management-project-list">
                  {filtered.map((p) => (
                    <article key={p.id} className="management-project-row">
                      <div className={`project-color-dot ${p.color}`} />
                      <button
                        className="management-project-name"
                        onClick={() => onOpen(p)}
                      >
                        <strong>{p.name}</strong>
                        <small>
                          {p.category} · {p.location || "No location"}
                        </small>
                      </button>
                      <span className="project-row-status">{p.status}</span>
                      <div className="project-row-progress">
                        <span>
                          {p.tasks.filter((t) => t.done && !t.archived).length}/
                          {p.tasks.filter((t) => !t.archived).length} tasks
                        </span>
                        <div>
                          <i style={{ width: `${progress(p)}%` }} />
                        </div>
                      </div>
                      <span className="project-row-risk">
                        {
                          p.tasks.filter(
                            (t) => !t.archived && taskState(t) === "blocked",
                          ).length
                        }{" "}
                        blocked
                      </span>
                      <button
                        className="project-row-open"
                        onClick={() => {
                          onProject(p.id);
                          onTool("list");
                        }}
                      >
                        Open tasks <ArrowUpRight size={14} />
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {!filtered.length && (
                <div className="management-empty">
                  <FolderKanban size={32} />
                  <h2>
                    {query || archived
                      ? "No matching projects"
                      : "Start with your first project"}
                  </h2>
                  <p>
                    {query || archived
                      ? "Try a different search or switch the archive filter."
                      : "Create a project, add a task, then move it through your board."}
                  </p>
                </div>
              )}
            </>
          )}
        </>
      ) : props && project ? (
        <div
          className="management-surface"
          key={`${project.id}-${["list", "table", "timeline", "kanban"].includes(tool) ? "tasks" : tool}`}
        >
          {!demo && <LiveWorkStatus project={project} onReload={onReload} />}
          {readOnly && !demo && (
            <p className="management-notice">
              {project.archived
                ? "This project is archived."
                : "You have view access to this project."}
            </p>
          )}
          {["list", "table", "timeline", "kanban"].includes(tool) ? (
            <TaskWorkbench
              {...props}
              initialLayout={
                tool === "kanban"
                  ? "board"
                  : (tool as "list" | "table" | "timeline")
              }
              onLayoutChange={(layout) => {
                if (layout === "board") {
                  setScope("tasks");
                  const url = new URL(location.href);
                  url.searchParams.set("scope", "tasks");
                  history.replaceState(null, "", url);
                }
                onTool(layout === "board" ? "kanban" : layout);
              }}
            />
          ) : ["CEO", "VP", "Director"].includes(tool) ? (
            <LeadershipReview
              {...props}
              initialRole={tool as LeadershipRole}
              onRoleChange={onTool}
              onSection={(section) =>
                onTool(
                  section === "strategy"
                    ? "strategy"
                    : section === "tasks"
                      ? "list"
                      : "delivery",
                )
              }
            />
          ) : tool === "strategy" ? (
            <ProjectStrategy {...props} />
          ) : tool === "delivery" ? (
            <ProjectDelivery {...props} />
          ) : (
            <WorkStudio
              {...props}
              initialTool={tool}
              standalone
              onToolChange={(id) => onTool(workTool(id))}
            />
          )}
        </div>
      ) : (
        <div className="management-empty">
          <h2>Choose an available project</h2>
          <p>Select a project above to use {info.title.toLowerCase()}.</p>
        </div>
      )}
    </main>
  );
}
