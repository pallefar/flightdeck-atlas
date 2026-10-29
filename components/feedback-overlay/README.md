# Admin feedback overlay

Turn it on, use the app as normal, **right-click anything** to leave a comment on it, then
copy every comment as **one prompt** to paste to Claude.

- Two floating tools at the bottom: **Annotate** (pencil) freezes the page, outlines what is under the
  pointer, and a click or right-click opens a comment box; **Browse** (cursor) leaves the app working
  as normal so you can move to the next page. Pins stay visible in both. The choice is remembered.
- Numbered pins mark commented elements; hover outlines what a right-click would mark.
- Selected text is captured with the note if you selected some before right-clicking.
- **Review & copy** shows all notes (edit, delete, jump to page, add a general note) and the
  generated prompt.
- Notes live in the browser's `localStorage` (`gta-feedback-notes-v1`, `gta-feedback-on`). Nothing
  is sent anywhere.
- **Privacy by construction:** a note records page, section heading, selector, `data-testid` and the
  *label* of a control or heading. It does not record the text of ordinary elements (which in a
  data app can be a person's or a requisition's data) — only text you selected yourself.

## Files (copy the folder)

| File | What |
|---|---|
| `index.tsx` | `<FeedbackToggle />` (header button) and `<FeedbackOverlay />` (marking layer, panel, dock) |
| `notes.ts` | Pure functions: selector/label capture, storage parsing, `buildPrompt` |
| `feedback-overlay.css` | Styles, imported by `index.tsx`; uses the host's CSS variables with fallbacks |

Needs React 18+ and a bundler that accepts a CSS import. No other dependency, no Next-specific code.

## Use

```tsx
import { FeedbackOverlay, FeedbackToggle } from "./feedback-overlay";

// somewhere in the header, only for admins:
{isAdmin ? <FeedbackToggle /> : null}

// once, anywhere in the page tree, only for admins:
{isAdmin ? <FeedbackOverlay pathname={usePathname()} appName="the Acme portal" /> : null}
```

- Gate both on your own admin check. The overlay does not authenticate anyone; it only decides
  what to render.
- `pathname` is the current route (Next: `usePathname()`, React Router: `useLocation().pathname`).
  Without it, `window.location.pathname` is read on each render.
- Both components must be rendered in a client component (`"use client"` in Next).
- Colours: define `--card --card-foreground --background --foreground --border --input --secondary
  --muted-foreground --destructive --orange` or accept the fallbacks.

## Tests

`notes.ts` is pure: see `tests/feedback-notes.test.ts` (`npx tsx --test`). The browser flow is
`tests/e2e/feedback-overlay.spec.ts` (Playwright; adapt `signIn`).
