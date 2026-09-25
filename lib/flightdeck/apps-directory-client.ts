"use client";
// The browser side of /api/flightdeck/apps/directory (apps-32). The loader is
// plain code so the spec can run it without a browser; useAppsDirectory is
// the thin React wrapper the 9-dot FlightDeck section uses (apps-33).
//
// FAILS CLOSED: any failed fetch clears the list (a stale list would present
// old state as current). Switching selection clears it at once, a late
// answer to an earlier request is dropped, and an answer whose echoed
// workspace/project is not the selection asked for is never shown.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { OsSelection } from "./context";
import type { DirectoryView } from "./apps-directory-route";

export const APPS_DIRECTORY_URL = "/api/flightdeck/apps/directory";
export type DirectorySnapshot = {
  loading: boolean;
  /** The last good list for the current selection, or null. */
  data: DirectoryView | null;
  /** The route's state, "error" when it gave none, null before a load. */
  state: string | null;
};
const EMPTY: DirectorySnapshot = { loading: false, data: null, state: null };
const keyOf = (s: { osWorkspaceId: string; osProjectId: string | null }) =>
  `${s.osWorkspaceId}\u0000${s.osProjectId ?? ""}`;

export function createDirectoryLoader(
  options: { fetch?: (url: string) => Promise<Response> } = {},
) {
  const send = options.fetch ?? ((url: string) => fetch(url, { cache: "no-store" }));
  let snap = EMPTY;
  let seq = 0;
  let shownKey: string | null = null;
  const listeners = new Set<() => void>();
  const set = (next: DirectorySnapshot) => {
    snap = next;
    listeners.forEach((l) => l());
  };
  return {
    snapshot: () => snap,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reset() {
      seq++;
      shownKey = null;
      set(EMPTY);
    },
    async load(expected: OsSelection) {
      const mine = ++seq;
      const key = keyOf(expected);
      // Another selection: never keep the old list on screen meanwhile.
      if (key !== shownKey) {
        shownKey = key;
        set({ loading: true, data: null, state: null });
      } else set({ ...snap, loading: true });
      let view: DirectoryView | null = null;
      let state = "error";
      try {
        const res = await send(APPS_DIRECTORY_URL);
        const body = (await res.json()) as Partial<DirectoryView>;
        if (typeof body?.state === "string") state = body.state;
        if (
          res.ok &&
          body.state === "ok" &&
          Array.isArray(body.apps) &&
          body.workspaceId === expected.osWorkspaceId &&
          body.projectId === expected.osProjectId
        )
          view = body as DirectoryView;
        else if (res.ok && body.state === "ok") state = "invalid_response";
      } catch {
        view = null;
      }
      if (mine !== seq) return; // a newer request owns the screen
      set({ loading: false, data: view, state });
    },
  };
}

/** The directory for the selected OS workspace + project; refetches when
 * the selection changes. `data` is null whenever the last fetch failed. */
export function useAppsDirectory(selection: OsSelection | null) {
  const loader = useMemo(() => createDirectoryLoader(), []);
  const snap = useSyncExternalStore(
    loader.subscribe,
    loader.snapshot,
    loader.snapshot,
  );
  const ws = selection?.osWorkspaceId ?? null;
  const project = selection?.osProjectId ?? null;
  useEffect(() => {
    if (ws) void loader.load({ osWorkspaceId: ws, osProjectId: project });
    else loader.reset();
  }, [loader, ws, project]);
  return {
    ...snap,
    reload: () =>
      ws ? loader.load({ osWorkspaceId: ws, osProjectId: project }) : undefined,
  };
}
