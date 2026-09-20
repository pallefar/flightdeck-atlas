"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, Task } from "@/lib/projects";
import {
  numericValue,
  type ScheduleLink,
  type AdvancedFilter,
} from "@/lib/advanced-work";
export function AdvancedTaskFields({
  task,
  project,
  onChange,
}: {
  task: Task;
  project: Project;
  onChange: (t: Task) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]),
    [pid, setPid] = useState(""),
    [target, setTarget] = useState(""),
    [type, setType] = useState<ScheduleLink["type"]>("FS"),
    [lag, setLag] = useState(0);
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json() as Promise<{ projects: Project[] }>)
      .then((b) => setProjects(b.projects || []))
      .catch(() => {});
  }, []);
  const choices = pid
    ? projects.find((p) => p.id === pid)?.tasks || []
    : project.tasks;
  return (
    <section className="advanced-task-fields">
      <h3>Structure, custom fields & scheduling</h3>
      <div className="work-form-grid">
        <label>
          Parent task
          <select
            value={task.parentId || ""}
            onChange={(e) => onChange({ ...task, parentId: e.target.value })}
          >
            <option value="">Top-level task</option>
            {project.tasks
              .filter((t) => t.id !== task.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Hourly rate · {project.budget?.currency || "EUR"}
          <Input
            type="number"
            min={0}
            max={100000}
            step="0.01"
            value={task.hourlyRate ?? ""}
            onChange={(e) =>
              onChange({
                ...task,
                hourlyRate:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!task.billable}
            onChange={(e) => onChange({ ...task, billable: e.target.checked })}
          />
          Billable time
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={!!task.archived}
            onChange={(e) => onChange({ ...task, archived: e.target.checked })}
          />
          Archive this task
        </label>
        {(project.work?.fields || []).map((f) => (
          <label key={f.id}>
            {f.name}
            {f.type === "formula" ? (
              <output>
                {numericValue(task, f.id, project.work!.fields)?.toLocaleString(
                  undefined,
                  { maximumFractionDigits: 2 },
                ) ?? "— (missing value or invalid calculation)"}
              </output>
            ) : f.type === "select" ? (
              <select
                value={String(task.customValues?.[f.id] || "")}
                onChange={(e) =>
                  onChange({
                    ...task,
                    customValues: {
                      ...task.customValues,
                      [f.id]: e.target.value,
                    },
                  })
                }
              >
                <option value="">Not set</option>
                {f.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={!!task.customValues?.[f.id]}
                onChange={(e) =>
                  onChange({
                    ...task,
                    customValues: {
                      ...task.customValues,
                      [f.id]: e.target.checked,
                    },
                  })
                }
              />
            ) : (
              <Input
                type={
                  f.type === "number"
                    ? "number"
                    : f.type === "date"
                      ? "date"
                      : "text"
                }
                step="any"
                maxLength={1000}
                value={String(task.customValues?.[f.id] ?? "")}
                onChange={(e) =>
                  onChange({
                    ...task,
                    customValues: {
                      ...task.customValues,
                      [f.id]:
                        f.type === "number" && e.target.value !== ""
                          ? Number(e.target.value)
                          : e.target.value,
                    },
                  })
                }
              />
            )}
          </label>
        ))}
      </div>
      <h4>Schedule links</h4>
      <p className="hub-muted">
        FS: finish → start · SS: start → start · FF: finish → finish · SF: start
        → finish. Lag is in calendar days. These constrain planning; use
        “Depends on tasks” for completion gates.
      </p>
      {(task.scheduleLinks || []).map((l, i) => (
        <div className="work-inline" key={i}>
          <span>
            {l.projectId
              ? projects.find((p) => p.id === l.projectId)?.name ||
                "Unavailable project"
              : "This project"}{" "}
            /{" "}
            {(l.projectId
              ? projects.find((p) => p.id === l.projectId)?.tasks
              : project.tasks
            )?.find((t) => t.id === l.taskId)?.title || "Unavailable task"}{" "}
            · {l.type} {l.lag >= 0 ? "+" : ""}
            {l.lag}d
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              onChange({
                ...task,
                scheduleLinks: task.scheduleLinks!.filter((_, n) => n !== i),
              })
            }
          >
            Remove link
          </Button>
        </div>
      ))}
      <div className="work-form-grid">
        <label>
          Dependency project
          <select
            value={pid}
            onChange={(e) => {
              setPid(e.target.value);
              setTarget("");
            }}
          >
            <option value="">This project</option>
            {projects
              .filter((p) => p.id !== project.id && !p.archived)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Dependency task
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose task</option>
            {choices
              .filter((t) => pid || t.id !== task.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
          </select>
        </label>
        <label>
          Dependency type
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ScheduleLink["type"])}
          >
            {["FS", "SS", "FF", "SF"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Lag days
          <Input
            type="number"
            min={-365}
            max={365}
            value={lag}
            onChange={(e) => setLag(Number(e.target.value))}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!target || (task.scheduleLinks?.length || 0) >= 30}
          onClick={() => {
            onChange({
              ...task,
              scheduleLinks: [
                ...(task.scheduleLinks || []),
                { taskId: target, projectId: pid, type, lag },
              ],
            });
            setTarget("");
          }}
        >
          Add schedule link
        </Button>
      </div>
    </section>
  );
}
export function FilterBuilder({
  value,
  onChange,
  fields = [],
  singleGroup = false,
}: {
  singleGroup?: boolean;
  value: AdvancedFilter;
  onChange: (v: AdvancedFilter) => void;
  fields?: { id: string; name: string }[];
}) {
  return (
    <details className="advanced-filter">
      <summary>
        Advanced conditions ·{" "}
        {value.groups.reduce((n, g) => n + g.conditions.length, 0)}
      </summary>
      {!singleGroup && (
        <div className="work-form-grid">
          <label>
            Combine groups
            <select
              value={value.mode}
              onChange={(e) =>
                onChange({ ...value, mode: e.target.value as "all" | "any" })
              }
            >
              <option value="all">All groups (AND)</option>
              <option value="any">Any group (OR)</option>
            </select>
          </label>
        </div>
      )}
      {value.groups.map((g, i) => (
        <fieldset className="condition-group" key={i}>
          <legend>Group {i + 1}</legend>
          <select
            aria-label={`Group ${i + 1} match`}
            value={g.mode}
            onChange={(e) =>
              onChange({
                ...value,
                groups: value.groups.map((x, n) =>
                  n === i ? { ...x, mode: e.target.value as "all" | "any" } : x,
                ),
              })
            }
          >
            <option value="all">Match all conditions</option>
            <option value="any">Match any condition</option>
          </select>
          {g.conditions.map((c, j) => (
            <div className="condition-row" key={j}>
              <select
                aria-label={`Condition ${i + 1}.${j + 1} field`}
                value={c.field}
                onChange={(e) =>
                  onChange({
                    ...value,
                    groups: value.groups.map((x, n) =>
                      n === i
                        ? {
                            ...x,
                            conditions: x.conditions.map((y, m) =>
                              m === j ? { ...y, field: e.target.value } : y,
                            ),
                          }
                        : x,
                    ),
                  })
                }
              >
                {[
                  { id: "state", name: "Workflow" },
                  { id: "priority", name: "Priority" },
                  { id: "owner", name: "Owner" },
                  { id: "group", name: "Group" },
                  { id: "title", name: "Task title" },
                  { id: "estimate", name: "Estimated minutes" },
                  { id: "actual", name: "Logged minutes" },
                  ...fields,
                ].map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Condition ${i + 1}.${j + 1} operator`}
                value={c.operator}
                onChange={(e) =>
                  onChange({
                    ...value,
                    groups: value.groups.map((x, n) =>
                      n === i
                        ? {
                            ...x,
                            conditions: x.conditions.map((y, m) =>
                              m === j
                                ? {
                                    ...y,
                                    operator: e.target
                                      .value as typeof c.operator,
                                  }
                                : y,
                            ),
                          }
                        : x,
                    ),
                  })
                }
              >
                {["is", "is_not", "contains", "gt", "lt"].map((o) => (
                  <option key={o} value={o}>
                    {o === "gt" ? ">" : o === "lt" ? "<" : o.replace("_", " ")}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Condition ${i + 1}.${j + 1} value`}
                value={c.value}
                onChange={(e) =>
                  onChange({
                    ...value,
                    groups: value.groups.map((x, n) =>
                      n === i
                        ? {
                            ...x,
                            conditions: x.conditions.map((y, m) =>
                              m === j ? { ...y, value: e.target.value } : y,
                            ),
                          }
                        : x,
                    ),
                  })
                }
              />
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...value,
                    groups: value.groups.map((x, n) =>
                      n === i
                        ? {
                            ...x,
                            conditions: x.conditions.filter((_, m) => m !== j),
                          }
                        : x,
                    ),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <div className="work-inline">
            <Button
              type="button"
              variant="outline"
              disabled={g.conditions.length >= 8}
              onClick={() =>
                onChange({
                  ...value,
                  groups: value.groups.map((x, n) =>
                    n === i
                      ? {
                          ...x,
                          conditions: [
                            ...x.conditions,
                            {
                              field: "state",
                              operator: "is",
                              value: "blocked",
                            },
                          ],
                        }
                      : x,
                  ),
                })
              }
            >
              Add condition
            </Button>
            {!singleGroup && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  onChange({
                    ...value,
                    groups: value.groups.filter((_, n) => n !== i),
                  })
                }
              >
                Remove group
              </Button>
            )}
          </div>
        </fieldset>
      ))}
      {!singleGroup && (
        <Button
          type="button"
          variant="outline"
          disabled={value.groups.length >= 6}
          onClick={() =>
            onChange({
              ...value,
              groups: [...value.groups, { mode: "all", conditions: [] }],
            })
          }
        >
          Add condition group
        </Button>
      )}
    </details>
  );
}
