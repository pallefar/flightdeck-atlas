// MIRROR of FlightDeck OS flightdeck/pagedoc/render/PageDocRenderer.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The PageDoc renderer. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// Pure: it renders a doc that parsePageDoc accepted, reaches the host only
// through `adapters`, holds no state and injects no HTML. It renders the same
// on the server (Atlas SSR, goldens) and in the browser.
import { createElement as h } from "react";
import type { PageDocAdapters } from "../adapters.js";
import type { Locale, PageDocV2 } from "../schema/index.js";
import type { RenderContext } from "./context.js";
import { PageDocRoot, type PageDocTheme } from "./root.js";
import { Section } from "./Section.js";

export interface PageDocRendererProps {
  doc: PageDocV2;
  /** The reader's language; missing text falls back (see pickLocalized). */
  locale: Locale;
  adapters: PageDocAdapters;
  /** Inside the editor canvas. */
  editing?: boolean;
  /** The host's default theme; the doc's own meta.theme wins. */
  theme?: PageDocTheme;
  /** Told about every block replaced by its fallback. */
  onBlockError?: (blockId: string, error: unknown) => void;
}

export function PageDocRenderer({ doc, locale, adapters, editing = false, theme, onBlockError }: PageDocRendererProps) {
  const ctx: RenderContext = { locale, sourceLocale: doc.meta.sourceLocale, adapters, editing, onBlockError };
  return h(
    PageDocRoot,
    { theme: doc.meta.theme ?? theme ?? "default", lang: locale, editing },
    doc.sections.map((section) => h(Section, { key: section.id, section, ctx })),
  );
}
