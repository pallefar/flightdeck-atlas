"use client";
import ProjectCollaboration from "./project-collaboration";
import { freshProject } from "@/lib/fresh-export";
import TaskWorkbench from "./task-workbench";
import ProjectStrategy from "./project-strategy";
import LeadershipReview from "./leadership-review";
import ProjectDelivery from "./project-delivery";
import { taskBlocked } from "@/lib/projects";
import { useState, useEffect, useRef } from "react";
import { Archive, Download, Globe2, Undo2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { progress, type Project, type ProjectFields } from "@/lib/projects";
import { downloadText } from "@/lib/briefing";
export default function ProjectWorkspace({
  project,
  demo,
  busy,
  error,
  onClose,
  onSave,
  onEdit,
  onGlobe,
  onReload,
  onPresent,
}: {
  project: Project;
  demo: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
    note?: string,
  ) => Promise<Project | null>;
  onEdit: () => void;
  onGlobe: () => void;
  onReload: () => void;
  onPresent: () => void;
}) {
  const readOnly = demo || project.canEdit === false;
  const [tab, setTab] = useState<
    | "overview"
    | "tasks"
    | "strategy"
    | "updates"
    | "collaboration"
    | "leadership"
    | "delivery"
  >("tasks");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        ref={dialogRef}
        className="project-dialog workspace-dialog"
        showCloseButton={false}
      >
        <div className="workspace-sticky-heading">
          <DialogTitle>{project.name}</DialogTitle>
          <button aria-label="Close" disabled={busy} onClick={onClose}>
            <X size={19} />
            <span>Close</span>
          </button>
        </div>
        <DialogDescription>
          {project.description || "Project workspace"}
        </DialogDescription>
        {demo && (
          <p className="demo-detail">
            Example project · Create your own project to save changes.
          </p>
        )}
        {!demo && readOnly && (
          <p className="hub-muted">
            Your role provides view access to this project. Editing requires
            permission from the Super Admin.
          </p>
        )}
        {project.archived && (
          <p className="demo-detail">
            Archived · Restore this project to put it back into your action
            queue.
          </p>
        )}
        <div className="workspace-meta">
          <span
            className={`status ${project.status.toLowerCase().replaceAll(" ", "-")}`}
          >
            {project.status}
          </span>
          <span>{project.functionArea || project.category}</span>
          <span>
            {project.dueDate ? `Target ${project.dueDate}` : "No target date"}
          </span>
          {project.priority === "High" && (
            <span className="priority-high">High priority</span>
          )}
        </div>
        <div className="section-heading">
          <h3>Project progress</h3>
          <span>{progress(project)}% complete</span>
        </div>
        <Progress
          aria-label="Project progress"
          value={progress(project)}
          className={`progress-bar ${project.color}`}
        />
        <div className="workspace-kpis">
          <span>
            <strong>{project.tasks.filter((t) => !t.done).length}</strong> open
            tasks
          </span>
          <span>
            <strong>
              {project.tasks.filter((t) => taskBlocked(t, project)).length}
            </strong>{" "}
            blocked
          </span>
          <span>
            <strong>
              {project.tasks
                .filter((t) => !t.done)
                .reduce((n, t) => n + (t.estimateMinutes || 0), 0)}
            </strong>{" "}
            estimated min left
          </span>
          <span>
            <strong>{project.objectives?.length || 0}</strong> strategy goals
          </span>
        </div>
        <div
          className="workspace-tabs filter-tabs"
          aria-label="Project sections"
        >
          {(
            [
              "overview",
              "tasks",
              "leadership",
              "delivery",
              "strategy",
              "collaboration",
              "updates",
            ] as const
          ).map((t) => (
            <button
              key={t}
              className={tab === t ? "chosen" : ""}
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
            >
              {t === "overview"
                ? "Overview"
                : t === "tasks"
                  ? `Tasks · ${project.tasks.length}`
                  : t === "leadership"
                    ? "Think like a leader"
                    : t === "delivery"
                      ? "Delivery & budget"
                      : t === "strategy"
                        ? "Strategy & KPIs"
                        : t === "collaboration"
                          ? "Collaborate & share"
                          : `Updates · ${project.activity?.length || 0}`}
            </button>
          ))}
        </div>
        {tab === "overview" ? (
          <div className="project-overview">
            <div>
              <h3>Outcome & direction</h3>{" "}
              {(project.nextAction || project.blocker || project.benefit) && (
                <div className="project-context">
                  {project.nextAction && (
                    <p>
                      <strong>Next action</strong>
                      {project.nextAction}
                    </p>
                  )}
                  {project.blocker && (
                    <p className="attention">
                      <strong>Blocker</strong>
                      {project.blocker}
                    </p>
                  )}
                  {project.benefit && (
                    <p>
                      <strong>Success measure</strong>
                      {project.benefit}
                    </p>
                  )}
                </div>
              )}
              <p className="hub-muted">
                {!project.nextAction && !project.blocker && !project.benefit
                  ? "Set a next action and success measure in Edit project."
                  : ""}
              </p>
            </div>
            <dl>
              <div>
                <dt>Sponsor</dt>
                <dd>{project.sponsor || "Not assigned"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{project.location || "Not set"}</dd>
              </div>
              <div>
                <dt>Onboarding</dt>
                <dd>{project.onboardingStage || "Discovery"}</dd>
              </div>
              <div>
                <dt>Last update</dt>
                <dd>{new Date(project.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
          </div>
        ) : tab !== "updates" ? null : (
          <div className="workspace-updates">
            {!readOnly && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  const result = await onSave(project, project, note.trim());
                  if (result) setNote("");
                }}
              >
                <Textarea
                  disabled={busy}
                  aria-label="Project update"
                  maxLength={1000}
                  required
                  placeholder="What changed? Capture a decision, result, or follow-up."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button type="submit" disabled={busy || !note.trim()}>
                  Record update
                </Button>
              </form>
            )}
            {[...(project.activity || [])].reverse().map((e) => (
              <article className="project-update" key={e.id}>
                <p>{e.text}</p>
                <time>{new Date(e.at).toLocaleString()}</time>
              </article>
            ))}
            {!project.activity?.length && (
              <p className="hub-muted">
                Updates will appear here as you work. Earlier activity has not
                been backfilled.
              </p>
            )}
          </div>
        )}
        <div hidden={tab !== "tasks"}>
          <TaskWorkbench
            project={project}
            readOnly={readOnly}
            busy={busy}
            onSave={onSave}
          />
        </div>
        <div hidden={tab !== "strategy"}>
          <ProjectStrategy
            project={project}
            readOnly={readOnly}
            busy={busy}
            onSave={onSave}
          />
        </div>
        {tab === "collaboration" && (
          <ProjectCollaboration
            project={project}
            demo={demo}
            onSave={onSave}
            onReload={onReload}
          />
        )}
        {tab === "leadership" && (
          <LeadershipReview
            project={project}
            readOnly={readOnly}
            busy={busy}
            onSave={onSave}
            onSection={setTab}
          />
        )}
        {tab === "delivery" && (
          <ProjectDelivery
            project={project}
            readOnly={readOnly}
            busy={busy}
            onSave={onSave}
          />
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="detail-actions">
          {!demo && (
            <Button variant="outline" onClick={onPresent}>
              Create presentation
            </Button>
          )}
          {project.latitude !== null && (
            <Button variant="outline" onClick={onGlobe}>
              <Globe2 size={16} /> Find on globe
            </Button>
          )}
          {!readOnly && (
            <>
              <Button onClick={onEdit}>Edit project</Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const latest = await freshProject(project.id);
                    downloadText(
                      `flightdeck-onboarding-${latest.name.replace(/[^a-z0-9]+/gi, "-")}.md`,
                      onboardingPack(latest),
                    );
                  } catch (e) {
                    alert((e as Error).message);
                  }
                }}
              >
                <Download size={15} /> Onboarding pack
              </Button>
              <button
                className="archive-button"
                disabled={busy || project.canArchive === false}
                onClick={async () => {
                  const result = await onSave(
                    { ...project, archived: !project.archived },
                    project,
                  );
                  if (result) onClose();
                }}
              >
                {project.archived ? <Undo2 size={15} /> : <Archive size={15} />}
                {project.archived ? "Restore project" : "Archive project"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
function onboardingPack(p: Project) {
  return [
    `# FlightDeck onboarding: ${p.name}`,
    "",
    `Function: ${p.functionArea || p.category}`,
    `Sponsor: ${p.sponsor || "To confirm"}`,
    `Stage: ${p.onboardingStage || "Discovery"}`,
    `Target: ${p.dueDate || "To agree"}`,
    "",
    "## Outcome",
    p.description,
    "",
    "## Success measure",
    p.benefit || "Agree a baseline and measurable outcome with the function.",
    "",
    "## Next action",
    p.nextAction || "Book a discovery session with the process owner.",
    "",
    "## Blockers",
    p.blocker || "None recorded; validate during discovery.",
    "",
    "## Delivery checklist",
    ...p.tasks.map(
      (t) =>
        `- [${t.done ? "x" : " "}] ${t.title}${t.assignee ? ` — ${t.assignee}` : ""}${t.dueDate ? ` · ${t.dueDate}` : ""}`,
    ),
    "",
    "## FlightDeck handoff",
    "Confirm the workspace, permitted project, data owner, app enablement, and named support owner. Map data sources and agree the minimum access needed. Validate the pilot before rollout.",
    "",
    "This is a planning document. Exporting it does not create a FlightDeck account, grant access, or onboard a function automatically.",
  ].join("\n");
}
