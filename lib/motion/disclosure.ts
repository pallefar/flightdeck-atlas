// MIRROR of FlightDeck OS flightdeck/web/src/motion/disclosure.ts at commit 0bccb8796484cc4b368ed1cbf51ec61489c60704
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** Sidebar group expand/collapse, as Atlas plays it: the chevron in the
 * group's header turns (navigation.css:299-304, `transform 0.2s ease`) and
 * nothing else moves. Atlas's submenu is `[hidden]`, so it snaps open and
 * shut and the rows below it snap to their new place; the OS does the same.
 * (Unfolding the links and gliding the rows below swept a header 164-206px
 * away from the pointer that clicked it, far outside Atlas's 9px, and the
 * unfold's scaleY squashed the link text.)
 *
 * The markup already shows the new glyph (▾ open, ▸ closed); turn() plays the
 * quarter turn into it for the chevron in the header just above each block
 * that has just appeared or disappeared.
 *
 * Usage: captureDisclosure() BEFORE the DOM change (a click handler, right
 * before the state update), playDisclosure() right after it (a layout effect).
 * useDisclosure (useMotion.ts) wires both. With motion off, capture measures
 * nothing and play does nothing: the markup's new state is the whole story. */
import { MOTION, allOf, motionAllowed, turn, type MotionHandle } from "./motion";

export interface DisclosureSnapshot {
  root: HTMLElement;
  selector: string;
  /** Whether each block was rendered. */
  shown: Map<HTMLElement, boolean>;
}

/** Is it rendered at all? display: none, on it or an ancestor, gives an empty box. */
function rendered(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width !== 0 || r.height !== 0;
}

function blocks(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll(selector)).filter((el): el is HTMLElement => el instanceof HTMLElement);
}

/** Which `selector` blocks inside `root` are rendered now. Null (nothing
 * measured) whenever motion may not run. Reads only. */
export function captureDisclosure(root: HTMLElement | null | undefined, selector: string): DisclosureSnapshot | null {
  if (!root || !root.isConnected || !motionAllowed()) return null;
  const shown = new Map<HTMLElement, boolean>();
  for (const el of blocks(root, selector)) shown.set(el, rendered(el));
  return { root, selector, shown };
}

/** Play the change since `snap` (see the file comment). `chevron` selects the
 * chevron inside a block's header, the element just before the block. Layout
 * is read before the first write. */
export function playDisclosure(snap: DisclosureSnapshot | null, opts: { chevron?: string } = {}): MotionHandle {
  const chevron = opts.chevron;
  if (!snap || !chevron || !snap.root.isConnected || !motionAllowed()) return allOf([]);
  const turns: Array<[Element, number]> = [];
  for (const el of blocks(snap.root, snap.selector)) {
    const before = snap.shown.get(el);
    const after = rendered(el);
    // A block that was not there before is new, not opened: nothing to turn.
    if (before === undefined || before === after) continue;
    const chev = el.previousElementSibling?.querySelector(chevron);
    // A chevron that is not rendered (the icon-only sidebar hides headers) has nothing to turn.
    if (chev && rendered(chev)) turns.push([chev, after ? MOTION.distance.chevronTurn : -MOTION.distance.chevronTurn]);
  }
  return allOf(turns.map(([chev, fromDeg]) => turn(chev, fromDeg)));
}
