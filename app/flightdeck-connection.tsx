"use client";
import { freshProject } from "@/lib/fresh-export";
import { confirmLeave } from "@/lib/flightdeck/autosave-ux";
import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  Download,
  Link2,
  Lock,
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
import { useWorkspace } from "./workspace-tools";
import {
  OnboardingEditor,
  checkNote,
  checkedLine,
  fetchStatus,
  stageLabel,
  useOnboardingStages,
} from "./flightdeck-onboarding";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/react";
import {
  exportDraftText,
  isDraftLocked,
  isStatusMoving,
  lockNote,
} from "@/lib/flightdeck/onboarding";
import { CARD_ANCHOR } from "@/lib/flightdeck/project-card";
import {
  connectionLine,
  connectionViewSchema,
  workWaitingForFlightDeck,
  type ConnectionView,
} from "@/lib/flightdeck/connection";
/** The one connection line's source: the credential's whoami, through
 * /api/flightdeck/connection. Anything unreadable is "check_failed". */
async function fetchConnection(fresh: boolean): Promise<ConnectionView> {
  try {
    const r = await fetch(
      `/api/flightdeck/connection${fresh ? "?refresh=1" : ""}`,
      { cache: "no-store" },
    );
    const parsed = connectionViewSchema.safeParse(
      r.ok ? await r.json() : null,
    );
    return parsed.success ? parsed.data : { state: "check_failed" };
  } catch {
    return { state: "check_failed" };
  }
}
async function fetchCatalog(cursor?: string) {
  const r = await fetch(
    `/api/flightdeck/catalog${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
  );
  if (!r.ok) throw Error("FlightDeck discovery could not be checked. Try again.");
  return catalogSchema.parse(await r.json());
}
export default function FlightDeckConnection({
  projects,
  busy,
  canCreate,
  superAdmin,
  onNew,
  onOpen,
  onSave,
  viewerId = "",
  onProjectSaved,
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
  /** Who is viewing (the onboarding form holds unsaved work per viewer). */
  viewerId?: string;
  /** The onboarding form's autosave landed. */
  onProjectSaved?: (project: Project) => void;
  onImported: () => Promise<void>;
}) {
  // null until someone picks a tab: the page then opens on To FlightDeck
  // while work waits there (an unsent draft or an open ask), else on From
  // FlightDeck. Once it has opened on To FlightDeck it stays there.
  const [chosenTab, setTab] = useState<"import" | "onboard" | null>(null);
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [catalog, setCatalog] = useState<ProjectCatalog | null>(null),
    // The first catalog check starts on mount, so the view opens "Checking".
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const locale = useLocale();
  const onboarding = useOnboardingStages(superAdmin);
  const [importing, setImporting] = useState<string | null>(null);
  const context = useFlightDeckContext(superAdmin);
  // The OS's origin, for LINKS only: the url of the built-in "FlightDeck OS"
  // app entry, which /api/workspace fills from ATLAS_FLIGHTDECK_URL for signed-in
  // users (never the credential). /integration is public, so the address is
  // shown here, in the signed-in Connections view, and not there.
  const { data: workspace } = useWorkspace();
  const osUrl = (workspace?.apps.find((x) => x.id === "flightdeck")?.url ?? "").replace(/\/+$/, "");
  function failed(e: unknown) {
    setError((e as Error).message);
    setCatalog(null);
  }
  async function refresh(cursor?: string) {
    if (!cursor) void fetchConnection(true).then(setConnection);
    setLoading(true);
    setError("");
    try {
      const result = await fetchCatalog(cursor);
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
      failed(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    void fetchConnection(false).then((v) => live && setConnection(v));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    fetchCatalog()
      .then(setCatalog, failed)
      .finally(() => setLoading(false));
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
  const waiting = workWaitingForFlightDeck(local, onboarding.stages);
  // Latched during render (not in an effect): once work has waited, a
  // later stage load that shows it sent does not flip the page away.
  if (waiting && chosenTab === null) setTab("onboard");
  const tab = chosenTab ?? (waiting ? "onboard" : "import");
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
      {/* ONE connection line, from the credential's whoami: no other
          chip, so "Connected" and "Not enabled" can never sit side by side. */}
      <div className="connection-status">
        <p role="status" data-testid="fd-connection-line">
          <strong>{connectionLine(connection, locale)}</strong>
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
              // The onboarding form lives on the other tab: leaving it with
              // unsaved work asks first.
              if (tab !== "import" && !confirmLeave()) return;
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
                  : "Import from FlightDeck is not available yet"}
              </h3>
              <p>
                {error
                  ? "Refresh to try again. No project access or import status can be confirmed."
                  : "OS projects cannot be imported into Atlas until delegated sign-in and per-project access exist. No OS data has been imported."}
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
            {checkNote(locale)} Each sent project says when it was last checked.
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
            // While FlightDeck may hold a send, the form locks the draft and
            // says so. The row must keep that promise: removing the draft
            // here would drop the name FlightDeck is reviewing, break Export
            // draft, drop the project from this tab's count, and leave a
            // later "Needs more info" reopening an empty draft. Both surfaces
            // read the same predicate off the same stage, so neither can
            // offer what the other forbids.
            const locked = isDraftLocked(stage);
            // Until the stage list has loaded once, Atlas cannot tell whether
            // FlightDeck holds this draft: the row neither claims a
            // destination is still to be chosen nor offers to drop it.
            const unknown = !!p.flightdeckDraft && !onboarding.stages;
            const lockReason = !p.flightdeckDraft
              ? ""
              : unknown
                ? onboarding.failed
                  ? "Atlas could not check FlightDeck, so it cannot tell whether FlightDeck holds this draft. It tries again shortly."
                  : "Atlas is checking whether FlightDeck holds this draft."
                : lockNote(stage);
            const reasonId = `fd-lock-${p.id}`;
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
                    {/* Locked first: a project FlightDeck holds always has a
                        saved draft (a send needs one), so asking about the
                        draft first made "With FlightDeck" unreachable and
                        left a linked project reading as one still choosing a
                        workspace. And the draft's own line no longer says
                        "when connected": read-only context is live, and the
                        destination is chosen in Review & send, not here. The
                        hint is the owner's planning note, shown as written. */}
                    <p>
                      {p.functionArea || p.category}
                      {locked
                        ? " · With FlightDeck"
                        : unknown
                          ? onboarding.failed
                            ? " · FlightDeck status unavailable"
                            : " · Checking FlightDeck status"
                          : p.flightdeckDraft
                            ? ` · ${p.flightdeckDraft.workspaceHint || (stage ? "Destination chosen when you send again" : "Destination chosen when you send")}`
                            : " · Atlas only"}
                    </p>
                    {/* The requester's surface is the project page's card
                        (plan 2026-09-25 J1); this page is the Super Admin's
                        tool and links back to it. */}
                    {superAdmin && (
                      <a
                        className="text-link"
                        href={`/?${new URLSearchParams({ view: "manage", tool: "overview", workspace: p.id })}#${CARD_ANCHOR}`}
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
                            return;
                          e.preventDefault();
                          onOpen(p);
                          history.replaceState(
                            null,
                            "",
                            `${location.pathname}${location.search}#${CARD_ANCHOR}`,
                          );
                        }}
                      >
                        {t("onb.card.rowLink", locale)}
                      </a>
                    )}
                    {isStatusMoving(stage) && (
                      <p className="fd-hint">
                        {checkedLine(onboarding.checked[p.id] ?? null, locale)}
                      </p>
                    )}
                  </div>
                  <span
                    className={`status ${stage === "linked" || stage === "setup-in-progress" || stage === "setup-complete" ? "completed" : p.flightdeckDraft || stage ? "planning" : ""}`}
                  >
                    {stage
                      ? stageLabel(stage, locale)
                      : p.flightdeckDraft
                        ? t("onb.row.draftPrepared", locale)
                        : t("onb.row.notPrepared", locale)}
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
                    viewerId={viewerId}
                    onAutosaved={onProjectSaved}
                    onClose={() => setEditing(null)}
                    onMessage={setMessage}
                    onStage={onboarding.mark}
                  />
                ) : (
                  <>
                    <div className="bridge-actions">
                      <Button
                        variant="outline"
                        disabled={busy || p.canEdit === false}
                        onClick={() => {
                          if (editing && !confirmLeave()) return;
                          setEditing(p.id);
                          setMessage("");
                        }}
                      >
                        {locked
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
                                // What the file says about FlightDeck comes
                                // from the stored send (the stage, where it
                                // went, which revision), never from fixed
                                // text: a draft FlightDeck holds is not "not
                                // submitted". Without a status, the row's
                                // stage still keeps it true.
                                const status = await fetchStatus(
                                  current.id,
                                  false,
                                );
                                if (!status && !onboarding.stages)
                                  throw Error(
                                    "Atlas could not check FlightDeck, so the export cannot say whether FlightDeck holds this draft. Try again.",
                                  );
                                const op = status?.operation;
                                const sentAs = op
                                  ? {
                                      stage: op.stage,
                                      destinationWorkspaceId:
                                        op.destinationWorkspaceId,
                                      atlasRevision: op.atlasRevision,
                                    }
                                  : stage
                                    ? {
                                        stage,
                                        destinationWorkspaceId: null,
                                        atlasRevision: null,
                                      }
                                    : null;
                                downloadText(
                                  `flightdeck-draft-${current.id}.md`,
                                  exportDraftText(current, sentAs),
                                );
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            <Download size={14} />
                            Export draft
                          </Button>
                          {/* Locked is announced, not just greyed: it stays
                            focusable (aria-disabled, not disabled) so a
                            keyboard or screen-reader user reaches it and
                            hears why, and the reason is printed on the row
                            below, so touch needs no hover either. */}
                          <button
                            type="button"
                            className="text-link"
                            disabled={busy || p.canEdit === false}
                            aria-disabled={lockReason ? true : undefined}
                            aria-describedby={lockReason ? reasonId : undefined}
                            onClick={async () => {
                              if (lockReason) return;
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
                    {lockReason && (
                      <p className="fd-lock-note" id={reasonId}>
                        <Lock size={13} aria-hidden="true" />
                        {lockReason}
                      </p>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </section>
      )}
      {superAdmin && osUrl ? (
        <section className="hub-card advantage-connect" aria-labelledby="fd-dev-ref">
          <BookOpen size={25} />
          <div>
            <h2 id="fd-dev-ref">FlightDeck developer reference</h2>
            <p className="hub-muted">
              How Atlas&apos;s credential, the read-only workspace and project
              context, and onboarding requests work, as FlightDeck documents
              them. Opens in FlightDeck and needs a FlightDeck sign-in.
            </p>
            <a
              className="text-link"
              href={`${osUrl}/console/help?article=developers-quickstart-atlas`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Quickstart for Atlas <ArrowUpRight size={14} />
            </a>{" "}
            <a
              className="text-link"
              href={`${osUrl}/console/help?article=developers-api-reference`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Inbound API reference <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
      ) : null}
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
