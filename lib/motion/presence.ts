// MIRROR of FlightDeck OS flightdeck/web/src/motion/presence.ts at commit 0bccb8796484cc4b368ed1cbf51ec61489c60704
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** Close motion for an overlay that has ALREADY unmounted.
 *
 * WHY NOT DEFER THE UNMOUNT. The usual way to animate a close is to keep the
 * component mounted until the animation ends. In the OS that would mean:
 *   - focus goes back to the opener only after the animation;
 *   - the panel stays interactive, and in the accessibility tree, while it
 *     animates;
 *   - most closes would never animate at all. Most overlays are closed by
 *     their CALLER (a Cancel or Save in the footer, a route change, the tour
 *     standing down when a drawer opens), which simply stops rendering them.
 *
 * WHAT THIS DOES INSTEAD. React unmounts at once: state, focus return and the
 * accessibility tree are exactly what they would be with motion off. A
 * callback-ref cleanup, which React runs while the element is still in the
 * document, calls exitOnUnmount(). React then removes the element. In a
 * microtask, before the browser paints, the SAME node is put back where it
 * was, as a decorative ghost, and the close motion plays on it:
 *   - `inert` + `aria-hidden`: nothing inside can be focused, clicked or read,
 *     and a click lands on whatever is under it;
 *   - its ids are removed, so a reopened copy of the same overlay never
 *     shares one with it;
 *   - it paints one z-index step below its old layer, so whatever opened in
 *     the same commit (the drawer the tour stood down for) is on top;
 *   - `data-motion-ghost`, so nothing that watches for new overlays mistakes
 *     it for one;
 *   - CSS animations restart when a node is re-inserted; they are cancelled,
 *     so nothing inside replays its entrance;
 *   - re-insertion resets scroll offsets; they are put back.
 * The ghost is removed when the motion ends, at the first pointer or key
 * input (the close is skippable), or after a hard ceiling, whichever comes
 * first.
 *
 * NO GHOST: when motion is not allowed (jsdom, reduced motion, webdriver, the
 * kill switch, a hidden tab), when the element's parent went too (a page
 * that unmounts with its overlay just goes), and when the element holds
 * something that re-insertion would reload or restart (an iframe, embed,
 * object, video or audio). */
import { MOTION, motionAllowed, type MotionHandle } from "./motion";

/** Marks a ghost. entrances.ts ignores nodes carrying it. */
export const GHOST_ATTR = "data-motion-ghost";

/** Re-inserting these reloads or restarts them: an iframe fetches its page
 * again, a video starts over. Such a panel closes without a ghost. */
const RELOADS = "iframe, embed, object, video, audio";

/** Beyond this many descendants the scroll bookkeeping is not worth it: the
 * panel closes without a ghost. */
const MAX_NODES = 4000;

/** The longest a ghost may stay, whatever its motion does. */
const CEILING = MOTION.duration.dialog + 300;

/** Is `root` the kind of element a ghost can be made of? Read before React
 * removes it. */
function ghostable(root: HTMLElement): boolean {
  if (!root.isConnected || !root.parentNode) return false;
  if (root.matches(RELOADS) || root.querySelector(RELOADS)) return false;
  return root.getElementsByTagName("*").length <= MAX_NODES;
}

function scrollOffsets(root: HTMLElement): Array<[Element, number, number]> {
  const out: Array<[Element, number, number]> = [];
  for (const el of [root, ...Array.from(root.getElementsByTagName("*"))]) {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) out.push([el, el.scrollTop, el.scrollLeft]);
  }
  return out;
}

/** Hand `root`'s close motion to a ghost (see the file comment). Call it from
 * a callback-ref cleanup, while React still has `root` in the document.
 * `play` starts the close on the re-inserted node (closePanel); `running` is
 * whatever motion still moves it (its open), cancelled when no ghost is made.
 * Without a ghost the element simply goes, as it would with motion off. */
export function exitOnUnmount(root: HTMLElement, play: () => MotionHandle, running?: MotionHandle | null): void {
  if (!motionAllowed() || !ghostable(root)) {
    // A StrictMode rehearsal keeps the element; its open may play on.
    queueMicrotask(() => {
      if (!root.isConnected) running?.cancel();
    });
    return;
  }
  const parent = root.parentNode!;
  const next = root.nextSibling;
  const scrolled = scrollOffsets(root);

  queueMicrotask(() => {
    // Still in the document: this was not an unmount (a StrictMode rehearsal).
    if (root.isConnected) return;
    if (!parent.isConnected) {
      running?.cancel();
      return;
    }
    parent.insertBefore(root, next && next.parentNode === parent ? next : null);
    root.setAttribute(GHOST_ATTR, "");
    root.setAttribute("inert", "");
    root.setAttribute("aria-hidden", "true");
    root.removeAttribute("id");
    for (const el of Array.from(root.querySelectorAll("[id]"))) el.removeAttribute("id");
    const z = Number.parseInt(getComputedStyle(root).zIndex, 10);
    if (Number.isFinite(z)) root.style.setProperty("z-index", String(z - 1));
    // Re-insertion restarted every CSS animation inside; none may replay.
    for (const a of root.getAnimations?.({ subtree: true }) ?? []) a.cancel();
    for (const [el, top, left] of scrolled) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }

    const handle = play();
    const doc = root.ownerDocument;
    let gone = false;
    const remove = () => {
      if (gone) return;
      gone = true;
      clearTimeout(ceiling);
      doc.removeEventListener("pointerdown", remove, true);
      doc.removeEventListener("keydown", remove, true);
      handle.cancel();
      root.remove();
    };
    const ceiling = setTimeout(remove, CEILING);
    doc.addEventListener("pointerdown", remove, true);
    doc.addEventListener("keydown", remove, true);
    void handle.finished.then(remove);
  });
}
