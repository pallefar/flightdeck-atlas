"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectFields } from "@/lib/projects";
import {
  recordSchema,
  type CollaborationRecord,
  type Sharing,
} from "@/lib/collaboration";
type ResponseData = {
  nextOffset: number | null;
  error: string;
  records: CollaborationRecord[];
  files: { id: string; name: string; size: number; author: string }[];
  people: { email: string }[];
  teams: { id: string; name: string }[];
  email: string;
  canComment: boolean;
  sharing: Sharing;
};
type Draft = ReturnType<typeof recordSchema.parse>;
export default function ProjectCollaboration({
  project,
  demo,
  onSave,
  onReload,
}: {
  project: Project;
  demo: boolean;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  onReload: () => void;
}) {
  const [tab, setTab] = useState("discussion"),
    [records, setRecords] = useState<CollaborationRecord[]>([]),
    [files, setFiles] = useState<
      { id: string; name: string; size: number; author: string }[]
    >([]),
    [people, setPeople] = useState<{ email: string }[]>([]),
    [email, setEmail] = useState(""),
    [canComment, setCanComment] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null),
    [editing, setEditing] = useState<CollaborationRecord | null>(null),
    [actionText, setActionText] = useState(""),
    [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const kind =
    tab === "discussion"
      ? "comment"
      : tab === "meetings"
        ? "meeting"
        : tab === "decisions"
          ? "decision"
          : tab === "reviews"
            ? "approval"
            : "benefit";
  const load = useCallback(
    async (offset = 0) => {
      if (demo) return;
      try {
        const r = await fetch(
            `/api/projects/${project.id}/collaboration?kind=${kind}&offset=${offset}`,
          ),
          b = (await r.json()) as ResponseData;
        if (!r.ok) throw Error(b.error);
        setRecords((old) => (offset ? [...old, ...b.records] : b.records));
        setNextOffset(b.nextOffset);
        setFiles(b.files);
        setPeople(b.people);
        setEmail(b.email);
        setCanComment(b.canComment);
        setError("");
      } catch (e) {
        setRecords([]);
        setFiles([]);
        setError((e as Error).message);
      }
    },
    [project.id, demo, kind],
  );
  useEffect(() => {
    void load();
  }, [load]);
  async function submit(
    data: Draft,
    record?: CollaborationRecord,
    action?: string,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/projects/${project.id}/collaboration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data,
            id: record?.id || draftId,
            revision: record?.revision,
            action,
          }),
        }),
        b = (await r.json()) as ResponseData;
      if (!r.ok) throw Error(b.error);
      setDraft(null);
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-collaboration">
      <div className="filter-tabs suite-tabs">
        {[
          "discussion",
          "meetings",
          "decisions",
          "reviews",
          "benefits",
          "files",
          ...(project.canShare ? ["sharing"] : []),
        ].map((t) => (
          <button
            type="button"
            disabled={!!draft || busy}
            key={t}
            aria-pressed={tab === t}
            className={tab === t ? "chosen" : ""}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {demo ? (
        <p>Create a project to start working together.</p>
      ) : tab === "sharing" ? (
        <ProjectSharing project={project} onReload={onReload} />
      ) : tab === "files" ? (
        <>
          <div className="suite-heading">
            <h3>Project files</h3>
            {project.canEdit && (
              <label className="file-upload">
                Upload file
                <input
                  type="file"
                  disabled={busy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    try {
                      const form = new FormData();
                      form.append("file", file);
                      const r = await fetch(
                          `/api/projects/${project.id}/files`,
                          { method: "POST", body: form },
                        ),
                        b = (await r.json()) as ResponseData;
                      if (!r.ok) throw Error(b.error);
                      await load();
                      e.target.value = "";
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
          <p className="hub-muted">
            Up to 10 MB per file. Access follows project sharing.
          </p>
          {files.map((f) => (
            <article className="inbox-row" key={f.id}>
              <a href={`/api/files/${f.id}`}>
                {f.name}
                <small>
                  {Math.ceil(f.size / 1024)} KB · {f.author}
                </small>
              </a>
              {project.canEdit && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm(`Remove ${f.name}?`)) return;
                    setBusy(true);
                    try {
                      const r = await fetch(`/api/files/${f.id}`, {
                        method: "DELETE",
                      });
                      if (!r.ok) throw Error("File could not be removed.");
                      await load();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </article>
          ))}
          {!files.length && <p>No files uploaded yet.</p>}
        </>
      ) : (
        <>
          <div className="suite-heading">
            <h3>
              {tab === "reviews"
                ? "Review requests"
                : tab[0].toUpperCase() + tab.slice(1)}
            </h3>
            {(kind === "comment" ? canComment : project.canEdit) && (
              <Button
                onClick={() => {
                  setDraft({
                    ...recordSchema.parse({
                      kind,
                      title: "New update",
                      body: "",
                    }),
                    title: "",
                  });
                  setEditing(null);
                  setDraftId(crypto.randomUUID());
                  setActionText("");
                }}
              >
                Add {kind === "approval" ? "review request" : kind}
              </Button>
            )}
          </div>
          {draft && (
            <form
              className="suite-card suite-editor"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(draft, editing || undefined);
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Title
                  <Input
                    required
                    maxLength={160}
                    value={draft.title}
                    onChange={(e) =>
                      setDraft({ ...draft, title: e.target.value })
                    }
                  />
                </label>
                <label>
                  {draft.kind === "meeting"
                    ? "Agenda, notes & decisions"
                    : "Details"}
                  <Textarea
                    maxLength={6000}
                    value={draft.body}
                    onChange={(e) =>
                      setDraft({ ...draft, body: e.target.value })
                    }
                  />
                </label>
                <div className="suite-form-grid">
                  <label>
                    Link to task
                    <select
                      value={draft.taskId}
                      onChange={(e) =>
                        setDraft({ ...draft, taskId: e.target.value })
                      }
                    >
                      <option value="">Project-wide</option>
                      {project.tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    @Mention members
                    <select
                      multiple
                      value={draft.mentions}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          mentions: Array.from(
                            e.target.selectedOptions,
                            (x) => x.value,
                          ),
                        })
                      }
                    >
                      {people.map((p) => (
                        <option key={p.email}>{p.email}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {draft.kind === "approval" && (
                  <label>
                    Reviewer
                    <select
                      required
                      value={draft.reviewer}
                      onChange={(e) =>
                        setDraft({ ...draft, reviewer: e.target.value })
                      }
                    >
                      <option value="">Choose a reviewer</option>
                      {people.map((p) => (
                        <option key={p.email}>{p.email}</option>
                      ))}
                    </select>
                  </label>
                )}
                {draft.kind !== "comment" && (
                  <label>
                    {draft.kind === "benefit" ? "Measurement date" : "Date"}
                    <Input
                      type="date"
                      value={draft.date}
                      onChange={(e) =>
                        setDraft({ ...draft, date: e.target.value })
                      }
                    />
                  </label>
                )}
                {draft.kind === "benefit" && (
                  <div className="suite-form-grid">
                    {(["expected", "actual"] as const).map((k) => (
                      <label key={k}>
                        {k}
                        <Input
                          type="number"
                          step="any"
                          value={draft[k] ?? ""}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              [k]:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Unit
                      <Input
                        placeholder="hours / EUR / defects"
                        maxLength={40}
                        value={draft.unit}
                        onChange={(e) =>
                          setDraft({ ...draft, unit: e.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
                {draft.kind === "meeting" && (
                  <>
                    <label>
                      Follow-up action
                      <Input
                        maxLength={200}
                        value={actionText}
                        onChange={(e) => setActionText(e.target.value)}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!actionText.trim()}
                      onClick={() => {
                        setDraft({
                          ...draft,
                          actions: [
                            ...draft.actions,
                            {
                              id: crypto.randomUUID(),
                              title: actionText.trim(),
                            },
                          ],
                        });
                        setActionText("");
                      }}
                    >
                      Add action to notes
                    </Button>
                    {draft.actions.map((a) => (
                      <div className="suite-actions" key={a.id}>
                        {a.title}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              actions: draft.actions.filter(
                                (x) => x.id !== a.id,
                              ),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </>
                )}
                <div className="suite-actions">
                  <Button type="submit">
                    Save {draft.kind === "approval" ? "request" : "update"}
                  </Button>
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          {records
            .filter((r) => r.kind === kind)
            .map((r) => (
              <article className="suite-card collaboration-record" key={r.id}>
                <div className="suite-heading">
                  <h3>{r.title}</h3>
                  <span className="suite-badge">
                    {r.kind === "approval" ? r.status : r.date || r.kind}
                  </span>
                </div>
                <p className="preserve-lines">{r.body}</p>
                {r.kind === "benefit" && (
                  <div className="benefit-values">
                    <span>
                      <strong>{r.expected ?? "—"}</strong> expected {r.unit}
                    </span>
                    <span>
                      <strong>{r.actual ?? "—"}</strong> realised {r.unit}
                    </span>
                    {r.expected !== undefined && r.actual !== undefined && (
                      <span>
                        <strong>{r.actual - r.expected}</strong> variance{" "}
                        {r.unit}
                      </span>
                    )}
                  </div>
                )}
                {r.taskId && (
                  <small>
                    Task:{" "}
                    {project.tasks.find((t) => t.id === r.taskId)?.title ||
                      "Removed task"}
                  </small>
                )}
                {r.mentions.length > 0 && (
                  <small>Mentioned: {r.mentions.join(", ")}</small>
                )}
                {r.reviewer && <small>Reviewer: {r.reviewer}</small>}
                <small>
                  {r.author} · {new Date(r.updatedAt).toLocaleString()}
                </small>
                <div className="suite-actions">
                  {r.kind !== "approval" &&
                    (project.canEdit ||
                      (canComment &&
                        r.author === email &&
                        r.kind === "comment")) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setEditing(r);
                          setDraft(r);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                  {r.kind === "approval" &&
                    r.status === "requested" &&
                    r.reviewer === email && (
                      <>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void submit(
                              { ...r, status: "approved", body: "Approved." },
                              r,
                              "review",
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt("What needs to change?");
                            if (reason?.trim())
                              void submit(
                                {
                                  ...r,
                                  status: "changes",
                                  body: reason.trim(),
                                },
                                r,
                                "review",
                              );
                          }}
                        >
                          Request changes
                        </Button>
                      </>
                    )}
                  {r.kind === "meeting" &&
                    r.actions.map((a) => {
                      const exists = project.tasks.some((t) => t.id === a.id);
                      return (
                        <Button
                          variant="outline"
                          key={a.id}
                          disabled={busy || exists || !project.canEdit}
                          onClick={async () => {
                            setBusy(true);
                            await onSave(
                              {
                                ...project,
                                tasks: [
                                  ...project.tasks,
                                  { id: a.id, title: a.title, done: false },
                                ],
                              },
                              project,
                            );
                            setBusy(false);
                          }}
                        >
                          {exists ? "Task created:" : "Create task:"} {a.title}
                        </Button>
                      );
                    })}
                </div>
              </article>
            ))}
          {nextOffset !== null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load(nextOffset)}
            >
              Load older updates
            </Button>
          )}
          {!records.some((r) => r.kind === kind) && !draft && (
            <p className="hub-muted">
              No {tab} yet. Capture the next conversation or decision here.
            </p>
          )}
        </>
      )}
    </div>
  );
}
function ProjectSharing({
  project,
  onReload,
}: {
  project: Project;
  onReload: () => void;
}) {
  const [data, setData] = useState<{
      sharing: Sharing;
      people: { email: string }[];
      teams: { id: string; name: string }[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState(""),
    [role, setRole] = useState<"viewer" | "commenter" | "editor">("viewer");
  useEffect(() => {
    fetch(`/api/projects/${project.id}/sharing`)
      .then(async (r) => {
        const b = (await r.json()) as ResponseData;
        if (!r.ok) throw Error(b.error);
        setData(b);
      })
      .catch((e) => setError(e.message));
  }, [project.id]);
  return (
    <section className="suite-card">
      <h3>Project sharing</h3>
      <p>
        The owner and Super Admin retain access. Sharing never grants admission
        to Atlas itself.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {data && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await fetch(`/api/projects/${project.id}/sharing`, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(data.sharing),
                }),
                b = (await r.json()) as ResponseData;
              if (!r.ok) throw Error(b.error);
              setData({ ...data, sharing: b.sharing });
              setError("");
              onReload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              Visibility
              <select
                value={data.sharing.visibility}
                onChange={(e) =>
                  setData({
                    ...data,
                    sharing: {
                      ...data.sharing,
                      visibility: e.target.value as Sharing["visibility"],
                    },
                  })
                }
              >
                <option value="private">Private</option>
                <option value="shared">Selected people & teams</option>
                <option value="all">All admitted Atlas members</option>
              </select>
            </label>
            {data.sharing.visibility === "shared" && (
              <>
                <div className="suite-form-grid">
                  <label>
                    Person or team
                    <select
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Select…</option>
                      <optgroup label="People">
                        {data.people.map((p) => (
                          <option key={p.email} value={`person:${p.email}`}>
                            {p.email}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Teams">
                        {data.teams.map((t) => (
                          <option key={t.id} value={`team:${t.id}`}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </label>
                  <label>
                    Project role
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as typeof role)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="commenter">Commenter</option>
                      <option value="editor">Editor</option>
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!target}
                    onClick={() => {
                      const [type, ...parts] = target.split(":"),
                        value = parts.join(":");
                      setData({
                        ...data,
                        sharing: {
                          ...data.sharing,
                          grants: [
                            ...data.sharing.grants.filter(
                              (g) => !(g.type === type && g.target === value),
                            ),
                            {
                              type: type as "person" | "team",
                              target: value,
                              role,
                            },
                          ],
                        },
                      });
                      setTarget("");
                    }}
                  >
                    Add grant
                  </Button>
                </div>
                {data.sharing.grants.map((g) => (
                  <div className="inbox-row" key={`${g.type}:${g.target}`}>
                    <span>
                      {g.type === "team"
                        ? data.teams.find((t) => t.id === g.target)?.name ||
                          "Removed team"
                        : g.target}{" "}
                      · {g.role}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setData({
                          ...data,
                          sharing: {
                            ...data.sharing,
                            grants: data.sharing.grants.filter((x) => x !== g),
                          },
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </>
            )}
            <div className="suite-actions">
              <Button>Save sharing</Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}/?view=dashboard&project=${encodeURIComponent(project.id)}`,
                    );
                    setError(
                      "Project link copied. Recipients must already have access.",
                    );
                  } catch {
                    setError(
                      "Clipboard unavailable. Open the project using its link in the address bar.",
                    );
                  }
                }}
              >
                Copy project link
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </section>
  );
}
