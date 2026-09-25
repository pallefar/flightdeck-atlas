"use client";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, FolderKanban, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { progress, type Project, type ProjectFields } from "@/lib/projects";
import { workTools, workTool, type WorkTool } from "@/lib/navigation";
import type { LeadershipRole } from "@/lib/leadership";
import TaskWorkbench from "./task-workbench";
import LeadershipReview from "./leadership-review";
import ProjectStrategy from "./project-strategy";
import ProjectDelivery from "./project-delivery";
import ProjectWorkspace from "./project-workspace";
import PresentationStudio from "./presentation-studio";
import WorkStudio, { LiveWorkStatus } from "./work-studio";
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
  onBack,
  onNew,
  onEdit,
  onGlobe,
  onSave,
  onReload,
  superAdmin = false,
  requesterRequests = false,
  viewerEmail = "",
}: {
  /** Who sees the project page's FlightDeck card. */
  superAdmin?: boolean;
  requesterRequests?: boolean;
  /** The signed-in email: only the asker is offered Withdraw on an ask. */
  viewerEmail?: string;
  projects: Project[];
  projectId: string;
  tool: WorkTool;
  demo: boolean;
  loaded: boolean;
  busy: boolean;
  canCreate: boolean;
  onProject: (id: string) => void;
  onTool: (tool: WorkTool) => void;
  onBack: () => void;
  onNew: () => void;
  onEdit: (project: Project) => void;
  onGlobe: (project: Project) => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
    note?: string,
  ) => Promise<Project | null>;
  onReload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const project =
    tool !== "projects" && loaded
      ? projects.find((p) => p.id === projectId)
      : undefined;
  const info = workTools.find((t) => t.id === tool)!;
  const readOnly = demo || project?.canEdit === false || !!project?.archived;
  const filtered = projects.filter(
    (p) =>
      !!p.archived === archived &&
      `${p.name} ${p.category} ${p.location}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const props = project ? { project, readOnly, busy, onSave, onReload } : null;
  const summary = ["overview", "updates", "collaboration"].includes(tool);
  const tasks = ["list", "table", "timeline", "kanban"].includes(tool);
  return (
    <main className="management-page project-focused-page">
      <button className="project-back-link" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to all projects
      </button>
      {!project ? (
        <>
          <header className="management-heading">
            <div>
              <span className="eyebrow">YOUR PORTFOLIO</span>
              <h1>
                {tool === "projects" ? "All projects" : "Choose a project"}
              </h1>
              <p>
                {tool === "projects"
                  ? "Open a project to reveal its workspace, menus and tools."
                  : `Choose where you want to use ${info.title.toLowerCase()}.`}
              </p>
            </div>
            <Button disabled={!canCreate || busy} onClick={onNew}>
              New project
            </Button>
          </header>
          {!!projectId && loaded && tool !== "projects" && (
            <p role="status" className="management-notice">
              The requested project is unavailable or you no longer have access.
              Choose an available project below.
            </p>
          )}
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
          <div className="project-picker-grid">
            {filtered.map((p) => (
              <button
                key={p.id}
                className="project-picker-card"
                disabled={!loaded}
                onClick={() => onProject(p.id)}
              >
                <span className="eyebrow">{p.category}</span>
                <strong>
                  {p.name}
                  <ArrowUpRight size={18} />
                </strong>
                <p>
                  {p.description ||
                    p.nextAction ||
                    "Open this project to start planning."}
                </p>
                <div>
                  <span>{p.status}</span>
                  <span>{progress(p)}% complete</span>
                </div>
                <small>
                  {tool === "projects"
                    ? "Open project workspace"
                    : `Open ${info.title.toLowerCase()}`}
                </small>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="management-empty">
              <FolderKanban size={32} />
              <h2>
                {loaded ? "No matching projects" : "Loading your projects…"}
              </h2>
              <p>
                {query || archived
                  ? "Try another search or switch the archive filter."
                  : "Create a project to start planning your work."}
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="project-identity-banner">
            <span className="project-identity-icon">
              <FolderKanban size={23} />
            </span>
            <div>
              <span className="eyebrow">PROJECT WORKSPACE</span>
              <strong>{project.name}</strong>
            </div>
            <span className="context-status">
              {project.status} · {progress(project)}% complete
            </span>
          </div>
          <div className="management-context">
            <label>
              Working project
              <select
                aria-label="Working project"
                value={project.id}
                onChange={(e) => onProject(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {tool !== "overview" && (
              <Button variant="outline" onClick={() => onTool("overview")}>
                Project overview
              </Button>
            )}
          </div>
          <header className="management-heading">
            <div>
              <span className="eyebrow">{info.group.toUpperCase()}</span>
              <div className="heading-with-help">
                <h1>{info.title}</h1>
                <FeatureHelp title={info.title}>{info.help}</FeatureHelp>
              </div>
            </div>
            {!readOnly && !summary && (
              <Button variant="outline" onClick={() => onEdit(project)}>
                Edit project
              </Button>
            )}
          </header>
          {demo && !summary && (
            <p className="management-notice">
              Example project · Create your own project to save changes.
            </p>
          )}
          {readOnly && !demo && !summary && (
            <p className="management-notice">
              {project.archived
                ? "This project is archived. Restore it from Project overview to resume work."
                : "You have view access to this project."}
            </p>
          )}
          {tool === "overview" && (
            <div className="project-overview-shortcuts">
              <button onClick={() => onTool("list")}>
                Plan tasks <ArrowUpRight size={14} />
              </button>
              <button onClick={() => onTool("kanban")}>
                Open Kanban <ArrowUpRight size={14} />
              </button>
              <button onClick={() => onTool("CEO")}>
                Review as CEO <ArrowUpRight size={14} />
              </button>
              <button onClick={() => onTool("collaboration")}>
                Share project <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <div className="management-surface" key={project.id}>
            {!demo && !summary && (
              <LiveWorkStatus project={project} onReload={onReload} />
            )}
            {props && (
              <div hidden={!tasks}>
                <TaskWorkbench
                  {...props}
                  initialLayout={
                    tool === "kanban"
                      ? "board"
                      : tool === "table" || tool === "timeline"
                        ? tool
                        : "list"
                  }
                  onLayoutChange={(layout) =>
                    onTool(layout === "board" ? "kanban" : layout)
                  }
                />
              </div>
            )}
            {props && (
              <div hidden={tool !== "strategy"}>
                <ProjectStrategy {...props} />
              </div>
            )}
            <div key={tool}>
              {props &&
                (tasks || tool === "strategy" ? null : [
                    "CEO",
                    "VP",
                    "Director",
                  ].includes(tool) ? (
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
                ) : tool === "delivery" ? (
                  <ProjectDelivery {...props} />
                ) : summary ? (
                  <ProjectWorkspace
                    project={project}
                    embedded
                    section={tool as "overview" | "updates" | "collaboration"}
                    demo={demo}
                    busy={busy}
                    error=""
                    onSave={onSave}
                    onReload={onReload}
                    onClose={onBack}
                    onEdit={() => onEdit(project)}
                    onGlobe={() => onGlobe(project)}
                    onPresent={() => onTool("slides")}
                    superAdmin={superAdmin}
                    requesterRequests={requesterRequests}
                    viewerEmail={viewerEmail}
                  />
                ) : tool === "slides" ? (
                  <PresentationStudio
                    projects={[project]}
                    scopedProjectId={project.id}
                    demo={demo}
                    initialProjectId={project.id}
                  />
                ) : (
                  <WorkStudio
                    {...props}
                    initialTool={tool}
                    standalone
                    onToolChange={(id) => onTool(workTool(id))}
                  />
                ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
