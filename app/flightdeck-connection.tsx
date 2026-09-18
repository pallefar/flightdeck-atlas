"use client";
import { freshProject } from "@/lib/fresh-export";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Download,
  Link2,
  Plus,
  RefreshCw,
  Search,
  Target,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Project, ProjectFields } from "@/lib/projects";
import {
  catalogSchema,
  projectRefKey,
  type ProjectCatalog,
  type ImportCandidate,
} from "@/lib/flightdeck/bridge";
import { downloadText } from "@/lib/briefing";
export default function FlightDeckConnection({
  projects,
  busy,
  canCreate,
  onNew,
  onOpen,
  onSave,
  onImported,
}: {
  projects: Project[];
  busy: boolean;
  canCreate: boolean;
  onNew: () => void;
  onOpen: (project: Project) => void;
  onSave: (
    fields: ProjectFields,
    existing?: Project,
  ) => Promise<Project | null>;
  onImported: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"import" | "onboard">("import");
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [label, setLabel] = useState(""),
    [workspace, setWorkspace] = useState(""),
    [message, setMessage] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  async function refresh(cursor?: string) {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/flightdeck/catalog${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!r.ok)
        throw Error("FlightDeck discovery could not be checked. Try again.");
      const result = catalogSchema.parse(await r.json());
      setCatalog((previous) =>
        cursor && previous?.connected && result.connected
          ? {
              ...result,
              candidates: [
                ...new Map(
                  [...previous.candidates, ...result.candidates].map((c) => [
                    projectRefKey(c.ref),
                    c,
                  ]),
                ).values(),
              ],
            }
          : result,
      );
    } catch (e) {
      setError((e as Error).message);
      setCatalog(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function importProject(candidate: ImportCandidate) {
    setImporting(projectRefKey(candidate.ref));
    setError("");
    try {
      const response = await fetch("/api/flightdeck/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: candidate.ref }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw Error(body.error || "Import could not be completed.");
      await onImported();
      await refresh();
      setMessage(`${candidate.name} is now available in Atlas.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(null);
    }
  }
  const local = projects.filter((p) => !p.archived && p.source === "atlas");
  const prepared = local.filter((p) => p.flightdeckDraft);
  const filtered = local.filter((p) =>
    `${p.name} ${p.functionArea || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const candidates = catalog?.connected
    ? catalog.candidates.filter((p) =>
        `${p.name} ${p.workspaceName}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      )
    : [];
  return (
    <main className="hub-page connection-hub">
      <div className="hub-heading">
        <div>
          <span className="eyebrow">YOUR WORK, CONNECTED</span>
          <h1>FlightDeck connection</h1>
          <p>
            Bring OS projects into Atlas. Prepare Atlas projects for the OS.
          </p>
        </div>
        <Link2 className="hub-heading-icon" size={29} />
      </div>
      <div className="connection-status">
        <span
          className={`status ${catalog?.connected ? "in-progress" : "planning"}`}
        >
          {catalog?.connected
            ? "Connected"
            : loading
              ? "Checking connection"
              : catalog
                ? "Not connected"
                : "Connection unavailable"}
        </span>
        <p>
          {catalog?.connected
            ? "Projects shown here are filtered by your FlightDeck access."
            : catalog?.reason || "Checking the FlightDeck connection."}
        </p>
        <Button
          variant="outline"
          disabled={loading || !!importing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>
      <div className="bridge-toolbar">
        <div className="filter-tabs">
          <button
            aria-pressed={tab === "import"}
            className={tab === "import" ? "chosen" : ""}
            onClick={() => {
              setTab("import");
              setQuery("");
            }}
          >
            From FlightDeck
          </button>
          <button
            aria-pressed={tab === "onboard"}
            className={tab === "onboard" ? "chosen" : ""}
            onClick={() => {
              setTab("onboard");
              setQuery("");
            }}
          >
            To FlightDeck <span>{prepared.length}</span>
          </button>
        </div>
        <Button disabled={!canCreate || busy} onClick={onNew}>
          <Plus size={15} />
          New Atlas project
        </Button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="bridge-success" role="status">
          <Check size={15} />
          {message}
        </p>
      )}
      {tab === "import" ? (
        <section className="hub-card">
          <h2>
            <ArrowDownToLine size={19} />
            OS projects without an Atlas project
          </h2>
          <p className="hub-muted">
            Choose an accessible OS project to create its linked Atlas
            workspace. Existing links will be excluded, including archived Atlas
            projects.
          </p>
          {!catalog?.connected ? (
            <div className="hub-empty">
              <Link2 size={28} />
              <h3>
                {error
                  ? "Discovery unavailable"
                  : "Your OS project list will appear here"}
              </h3>
              <p>
                {error
                  ? "Refresh to try again. No project access or import status can be confirmed."
                  : "Connect FlightDeck to discover projects you can access. No OS data has been imported."}
              </p>
              <a className="text-link" href="/integration">
                Connection requirements <ArrowUpRight size={14} />
              </a>
            </div>
          ) : (
            <>
              <label className="bridge-search">
                <Search size={16} />
                <Input
                  aria-label="Search OS projects"
                  placeholder="Search projects or workspaces"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {candidates.map((c) => (
                <article className="bridge-row" key={projectRefKey(c.ref)}>
                  <div>
                    <h3>{c.name}</h3>
                    <p>{c.workspaceName}</p>
                  </div>
                  <Button
                    disabled={
                      !canCreate || !c.canImport || !!importing || loading
                    }
                    onClick={() => void importProject(c)}
                  >
                    {importing === projectRefKey(c.ref)
                      ? "Creating…"
                      : "Create in Atlas"}
                  </Button>
                </article>
              ))}
              {!candidates.length && (
                <p className="hub-empty">
                  {query
                    ? "No projects match this search in the loaded results."
                    : "No unlinked projects in the loaded results."}
                </p>
              )}
              {catalog.nextCursor && (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => void refresh(catalog.nextCursor!)}
                >
                  Load more projects
                </Button>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="hub-card">
          <h2>
            <ArrowUpRight size={19} />
            Prepare for FlightDeck
          </h2>
          <p className="hub-muted">
            Save a proposed OS name and destination now. When connected, you’ll
            choose an authorized workspace and review before creating the OS
            project. Saving a draft sends nothing to FlightDeck.
          </p>
          <label className="bridge-search">
            <Search size={16} />
            <Input
              aria-label="Search Atlas projects for onboarding"
              placeholder="Search your Atlas projects"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!local.length && (
            <div className="hub-empty">
              <h3>Start with an Atlas project</h3>
              <p>Create your project here, then prepare it for FlightDeck.</p>
              <Button disabled={!canCreate || busy} onClick={onNew}>
                <Plus size={15} />
                Create Atlas project
              </Button>
            </div>
          )}
          {!!local.length && !filtered.length && (
            <p className="hub-empty">No Atlas projects match this search.</p>
          )}
          {filtered.map((p) => (
            <article className="bridge-project" key={p.id}>
              <div className="bridge-row">
                <div>
                  <button
                    className="bridge-project-name"
                    onClick={() => onOpen(p)}
                  >
                    {p.name}
                    <ArrowUpRight size={14} />
                  </button>
                  <p>
                    {p.functionArea || p.category}
                    {p.flightdeckDraft
                      ? ` · ${p.flightdeckDraft.workspaceHint || "Choose workspace when connected"}`
                      : " · Atlas only"}
                  </p>
                </div>
                <span
                  className={`status ${p.flightdeckDraft ? "planning" : ""}`}
                >
                  {p.flightdeckDraft ? "Draft prepared" : "Not prepared"}
                </span>
              </div>
              {editing === p.id ? (
                <form
                  className="bridge-draft"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const saved = await onSave(
                      {
                        ...p,
                        flightdeckDraft: {
                          label: label.trim(),
                          workspaceHint: workspace.trim(),
                        },
                      },
                      p,
                    );
                    if (saved) {
                      setEditing(null);
                      setMessage(
                        "Onboarding draft saved in Atlas. Nothing has been sent to FlightDeck.",
                      );
                    }
                  }}
                >
                  <label>
                    Proposed OS project name
                    <Input
                      required
                      maxLength={100}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  <label>
                    Preferred workspace (optional)
                    <Input
                      maxLength={100}
                      placeholder="e.g. Operations Europe"
                      value={workspace}
                      onChange={(e) => setWorkspace(e.target.value)}
                    />
                  </label>
                  <p className="hub-muted">
                    This is a planning note. Workspace permissions will be
                    checked when connected.
                  </p>
                  <div className="bridge-actions">
                    <Button disabled={busy || !label.trim()} type="submit">
                      Save onboarding draft
                    </Button>
                    <Button
                      variant="outline"
                      type="button"
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="bridge-actions">
                  <Button
                    variant="outline"
                    disabled={busy || p.canEdit === false}
                    onClick={() => {
                      setEditing(p.id);
                      setLabel(p.flightdeckDraft?.label || p.name);
                      setWorkspace(p.flightdeckDraft?.workspaceHint || "");
                    }}
                  >
                    {p.flightdeckDraft ? "Edit draft" : "Prepare onboarding"}
                  </Button>
                  {p.flightdeckDraft && (
                    <>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const current = await freshProject(p.id);
                            if (!current.flightdeckDraft)
                              throw Error(
                                "This onboarding draft is no longer available.",
                              );
                            downloadText(
                              `flightdeck-draft-${current.id}.md`,
                              [
                                `# FlightDeck onboarding draft: ${current.flightdeckDraft!.label}`,
                                `Atlas project: ${current.name}`,
                                `Atlas ID: ${current.id}`,
                                `Preferred workspace: ${current.flightdeckDraft!.workspaceHint || "To select"}`,
                                `Description: ${current.description}`,
                                `Function: ${current.functionArea || current.category}`,
                                `Sponsor: ${current.sponsor || "To confirm"}`,
                                `Success measure: ${current.benefit || "To define"}`,
                                "",
                                "Prepared in Atlas. Not submitted to FlightDeck. Workspace access and final project details must be reviewed before creation.",
                              ].join("\n\n"),
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <Download size={14} />
                        Export draft
                      </Button>
                      <button
                        className="text-link"
                        disabled={busy || p.canEdit === false}
                        onClick={async () => {
                          const saved = await onSave(
                            { ...p, flightdeckDraft: null },
                            p,
                          );
                          if (saved)
                            setMessage(
                              "Onboarding draft removed. Your Atlas project is unchanged.",
                            );
                        }}
                      >
                        <X size={14} />
                        Remove draft
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      <section className="hub-card advantage-connect">
        <Target size={25} />
        <div>
          <h2>TEOA Advantage</h2>
          <p className="hub-muted">
            Project links will also anchor permitted scorecards, objectives and
            improvement work. Advantage data and shared sign-in are waiting for
            the SDK.
          </p>
          <a className="text-link" href="/integration">
            SDK and master-app requirements <ArrowUpRight size={14} />
          </a>
        </div>
      </section>
    </main>
  );
}
