// The onboarding autosave's UI rules (onb-atlas-save-ux, plan 2026-09-25 §3
// J2 and §7 lane A), kept pure so they can be tested without a browser:
//   - the status pill's words for each coordinator state;
//   - when leaving (tab close or an in-app route change) must ask first;
//   - the per-viewer, per-project recovery buffer that holds local work
//     across a reload until a conflict is resolved (sessionStorage, every
//     access wrapped: a blocked or absent store never breaks the form);
//   - a tiny registry the app's router asks before it changes view.
import type { AutosaveState } from "./autosave";
import { t, type Locale } from "@/lib/i18n";

export type PillTone = "ok" | "busy" | "warn";

/** The pill's text and tone. `savedAt` is when this form last saw a save
 * succeed; `basicsDirty` means fields outside the autosaved onboarding part
 * wait for Save now. */
export function autosavePill(
  s: AutosaveState,
  {
    locale = "en",
    savedAt = null,
    basicsDirty = false,
  }: { locale?: Locale; savedAt?: Date | null; basicsDirty?: boolean } = {},
): { text: string; tone: PillTone } {
  switch (s.status) {
    case "conflict":
      return { text: t("onb.autosave.conflict", locale), tone: "warn" };
    case "stopped":
      return s.stopReason === "locked"
        ? { text: t("onb.autosave.locked", locale), tone: "warn" }
        : {
            text: t("onb.autosave.refused", locale, {
              error: (s.lastError ?? "").replace(/\.$/, ""),
            }),
            tone: "warn",
          };
    case "retrying":
      return {
        text: t("onb.autosave.retrying", locale, {
          seconds: Math.max(1, Math.round((s.retryInMs ?? 0) / 1000)),
        }),
        tone: "warn",
      };
    case "saving":
      return { text: t("onb.autosave.saving", locale), tone: "busy" };
    case "pending":
      return { text: t("onb.autosave.pending", locale), tone: "busy" };
  }
  if (basicsDirty)
    return { text: t("onb.autosave.basics", locale), tone: "busy" };
  if (s.status === "saved" && savedAt)
    return {
      text: t("onb.autosave.saved", locale, {
        time: savedAt.toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        }),
        revision: s.acknowledgedRevision,
      }),
      tone: "ok",
    };
  return {
    text: t("onb.autosave.idle", locale, { revision: s.acknowledgedRevision }),
    tone: "ok",
  };
}

/** Leaving must ask while anything local is not on the server: an edit
 * still pending or failing, fields waiting for Save now, or a held conflict
 * copy. Nothing asks once everything is saved. */
export const hasUnsavedWork = (
  s: Pick<AutosaveState, "pending" | "status">,
  basicsDirty: boolean,
  held: boolean,
) =>
  basicsDirty ||
  held ||
  s.pending ||
  s.status === "conflict" ||
  s.status === "retrying";

/** JSON with object keys sorted, so two equal values compare equal however
 * their keys were ordered. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

/** Keys that change on every save, or belong to the autosaved part. */
const VOLATILE = new Set([
  "onboarding",
  "onboardingRevision",
  "revision",
  "updatedAt",
  "activity",
]);
/** True when two versions of a project agree on everything outside the
 * autosaved onboarding part, so a form holding unsaved basics may move its
 * base onto the newer one without overwriting anyone. */
export function sameOutsideOnboarding(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  const strip = (p: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(p).filter(([k]) => !VOLATILE.has(k)));
  return stableJson(strip(a)) === stableJson(strip(b));
}

// ── Recovery buffer ─────────────────────────────────────────────────────

export type HeldDraft<D> = {
  v: 1;
  /** The local form, exactly as it was. */
  draft: D;
  /** The version the local edits started from, so Keep mine can put back
   * exactly the fields this viewer changed. */
  baseDraft: D;
  /** Whether fields outside the onboarding part were edited. */
  basicsDirty: boolean;
  /** The revision the local work was based on. */
  base: number;
  heldAt: string;
};

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/** One slot per viewer and project, so one person's held copy is never
 * offered to another who signs in to the same tab. */
export const bufferKey = (viewer: string, projectId: string) =>
  `atlas.onboarding.held.v1:${encodeURIComponent(viewer || "anonymous")}:${encodeURIComponent(projectId)}`;

export function readHeld<D>(
  viewer: string,
  projectId: string,
  store: Store | null = session(),
): HeldDraft<D> | null {
  try {
    const raw = store?.getItem(bufferKey(viewer, projectId));
    if (!raw) return null;
    const held = JSON.parse(raw) as Partial<HeldDraft<D>> | null;
    if (
      !held ||
      held.v !== 1 ||
      !held.draft ||
      typeof held.draft !== "object" ||
      !held.baseDraft ||
      typeof held.baseDraft !== "object" ||
      typeof held.basicsDirty !== "boolean" ||
      !Number.isInteger(held.base)
    )
      return null;
    return held as HeldDraft<D>;
  } catch {
    return null;
  }
}

export function writeHeld<D>(
  viewer: string,
  projectId: string,
  held: Omit<HeldDraft<D>, "v" | "heldAt">,
  store: Store | null = session(),
) {
  try {
    store?.setItem(
      bufferKey(viewer, projectId),
      JSON.stringify({ v: 1, ...held, heldAt: new Date().toISOString() }),
    );
  } catch {
    // A full or blocked store: the copy lives on in memory only.
  }
}

export function clearHeld(
  viewer: string,
  projectId: string,
  store: Store | null = session(),
) {
  try {
    store?.removeItem(bufferKey(viewer, projectId));
  } catch {
    // Nothing to clear in a blocked store.
  }
}

// ── Leave guard registry ────────────────────────────────────────────────

type Guard = () => string | null;
const guards = new Set<Guard>();

/** A form registers a function that returns the question to ask while it
 * holds unsaved work (null when nothing would be lost). */
export function registerLeaveGuard(guard: Guard) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** Asks before an in-app route change; true when leaving may go ahead. */
export function confirmLeave(
  ask: (question: string) => boolean = (q) => window.confirm(q),
) {
  for (const guard of guards) {
    const question = guard();
    if (question && !ask(question)) return false;
  }
  return true;
}
