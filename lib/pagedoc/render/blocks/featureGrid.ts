// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/featureGrid.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The feature grid block: an optional h2 and a list of items, each an h3,
// optional text and an optional image.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import type { RenderContext } from "../context.js";
import { renderImage } from "./media.js";
import { localizedText } from "./text.js";

export type FeatureGridBlock = Extract<Block, { type: "featureGrid" }>;

export function renderFeatureGrid(block: FeatureGridBlock, ctx: RenderContext): ReactNode {
  return h(
    "div",
    { className: "pd-feature-grid" },
    localizedText("h2", "pd-block-heading", block.heading, ctx),
    h(
      "ul",
      { className: "pd-feature-list" },
      block.items.map((item) =>
        h(
          "li",
          { key: item.id, className: "pd-feature" },
          item.media
            ? renderImage(
                { mediaId: item.media.mediaId, alt: item.media.alt, decorative: item.media.decorative, className: "pd-feature-img", lazy: true },
                ctx,
              )
            : null,
          localizedText("h3", "pd-feature-title", item.title, ctx),
          localizedText("p", "pd-feature-text", item.text, ctx),
        ),
      ),
    ),
  );
}
