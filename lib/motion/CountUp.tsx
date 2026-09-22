// MIRROR of FlightDeck OS flightdeck/web/src/motion/CountUp.tsx at commit 99d641f1871069e35ea3ed411f20d427ea5d75fc
// (pallefar FlightDeck OS, branch feat/anime-motion-os). Byte-identical below this header: change the OS copy
// first and re-copy, so Atlas and the OS keep one motion language. lib/motion/README.md says what Atlas uses.
/** A number that counts up (useCountUp) whenever `value` changes, and on
 * mount from 0. Renders exactly `<div className={className}>{children}</div>`:
 * the text is the caller's, final and correct with motion off, and the count
 * only replays it. `value` is the number that text shows, or null when it
 * shows none (a "—" placeholder, a status word), which never counts. */
import { useRef, type ReactNode } from "react";
import { useCountUp } from "./useMotion";

export function CountUp({ value, className, children }: { value: number | null; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useCountUp(ref, value);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
