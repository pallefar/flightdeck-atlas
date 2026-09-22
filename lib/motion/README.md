# Motion layer (`lib/motion/`)

Atlas's copy of the motion layer shared by FlightDeck OS, its sub-apps, Studio and Atlas. Owner
decision, 2026-09-22: *"also lets start using animate.js for animations in the app"*. Asked which
library, the owner chose **Anime.js** (animejs 4.x), and **"Atlas motion, everywhere"** as the scope:
one motion language across the OS, the sub-apps, Studio and Atlas, always honouring reduced motion.

Atlas is the reference design, so this layer changes nothing Atlas already animates. Atlas's CSS
motion (`app/motion.css` and the rest listed below) stays exactly as it is. The layer only drives
motion that has to run in JavaScript.

## The mirror

`motion.ts`, `useMotion.ts`, `entrances.ts`, `CountUp.tsx`, `disclosure.ts` and `presence.ts` are
copies of the OS's `flightdeck/web/src/motion/` at commit
`745733922e001557b6ff727d25110b8dde7cd3f6` (FlightDeck OS, branch `feat/anime-motion-os`). Each
starts with a header naming that commit and is byte-identical below it. `useMotion.ts` also carries
an `eslint-disable` line for React Compiler rules that Atlas's lint runs and the OS's does not.
`disclosure.ts` and `presence.ts` are copied because `useMotion.ts` imports them.

- **Not copied:** `TabIndicator.tsx`. Atlas's pill-tab indicator (`.view-tab-indicator`) already
  slides in CSS.
- **Atlas's own files:** this README, and `env.d.ts`, which declares the one Vite env key the layer
  reads (`VITE_FD_MOTION_OFF`). Next's `ImportMetaEnv` has no index signature for it.
- **Not scanned by Tailwind:** `app/globals.css` has `@source not "../lib/motion"`. The copies'
  comments name utility classes (`duration-500`, `ease-out`, `static`) that no Atlas element uses.
  Without that line Tailwind would add them to Atlas's stylesheet.

**To update:** change the OS copy first. Then copy each file again, keep the header and set its
commit, and rerun `tests/motion.spec.ts` and the check below. Never edit the code below a header
here, or the two apps stop sharing one motion language.

**To check the mirror:** `node scripts/check-motion-mirror.mjs <FlightDeck OS checkout> [ref]`
(`ref` defaults to `origin/feat/anime-motion-os`; `git fetch` that checkout first). It fails when a
file's code differs from the commit its header names (an edit made here), when the headers name
different commits, or when the OS's `ref` has a different version of a file (the OS moved on: copy
again).

## What Atlas animates with it

| Where | Helper | What it does |
|---|---|---|
| Dashboard stat tiles (`app/atlas.tsx`, `Metric`) | `useCountUp` | The four numbers (projects, in progress, tasks complete, on the map) count up over 600ms. A tile counts from 0 when it mounts in the browser (Portfolio again after another view), and from the old value when its value changes. Zero padding is kept on every frame (`"03"`). The last frame is byte-identical to the render. A number already on screen is never pulled back: a tile hydrated from server HTML does not count, and nor does a tile that replaces one still showing its number. That happens on every page load: the shell mounts again once access loads (`WellbeingProvider` is keyed by the signed-in user), and the new tile finds the old one's number in `paintedMetrics`. A tile only counts between two numbers of the same data (`MetricSource`: `loading`, `examples`, `workspace`). Before `/api/projects` answers, Atlas renders the demo examples (4 projects), so for a user with projects the load is a change of source, not of value: the loaded numbers replace the demo ones at once, as before this layer, instead of counting 4 > 3 > 2 > 1. The same goes for Start fresh (examples to an empty workspace). The stat section is keyed by the source, so a change of source mounts new tiles, and a tile that replaces one showing another source's number shows its own at once. So a page load never counts; the count runs when a tile mounts in the browser or its value changes within the same data. |
| Sidebar groups (`app/atlas-navigation.tsx`) | `useDisclosure` | Opening a group unfolds its links from their top edge (scaleY and fade), and the groups and help link below glide to their new place (FLIP, translate only). All of it takes 200ms `ease`, the timing of the chevron's CSS turn. A closed group disappears at once, as before. User toggles animate. So does a group that opens because you navigated somewhere else (the command menu, a project card). A group does not animate when it opens at mount, from stored groups, or from a `?view=` link while the workspace loads. The chevron is not passed to the helper, so its turn stays Atlas's CSS transition. |

## What stays in CSS (not duplicated)

| Motion | Where it lives |
|---|---|
| Page heading and hub header arrive (`atlas-arrive`, 500ms) | `app/motion.css` |
| Project cards arrive, staggered 45ms, with the 4th card onwards sharing the 135ms slot | `app/motion.css` |
| Pill-tab indicator slide (450ms `cubic-bezier(.22,1,.36,1)`) | `app/motion.css` (`.view-tab-indicator`, `--active-tab`) |
| Hover lift, press scale, colour transitions | `app/motion.css`, `app/globals.css` |
| Workspace/project surface swap (`work-surface-enter`) | `app/navigation.css` |
| Studio tab panel swap (`studio-enter`) | `app/work-studio.css` |
| Work item arrive/celebrate | `app/work-management.css` |
| Dialogs, the command menu and the mobile navigation dialog (fade + zoom, 200ms) | `components/ui/dialog.tsx` via `tw-animate-css` |
| Sidebar group chevron turn (200ms `ease`) | `app/navigation.css` |

**JavaScript motion that stays outside the layer.** Three pieces animate in JS on their own: the
dashboard-to-globe camera flight (`app/view-flight.tsx`), the room journey
(`app/room-journey.tsx`) and the globe's camera and tour (`app/globe.tsx`,
`app/globe-workspace.tsx`). These are WebGL/Cesium render loops, not DOM decoration. They follow
Atlas's own settings (`motionScale` in `lib/settings.ts`, which honours reduced motion) and are not
wired to this layer.

**Known limitations.**

- This is JS-driven motion. A long main-thread task during a count or an unfold skips frames,
  where a CSS animation of `opacity`/`transform` would keep running on the compositor.
- The globe flight snapshots the dashboard by cloning its DOM. If you switch to the globe within
  600ms of the dashboard mounting, that snapshot shows the numbers mid-count.

## The rules (same as the OS)

1. **Animation is decoration.** Markup and CSS always render the final state, and nothing starts at
   `opacity: 0` in markup or CSS. A helper takes an element that has already rendered, sets it back
   to its start frame in a layout effect (before paint), and plays it forward.
2. **Reduced motion means no movement.** With `prefers-reduced-motion: reduce`, every helper
   settles instantly, as Atlas's CSS does.
3. **Tests see the final state synchronously.** Every helper is a no-op when:
   - `navigator.webdriver` is true (Playwright);
   - the user agent is jsdom, or `matchMedia` is missing;
   - the tab is hidden;
   - `window.__FD_MOTION_OFF === true`;
   - the build ran with `VITE_FD_MOTION_OFF=1`.
4. **Only compositor properties.** The helpers write `opacity`, `translate`, `scale` and `rotate`
   (the individual properties, never `transform`) with their `transform-origin`, plus the
   count-up's text. They compose with Atlas's own transforms, such as the hover lifts.
5. **Everything written is taken back.** When a motion ends, is cancelled or unmounts, the element
   goes back to its stylesheet with no inline residue. A count-up stops if React writes the number
   while it runs.

## Opting out

| Who | How |
|---|---|
| The user | The system "reduce motion" setting. |
| A developer or a screenshot script | `window.__FD_MOTION_OFF = true` in the page, or build with `VITE_FD_MOTION_OFF=1`. |
| Automation | Nothing to do: `navigator.webdriver` switches it off. To record motion, launch Chrome with `--disable-blink-features=AutomationControlled`, as `tests/motion.spec.ts` does. |

## Testing

`tests/motion.spec.ts` (Playwright, real Chrome) covers:

- **Count-up:**
  - on a page load, never pulls a painted number back (sampled every frame, through the shell's
    second mount), and ends byte-identical to the motion-off render;
  - counts from 0 when a tile mounts again, rising monotonically with its padding kept, and ends
    byte-identical to the motion-off render;
  - under reduced motion or automation, never writes the number.
- **Sidebar groups:**
  - unfold, glide down on open and glide up on close, ending on markup identical to the motion-off
    render;
  - no JS write to the chevron;
  - unfold when a navigation made elsewhere opens a group;
  - no motion at mount (stored groups, or a `?view=` link while loading), under reduced motion, or
    under automation.
- **CSS reference:** the arrive, indicator and chevron CSS stay pinned.

The suite can run against a second checkout's dev server:

```sh
npm run dev -- --port 5174
ATLAS_BASE_URL=http://localhost:5174 npx playwright test tests/motion.spec.ts
```

## Dependency record (rule 8)

- **Package:** `animejs` `^4.5.0` (4.5.0 installed), MIT, by Julian Garnier, https://animejs.com.
- **Why:** the owner's request quoted above. None of Atlas's other dependencies animates plain
  objects from JS. `tw-animate-css` and `motion.css` are CSS only.
- **How it is used:** named imports only (`animate`, `cubicBezier`, the `EasingFunction` type), so
  the bundler tree-shakes the rest. It is bundled, never loaded from a CDN.
- **Size (production `vinext build`, `dist/client/_next/static`, JS/CSS):**
  - Total: +38,855 bytes raw (+15,991 gzip), from 2,284,141 to 2,322,996 raw.
  - Almost all of that is in the `atlas-*.js` chunk: +38,853 raw (+15,996 gzip).
  - The stylesheet is byte-identical (`index.oRy8w7fE.css` before and after).
