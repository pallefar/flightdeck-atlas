# Motion layer (`lib/motion/`)

Atlas's copy of the motion layer shared by FlightDeck OS, its sub-apps, Studio and Atlas. Owner
decision, 2026-09-22: *"also lets start using animate.js for animations in the app"*. Asked which
library, the owner chose **Anime.js** (animejs 4.x), and **"Atlas motion, everywhere"** as the scope:
one motion language across the OS, the sub-apps, Studio and Atlas, always honouring reduced motion.

Atlas is the reference design, so this layer changes nothing Atlas already animates. Atlas's CSS
motion (`app/motion.css` and the rest listed below) stays exactly as it is. The layer only drives
motion that has to run in JavaScript.

## The mirror

`motion.ts`, `useMotion.ts`, `entrances.ts`, `disclosure.ts` and `presence.ts` are copies of the
OS's `flightdeck/web/src/motion/` at commit `0bccb8796484cc4b368ed1cbf51ec61489c60704` (FlightDeck
OS, branch `feat/anime-motion-os`). Each starts with a header naming that commit and is
byte-identical below it. `useMotion.ts` also carries an `eslint-disable` line for a React Compiler
rule (`react-hooks/refs`) that Atlas's lint runs and the OS's does not. `disclosure.ts` and
`presence.ts` are copied because `useMotion.ts` imports them.

- **Not copied:** `TabIndicator.tsx`, because Atlas's pill-tab indicator (`.view-tab-indicator`)
  already slides in CSS. The OS's README is not copied either: this file takes its place.
- **Gone:** `CountUp.tsx`. The OS removed it, with `useCountUp`, `countUp()` and
  `MOTION.duration.countUp`, in `d2107c6a` ("draw the KPI band in place and drop the count-up, as
  Atlas does"). Atlas's copy went with it.
- **Atlas's own files:** this README, and `env.d.ts`, which declares the one Vite env key the layer
  reads (`VITE_FD_MOTION_OFF`). Next's `ImportMetaEnv` has no index signature for it.
- **Not scanned by Tailwind:** `app/globals.css` has `@source not "../lib/motion"`. The copies'
  comments name utility classes (`ease-out`, `static`) that no Atlas element uses. Without that
  line Tailwind would add them to Atlas's stylesheet.

**To update:** change the OS copy first. Then copy each file again, keep the header and set its
commit, and rerun `tests/motion.spec.ts` and the check below. Never edit the code below a header
here, or the two apps stop sharing one motion language.

**To check the mirror:** `node scripts/check-motion-mirror.mjs <FlightDeck OS checkout> [ref]`
(`ref` defaults to `origin/feat/anime-motion-os`; `git fetch` that checkout first). It exits 1 when:

- a file's code differs from the commit its header names (an edit made here);
- the headers name different commits;
- the OS's `ref` has a different version of a file, or no longer has it (the OS moved on: copy
  again);
- `lib/motion` holds a file that is neither a copy nor one of Atlas's own (a removed copy left
  behind);
- `ref` has a file that is neither copied nor listed as not copied (the OS added one).

## What Atlas animates with it

**One entrance.** The 9-dot menu's FlightDeck OS app cards (`app/workspace-tools.tsx`, apps-33)
arrive with `useArrive` (`atlas-arrive`, staggered) when a list appears. Like every helper it
does nothing under reduced motion, in automation or with motion switched off. Every other motion
Atlas has is its own CSS (the table below).

The two helpers Atlas once called went when the OS matched Atlas:

- **Stat tiles** (`app/atlas.tsx`, `Metric`): drawn in place, as in the base. The OS removed its
  count-up in `d2107c6a`, because a counting tile shows numbers that are not true for ~300ms, on
  screen and in the accessibility tree. Atlas never counted.
- **Sidebar groups** (`app/atlas-navigation.tsx`): they snap open and shut, as in the base, and
  only the chevron turns (in CSS). The OS removed `unfold()` and `glide()` in `0bccb879` ("sidebar
  groups snap open and shut; only the chevron turns, as in Atlas"). What `useDisclosure` still
  plays is that chevron turn, which Atlas already has in `app/navigation.css`, so there is nothing
  to wire.

Each helper the layer has, and the Atlas CSS that already plays it (so it is not duplicated):

| Helper | Plays | Atlas's own |
|---|---|---|
| `arrive` / `useArrive` / `useEntrances` | `atlas-arrive` | `app/motion.css` (page heading, project cards) |
| `slideIndicator` / `useIndicator` (and the OS's `TabIndicator`) | The pill-tab indicator's slide | `app/motion.css` (`.view-tab-indicator`) |
| `openPanel` / `closePanel` / `usePanelMotion` | Dialog, menu and popover open/close | `components/ui/dialog.tsx` etc. via `tw-animate-css` |
| `reenter` / `useReenter` | `work-surface-enter` | `app/navigation.css` |
| `swapIn` | `studio-enter` | `app/work-studio.css` |
| `turn` / `useDisclosure` | The sidebar chevron's turn | `app/navigation.css` |

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
   (the individual properties, never `transform`) with their `transform-origin`, never text. They
   compose with Atlas's own transforms, such as the hover lifts.
5. **Everything written is taken back.** When a motion ends, is cancelled or unmounts, the element
   goes back to its stylesheet with no inline residue.

## Opting out

| Who | How |
|---|---|
| The user | The system "reduce motion" setting. |
| A developer or a screenshot script | `window.__FD_MOTION_OFF = true` in the page, or build with `VITE_FD_MOTION_OFF=1`. |
| Automation | Nothing to do: `navigator.webdriver` switches it off. To record motion, launch Chrome with `--disable-blink-features=AutomationControlled`, as `tests/motion.spec.ts` does. |

## Testing

`tests/motion.spec.ts` (Playwright, real Chrome) pins Atlas's own behaviour with motion on (a
Chrome launched without the automation flag, where the layer would run), and again under reduced
motion:

- **Stat tiles:** a page load (the demo workspace, 1 project, 9 projects) and Today and advisor,
  then Portfolio, write no number at all: sampled every frame, the tiles go straight from the
  painted numbers to the true ones, and the accessibility tree reads the true numbers from the
  tiles' first frame. The Archived filter writes each tile at most once, straight to its final
  number. The markup is `<strong>8</strong>` / `<strong>05</strong>`, as in the base. A source
  check keeps any count-up out of `app/`, `components/` and `lib/`.
- **Sidebar groups:** opening and closing both groups, rapid clicks, a navigation made elsewhere
  (the command menu), groups restored open and a `?view=` link write no inline style anywhere in
  the sidebar. Sampled every frame, a group is fully drawn or hidden and the help link never
  moves. The chevron turns in CSS only.
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
- **How it is used:** only by `lib/motion`, with named imports (`animate`, `cubicBezier`, the
  `EasingFunction` type), so the bundler tree-shakes the rest. It is bundled, never loaded from a
  CDN.
- **Size (production `vinext build`, `dist/client/_next/static`, JS/CSS):** nothing in Atlas
  imports `lib/motion` yet, so neither it nor animejs is in the bundle. Built at this commit:
  2,284,143 bytes raw (618,537 gzip), against 2,284,141 raw for the base (`dc7d9e1`). The 2 bytes
  are in the `index-*.js` chunk; the `atlas-*.js` chunk is the same size, no chunk holds animejs
  code, and the stylesheet is byte-identical (`index.oRy8w7fE.css`). While the stat count-up and
  the sidebar unfold were wired in, the bundle was +38,855 bytes raw (+15,991 gzip), almost all of
  it in the `atlas-*.js` chunk: roughly what the first helper Atlas imports will bring.
