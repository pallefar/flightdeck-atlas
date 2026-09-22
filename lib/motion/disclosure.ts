// MIRROR of FlightDeck OS flightdeck/web/src/motion/disclosure.ts at commit 745733922e001557b6ff727d25110b8dde7cd3f6
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** Sidebar group expand/collapse: Atlas's chevron turn (navigation.css:
 * 299-304) plus a submenu that unfolds instead of popping in, with the rows
 * below gliding to their new place instead of jumping.
 *
 * Atlas itself only turns the chevron; its submenu is `[hidden]` and snaps.
 * Animating `height` would re-lay out the sidebar on every frame, so this is
 * FLIP with transforms only:
 *   - a row still shown that moved GLIDES from its old painted top (glide);
 *   - a block that just appeared UNFOLDS from its top edge (unfold), moving
 *     with its header when the header moved too;
 *   - a block that just disappeared is simply gone, as in Atlas;
 *   - the chevron in the header just above a block that appeared or
 *     disappeared TURNS into its new orientation (turn).
 * Unfold and glide share one curve and duration, so an unfolding block's
 * bottom edge and the top of the row gliding below it travel together.
 *
 * Usage: captureDisclosure() BEFORE the DOM change (a click handler, right
 * before the state update), playDisclosure() right after it (a layout effect).
 * useDisclosure (useMotion.ts) wires both. With motion off, capture measures
 * nothing and play does nothing: the markup's new state is the whole story. */
import { MOTION, allOf, glide, motionAllowed, turn, unfold, type MotionHandle } from "./motion";

export interface DisclosureSnapshot {
  root: HTMLElement;
  selector: string;
  /** Painted top of each item relative to `root`, or null when not rendered. */
  tops: Map<HTMLElement, number | null>;
}

/** Is it rendered at all? display: none, on it or an ancestor, gives an empty box. */
function rendered(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width !== 0 || r.height !== 0;
}

/** Painted top relative to `root` (transforms included, so a row caught
 * mid-glide is measured where it is seen), or null when not rendered. */
function topOf(el: HTMLElement, rootTop: number): number | null {
  return rendered(el) ? el.getBoundingClientRect().top - rootTop : null;
}

function items(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/** Where every `selector` item inside `root` is painted now. Null (nothing
 * measured) whenever motion may not run. Reads only. */
export function captureDisclosure(root: HTMLElement | null | undefined, selector: string): DisclosureSnapshot | null {
  if (!root || !root.isConnected || !motionAllowed()) return null;
  const rootTop = root.getBoundingClientRect().top;
  const tops = new Map<HTMLElement, number | null>();
  for (const el of items(root, selector)) tops.set(el, topOf(el, rootTop));
  return { root, selector, tops };
}

/** Play the change since `snap` (see the file comment). `chevron` selects the
 * chevron inside a block's header, the element just before the block. Items
 * must not nest (a moving parent would carry a moving child twice). Layout is
 * read before the first write. */
export function playDisclosure(snap: DisclosureSnapshot | null, opts: { chevron?: string } = {}): MotionHandle {
  const handles: MotionHandle[] = [];
  if (!snap || !snap.root.isConnected || !motionAllowed()) return allOf(handles);
  const rootTop = snap.root.getBoundingClientRect().top;
  const now = new Map<HTMLElement, number | null>();
  for (const el of items(snap.root, snap.selector)) now.set(el, topOf(el, rootTop));

  const moved: Array<[HTMLElement, number]> = [];
  const shown: Array<[HTMLElement, number]> = [];
  const turned: Array<[Element, number]> = [];
  const deltaOf = (el: Element | null): number => {
    if (!(el instanceof HTMLElement)) return 0;
    const before = snap.tops.get(el);
    const after = now.get(el);
    return before == null || after == null ? 0 : before - after;
  };
  const chevronOf = (block: HTMLElement): Element | null => {
    const header = block.previousElementSibling;
    const chev = opts.chevron && header ? header.querySelector(opts.chevron) : null;
    // A chevron that is not rendered (the icon-only sidebar hides headers) has nothing to turn.
    return chev && rendered(chev) ? chev : null;
  };

  for (const [el, after] of now) {
    const before = snap.tops.has(el) ? snap.tops.get(el)! : null;
    if (after !== null && before !== null) {
      const dy = before - after;
      if (Math.abs(dy) >= 0.5) moved.push([el, dy]);
    } else if (after !== null && before === null) {
      shown.push([el, deltaOf(el.previousElementSibling)]);
      const chev = chevronOf(el);
      if (chev) turned.push([chev, MOTION.distance.chevronTurn]);
    } else if (after === null && before !== null) {
      const chev = chevronOf(el);
      if (chev) turned.push([chev, -MOTION.distance.chevronTurn]);
    }
  }
  // Turns first: turn() reads the chevron's computed transition (style only,
  // no layout), so it goes before the writes that would force a style recalc.
  for (const [chev, fromDeg] of turned) handles.push(turn(chev, fromDeg));
  for (const [el, dy] of moved) handles.push(glide(el, dy));
  for (const [el, fromY] of shown) handles.push(unfold(el, { fromY }));
  return allOf(handles);
}
