// MIRROR of FlightDeck OS flightdeck/web/src/motion/entrances.ts at commit 745733922e001557b6ff727d25110b8dde7cd3f6
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** Page entrances: Atlas's `atlas-arrive` (motion.css:125-150) for every
 * console page, on a route change and on first load. ONE watcher sits on the
 * element that hosts the routed page (App.tsx's `.main-col` and the
 * standalone shell), so no page carries its own entrance code.
 *
 * WHAT ARRIVES is what Atlas arrives, and nothing more. Atlas moves only
 * `.dashboard > .page-heading` (500ms) and `.project-grid > .project-card`
 * (450ms, staggered 45ms, the 4th onwards sharing the 135ms slot); its
 * metrics strip, notices and filter bar are drawn in place from the first
 * frame. Among the direct children of `.page`:
 *   - the page heading (`.pagehead`, or a `<header>`) arrives like Atlas's
 *     `.page-heading`; a stat row inside it stays in place;
 *   - a card grid (`.cards`, `.applaunch`, `.dash-widgets`) arrives ITEM BY
 *     ITEM, each card taking the next stagger slot, like Atlas's project cards;
 *   - everything else (a stat row, a notice, a tab bar, a table, a form, any
 *     other block) renders in place.
 * A wrapper with no visible box of its own is looked through for a heading
 * or a card grid. A box that is visible (a card, a panel) stays in place with
 * everything inside it, so no frame stands still while its content rises.
 *
 * WHEN. Whatever is on the page when the watcher starts, when a new `.page`
 * is inserted (a route change) or when the route key changes, arrives. So
 * does content inserted during the following MOTION.duration.entranceWindow:
 * that is "first load", the cards a page renders once its fetch answers.
 * The window closes at the first pointer or key input, which also settles
 * anything still moving, so a click never lands on a moving target and
 * nothing a user action reveals later jumps.
 *
 * WHAT IS LEFT ALONE: an element with its own CSS animation (inline styles
 * cannot beat a running CSS animation, so the two would fight), a fixed or
 * absolutely positioned element, a unit that starts below the fold (nobody
 * would see it move), and anything holding an open overlay: a
 * moving ancestor is a containing block for `position: fixed`, which would
 * pin the overlay inside the arriving box for the length of the motion.
 *
 * A static surface (motion.ts STATIC, `data-motion="static"`) never moves:
 * it is no unit, a card holding one stays put with it, and a page that
 * re-arrives as a whole (a workspace switch) moves in its parts around it.
 *
 * A TAB SWITCH swaps the panel, as Atlas's studio tabs do: Atlas re-keys
 * `.studio-panel` on a tab change (work-studio.tsx:318), so the new panel
 * plays `studio-enter`. When a click on a button of a page's tab bar (`.tabs`,
 * or Settings' `.setnav`) replaces what the blocks after the bar show (the
 * old tab's content leaves, the new tab's comes), those blocks swap in as one
 * unit (motion.ts swapIn: 6px, 250ms) before the new content paints. The bar
 * itself and everything above it stay. A click that replaces nothing below the
 * bar plays nothing: not the tab already shown, not one that only adds a line
 * beside the bar (Ops' "refreshing…"), and not content that lands after the
 * click's frame (a fetch answering). A bar whose component plays its own
 * motion for the switch (Sign's filter tabs and wizard steps) carries
 * OWN_MOTION and is left to it. No page carries code for this.
 *
 * A VIEW CHANGE is a route change too. A sub-app that switches views on a
 * query parameter while its `.page` element stays (Advantage's `?focus=`,
 * `?cycle=`) names the view in `data-motion-view` on that `.page`. When the
 * value changes, the page arrives as if it were new and a new window opens,
 * so what the new view's fetches render arrives as well.
 *
 * `.page` itself keeps its stylesheet `pageIn` animation whenever this layer
 * does not run (reduced motion, automation, the kill switch). When it does
 * run, it switches `pageIn` off on that one page with an inline
 * `animation: none` before the first paint: the page rising as a whole
 * would move everything Atlas draws in place, and double every movement of
 * its arriving heading and cards. */
import { MOTION, allOf, arrive, holdsStatic, motionAllowed, motionSupported, reenter, STATIC, swapIn, type MotionHandle } from "./motion";
import { GHOST_ATTR } from "./presence";

/** Names a page's current view (see the file comment). */
export const VIEW_ATTR = "data-motion-view";

const PAGE = ".page";
/** The page heading: `.pagehead` on the console pages, a `<header>` in a
 * sub-app (Advantage's). */
const HEADING = ".pagehead, header";
/** Card grids: their cards arrive one by one. All pre-existing classes;
 * `.dash-widgets` is the Dashboard's and custom pages' widget grid. */
const CARDS = ".cards, .applaunch, .dash-widgets";
/** What a filter tab brings in card by card (arriveBlocks): the card grids,
 * and a `.stack` list of rows (Sign's envelopes). */
const FILTER_LISTS = `${CARDS}, .stack`;
/** Stays in place even inside an arriving heading, as Atlas's metrics do. */
const STILL = ".statrow";
/** A page's tab bar: its buttons switch what the blocks after it show. */
const TAB_BAR = ".tabs, .setnav";
/** A tab bar whose component plays its own motion when it switches
 * (arriveBlocks, swapIn): the watcher's panel swap leaves it alone. */
export const OWN_MOTION = '[data-motion="own"]';
/** An open overlay: the Overlay component's roots (App.tsx's Esc handler asks
 * the same question with the same classes) or any ARIA dialog. */
const OVERLAY = '.overlay-backdrop, .overlay-aside, [role="dialog"], [aria-modal="true"]';

export interface EntranceUnit {
  el: HTMLElement;
  /** Stagger slot. Units sharing a slot move together, as one. */
  slot: number;
  /** The page heading or part of it (not a stat tile inside it): arrives over
   * MOTION.duration.arriveHeading. */
  heading: boolean;
}

/** No background, border or shadow of its own: moving its children one by one
 * looks exactly like moving it. */
function seeThrough(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const clear = (c: string) => c === "" || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const noBorder = (["Top", "Right", "Bottom", "Left"] as const).every((side) => {
    const width = cs.getPropertyValue(`border-${side.toLowerCase()}-width`);
    const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
    return style === "" || style === "none" || style === "hidden" || width === "" || parseFloat(width) === 0;
  });
  const bgImage = cs.getPropertyValue("background-image");
  const shadow = cs.getPropertyValue("box-shadow");
  return clear(cs.getPropertyValue("background-color")) && (bgImage === "" || bgImage === "none") && (shadow === "" || shadow === "none") && noBorder;
}

/** Elements that paint nothing of their own: never a unit, never a stagger slot. */
const UNPAINTED = "style, script, template";

const elementsOf = (el: Element): HTMLElement[] => Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !c.matches(UNPAINTED));

/** Every unit of `page` in document order, with its slot. See the file comment
 * for the rules. Exported for the tests. */
export function entranceUnits(page: Element): EntranceUnit[] {
  return blockUnits(elementsOf(page));
}

/** The units of a run of sibling blocks, by the same rules as a page's
 * children: the heading, and the items of every `lists` container (by
 * default the card grids). `entranceUnits` is this over a page's children;
 * `arriveBlocks` uses it, with FILTER_LISTS, for the part of a page below a
 * filter tab bar. */
export function blockUnits(blocks: HTMLElement[], lists: string = CARDS): EntranceUnit[] {
  const units: EntranceUnit[] = [];
  let next = 0;
  /** `heading`: the slot of the heading being visited, or null outside one. */
  const visit = (children: HTMLElement[], heading: number | null) => {
    for (const child of children) {
      if (child.matches(STATIC)) continue;
      const inHeading = heading !== null || child.matches(HEADING);
      if (child.matches(lists) && seeThrough(child)) {
        for (const item of elementsOf(child)) if (!holdsStatic(item)) units.push({ el: item, slot: next++, heading: false });
      } else if (inHeading && child.matches(STILL)) {
        continue;
      } else if (seeThrough(child) && (child.querySelector(lists) || child.querySelector(HEADING) || (inHeading && (child.querySelector(STILL) || child.querySelector(STATIC))))) {
        // Looked through: a heading's parts share its slot, so they move as the heading would.
        visit(elementsOf(child), inHeading ? (heading ?? next++) : null);
      } else if (inHeading && !holdsStatic(child)) {
        units.push({ el: child, slot: heading ?? next++, heading: true });
      }
      // else: it renders in place. A visible box holding a static surface stays put, surface and all.
    }
  };
  visit(blocks, null);
  return units;
}

/** The parts of `el` that can move around the static surface it holds: each
 * child that holds none, looking through a see-through child that does. A
 * visible box holding one stays put with it. For a page re-arriving as a
 * whole (reenter), which moves every part, not only Atlas's arrivals. */
function partsAround(el: Element): HTMLElement[] {
  const parts: HTMLElement[] = [];
  for (const child of elementsOf(el)) {
    if (!holdsStatic(child)) parts.push(child);
    else if (!child.matches(STATIC) && seeThrough(child)) parts.push(...partsAround(child));
  }
  return parts;
}

export interface EntranceStep {
  els: HTMLElement[];
  /** ms before these start: their slot's place in Atlas's stagger. */
  delay: number;
  duration: number;
}

/** The arrive() calls for a batch of units. Slots are renumbered from 0, so a
 * batch that lands after the heading (a fetch answering) starts at once
 * instead of inheriting the capped 135ms of its place on the page. Slot n
 * waits min(n, 3) x 45ms, as Atlas's nth-child delays do; the heading takes
 * 500ms, everything else 450ms. Exported for the tests. */
export function planEntrance(units: EntranceUnit[]): EntranceStep[] {
  const slots = [...new Set(units.map((u) => u.slot))].sort((a, b) => a - b);
  const steps = new Map<string, EntranceStep>();
  for (const u of units) {
    const delay = Math.min(slots.indexOf(u.slot), MOTION.stagger.maxSteps) * MOTION.stagger.step;
    const duration = u.heading ? MOTION.duration.arriveHeading : MOTION.duration.arrive;
    const key = `${delay}:${duration}`;
    const step = steps.get(key) ?? { els: [], delay, duration };
    step.els.push(u.el);
    steps.set(key, step);
  }
  return [...steps.values()];
}

/** May this unit be moved without fighting something else? */
function movable(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const animation = cs.getPropertyValue("animation-name");
  if (animation !== "" && animation !== "none") return false;
  // A fixed or absolute box is placed against something else, not the flow the
  // page arrives in (a FAB, a floating toolbar); moving it would read as a jump.
  const position = cs.getPropertyValue("position");
  if (position === "fixed" || position === "absolute") return false;
  return !el.matches(OVERLAY) && el.querySelector(OVERLAY) === null;
}

/** Start the arrive() calls for `units`, leaving out what must not move and
 * what starts below the fold: nobody sees it arrive, so a long list costs no
 * per-frame work. All reads happen here, before any write. */
function arriveUnits(units: EntranceUnit[]): MotionHandle[] {
  const fold = units[0]?.el.ownerDocument.defaultView?.innerHeight ?? Infinity;
  const ready = units.filter((u) => u.el.isConnected && movable(u.el) && u.el.getBoundingClientRect().top < fold);
  return planEntrance(ready).map((step) => arrive(step.els, { delay: step.delay, stagger: 0, duration: step.duration }));
}

/** The element siblings after `el`, in order: what a tab or step bar shows below it. */
export function siblingsAfter(el: Element | null | undefined): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let n = el?.nextElementSibling ?? null; n; n = n.nextElementSibling) if (n instanceof HTMLElement && !n.matches(UNPAINTED)) out.push(n);
  return out;
}

/** Atlas's CSS arrives every card that is INSERTED, with the nth-child
 * stagger, so a filter tab that brings other cards brings them arriving. This
 * is that for `blocks` (typically siblingsAfter(the tab bar)), by the page
 * rules: the items of a see-through card grid or `.stack` list one by one in
 * stagger slots; any other block renders in place, as does anything the page
 * watcher would leave alone. For a change the person made, when the page's
 * own entrance window is closed. A bar whose component calls this carries
 * OWN_MOTION, so the watcher's panel swap leaves it to this. */
export function arriveBlocks(blocks: HTMLElement[]): MotionHandle {
  if (blocks.length === 0 || !motionAllowed()) return allOf([]);
  return allOf(arriveUnits(blockUnits(blocks, FILTER_LISTS)));
}

/** The outermost `.page` at or above `el`, inside `root`. */
function pageOf(el: Element, root: Element): HTMLElement | null {
  let page: HTMLElement | null = null;
  for (let p = el.closest(PAGE); p && root.contains(p) && p !== root; p = p.parentElement?.closest(PAGE) ?? null) {
    if (p instanceof HTMLElement) page = p;
  }
  return page;
}

/** The outermost pages inside `el` (or `el` itself). */
function pagesIn(el: Element, root: Element): HTMLElement[] {
  const found = el.matches(PAGE) ? [el] : Array.from(el.querySelectorAll(PAGE));
  return found.filter((p): p is HTMLElement => p instanceof HTMLElement && pageOf(p, root) === p);
}

export interface EntranceWatch {
  /** Open a new entrance window: a route change that may not insert a new `.page`. */
  open(): void;
  /** The page's context changed under it (a workspace or project switch) and
   * the page stays: it re-arrives as one unit with Atlas's subtler
   * `work-surface-enter` (motion.ts reenter), and a new window opens, so what
   * the new context's fetches render arrives like a first load. */
  reenter(): void;
  /** Stop watching and settle anything still moving. Idempotent. */
  stop(): void;
}

const IDLE: EntranceWatch = Object.freeze({ open() {}, reenter() {}, stop() {} });

/** Watch `root` for page entrances (see the file comment). Returns an idle
 * watcher, and never observes anything, where motion can never run (jsdom,
 * webdriver, a VITE_FD_MOTION_OFF build), so no test pays for it. The
 * conditions that can change while the page is open (reduced motion, the
 * kill switch, a hidden tab) are checked on every entrance. */
export function watchEntrances(root: HTMLElement, opts: { window?: number } = {}): EntranceWatch {
  if (!motionSupported() || typeof MutationObserver !== "function") return IDLE;
  const doc = root.ownerDocument;
  const windowMs = opts.window ?? MOTION.duration.entranceWindow;
  const running = new Set<MotionHandle>();
  let until = 0;
  let stopped = false;

  const open = () => {
    until = performance.now() + windowMs;
  };
  const settle = () => {
    const all = [...running];
    running.clear();
    for (const h of all) h.cancel();
  };

  const play = (units: EntranceUnit[]) => {
    for (const handle of arriveUnits(units)) {
      running.add(handle);
      void handle.finished.then(() => running.delete(handle));
    }
  };

  /** Atlas's studio-enter for the blocks a tab switch changed, as one unit. */
  const swap = (blocks: HTMLElement[]) => {
    const fold = doc.defaultView?.innerHeight ?? Infinity;
    const handle = swapIn(blocks.filter((el) => movable(el) && el.getBoundingClientRect().top < fold));
    running.add(handle);
    void handle.finished.then(() => running.delete(handle));
  };

  /** The tab bar a click has just landed on, until the frame after the click. */
  let clicked: HTMLElement | null = null;
  const onClick = (e: Event) => {
    const tab = e.target instanceof Element ? e.target.closest("button") : null;
    const bar = tab?.parentElement ?? null;
    if (!bar || !bar.matches(TAB_BAR) || bar.matches(OWN_MOTION) || !root.contains(bar)) return;
    clicked = bar;
    requestAnimationFrame(() => {
      if (clicked === bar) clicked = null;
    });
  };

  /** The blocks after the clicked bar, when `records` swapped what they show; else []. */
  const switchedPanel = (records: MutationRecord[]): HTMLElement[] => {
    const bar = clicked;
    if (!bar || !bar.isConnected) return [];
    const panel = siblingsAfter(bar);
    // A switch REPLACES what the panel shows: the old tab's content leaves as
    // the new tab's comes. A click that only adds beside the bar (Ops' window
    // tabs show a "refreshing…" line under the Refresh button next to them;
    // the data changes when the fetch answers) is no switch.
    let left = false;
    let came = false;
    for (const r of records) {
      if (r.type !== "childList" || !(r.target === bar.parentElement || panel.some((p) => p.contains(r.target)))) continue;
      left ||= r.removedNodes.length > 0;
      came ||= r.addedNodes.length > 0;
    }
    if (!left || !came) return [];
    clicked = null;
    return panel;
  };

  const enterPage = (page: HTMLElement) => {
    // Before the first paint: pageIn would lift the whole page under its arriving children.
    page.style.setProperty("animation", "none");
    play(entranceUnits(page));
  };

  const observer = new MutationObserver((records) => {
    const swapped = switchedPanel(records);
    const added: HTMLElement[] = [];
    const fresh = new Set<HTMLElement>();
    for (const r of records) {
      if (r.type === "attributes") {
        // A view change (VIEW_ATTR): the page it names arrives as if it were new.
        const el = r.target;
        if (el instanceof HTMLElement && el.isConnected && el.getAttribute(VIEW_ATTR) !== r.oldValue) {
          const page = pageOf(el, root);
          if (page) fresh.add(page);
        }
        continue;
      }
      // A ghost (presence.ts) is a closed overlay playing its exit, not new content.
      for (const n of Array.from(r.addedNodes)) if (n instanceof HTMLElement && n.isConnected && !n.hasAttribute(GHOST_ATTR)) added.push(n);
    }
    // A switch that also brought a new page or view: that entrance plays instead.
    if (swapped.length > 0 && motionAllowed() && ![...fresh].some((p) => p.contains(swapped[0]!))) swap(swapped);
    if (added.length === 0 && fresh.size === 0) return;
    // An overlay opening inside something still arriving: settle first, or the
    // moving ancestor would hold the overlay's fixed box for the rest of the motion.
    if (running.size > 0 && added.some((a) => a.matches(OVERLAY) || a.querySelector(OVERLAY) !== null)) settle();

    const touched = new Map<HTMLElement, HTMLElement[]>();
    for (const a of added) {
      const page = pageOf(a, root);
      if (page === a) fresh.add(a);
      else if (page) touched.set(page, [...(touched.get(page) ?? []), a]);
      else for (const p of pagesIn(a, root)) fresh.add(p);
    }
    if (fresh.size > 0) open();
    if (performance.now() > until || !motionAllowed()) return;
    for (const page of fresh) enterPage(page);
    for (const [page, nodes] of touched) {
      if (fresh.has(page)) continue;
      // What the swap already moves does not also arrive on its own.
      play(entranceUnits(page).filter((u) => !swapped.some((b) => b.contains(u.el)) && nodes.some((n) => n === u.el || n.contains(u.el))));
    }
  });

  const onInput = () => {
    until = 0;
    settle();
  };

  open();
  if (motionAllowed()) for (const page of pagesIn(root, root)) enterPage(page);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: [VIEW_ATTR], attributeOldValue: true });
  doc.addEventListener("pointerdown", onInput, true);
  doc.addEventListener("keydown", onInput, true);
  doc.addEventListener("click", onClick, true);

  return {
    open,
    reenter() {
      if (stopped) return;
      open();
      if (!motionAllowed()) return;
      settle(); // anything still arriving is handed back before the page moves as a whole
      for (const page of pagesIn(root, root)) {
        // Not a page holding an open overlay: a moving ancestor would hold its fixed box.
        if (page.querySelector(OVERLAY) !== null) continue;
        // A pageIn still playing would override the inline frames; this replaces it.
        page.style.setProperty("animation", "none");
        // A page holding a static surface moves in its parts, around the surface.
        const handle = reenter(holdsStatic(page) ? partsAround(page) : page);
        running.add(handle);
        void handle.finished.then(() => running.delete(handle));
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      doc.removeEventListener("pointerdown", onInput, true);
      doc.removeEventListener("keydown", onInput, true);
      doc.removeEventListener("click", onClick, true);
      clicked = null;
      settle();
    },
  };
}
