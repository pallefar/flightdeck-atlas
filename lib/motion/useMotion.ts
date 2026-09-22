// MIRROR of FlightDeck OS flightdeck/web/src/motion/useMotion.ts at commit 99d641f1871069e35ea3ed411f20d427ea5d75fc
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/* eslint-disable react-hooks/refs, @typescript-eslint/no-unused-vars -- Atlas's lint runs React Compiler rules the
   OS does not: the latest-options ref (usePanelMotion) and the lazily made capture API (useDisclosure) are written or
   read during render on purpose, and `_unused` drops a key from a rest spread. Not changed here, to stay identical. */
/** React bindings for the motion layer (motion.ts). Every hook runs in a
 * LAYOUT effect: it pulls the element back to its start frame before the
 * browser paints, so no frame of the end state flashes first. Every hook also
 * cancels on unmount. With motion off, each one leaves the committed render
 * untouched in the same effect, so a test sees the final state synchronously. */
import { useCallback, useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import { captureDisclosure, playDisclosure, type DisclosureSnapshot } from "./disclosure";
import { watchEntrances, type EntranceWatch } from "./entrances";
import { arrive, closePanel, countUp, motionAllowed, openPanel, reenter, slideIndicator, type ArriveOptions, type CountUpOptions, type MotionHandle, type MotionTargets, type PanelSide } from "./motion";
import { exitOnUnmount } from "./presence";

/** atlas-arrive for `ref`, or for the children matching `selector` (staggered),
 * whenever `deps` change. Mount counts as a change. */
export function useArrive(
  ref: RefObject<Element | null>,
  deps: DependencyList,
  opts: ArriveOptions & { selector?: string } = {},
): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const { selector, ...rest } = opts;
    const handle = arrive(selector ? root.querySelectorAll(selector) : root, rest);
    return () => handle.cancel();
    // `deps` IS the dependency list. `opts` is read from the render that triggered the run.
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Count the number rendered inside `ref` up to `value` on mount (from
 * `mountFrom`, default 0, or no count on mount when null), then from the old
 * value to the new one on every change. A non-number value (a "—" placeholder
 * while loading) resets, so the first real number counts up from `mountFrom`. */
export function useCountUp(
  ref: RefObject<Element | null>,
  value: number | null | undefined,
  opts: Omit<CountUpOptions, "from"> & { mountFrom?: number | null } = {},
): void {
  const last = useRef<{ from: number; to: number } | null>(null);
  useLayoutEffect(() => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      last.current = null;
      return;
    }
    const prev = last.current;
    // prev.to === value only when the effect re-runs WITHOUT a change, which is
    // StrictMode's dev double-invoke. Replay the same count rather than dropping it.
    const from = prev === null ? (opts.mountFrom === undefined ? 0 : opts.mountFrom) : prev.to === value ? prev.from : prev.to;
    last.current = { from: from ?? value, to: value };
    if (from === null || from === value) return;
    const { mountFrom: _unused, ...rest } = opts;
    const handle = countUp(ref.current, value, { ...rest, from });
    return () => handle.cancel();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
}

const ACTIVE_TAB = '[aria-selected="true"], [aria-current="page"], [aria-pressed="true"], .active';

/** A sliding pill-tab indicator: whenever `activeKey` changes, `indicatorRef`
 * slides over the active tab inside `containerRef`. By default the active tab
 * is the first `[aria-selected=true]`, `[aria-current=page]`,
 * `[aria-pressed=true]` or `.active`. The first placement and every resize of
 * the strip are instant. */
export function useIndicator(
  containerRef: RefObject<HTMLElement | null>,
  indicatorRef: RefObject<HTMLElement | null>,
  activeKey: unknown,
  opts: { selector?: string } = {},
): void {
  const placed = useRef(false);
  const handle = useRef<MotionHandle | null>(null);
  const selector = opts.selector ?? ACTIVE_TAB;
  const activeTab = () => containerRef.current?.querySelector<HTMLElement>(selector) ?? null;

  useLayoutEffect(() => {
    const target = activeTab();
    if (!indicatorRef.current || !target) return;
    handle.current = slideIndicator(indicatorRef.current, target, { instant: !placed.current });
    placed.current = true;
  }, [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const container = containerRef.current;
    let ro: ResizeObserver | null = null;
    if (container && typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => {
        const target = activeTab();
        if (indicatorRef.current && target) handle.current = slideIndicator(indicatorRef.current, target, { instant: true });
      });
      ro.observe(container);
    }
    return () => {
      ro?.disconnect();
      handle.current?.cancel();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Page entrances (entrances.ts) for the element that hosts the routed page.
 * Returns a callback ref: the watcher starts when that element mounts, which
 * may be later than this hook's first render (the shell mounts after the
 * login gate), and stops when it unmounts. A change of `routeKey` opens a new
 * entrance window for a route change that keeps the same page component.
 * A change of `scopeKey` alone (a workspace or project switch that leaves the
 * route where it is) re-arrives the page with Atlas's work-surface-enter; when
 * the route changes in the same commit, the route change's entrance plays
 * instead, so the page never gets both. */
export function useEntrances(routeKey: unknown, scopeKey?: unknown): (el: HTMLElement | null) => void {
  const watch = useRef<EntranceWatch | null>(null);
  const seen = useRef<{ route: unknown; scope: unknown } | null>(null);
  const attach = useCallback((el: HTMLElement | null) => {
    watch.current?.stop();
    watch.current = el ? watchEntrances(el) : null;
  }, []);
  useLayoutEffect(() => {
    const prev = seen.current;
    seen.current = { route: routeKey, scope: scopeKey };
    // On mount this re-opens the window attach() just opened, which is harmless.
    if (!prev || !Object.is(prev.route, routeKey)) watch.current?.open();
    else if (!Object.is(prev.scope, scopeKey)) watch.current?.reenter();
  }, [routeKey, scopeKey]);
  return attach;
}

/** Sidebar-group motion (disclosure.ts) for the items matching `selector`
 * inside `rootRef`. Call `capture()` right before the state update that opens
 * or closes a group; the commit that follows plays it. A capture is used by
 * the very next commit only, and a commit without one plays nothing. Unmount
 * settles whatever is still moving. */
export function useDisclosure(rootRef: RefObject<HTMLElement | null>, opts: { selector: string; chevron?: string }): { capture(): void } {
  const pending = useRef<DisclosureSnapshot | null>(null);
  const handle = useRef<MotionHandle | null>(null);
  const api = useRef<{ capture(): void } | null>(null);
  api.current ??= {
    capture() {
      pending.current = captureDisclosure(rootRef.current, opts.selector);
    },
  };
  // Every commit: consume the capture, if any. Cancelling what still moves
  // BEFORE measuring puts every item back in its layout slot; the capture
  // already holds where each one was painted, so the new motion starts there.
  useLayoutEffect(() => {
    const snap = pending.current;
    pending.current = null;
    if (!snap) return;
    handle.current?.cancel();
    handle.current = playDisclosure(snap, { chevron: opts.chevron });
  });
  useLayoutEffect(() => () => handle.current?.cancel(), []);
  return api.current;
}

export interface PanelMotionOptions {
  /** How it moves: a sheet's edge, "center" for a dialog, "below"/"above" for
   * a menu or popover (see openPanel). Read when the element mounts, and again
   * when it unmounts. */
  side: PanelSide;
  /** The moving panel, when the element the ref goes on is its backdrop:
   * a selector matched inside it (e.g. ":scope > .overlay-panel"). */
  panel?: string;
  /** "below"/"above": the corner the zoom grows from (see openPanel). */
  origin?: string;
  /** Descendants with a CSS entrance animation of their own (the Overlay
   * body's `.demo-fade`): switched off while this motion is the entrance. */
  retire?: string;
}

/** Switch off a CSS entrance animation the JS motion replaces. Inline, and
 * left in place: removing it later would restart the animation. */
function retireCss(el: HTMLElement): void {
  const cs = getComputedStyle(el);
  const name = cs.getPropertyValue("animation-name");
  // The shorthand too: some engines (jsdom) resolve only that one.
  const short = cs.getPropertyValue("animation");
  if ((name !== "" && name !== "none") || (short !== "" && !/^none\b/.test(short))) el.style.setProperty("animation", "none");
}

/** Open and close motion for an overlay that renders while it is open and
 * unmounts when it closes. Returns a CALLBACK REF for the element that mounts
 * and unmounts (the backdrop, or the panel itself). On mount the panel opens
 * with openPanel (a containing backdrop carries the fade). On unmount React
 * removes it at once, and the close plays on a decorative ghost of it
 * (presence.ts): focus return, state and the accessibility tree are never
 * delayed, and every way of closing it animates, not only its own ✕. With
 * motion off nothing is written, and nothing lingers. The ref is stable, so a
 * re-render never re-runs it. */
export function usePanelMotion(opts: PanelMotionOptions): (root: HTMLElement | null) => (() => void) | undefined {
  const latest = useRef(opts);
  latest.current = opts;
  return useCallback((root: HTMLElement | null) => {
    if (!root) return undefined;
    const o = latest.current;
    const panel = o.panel ? root.querySelector<HTMLElement>(o.panel) : root;
    if (!panel) return undefined;
    const backdrop = panel === root ? null : root;
    let opening: MotionHandle | null = null;
    if (motionAllowed()) {
      // The panel's own CSS entrance (drawerIn, demo-fadein, pageIn) would
      // override the inline frames, or add its slide to this one.
      for (const el of [root, panel, ...(o.retire ? Array.from(root.querySelectorAll<HTMLElement>(o.retire)) : [])]) retireCss(el);
      opening = openPanel(panel, { side: o.side, backdrop, origin: o.origin });
    }
    return () => {
      const c = latest.current;
      exitOnUnmount(root, () => closePanel(panel, { side: c.side, backdrop, origin: c.origin }), opening);
    };
  }, []);
}

/** Atlas's work-surface-enter (reenter) on `targets()` whenever `key` changes
 * while `active` stays true: the same surface, showing the next step. Never on
 * mount, nor when `active` turns true, because the surface's own entrance
 * plays then. A change mid-motion restarts it; unmount settles it. */
export function useReenter(targets: () => MotionTargets, key: unknown, active = true): void {
  useMotionOnChange(() => reenter(targets()), key, active);
}

/** Run `play` (a motion.ts or entrances.ts helper, e.g. swapIn or
 * arriveBlocks) whenever `key` changes while `active` stays true: the same
 * surface turning over its content, a wizard's next step or a filter tab's
 * other list. Never on mount, nor when `active` turns true, because whatever
 * mounts has its own entrance. It runs in the layout effect of the commit
 * that changed `key`, so the new content is pulled to its start frame before
 * it paints. A change mid-motion restarts it; unmount settles it. */
export function useMotionOnChange(play: () => MotionHandle, key: unknown, active = true): void {
  const shown = useRef<{ key: unknown } | null>(null);
  const handle = useRef<MotionHandle | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      shown.current = null;
      return;
    }
    const prev = shown.current;
    shown.current = { key };
    if (!prev || Object.is(prev.key, key)) return;
    handle.current?.cancel();
    handle.current = play();
  }, [key, active]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => handle.current?.cancel(), []);
}
