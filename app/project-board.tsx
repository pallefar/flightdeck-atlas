"use client";
import { ArrowUpRight } from "lucide-react";
import { useRef, useState } from "react";
import { progress, type Project, type ProjectFields } from "@/lib/projects";
const statuses = ["Planning", "In progress", "On hold", "Completed"] as const;
export default function ProjectBoard({
  projects,
  onOpen,
  onSave,
  busy,
  demo,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  busy: boolean;
  demo: boolean;
}) {
  const drag = useRef<Project | null>(null);
  const [over, setOver] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <div className="project-board" aria-label="Project status board">
      {statuses.map((status) => (
        <section
          className={`board-column ${over === status ? "kanban-drop-target" : ""}`}
          key={status}
          aria-label={`${status} projects`}
          onDragOver={(e) => {
            if (drag.current && !demo && !busy) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setOver(status);
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver("");
          }}
          onDrop={async (e) => {
            e.preventDefault();
            const p = drag.current;
            drag.current = null;
            setOver("");
            if (
              !p ||
              demo ||
              busy ||
              p.canEdit === false ||
              p.archived ||
              p.status === status
            )
              return;
            const saved = await onSave({ ...p, status }, p);
            if (saved) setNotice(`${saved.name} saved in ${saved.status}.`);
          }}
        >
          <h3>
            {status}
            <span>{projects.filter((p) => p.status === status).length}</span>
          </h3>
          {projects
            .filter((p) => p.status === status)
            .map((p) => (
              <article
                key={p.id}
                className={`board-card ${p.color}`}
                draggable={!demo && !busy && p.canEdit !== false && !p.archived}
                onDragStart={(e) => {
                  drag.current = p;
                  e.dataTransfer.setData("text/plain", p.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  drag.current = null;
                  setOver("");
                }}
              >
                <button onClick={() => onOpen(p)}>
                  <span>{p.category}</span>
                  <strong>
                    {p.name}
                    <ArrowUpRight size={15} />
                  </strong>
                  <p>{p.nextAction || p.description || "Add a next action"}</p>
                </button>
                <div className="board-progress">
                  <span style={{ width: `${progress(p)}%` }} />
                </div>
                <small>
                  {progress(p)}% of tasks ·{" "}
                  {p.dueDate ? `Due ${p.dueDate}` : "No deadline"}
                </small>
                <label>
                  Move to
                  <select
                    aria-label={`Status for ${p.name}`}
                    disabled={demo || busy || p.canEdit === false || p.archived}
                    value={p.status}
                    onChange={(e) =>
                      void onSave(
                        { ...p, status: e.target.value as Project["status"] },
                        p,
                      )
                    }
                  >
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          {!projects.some((p) => p.status === status) && (
            <p className="board-empty">No projects</p>
          )}
        </section>
      ))}
      {notice && (
        <p role="status" className="kanban-save-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
