// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/benefits.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The benefits block: an optional h2 and a list of titled items (h3 + text).
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
import { localizedText } from "./text.js";

export type BenefitsBlock = Extract<Block, { type: "benefits" }>;

export function renderBenefits(block: BenefitsBlock, ctx: RenderContext): ReactNode {
  return h(
    "div",
    { className: "pd-benefits" },
    localizedText("h2", "pd-block-heading", block.heading, ctx),
    h(
      "ul",
      { className: "pd-benefit-list" },
      block.items.map((item) =>
        h(
          "li",
          { key: item.id, className: "pd-benefit" },
          localizedText("h3", "pd-benefit-title", item.title, ctx),
          localizedText("p", "pd-benefit-text", item.text, ctx),
        ),
      ),
    ),
  );
}
