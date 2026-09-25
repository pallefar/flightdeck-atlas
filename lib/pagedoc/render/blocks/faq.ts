// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/faq.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The FAQ block: an optional h2 and one native <details> per question (the
// browser's own disclosure: keyboard, screen reader and find-in-page work
// without script). The answer is rich text.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";
import { renderRichText } from "../richText.js";
import { localizedText } from "./text.js";

export type FaqBlock = Extract<Block, { type: "faq" }>;

export function renderFaq(block: FaqBlock, ctx: RenderContext): ReactNode {
  return h(
    "div",
    { className: "pd-faq" },
    localizedText("h2", "pd-block-heading", block.heading, ctx),
    block.items.map((item) => {
      const a = pickLocalized(item.a, ctx.locale, ctx.sourceLocale);
      return h(
        "details",
        { key: item.id, className: "pd-faq-item" },
        localizedText("summary", "pd-faq-q", item.q, ctx),
        a ? h("div", { className: "pd-faq-a pd-rich-text", ...langAttrs(a, ctx.locale) }, renderRichText(a.value, ctx)) : null,
      );
    }),
  );
}
