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
import { useFlightDeckContext } from "./flightdeck-context-switcher";
import {
  CHECK_NOTE,
  OnboardingEditor,
  SEND_OPEN_NOTE,
  STAGE_LABEL,
  checkedLine,
  isSendOpen,
  useOnboardingStages,
} from "./flightdeck-onboarding";
import type { ContextState } from "@/lib/flightdeck/context";
const contextStatus: Record<
  ContextState | "check_failed" | "checking",
  { chip: string; tone: string; text: string }
> = {
  ok: {
    chip: "Connected (read-only)",
    tone: "completed",
    text: "connected (read-only). The sidebar mirrors your FlightDeck OS workspace and project lists through the OS inbound API.",
  },
  workspace_not_found: {
    chip: "Connected (read-only)",
    tone: "completed",
    text: "connected (read-only). Your saved workspace is no longer shared with Atlas; choose another in the sidebar.",
  },
  workspace_disabled: {
    chip: "Connected (read-only)",
    tone: "completed",
    text: "connected (read-only). The selected workspace is disabled in FlightDeck.",
  },
  checking: {
    chip: "Checking",
    tone: "planning",
    text: "checking the FlightDeck inbound API.",
  },
  not_configured: {
    chip: "Not configured",
    tone: "planning",
    text: "not configured. Set the FlightDeck URL and inbound credential in Atlas server configuration.",
  },
  not_permitted: {
    chip: "Super Admin only",
    tone: "planning",
    text: "read-only lists are shown to the Atlas Super Admin because they use one shared OS machine credential.",
  },
  os_unreachable: {
    chip: "Unreachable",
    tone: "on-hold",
    text: "FlightDeck OS could not be reached. The last confirmed lists stay visible.",
  },
  rate_limited: {
    chip: "Busy",
    tone: "on-hold",
    text: "FlightDeck asked Atlas to wait before reading again.",
  },
  invalid_response: {
    chip: "Unexpected response",
    tone: "on-hold",
    text: "FlightDeck answered, but not with the agreed context contract.",
  },
  check_failed: {
    chip: "Unavailable",
    tone: "on-hold",
    text: "Atlas could not check the context right now.",
  },
  unauthorized: {
    chip: "Refused",
    tone: "on-hold",
    text: "FlightDeck refused Atlas's inbound credential. Nothing is shown.",
  },
};
export default function FlightDeckConnection({
  projects,
  busy,
  canCreate,
  superAdmin,
  onNew,
  onOpen,
  onSave,
  onImported,
}: {
  projects: Project[];
  busy: boolean;
  canCreate: boolean;
  superAdmin: boolean;
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
    [message, setMessage] = useState("");
  const onboarding = useOnboardingStages(superAdmin);
  const [importing, setImporting] = useState<string | null>(null);
  const context = useFlightDeckContext(superAdmin);
  const contextRow =
    contextStatus[!superAdmin ? "not_permitted" : context.state || "checking"];
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
        <span className={`status ${contextRow.tone}`}>{contextRow.chip}</span>
        <p>
          <strong>Workspace &amp; project context:</strong> {contextRow.text}
        </p>
      </div>
      <div className="connection-status">
        <span className="status planning">
          {superAdmin ? "Proposal only" : "Super Admin sends"}
        </span>
        <p>
          <strong>Onboarding to FlightDeck:</strong> the Atlas Super Admin can
          send a prepared project to FlightDeck for review. It files a request
          only: an OS admin decides, and nothing is created automatically.
          FlightDeck must have project onboarding enabled for Atlas.
        </p>
      </div>
      <div className="connection-status">
        <span
          className={`status ${catalog?.connected ? "in-progress" : "planning"}`}
        >
          {catalog?.connected
            ? "Connected"
            : loading
              ? "Checking"
              : catalog
                ? "Not enabled"
                : "Unavailable"}
        </span>
        <p>
          <strong>Import from FlightDeck:</strong>{" "}
          {catalog?.connected
            ? "Projects shown here are filtered by your FlightDeck access."
            : catalog
              ? "not enabled. OS projects cannot be imported into Atlas until delegated sign-in and per-project access exist."
              : "Checking whether import is available."}
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
            Describe an Atlas project for FlightDeck in three steps: Basics,
            FlightDeck details, then Review &amp; send. Saving a draft sends
            nothing. The Atlas Super Admin reviews every field and sends it as a
            request; an OS admin decides, and nothing is created automatically.{" "}
            {CHECK_NOTE} Each sent project says when it was last checked.
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
          {filtered.map((p) => {
            const stage = onboarding.stages?.[p.id];
            // While FlightDeck is reviewing a send, the form locks the draft
            // and says so. The row must keep that promise: removing the draft
            // here would drop the name FlightDeck is reviewing, break Export
            // draft, drop the project from this tab's count, and leave a
            // later "Needs more info" reopening an empty draft.
            const sendOpen = isSendOpen(stage);
            return (
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
                    {(stage === "submitted" ||
                      stage === "linked" ||
                      stage === "setup-in-progress") && (
                      <p className="fd-hint">
                        {checkedLine(onboarding.checked[p.id] ?? null)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`status ${stage === "linked" || stage === "setup-in-progress" || stage === "setup-complete" ? "completed" : p.flightdeckDraft || stage ? "planning" : ""}`}
                  >
                    {stage
                      ? STAGE_LABEL[stage]
                      : p.flightdeckDraft
                        ? "Draft prepared"
                        : "Not prepared"}
                  </span>
                </div>
                {editing === p.id ? (
                  <OnboardingEditor
                    project={p}
                    superAdmin={superAdmin}
                    busy={busy}
                    workspaces={superAdmin ? context.workspaces : []}
                    contextState={superAdmin ? context.state : null}
                    onSave={onSave}
                    onClose={() => setEditing(null)}
                    onMessage={setMessage}
                    onStage={onboarding.mark}
                  />
                ) : (
                  <div className="bridge-actions">
                    <Button
                      variant="outline"
                      disabled={busy || p.canEdit === false}
                      onClick={() => {
                        setEditing(p.id);
                        setMessage("");
                      }}
                    >
                      {sendOpen
                        ? "View status"
                        : p.flightdeckDraft
                          ? "Edit draft"
                          : "Prepare onboarding"}
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
                          disabled={busy || p.canEdit === false || sendOpen}
                          title={sendOpen ? SEND_OPEN_NOTE : undefined}
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
            );
          })}
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
