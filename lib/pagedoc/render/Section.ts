// MIRROR of FlightDeck OS flightdeck/pagedoc/render/Section.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Sections, columns and the per-block dispatch. PORTABLE: mirrored byte for
// byte into Atlas lib/pagedoc, so only react, react-dom, 'zod/v4' and relative
// paths inside flightdeck/pagedoc may be imported
// (scripts/check-pagedoc-portable.mjs).
//
// Columns are emitted in document order and pagedoc.css never reorders them,
// so on a phone ('stack') DOM order is reading order (WCAG 1.3.2).
// 'hide-second' marks the second column; the stylesheet hides it on a narrow
// container. Sections and blocks are plain divs: the host owns the page's
// landmarks and its h1.
import { createElement as h, type ReactNode } from "react";
import type { Block, Section as SectionData } from "../schema/index.js";
import { BlockBoundary, BlockFallback } from "./BlockBoundary.js";
import type { RenderContext } from "./context.js";
import { renderAppCards } from "./blocks/appCards.js";
import { renderBenefits } from "./blocks/benefits.js";
import { renderCta } from "./blocks/cta.js";
import { renderDivider } from "./blocks/divider.js";
import { renderFaq } from "./blocks/faq.js";
import { renderFeatureGrid } from "./blocks/featureGrid.js";
import { renderGallery } from "./blocks/gallery.js";
import { renderHero } from "./blocks/hero.js";
import { renderMedia } from "./blocks/media.js";
import { renderRichTextBlock } from "./blocks/richText.js";
import { renderTabs } from "./blocks/tabs.js";
import { renderWidget } from "./blocks/widget.js";

function blockContent(block: Block, ctx: RenderContext): ReactNode {
  switch (block.type) {
    case "hero":
      return renderHero(block, ctx);
    case "richText":
      return renderRichTextBlock(block, ctx);
    case "divider":
      return renderDivider();
    case "media":
      return renderMedia(block, ctx);
    case "gallery":
      return renderGallery(block, ctx);
    case "featureGrid":
      return renderFeatureGrid(block, ctx);
    case "benefits":
      return renderBenefits(block, ctx);
    case "faq":
      return renderFaq(block, ctx);
    case "cta":
      return renderCta(block, ctx);
    case "appCards":
      return renderAppCards(block, ctx);
    case "widget":
      return renderWidget(block, ctx);
    case "tabs":
      return renderTabs(block, ctx, renderBlock);
    default:
      // A block type this renderer does not know (a doc that bypassed
      // parsePageDoc, or a newer tree's block): its slot says so.
      throw new Error(`no renderer for block type '${String((block as { type?: unknown }).type)}'`);
  }
}

function renderBlock(block: Block, ctx: RenderContext): ReactNode {
  let content: ReactNode;
  try {
    content = blockContent(block, ctx);
  } catch (error) {
    ctx.onBlockError?.(block.id, error);
    return h(BlockFallback, { key: block.id, blockId: block.id, locale: ctx.locale });
  }
  return h(
    BlockBoundary,
    { key: block.id, blockId: block.id, locale: ctx.locale, onError: ctx.onBlockError },
    h("div", { className: `pd-block pd-block-${block.type}`, "data-pd-id": block.id }, content),
  );
}

export function Section({ section, ctx }: { section: SectionData; ctx: RenderContext }) {
  const className = [
    "pd-section",
    `pd-layout-${section.layout}`,
    `pd-emphasis-${section.emphasis}`,
    `pd-spacing-${section.spacing}`,
    `pd-phone-${section.phone}`,
  ].join(" ");
  return h(
    "div",
    { className, "data-pd-id": section.id },
    h(
      "div",
      { className: "pd-columns" },
      section.columns.map((column, i) =>
        h(
          "div",
          {
            key: column.id,
            className: section.phone === "hide-second" && i === 1 ? "pd-column pd-column-phone-hidden" : "pd-column",
            "data-pd-id": column.id,
          },
          column.blocks.map((b) => renderBlock(b, ctx)),
        ),
      ),
    ),
  );
}
