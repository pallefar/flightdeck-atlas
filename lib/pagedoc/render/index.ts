// MIRROR of FlightDeck OS flightdeck/pagedoc/render/index.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// PageDoc renderer entry point. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// In-house and dependency-free whichever editor wins the engine spike, so the
// Atlas mirror never carries an editor library. Never inject raw HTML.
// Written with createElement rather than JSX, so the tree also compiles in the
// server's typecheck stack (no jsx setting) and in any host's bundler.
export { PAGEDOC_THEMES, PageDocRoot, type PageDocRootProps, type PageDocTheme } from "./root.js";
export { PageDocRenderer, type PageDocRendererProps } from "./PageDocRenderer.js";
export { Section } from "./Section.js";
export { BlockBoundary, BlockFallback, type BlockBoundaryProps } from "./BlockBoundary.js";
export { BLOCK_ERROR_TEXT, langAttrs, pickLocalized, type Picked, type RenderContext } from "./context.js";
export { renderRichText } from "./richText.js";
