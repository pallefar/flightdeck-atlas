"use client";
import { useState } from "react";
import {
  Archive,
  Download,
  Globe2,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { progress, type Project, type ProjectFields } from "@/lib/projects";
import { downloadText } from "@/lib/briefing";
type Task = ProjectFields["tasks"][number];
export default function ProjectWorkspace({
  project,
  demo,
  busy,
  error,
  onClose,
  onSave,
  onEdit,
  onGlobe,
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
}) {
  const readOnly = demo || project.canEdit === false;
  const [tab, setTab] = useState<"tasks" | "updates">("tasks");
  const [title, setTitle] = useState(""),
    [due, setDue] = useState(""),
    [priority, setPriority] = useState<Task["priority"]>("Normal"),
    [note, setNote] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  async function saveTask(task: Task) {
    const result = await onSave(
      {
        ...project,
        tasks: project.tasks.map((t) => (t.id === task.id ? task : t)),
      },
      project,
    );
    if (result) setEditing(null);
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="project-dialog workspace-dialog">
        <DialogTitle>{project.name}</DialogTitle>
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
        <div className="section-heading">
          <h3>Project progress</h3>
          <span>{progress(project)}% complete</span>
        </div>
        <Progress
          aria-label="Project progress"
          value={progress(project)}
          className={`progress-bar ${project.color}`}
        />
        <div className="workspace-tabs filter-tabs">
          <button
            className={tab === "tasks" ? "chosen" : ""}
            aria-pressed={tab === "tasks"}
            onClick={() => setTab("tasks")}
          >
            Tasks · {project.tasks.length}
          </button>
          <button
            className={tab === "updates" ? "chosen" : ""}
            aria-pressed={tab === "updates"}
            onClick={() => setTab("updates")}
          >
            Updates · {project.activity?.length || 0}
          </button>
        </div>
        {tab === "tasks" ? (
          <>
            <div className="workspace-tasks">
              {project.tasks.map((t) => (
                <div className="workspace-task" key={t.id}>
                  {editing?.id === t.id ? (
                    <form
                      className="edit-task-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveTask(editing);
                      }}
                    >
                      <Input
                        aria-label="Task title"
                        required
                        maxLength={200}
                        value={editing.title}
                        onChange={(e) =>
                          setEditing({ ...editing, title: e.target.value })
                        }
                      />
                      <div className="task-options">
                        <label>
                          Due date
                          <Input
                            type="date"
                            value={editing.dueDate || ""}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                dueDate: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Priority
                          <select
                            value={editing.priority || "Normal"}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                priority: e.target.value as Task["priority"],
                              })
                            }
                          >
                            <option>Normal</option>
                            <option>High</option>
                            <option>Low</option>
                          </select>
                        </label>
                      </div>
                      <Input
                        aria-label="Task owner"
                        placeholder="Owner (optional)"
                        maxLength={100}
                        value={editing.assignee || ""}
                        onChange={(e) =>
                          setEditing({ ...editing, assignee: e.target.value })
                        }
                      />
                      <div className="task-edit-actions">
                        <Button type="submit" disabled={busy}>
                          Save task
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                        <button
                          type="button"
                          aria-label={`Remove ${t.title}`}
                          disabled={busy}
                          onClick={() =>
                            void onSave(
                              {
                                ...project,
                                tasks: project.tasks.filter(
                                  (x) => x.id !== t.id,
                                ),
                              },
                              project,
                            ).then((result) => {
                              if (result) setEditing(null);
                            })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <label className="workspace-task-check">
                        <input
                          type="checkbox"
                          checked={t.done}
                          disabled={readOnly || busy}
                          onChange={() =>
                            void saveTask({ ...t, done: !t.done })
                          }
                        />
                        <span className={t.done ? "task-done" : ""}>
                          {t.title}
                        </span>
                      </label>
                      <div className="task-metadata">
                        <span>
                          {t.dueDate || "No date"}
                          {t.priority === "High" ? " · High" : ""}
                          {t.assignee ? ` · ${t.assignee}` : ""}
                        </span>
                        {!readOnly && (
                          <button
                            aria-label={`Edit ${t.title}`}
                            disabled={busy}
                            onClick={() => setEditing({ ...t })}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            {!readOnly && (
              <form
                className="add-action-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!title.trim()) return;
                  const result = await onSave(
                    {
                      ...project,
                      tasks: [
                        ...project.tasks,
                        {
                          id: crypto.randomUUID(),
                          title: title.trim(),
                          done: false,
                          dueDate: due,
                          priority,
                        },
                      ],
                    },
                    project,
                  );
                  if (result) {
                    setTitle("");
                    setDue("");
                    setPriority("Normal");
                  }
                }}
              >
                <Input
                  aria-label="New task"
                  required
                  maxLength={200}
                  placeholder="Add the next step…"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <div className="task-options">
                  <label>
                    Task due date
                    <Input
                      type="date"
                      value={due}
                      onChange={(e) => setDue(e.target.value)}
                    />
                  </label>
                  <label>
                    Task priority
                    <select
                      value={priority}
                      onChange={(e) =>
                        setPriority(e.target.value as Task["priority"])
                      }
                    >
                      <option>Normal</option>
                      <option>High</option>
                      <option>Low</option>
                    </select>
                  </label>
                  <Button type="submit" disabled={busy || !title.trim()}>
                    <Plus size={15} /> Add
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : (
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
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <div className="detail-actions">
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
                onClick={() =>
                  downloadText(
                    `flightdeck-onboarding-${project.name.replace(/[^a-z0-9]+/gi, "-")}.md`,
                    onboardingPack(project),
                  )
                }
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
