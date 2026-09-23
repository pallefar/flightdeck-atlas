"use client";
import { useEffect, useId, useSyncExternalStore } from "react";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type { AccessProfile } from "@/lib/access-policy";
import { PREFERENCES_CHANGED_EVENT } from "@/lib/collaboration";
import {
  contextErrorSchema,
  contextResponseSchema,
  projectLabel,
  projectOptionText,
  visibleProjects,
  workspaceOptionText,
  type ContextResponse,
  type ContextState,
  type OsContextEntry,
  type OsSelection,
} from "@/lib/flightdeck/context";

// Read-only mirror of the FlightDeck OS sidebar's Workspace / Project
// switchers. Lists come from Atlas's own /api/flightdeck/context, which reads
// the OS inbound API server-side; the browser never contacts the OS.
type Snapshot = {
  loaded: boolean;
  state: ContextState | "check_failed" | null;
  workspaces: OsContextEntry[];
  projects: OsContextEntry[];
  selected: OsSelection | null;
  projectFallback: boolean;
  lastGoodAt: string | null;
  checkedAt: string | null;
  retryAfter: number | null;
  saving: boolean;
  /** The choice being saved, shown in the selects until the save answers. */
  pending: SelectionRequest | null;
  error: string;
};
type SelectionRequest = { osWorkspaceId: string; osProjectId: string | null };
const initial: Snapshot = {
  loaded: false,
  state: null,
  workspaces: [],
  projects: [],
  selected: null,
  projectFallback: false,
  lastGoodAt: null,
  checkedAt: null,
  retryAfter: null,
  saving: false,
  pending: null,
  error: "",
};
let snapshot = initial;
const listeners = new Set<() => void>();
let generation = 0,
  pollers = 0,
  stopPolling: (() => void) | null = null,
  retryTimer: number | undefined;
function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}
const freshStates: ContextState[] = [
  "ok",
  "workspace_not_found",
  "workspace_disabled",
];
const clearStates: ContextState[] = [
  "unauthorized",
  "not_configured",
  "not_permitted",
];
/** `keepError` is set for the check that directly follows a failed save, so
 * its message is not hidden the moment it appears. Any later check that
 * confirms FlightDeck again clears it. */
function apply(body: ContextResponse, keepError = false) {
  window.clearTimeout(retryTimer);
  // Unreachable, busy or unexpected responses keep the last good lists.
  update({
    loaded: true,
    state: body.state,
    checkedAt: body.checkedAt,
    retryAfter: body.retryAfter,
    ...(freshStates.includes(body.state)
      ? {
          workspaces: body.workspaces,
          projects: body.projects,
          selected: body.selected,
          projectFallback: body.projectFallback,
          lastGoodAt: body.checkedAt,
          ...(keepError ? {} : { error: "" }),
        }
      : {}),
    ...(clearStates.includes(body.state)
      ? {
          workspaces: [],
          projects: [],
          selected: null,
          projectFallback: false,
          lastGoodAt: null,
        }
      : {}),
  });
  if (body.state === "rate_limited" && body.retryAfter && body.retryAfter < 60)
    retryTimer = window.setTimeout(
      () => void refresh(),
      body.retryAfter * 1000,
    );
}
async function refresh(options: { keepError?: boolean } = {}) {
  const started = generation;
  try {
    const response = await fetch("/api/flightdeck/context", {
      cache: "no-store",
    });
    if (started !== generation) return;
    if (response.status === 401 || response.status === 403) {
      apply(
        {
          state: "not_permitted",
          workspaces: [],
          projects: [],
          selected: null,
          projectFallback: false,
          retryAfter: null,
          checkedAt: new Date().toISOString(),
        },
        options.keepError,
      );
      return;
    }
    const body = contextResponseSchema.safeParse(
      response.ok ? await response.json() : null,
    );
    if (started !== generation) return;
    if (body.success) apply(body.data, options.keepError);
    else
      update({
        loaded: true,
        state: "check_failed",
        checkedAt: new Date().toISOString(),
      });
  } catch {
    if (started === generation)
      update({
        loaded: true,
        state: "check_failed",
        checkedAt: new Date().toISOString(),
      });
  }
}
async function choose(next: SelectionRequest) {
  // One save at a time: a second PUT could land on the server first.
  if (snapshot.saving) return;
  const mine = ++generation;
  update({ saving: true, pending: next, error: "" });
  try {
    const response = await fetch("/api/flightdeck/context", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const raw: unknown = await response.json().catch(() => null);
    if (mine !== generation) return;
    const body = contextResponseSchema.safeParse(raw);
    if (response.ok && body.success) {
      apply(body.data);
      update({ saving: false, pending: null });
      window.dispatchEvent(new Event(PREFERENCES_CHANGED_EVENT));
      return;
    }
    const failure = contextErrorSchema.safeParse(raw);
    update({
      saving: false,
      pending: null,
      error: failure.success
        ? failure.data.error
        : "The FlightDeck context could not be saved. Try again.",
    });
  } catch {
    if (mine !== generation) return;
    update({
      saving: false,
      pending: null,
      error: "The FlightDeck context could not be saved. Try again.",
    });
  }
  // Show what the OS now says (for example a workspace disabled meanwhile).
  void refresh({ keepError: true });
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** One poller however many switchers are mounted (sidebar + mobile menu).
 * Same cadence as the Atlas project list: on window focus and every 60 s. */
function startPolling() {
  pollers++;
  if (pollers === 1) {
    void refresh();
    const reload = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", reload);
    const interval = window.setInterval(reload, 60000);
    stopPolling = () => {
      window.removeEventListener("focus", reload);
      clearInterval(interval);
      window.clearTimeout(retryTimer);
    };
  }
  return () => {
    pollers--;
    if (pollers === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}
export function useFlightDeckContext(enabled: boolean) {
  useEffect(() => (enabled ? startPolling() : undefined), [enabled]);
  const current = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => initial,
  );
  return { ...current, refresh, choose };
}

const time = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso))
    : "";
/** The state text is a polite live region, so it is announced only when the
 * state changes. The check time sits outside it so a routine poll stays
 * silent for screen readers. */
function status(
  context: Snapshot,
  project?: OsContextEntry,
): {
  tone: "ok" | "warn" | "error" | "idle";
  text: string;
  at?: { label: string; iso: string | null };
} {
  const lastGood = context.lastGoodAt
    ? { label: "last checked", iso: context.lastGoodAt }
    : undefined;
  switch (context.state) {
    case null:
      return { tone: "idle", text: "Checking FlightDeck…" };
    case "ok":
      if (!context.workspaces.length)
        return { tone: "warn", text: "No workspaces shared with Atlas yet." };
      return {
        tone: context.projectFallback ? "warn" : "ok",
        text:
          context.projectFallback && project
            ? `Saved project unavailable. Showing ${projectLabel(project)}.`
            : "Connected",
        at: { label: "checked", iso: context.checkedAt },
      };
    case "not_configured":
      return { tone: "idle", text: "FlightDeck not configured" };
    case "os_unreachable":
      return { tone: "warn", text: "FlightDeck unreachable", at: lastGood };
    case "rate_limited":
      return {
        tone: "warn",
        text: `FlightDeck is busy. Retrying in ${context.retryAfter || 60}s.`,
        at: lastGood,
      };
    case "invalid_response":
      return {
        tone: "warn",
        text: "FlightDeck sent an unexpected response",
        at: lastGood,
      };
    case "check_failed":
      return {
        tone: "warn",
        text: "Context could not be checked",
        at: lastGood,
      };
    case "unauthorized":
      return { tone: "error", text: "FlightDeck refused Atlas's credential" };
    case "workspace_not_found":
      return {
        tone: "warn",
        text: "Saved workspace is no longer available. Choose another.",
      };
    case "workspace_disabled":
      return {
        tone: "warn",
        text: "This workspace is disabled in FlightDeck.",
      };
    case "not_permitted":
      return { tone: "idle", text: "" };
  }
}

export default function FlightDeckContextSwitcher({
  access,
}: {
  access: AccessProfile | null;
}) {
  // The OS credential is a machine credential; only the Super Admin sees it.
  const superAdmin = !!access?.superAdmin;
  const context = useFlightDeckContext(superAdmin);
  const id = useId();
  if (!superAdmin || context.state === "not_permitted") return null;
  const workspaces = context.workspaces;
  // A choice being saved is shown at once and put back only if it fails.
  const shown = context.pending ?? context.selected;
  const workspaceValue = shown?.osWorkspaceId || "";
  const projectValue = shown?.osProjectId || "";
  // While a workspace change saves, that workspace's projects are unknown.
  const switchingWorkspace =
    !!context.pending &&
    context.pending.osWorkspaceId !== context.selected?.osWorkspaceId;
  const projects = switchingWorkspace
    ? []
    : visibleProjects(context.projects, superAdmin);
  const currentWorkspace = workspaces.find((w) => w.id === workspaceValue);
  const currentProject = projects.find((p) => p.id === projectValue);
  // Changes are only offered against a list the OS has just confirmed.
  const live =
    !!context.state && (freshStates as string[]).includes(context.state);
  // While saving, the selects stay enabled so the one in use keeps keyboard
  // focus; they are marked busy and further changes are ignored.
  const busy = context.saving;
  const canSwitch = (options: OsContextEntry[], value: string) => {
    const selectable = options.filter((o) => o.enabled);
    return (
      selectable.length > 1 ||
      (selectable.length === 1 && selectable[0].id !== value)
    );
  };
  // Like the OS sidebar, which shows a switcher only when there is something
  // to switch to: a confirmed context with no alternative reads as plain
  // text, not as a greyed-out control that looks unavailable.
  const fixedWorkspace =
    live && currentWorkspace && !canSwitch(workspaces, workspaceValue)
      ? currentWorkspace
      : null;
  const fixedProject =
    live &&
    currentWorkspace?.enabled &&
    currentProject &&
    !canSwitch(projects, projectValue)
      ? currentProject
      : null;
  const placeholder = (kind: "workspace" | "project", count: number) =>
    !context.loaded || busy
      ? "Loading…"
      : count
        ? `Choose a ${kind}`
        : kind === "workspace"
          ? "No workspaces"
          : "No projects";
  const message = status(context, currentProject);
  return (
    <div
      className="fd-context"
      role="group"
      aria-labelledby={`${id}-title`}
      aria-busy={busy || !context.loaded}
    >
      <div className="fd-context-heading">
        <span className="eyebrow" id={`${id}-title`}>
          FlightDeck OS
        </span>
        <span className="fd-context-badge">Read-only</span>
      </div>
      {fixedWorkspace ? (
        <p className="fd-context-fixed">
          <span className="fd-context-label">FlightDeck workspace</span>
          <span className="fd-context-value" title={fixedWorkspace.label}>
            {workspaceOptionText(fixedWorkspace)}
          </span>
        </p>
      ) : (
        <>
          <label htmlFor={`${id}-workspace`}>FlightDeck workspace</label>
          <NativeSelect
            id={`${id}-workspace`}
            size="sm"
            className="fd-context-select"
            title={currentWorkspace?.label}
            value={currentWorkspace ? workspaceValue : ""}
            disabled={
              !live || (!busy && !canSwitch(workspaces, workspaceValue))
            }
            aria-disabled={busy || undefined}
            onChange={(e) =>
              void choose({ osWorkspaceId: e.target.value, osProjectId: null })
            }
          >
            {!currentWorkspace && (
              <NativeSelectOption value="" disabled>
                {placeholder("workspace", workspaces.length)}
              </NativeSelectOption>
            )}
            {workspaces.map((w) => (
              <NativeSelectOption key={w.id} value={w.id} disabled={!w.enabled}>
                {workspaceOptionText(w)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </>
      )}
      {fixedProject ? (
        <p className="fd-context-fixed">
          <span className="fd-context-label">FlightDeck project</span>
          <span className="fd-context-value" title={projectLabel(fixedProject)}>
            {projectOptionText(projects, fixedProject)}
          </span>
        </p>
      ) : (
        <>
          <label htmlFor={`${id}-project`}>FlightDeck project</label>
          <NativeSelect
            id={`${id}-project`}
            size="sm"
            className="fd-context-select"
            title={currentProject ? projectLabel(currentProject) : undefined}
            value={currentProject ? projectValue : ""}
            disabled={
              !live ||
              !currentWorkspace?.enabled ||
              (!busy && !canSwitch(projects, projectValue))
            }
            aria-disabled={busy || undefined}
            onChange={(e) =>
              void choose({
                osWorkspaceId: workspaceValue,
                osProjectId: e.target.value,
              })
            }
          >
            {!currentProject && (
              <NativeSelectOption value="" disabled>
                {placeholder("project", projects.length)}
              </NativeSelectOption>
            )}
            {projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id} disabled={!p.enabled}>
                {projectOptionText(projects, p)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </>
      )}
      <div className="fd-context-status" data-tone={message.tone}>
        <span className="fd-context-dot" aria-hidden="true" />
        <p>
          {/* While saving, the previous text is kept invisibly in the same
              cell so the row, and the nav below it, keep their height. */}
          <span className="fd-context-line">
            <span role="status">{busy ? "Saving…" : message.text}</span>
            {busy && (
              <span className="fd-context-ghost" aria-hidden="true">
                {message.text}
              </span>
            )}
          </span>
          {message.at?.iso && (
            <small>
              {message.at.label}{" "}
              <time dateTime={message.at.iso}>{time(message.at.iso)}</time>
            </small>
          )}
        </p>
      </div>
      {context.error && (
        <p className="fd-context-error" role="alert">
          {context.error}
        </p>
      )}
    </div>
  );
}
