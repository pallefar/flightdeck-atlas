// MIRROR of FlightDeck OS flightdeck/web/src/motion/motion.ts at commit 745733922e001557b6ff727d25110b8dde7cd3f6
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** The ONE motion layer for the OS, its sub-apps and Studio (owner decision
 * 2026-09-22: "also lets start using animate.js for animations in the app" →
 * Anime.js 4, "Atlas motion, everywhere"). Every JS-driven animation goes
 * through the helpers below; CSS hover/press transitions stay in the
 * stylesheet. README.md next to this file has the rules and the opt-outs.
 *
 * ⛔ ANIMATION IS DECORATION. Markup and CSS always render the FINAL state.
 * A helper may pull an already-rendered element back to a start frame and
 * play it forward, but only when `motionAllowed()` says so. In every other
 * case (reduced motion, jsdom, webdriver, kill switch, hidden tab) it does
 * nothing, or settles the end state synchronously, so a test or an assistive
 * tech user never sees an in-between frame.
 *
 * ⚠ Why the helpers tween plain proxy objects and write `opacity`,
 * `translate` and `scale` themselves instead of handing DOM nodes to
 * anime's `translateY`/`scale`: anime folds those shorthands into the single
 * `transform` property, which would wipe any transform the stylesheet sets
 * (centring, the hover lift) for the length of the animation. The CSS
 * individual transform properties COMPOSE with `transform`, so an entrance
 * never fights the theme. They are also compositor-only, so no animation
 * here triggers layout. */
import { animate, cubicBezier } from "animejs";
import type { EasingFunction } from "animejs";

declare global {
  interface Window {
    /** Kill switch for devtools, e2e harnesses and screenshot scripts:
     * `window.__FD_MOTION_OFF = true` makes every helper settle instantly. */
    __FD_MOTION_OFF?: boolean;
  }
}

/** Atlas's motion language as numbers. Sources are flightdeck-atlas/app files. */
export const MOTION = {
  duration: {
    /** Hover/press/colour transitions: 0.15-0.25s (motion.css:317-322). The theme owns these in CSS. */
    transition: 200,
    /** Card entrance `atlas-arrive` (motion.css:132). */
    arrive: 450,
    /** Page-heading entrance (motion.css:129). */
    arriveHeading: 500,
    /** Surface swap `work-surface-enter` (navigation.css:677). */
    surface: 220,
    /** Panel swap `studio-enter` (work-studio.css:74): Atlas's `.studio-panel`
     * is keyed by its tab (work-studio.tsx:318), so a tab change mounts the
     * next panel, which plays this. The OS plays it on a wizard's next step. */
    swap: 250,
    /** Pill-tab indicator slide (motion.css:74). */
    indicator: 450,
    /** Sidebar group chevron turn (navigation.css:299-301, `transform 0.2s ease`).
     * The OS plays the submenu's unfold and the rows below it over the same
     * 200ms, so the three move as one. */
    disclosure: 200,
    /** Dialog zoom + fade, open and close (components/ui/dialog.tsx:64,
     * `duration-200`). Side panels (drawers, asides) take it too: every Atlas
     * overlay is a Dialog. Its sheet.tsx is imported only by ui/sidebar.tsx,
     * which nothing imports, so no Atlas page ever shows a sheet. */
    dialog: 200,
    /** The dimmed backdrop's fade (dialog.tsx:42, sheet.tsx:39). It has no
     * duration class, so it runs tw-animate-css's default 150ms. */
    backdrop: 150,
    /** Dropdown menu / popover open and close (dropdown-menu.tsx:45,
     * popover.tsx:33): tw-animate-css's default 150ms, `ease`. */
    popover: 150,
    /** Stat count-up. Atlas has none; chosen a little longer than arrive. */
    countUp: 600,
    /** How long after a route change or a page mount content that renders
     * still counts as "first load" and arrives (entrances.ts). Atlas's CSS
     * arrives cards whenever they are inserted; the OS stops after this, or at
     * the first pointer/key input, so a later click never makes content jump. */
    entranceWindow: 1500,
  },
  /** cubic-bezier control points. */
  ease: {
    /** CSS `ease`, which atlas-arrive and the dialog use. */
    standard: [0.25, 0.1, 0.25, 1],
    /** The tab indicator's curve (motion.css:74). The count-up reuses it. */
    emphasized: [0.22, 1, 0.36, 1],
    /** `ease-out`, work-surface-enter. */
    out: [0, 0, 0.58, 1],
  },
  distance: {
    /** atlas-arrive rises this many px (motion.css:147). */
    arrive: 9,
    /** work-surface-enter rises 5px from opacity 0.5 (navigation.css:841-846). */
    surface: 5,
    surfaceOpacity: 0.5,
    /** studio-enter rises 6px from opacity 0 (work-studio.css:415-423). */
    swap: 6,
    /** Dialog starts at 95% (zoom-in-95). Menus and popovers too. */
    dialogScale: 0.95,
    /** A side panel fades in from this many px towards its edge, in the
     * dialog's 200ms: about what zoom-in-95 moves the edges of a 400-500px
     * dialog, without zooming a panel that is pinned to an edge. */
    sheetTravel: 20,
    /** A menu or popover drops in from 8px towards its trigger
     * (slide-in-from-top-2: 2 x the 4px spacing unit). Its exit has no slide. */
    popoverDrop: 8,
    /** A collapsed sidebar group's chevron is turned this far (navigation.css:302-304). */
    chevronTurn: -90,
    /** CSS-owned, listed so the language lives in one place: button lift, card lift, press. */
    buttonLift: 2,
    cardLift: 3,
    pressScale: 0.98,
  },
  stagger: {
    /** 45ms per item, and the 4th item onwards shares the 135ms slot (motion.css:135-143). */
    step: 45,
    maxSteps: 3,
  },
} as const;

const EASE = {
  standard: cubicBezier(...MOTION.ease.standard),
  emphasized: cubicBezier(...MOTION.ease.emphasized),
  out: cubicBezier(...MOTION.ease.out),
};

/** One of MOTION.ease's curves, by name. */
export type MotionEase = keyof typeof MOTION.ease;

const ENV_FLAG = import.meta.env.VITE_FD_MOTION_OFF as string | undefined;
const ENV_OFF = ENV_FLAG === "1" || ENV_FLAG === "true";

/** Can JS motion EVER run in this page? False for the conditions that last
 * the page's whole life: a build with VITE_FD_MOTION_OFF, no DOM, jsdom (no
 * layout, so a frame there is meaningless), webdriver automation (wants stable
 * frames) and a browser without matchMedia. A long-lived watcher uses this to
 * not even start; everything else asks motionAllowed() each time. */
export function motionSupported(): boolean {
  if (ENV_OFF || typeof window === "undefined" || typeof document === "undefined") return false;
  const nav = window.navigator;
  if (nav?.webdriver === true || /jsdom/i.test(nav?.userAgent ?? "")) return false;
  return typeof window.matchMedia === "function";
}

/** May JS motion run right now? False under any HARD-RULE condition. It is
 * evaluated on every call, so flipping the OS setting takes effect on the
 * next animation. */
export function motionAllowed(): boolean {
  if (!motionSupported()) return false;
  if (window.__FD_MOTION_OFF === true) return false;
  // A hidden tab never paints, and anime pauses there, leaving the start frame in place.
  if (document.visibilityState === "hidden") return false;
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** What every helper returns. */
export interface MotionHandle {
  /** Stop now, idempotent, never fires `onDone`. Each helper documents the
   * state it leaves; for all but `slideIndicator` that is the element exactly
   * as the stylesheet renders it. */
  cancel(): void;
  /** Resolves once settled (completed or cancelled). It has already resolved
   * when the helper did nothing. */
  readonly finished: Promise<void>;
}

const SETTLED: MotionHandle = Object.freeze({ cancel() {}, finished: Promise.resolve() });

export type MotionTargets =
  | Element
  | null
  | undefined
  | ArrayLike<Element | null | undefined>
  | Iterable<Element | null | undefined>;

type Styled = HTMLElement | SVGElement;

function toElements(targets: MotionTargets): Styled[] {
  if (!targets) return [];
  const list = targets instanceof Element ? [targets] : Array.from(targets as ArrayLike<Element | null | undefined>);
  // Only elements already in the document: the rule is "animate what is rendered".
  return list.filter((el): el is Styled => (el instanceof HTMLElement || el instanceof SVGElement) && el.isConnected);
}

/** The markup's opt-out: an element carrying `data-motion="static"` is never
 * moved by an entrance (arrive, reenter, swapIn, the page watcher), and
 * neither is anything that contains one, because moving a box carries
 * everything inside it. For a surface that works in its own painted
 * coordinates, such as the Maps editor's React Flow canvas and minimap: it
 * measures its box to map every pointer and to fit the view, and a box
 * caught mid-rise would be measured a few px off. The page around it still
 * arrives (entrances.ts looks through a see-through wrapper around it). */
export const STATIC = '[data-motion="static"]';

/** Is `el` static, or does it hold something that is? */
export function holdsStatic(el: Element): boolean {
  return el.matches(STATIC) || el.querySelector(STATIC) !== null;
}

// ---------------------------------------------------------------------------
// The one driver. It tweens a proxy per element with anime and paints only the
// channels that actually change.

/** `r` is the CSS `rotate` property in degrees. */
type Frame = { opacity: number; x: number; y: number; sx: number; sy: number; r: number };
const REST: Frame = { opacity: 1, x: 0, y: 0, sx: 1, sy: 1, r: 0 };
const frame = (f: Partial<Frame>): Frame => ({ ...REST, ...f });
const OWNED = ["opacity", "translate", "scale", "rotate", "transform-origin"] as const;

interface Drive {
  from: Frame;
  to: Frame;
  unit: "px" | "%";
  duration: number;
  ease: EasingFunction;
  delay?: (index: number) => number;
  /** transform-origin for the length of the motion; the element's own value comes back with restore. */
  origin?: string;
  /** "restore" hands the element back to its stylesheet at the end (entrances);
   * "hold" leaves the `to` frame inline (a closed panel, a placed indicator). */
  end: "restore" | "hold";
  /** What cancel() leaves: the stylesheet's state, or the `to` frame. */
  cancelTo: "restore" | "end";
  onDone?: () => void;
}

interface Running {
  handle: MotionHandle;
  /** The first element's frame as last painted, for interrupting mid-flight. */
  current(): Frame;
  /** The unit its x/y are in, so an interruption only continues a compatible frame. */
  unit: "px" | "%";
}

/** At most one drive per element. A new one cancels the old one FIRST, so it
 * never records the old one's half-way inline values as "original" and puts
 * them back later, which would leave the element stuck half-faded. */
const active = new WeakMap<Styled, Running>();

/** An element's OWN inline values, kept while a finished "hold" motion (a
 * closed panel) still has its end frame inline. A panel that stays mounted and
 * reopens must restore these, not the held closed frame, or it would slide in
 * and then snap back off-screen. */
const held = new WeakMap<Styled, string[]>();

function drive(els: Styled[], d: Drive): Running {
  for (const el of els) active.get(el)?.handle.cancel();
  // A channel is painted when it changes, and also when it holds still off the
  // rest frame: a close that interrupts an open which has not painted a frame
  // yet starts AT its end frame, and must still show it, not the open panel.
  const off = (k: keyof Frame) => d.from[k] !== d.to[k] || d.from[k] !== REST[k];
  const moves = off("x") || off("y");
  const scales = off("sx") || off("sy");
  const fades = off("opacity");
  const turns = off("r");
  const saved = els.map((el) => held.get(el) ?? OWNED.map((p) => el.style.getPropertyValue(p)));
  const proxies = els.map(() => ({ ...d.from }));
  if (d.origin !== undefined) for (const el of els) el.style.setProperty("transform-origin", d.origin);

  const paint = () => {
    proxies.forEach((f, i) => {
      const s = els[i]!.style;
      if (fades) s.setProperty("opacity", String(f.opacity));
      if (moves) s.setProperty("translate", `${f.x}${d.unit} ${f.y}${d.unit}`);
      if (scales) s.setProperty("scale", `${f.sx} ${f.sy}`);
      if (turns) s.setProperty("rotate", `${f.r}deg`);
    });
  };
  const restore = () => {
    els.forEach((el, i) => {
      held.delete(el);
      OWNED.forEach((p, j) => {
        const v = saved[i]![j]!;
        if (v) el.style.setProperty(p, v);
        else el.style.removeProperty(p);
      });
      if (el.getAttribute("style") === "") el.removeAttribute("style");
    });
  };

  let done = false;
  let running: Running | null = null;
  let resolve: () => void = () => {};
  const finished = new Promise<void>((r) => (resolve = r));
  const release = () => {
    for (const el of els) if (active.get(el) === running) active.delete(el);
    resolve();
  };

  const to: Partial<Frame> = {};
  if (fades) to.opacity = d.to.opacity;
  if (moves) Object.assign(to, { x: d.to.x, y: d.to.y });
  if (scales) Object.assign(to, { sx: d.to.sx, sy: d.to.sy });
  if (turns) to.r = d.to.r;

  paint(); // the start frame, synchronously: no paint of the end state in between
  const delay = d.delay;
  const anim = animate(proxies, {
    ...to,
    duration: Math.max(1, d.duration),
    ease: d.ease,
    delay: delay ? (_target?: unknown, i?: number) => delay(i ?? 0) : 0,
    onRender: paint,
    onComplete: () => {
      if (done) return;
      done = true;
      if (d.end === "restore") restore();
      else els.forEach((el, i) => held.set(el, saved[i]!));
      release();
      d.onDone?.();
    },
  });

  const handle: MotionHandle = {
    finished,
    cancel() {
      if (done) return;
      done = true;
      anim.cancel();
      if (d.cancelTo === "restore") restore();
      else {
        proxies.forEach((f) => Object.assign(f, d.to));
        paint();
      }
      release();
    },
  };
  const r: Running = { handle, current: () => ({ ...(proxies[0] ?? d.to) }), unit: d.unit };
  running = r;
  for (const el of els) active.set(el, r);
  return r;
}

function both(a: MotionHandle, b: MotionHandle): MotionHandle {
  return {
    finished: Promise.all([a.finished, b.finished]).then(() => undefined),
    cancel() {
      a.cancel();
      b.cancel();
    },
  };
}

// ---------------------------------------------------------------------------
// Public helpers

export interface ArriveOptions {
  /** Rise in px. Default 9, from atlas-arrive. */
  distance?: number;
  /** Start opacity. Default 0. work-surface-enter uses 0.5. */
  fromOpacity?: number;
  /** Default 450ms. */
  duration?: number;
  /** Per-item delay in ms. Default 45, capped at MOTION.stagger.maxSteps steps. */
  stagger?: number;
  /** Extra delay in ms before every item, on top of its stagger. Default 0.
   * Lets several arrive() calls share one stagger sequence. */
  delay?: number;
  /** Default "standard" (CSS `ease`, as atlas-arrive). */
  ease?: MotionEase;
}

/** Atlas `atlas-arrive`: rendered elements rise 9px while fading in, with
 * a stagger. Ends with the elements handed back to the stylesheet (no inline
 * residue). cancel() does the same. A static element, or one holding one
 * (STATIC), is left where it is. */
export function arrive(targets: MotionTargets, opts: ArriveOptions = {}): MotionHandle {
  const els = toElements(targets).filter((el) => !holdsStatic(el));
  if (els.length === 0 || !motionAllowed()) return SETTLED;
  const step = opts.stagger ?? MOTION.stagger.step;
  const base = Math.max(0, opts.delay ?? 0);
  return drive(els, {
    from: frame({ opacity: opts.fromOpacity ?? 0, y: opts.distance ?? MOTION.distance.arrive }),
    to: REST,
    unit: "px",
    duration: opts.duration ?? MOTION.duration.arrive,
    ease: EASE[opts.ease ?? "standard"],
    delay: (i) => base + Math.min(i, MOTION.stagger.maxSteps) * step,
    end: "restore",
    cancelTo: "restore",
  }).handle;
}

/** Atlas `work-surface-enter` (navigation.css:677, 841-846), which Atlas plays
 * on `.management-surface` when it re-keys on a project switch: opacity 0.5 to
 * 1 while rising 5px, 220ms ease-out, everything as one unit. Subtler than
 * arrive(), because the page is not new, only its context. Ends handed back to
 * the stylesheet. */
export function reenter(targets: MotionTargets): MotionHandle {
  return arrive(targets, {
    distance: MOTION.distance.surface,
    fromOpacity: MOTION.distance.surfaceOpacity,
    duration: MOTION.duration.surface,
    stagger: 0,
    ease: "out",
  });
}

/** Atlas `studio-enter` (work-studio.css:74, 415-423), which Atlas plays on
 * the panel a tab change mounts: opacity 0 to 1 while rising 6px, 250ms
 * `ease`, everything as one unit. For the content that replaces the last
 * step of a wizard. Ends handed back to the stylesheet. */
export function swapIn(targets: MotionTargets): MotionHandle {
  return arrive(targets, {
    distance: MOTION.distance.swap,
    duration: MOTION.duration.swap,
    stagger: 0,
  });
}

/** Does the stylesheet already transition the rotation of this element, or of
 * anything inside it (an icon: `.navchevron svg`)? Then CSS plays the turn and
 * a JS turn on top would add to it, 180° for a 90° change. */
function cssTurns(el: Styled): boolean {
  return [el, ...Array.from(el.querySelectorAll("*"))].some((node) => {
    const cs = getComputedStyle(node);
    const props = (cs.getPropertyValue("transition-property") || "").split(",").map((p) => p.trim());
    const durations = (cs.getPropertyValue("transition-duration") || "").split(",").map((d) => parseFloat(d) || 0);
    return props.some((p, i) => (p === "all" || p === "transform" || p === "rotate") && (durations[i % Math.max(1, durations.length)] ?? 0) > 0);
  });
}

/** Atlas's sidebar group chevron (navigation.css:299-304): it turns over 200ms
 * `ease` when its group opens or closes. The markup already shows the NEW
 * orientation (with motion off that is the whole story); this plays the turn
 * into it, from `fromDeg` (the old orientation minus the new one: -90 for a
 * chevron whose group just opened, +90 for one that just closed) to 0. A turn
 * interrupted mid-way continues from where it is painted. Skipped when the
 * stylesheet transitions the rotation itself, on the chevron or on an icon
 * inside it. Ends handed back to the stylesheet. */
export function turn(el: Element | null | undefined, fromDeg: number, opts: { duration?: number } = {}): MotionHandle {
  const target = toElements(el)[0];
  if (!target || !motionAllowed() || cssTurns(target)) return SETTLED;
  const from = (active.get(target)?.current().r ?? 0) + fromDeg;
  if (from === 0) return SETTLED;
  return drive([target], {
    from: frame({ r: from }),
    to: REST,
    unit: "px",
    duration: opts.duration ?? MOTION.duration.disclosure,
    ease: EASE.standard,
    end: "restore",
    cancelTo: "restore",
  }).handle;
}

/** A block that has just become visible unfolds from its top edge: scaleY 0 to
 * 1 while fading in, travelling `fromY` px with the header above it when that
 * header moved too. Paired with glide() on everything below it, this reads as
 * a height animation without animating height, which would re-lay out the
 * page on every frame. Ends handed back to the stylesheet. */
export function unfold(el: Element | null | undefined, opts: { fromY?: number; duration?: number } = {}): MotionHandle {
  const target = toElements(el)[0];
  if (!target || !motionAllowed()) return SETTLED;
  return drive([target], {
    from: frame({ opacity: 0, sy: 0, y: opts.fromY ?? 0 }),
    to: REST,
    unit: "px",
    origin: "50% 0",
    duration: opts.duration ?? MOTION.duration.disclosure,
    ease: EASE.standard,
    end: "restore",
    cancelTo: "restore",
  }).handle;
}

/** FLIP: an element whose layout slot just moved glides from where it was
 * painted to where it now is. `fromY` is old top minus new top, in px.
 * Translate only. Ends handed back to the stylesheet. */
export function glide(targets: MotionTargets, fromY: number, opts: { duration?: number } = {}): MotionHandle {
  const els = toElements(targets);
  if (els.length === 0 || fromY === 0 || !motionAllowed()) return SETTLED;
  return drive(els, {
    from: frame({ y: fromY }),
    to: REST,
    unit: "px",
    duration: opts.duration ?? MOTION.duration.disclosure,
    ease: EASE.standard,
    end: "restore",
    cancelTo: "restore",
  }).handle;
}

/** Several handles as one: settles when all have, cancels all. */
export function allOf(handles: MotionHandle[]): MotionHandle {
  const live = handles.filter((h) => h !== SETTLED);
  if (live.length === 0) return SETTLED;
  if (live.length === 1) return live[0]!;
  return {
    finished: Promise.all(live.map((h) => h.finished)).then(() => undefined),
    cancel() {
      for (const h of live) h.cancel();
    },
  };
}

export type PanelSide = "right" | "left" | "top" | "bottom" | "center" | "below" | "above";

export interface PanelOptions {
  /** Which edge a side panel comes in from (fade + a 20px travel, in Atlas's
   * dialog timing); "center" for a dialog (fade + 95% zoom);
   * "below" / "above" for a menu or popover that opens under / over its
   * trigger (fade + 95% zoom + an 8px drop, Atlas dropdown-menu.tsx:45).
   * Default "right". */
  side?: PanelSide;
  /** The dimmed backdrop, faded in 150ms as Atlas's is. A backdrop that
   * CONTAINS the panel (the OS Overlay renders the panel inside it) cannot
   * fade on its own: its opacity multiplies into the panel. It then carries
   * the panel's fade instead, and the panel only moves. */
  backdrop?: Element | null;
  /** "below" / "above": the corner the zoom grows from, nearest the trigger,
   * as a transform-origin in % or px (e.g. "100% 0" for a right-aligned
   * menu). Default: the middle of the edge that faces the trigger. */
  origin?: string;
}

/** Where a panel can zoom from without drifting, or null for "no zoom".
 * The `scale` property applies ON TOP of the stylesheet's `transform`, so
 * around the default origin a dialog centred with translate(-50%, -50%) slides
 * towards a corner while it grows (measured in Chrome: 9px x 4.5px on a
 * 360x180 box). For a pure translation the fix is exact: move the origin by
 * the same translation. A translation is origin-independent, so the
 * stylesheet's own transform is unaffected. Any other transform gets no zoom.
 * "" means the element's own origin already is the wanted one. */
function zoomOrigin(el: Styled, want = "50% 50%"): string | null {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return want === "50% 50%" ? "" : want;
  const m = /^matrix\(1, 0, 0, 1, (-?[\d.e+-]+), (-?[\d.e+-]+)\)$/.exec(t);
  if (!m || !(el instanceof HTMLElement)) return null;
  const [ox = "50%", oy = "50%"] = want.trim().split(/\s+/);
  const at = (v: string, size: number) => (v.endsWith("%") ? (parseFloat(v) / 100) * size : parseFloat(v) || 0);
  return `${at(ox, el.offsetWidth) + Number(m[1])}px ${at(oy, el.offsetHeight) + Number(m[2])}px`;
}

interface PanelMotion {
  /** The frame an opening panel starts from. */
  enter: Frame;
  /** The frame a closing panel ends on. Differs from `enter` for a popover,
   * whose exit has no slide. */
  exit: Frame;
  unit: "px" | "%";
  open: number;
  close: number;
  ease: EasingFunction;
  origin?: string;
}

/** `carried`: a containing backdrop does the fading, so the panel's own
 * frames leave opacity alone. */
function panelMotion(side: PanelSide, el: Styled, carried: boolean, want?: string): PanelMotion {
  const s = MOTION.distance.dialogScale;
  const o = carried ? 1 : 0;
  if (side === "center" || side === "below" || side === "above") {
    const pop = side !== "center";
    const origin = zoomOrigin(el, want ?? (side === "below" ? "50% 0" : side === "above" ? "50% 100%" : "50% 50%"));
    const zoom = origin === null ? {} : { sx: s, sy: s };
    const drop = side === "below" ? -MOTION.distance.popoverDrop : side === "above" ? MOTION.distance.popoverDrop : 0;
    const d = pop ? MOTION.duration.popover : MOTION.duration.dialog;
    return {
      enter: frame({ opacity: o, ...zoom, y: drop }),
      exit: frame({ opacity: o, ...zoom }),
      unit: "px",
      open: d,
      close: d,
      ease: EASE.standard,
      ...(origin ? { origin } : {}),
    };
  }
  // A side panel: Atlas's dialog timing and fade, with a short travel from its edge instead of the zoom.
  const t = MOTION.distance.sheetTravel;
  const offset = { right: { x: t }, left: { x: -t }, bottom: { y: t }, top: { y: -t } }[side];
  const d = MOTION.duration.dialog;
  return { enter: frame({ opacity: o, ...offset }), exit: frame({ opacity: o, ...offset }), unit: "px", open: d, close: d, ease: EASE.standard };
}

function backdropOf(opts: PanelOptions, panel: Styled): { el: Styled; carries: boolean } | null {
  const b = toElements(opts.backdrop)[0];
  return b && b !== panel ? { el: b, carries: b.contains(panel) } : null;
}

/** The frame `el` is painted at if a compatible motion is moving it, so an
 * interrupting one continues from there instead of jumping. */
function paintedFrame(el: Styled, unit: "px" | "%"): Frame | null {
  const r = active.get(el);
  return r && r.unit === unit ? r.current() : null;
}

/** Fade a side panel in from its edge, zoom a dialog in, or drop a popover open.
 * Ends, and cancels, to the stylesheet's state. */
export function openPanel(el: Element | null | undefined, opts: PanelOptions = {}): MotionHandle {
  const panel = toElements(el)[0];
  if (!panel || !motionAllowed()) return SETTLED;
  const backdrop = backdropOf(opts, panel);
  const m = panelMotion(opts.side ?? "right", panel, backdrop?.carries ?? false, opts.origin);
  const main = drive([panel], { from: m.enter, to: REST, unit: m.unit, duration: m.open, ease: m.ease, origin: m.origin, end: "restore", cancelTo: "restore" }).handle;
  if (!backdrop) return main;
  // A carried panel fades with its backdrop, so the backdrop takes the
  // panel's own duration; a sibling backdrop fades in its own 150ms.
  const duration = backdrop.carries ? m.open : MOTION.duration.backdrop;
  const fade = drive([backdrop.el], { from: frame({ opacity: 0 }), to: REST, unit: "px", duration, ease: EASE.standard, end: "restore", cancelTo: "restore" }).handle;
  return both(main, fade);
}

/** The reverse of openPanel. `onDone` is where the caller unmounts: it runs
 * SYNCHRONOUSLY when motion is off, so a close click is still instant in tests.
 * With motion on, the panel holds its closed frame until unmounted, which
 * avoids a frame of the open panel flashing between the end and the unmount.
 * A close that interrupts an opening panel starts where it is painted.
 * cancel() restores the open panel and skips `onDone`. For a component that
 * unmounts at once and lets the close play afterwards, see presence.ts. */
export function closePanel(el: Element | null | undefined, opts: PanelOptions & { onDone?: () => void } = {}): MotionHandle {
  const panel = toElements(el)[0];
  if (!panel || !motionAllowed()) {
    opts.onDone?.();
    return SETTLED;
  }
  const backdrop = backdropOf(opts, panel);
  const m = panelMotion(opts.side ?? "right", panel, backdrop?.carries ?? false, opts.origin);
  // A carried panel fades out with its backdrop over its whole exit. A
  // sibling backdrop takes 150ms.
  const fadeFor = backdrop?.carries ? m.close : Math.min(MOTION.duration.backdrop, m.close);
  const fade = backdrop
    ? drive([backdrop.el], { from: paintedFrame(backdrop.el, "px") ?? REST, to: frame({ opacity: 0 }), unit: "px", duration: fadeFor, ease: EASE.standard, end: "hold", cancelTo: "restore" }).handle
    : SETTLED;
  const main = drive([panel], { from: paintedFrame(panel, m.unit) ?? REST, to: m.exit, unit: m.unit, duration: m.close, ease: m.ease, origin: m.origin, end: "hold", cancelTo: "restore", onDone: opts.onDone }).handle;
  return backdrop ? both(main, fade) : main;
}

/** Last settled geometry per indicator: where it was sent and how wide it is. */
const indicatorAt = new WeakMap<HTMLElement, { x: number; w: number }>();

/** Move a pill-tab indicator over `target` (Atlas: 450ms on the emphasized
 * curve). Both must share an offsetParent, the positioned tab strip. The first
 * call for an indicator, `instant`, and motion-off all place it at once.
 * Interrupting mid-slide continues from where it is. The inline translate and
 * width ARE the indicator's position, so they stay; cancel() jumps to the
 * target. Width is written once per call, never animated: a width change is
 * played as a scaleX from the left edge. */
export function slideIndicator(indicator: HTMLElement | null | undefined, target: HTMLElement | null | undefined, opts: { instant?: boolean } = {}): MotionHandle {
  if (!indicator || !target) return SETTLED;
  // offsetLeft ignores transforms, so these are layout slots, not painted positions.
  const x = target.offsetLeft - indicator.offsetLeft;
  const w = target.offsetWidth;
  const prev = indicatorAt.get(indicator);
  const running = active.get(indicator);
  const cur = running?.current();
  const fromX = cur ? cur.x : prev?.x;
  const fromW = cur && prev ? prev.w * cur.sx : prev?.w;
  indicatorAt.set(indicator, { x, w });
  indicator.style.width = `${w}px`;
  const place = () => {
    running?.handle.cancel();
    indicator.style.setProperty("translate", `${x}px 0px`);
    indicator.style.removeProperty("scale");
  };
  if (opts.instant || fromX === undefined || fromW === undefined || w <= 0 || !motionAllowed() || (fromX === x && fromW === w)) {
    place();
    return SETTLED;
  }
  return drive([indicator], {
    from: frame({ x: fromX, sx: fromW / w }),
    to: frame({ x }),
    unit: "px",
    origin: "0 50%",
    duration: MOTION.duration.indicator,
    ease: EASE.emphasized,
    end: "hold",
    cancelTo: "end",
  }).handle;
}

export interface CountUpOptions {
  /** Start value. Default 0. */
  from?: number;
  /** Default 600ms. */
  duration?: number;
  /** Formats the number part only, e.g. `(n) => n.toLocaleString("de-DE")`.
   * It gets values rounded to the target's decimals and must reproduce the
   * rendered number for `to` exactly, or nothing animates. Leave it out and the
   * helper finds the plain or locale format that reproduces it. */
  format?: (n: number) => string;
}

const NUMBER = /[-−]?\d(?:[\d.,'’  ]*\d)?/;

function numericTextNode(el: Element): Text | null {
  const walk = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/\d/.test((n as Text).data)) return n as Text;
  return null;
}

function decimalsOf(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i < 0 || /e/i.test(s) ? 0 : Math.min(s.length - i - 1, 6);
}

const roundTo = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f || 0; // `|| 0` folds -0, which Intl prints as "-0"
};

/** A formatter that reproduces `token` for `to`, or null. */
function matchFormat(token: string, to: number, el: Element, custom?: (n: number) => string): ((n: number) => string) | null {
  if (custom) {
    const d = decimalsOf(to);
    return custom(roundTo(to, d)) === token ? (n) => custom(roundTo(n, d)) : null;
  }
  const lang = el.closest("[lang]")?.getAttribute("lang") || undefined;
  const locales = [...new Set([undefined, lang, "en-US", "de-DE"])];
  const shapes: Array<(n: number, d: number) => string> = [
    (n, d) => n.toFixed(d),
    ...locales.map((loc) => (n: number, d: number) => n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d })),
  ];
  for (let d = 0; d <= 3; d++) {
    for (const shape of shapes) {
      try {
        if (shape(roundTo(to, d), d) === token) return (n) => shape(roundTo(n, d), d);
      } catch {
        // A malformed lang="" tag makes Intl throw; that shape just doesn't match.
      }
    }
  }
  return null;
}

const counting = new WeakMap<Element, MotionHandle>();

/** Count a rendered number up from `from` to `to`. It animates only the text
 * node holding the number, and only when a formatter reproduces the rendered
 * number exactly, so the final text is byte-identical to the render. When
 * anyone else, such as React with a new value, writes that text mid-count, the
 * count stops and leaves their text. cancel() restores the rendered text. */
export function countUp(el: Element | null | undefined, to: number, opts: CountUpOptions = {}): MotionHandle {
  const from = opts.from ?? 0;
  if (!el || !Number.isFinite(to) || !Number.isFinite(from) || from === to) return SETTLED;
  if (!motionAllowed() || typeof MutationObserver !== "function") return SETTLED;
  counting.get(el)?.cancel();
  const node = numericTextNode(el);
  const original = node?.data ?? "";
  const m = NUMBER.exec(original);
  if (!node || !m) return SETTLED;
  const fmt = matchFormat(m[0], to, el, opts.format);
  if (!fmt) return SETTLED;
  const prefix = original.slice(0, m.index);
  const suffix = original.slice(m.index + m[0].length);
  const parent = node.parentNode;

  // Watch OUR text node only, and drain the records of our own writes right
  // after each one. Any record left over is somebody else, e.g. React
  // committing a new value or a language switch, writing this node. A mutation
  // record is queued even when the written text is identical, so a new value
  // that happens to equal an in-between frame is still seen. Changes elsewhere
  // in `el`, such as a label beside the number, are not ours to react to.
  // ⚠ The observer hands pending records to its callback in a MICROTASK, long
  // before the next animation frame. takeRecords() alone would then find
  // nothing, so the callback has to remember too.
  let theirs = false;
  const note = (records: MutationRecord[]) => {
    if (records.some((r) => r.type === "characterData") || node.parentNode !== parent) theirs = true;
  };
  const watch = new MutationObserver(note);
  watch.observe(node, { characterData: true });
  if (parent) watch.observe(parent, { childList: true });
  const foreign = () => {
    note(watch.takeRecords());
    return theirs;
  };

  const proxy = { v: from };
  let done = false;
  let anim: ReturnType<typeof animate> | null = null;
  let handle: MotionHandle | null = null;
  let resolve: () => void = () => {};
  const finished = new Promise<void>((r) => (resolve = r));

  const stop = (restore: boolean) => {
    if (done) return;
    done = true;
    anim?.cancel();
    const overwritten = foreign();
    watch.disconnect();
    if (restore && !overwritten && node.data !== original) node.data = original;
    if (counting.get(el) === handle) counting.delete(el);
    resolve();
  };
  const write = () => {
    if (done) return;
    if (foreign()) return stop(false);
    node.data = prefix + fmt(proxy.v) + suffix;
    watch.takeRecords();
  };

  handle = { finished, cancel: () => stop(true) };
  counting.set(el, handle);
  write(); // the start number, synchronously
  anim = animate(proxy, {
    v: to,
    duration: Math.max(1, opts.duration ?? MOTION.duration.countUp),
    ease: EASE.emphasized,
    onRender: write,
    onComplete: () => stop(true),
  });
  return handle;
}
