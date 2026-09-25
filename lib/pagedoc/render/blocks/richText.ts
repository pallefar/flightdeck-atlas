// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/richText.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The rich text block.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";
import { renderRichText } from "../richText.js";

export type RichTextBlock = Extract<Block, { type: "richText" }>;

export function renderRichTextBlock(block: RichTextBlock, ctx: RenderContext): ReactNode {
  const text = pickLocalized(block.content, ctx.locale, ctx.sourceLocale);
  if (!text) return null;
  return h("div", { className: "pd-rich-text", ...langAttrs(text, ctx.locale) }, renderRichText(text.value, ctx));
}
