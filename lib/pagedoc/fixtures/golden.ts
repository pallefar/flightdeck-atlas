// MIRROR of FlightDeck OS flightdeck/pagedoc/fixtures/golden.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Golden HTML normalisation. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so both hosts compare rendered markup with
// fixtures/<name>.<locale>.html the same way.
//
// A golden is the server-rendered markup (react-dom/server
// renderToStaticMarkup) of PageDocRenderer with the adapters below, reduced to
// the renderer's own output: React 19 prepends image preload hints
// (<link rel="preload" as="image">) that belong to the host document, not the
// page, so they are dropped. One trailing newline ends the file.
import type { PageDocAdapters } from "../adapters.js";

/** The fixed adapter URLs goldens are rendered with. */
export const GOLDEN_MEDIA_URL = (mediaId: string) => `/media/${mediaId}`;
export const GOLDEN_PAGE_URL = (pageId: string) => `/pages/${pageId}`;

/** The fixed adapters goldens are rendered with: every media item ready at
 * GOLDEN_MEDIA_URL, every page resolvable, every app requestable and named by
 * its id, one visible app, and no live widget (the notice). */
export function goldenAdapters(): PageDocAdapters {
  return {
    media: { resolve: (mediaId) => ({ status: "ready", url: GOLDEN_MEDIA_URL(mediaId) }) },
    resolvePage: GOLDEN_PAGE_URL,
    navigate: () => {},
    widget: () => null,
    appState: () => "request",
    appAction: () => {},
    appCard: (appId) => ({ name: appId }),
    visibleApps: () => ["contracts"],
  };
}

export function normalizeGoldenHtml(html: string): string {
  return `${html.replace(/^(?:<link rel="preload" as="image"[^>]*\/>)+/, "")}\n`;
}
