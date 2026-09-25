// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/text.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Small shared pieces: a block heading (h2) and a localized plain-text element.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";

type Localized = { en?: string | undefined; de?: string | undefined } | undefined;

/** A localized plain text in the given element, or nothing when absent. */
export function localizedText(tag: string, className: string, value: Localized, ctx: RenderContext): ReactNode {
  const t = pickLocalized(value, ctx.locale, ctx.sourceLocale);
  return t ? h(tag, { className, ...langAttrs(t, ctx.locale) }, t.value) : null;
}
