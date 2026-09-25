// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/hero.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The hero block: the page's lead heading, an optional subheading and image.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
//
// The heading is an h2: the page title is the host's h1. The image comes only
// through the host's media adapter (renderImage); alt text is the stored
// per-use alt, and a decorative image gets alt="". The optional button is the
// CTA block's button (renderCtaButton).
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";
import { renderCtaButton } from "./cta.js";
import { renderImage } from "./media.js";

export type HeroBlock = Extract<Block, { type: "hero" }>;

export function renderHero(block: HeroBlock, ctx: RenderContext): ReactNode {
  const heading = pickLocalized(block.heading, ctx.locale, ctx.sourceLocale);
  const sub = pickLocalized(block.subheading, ctx.locale, ctx.sourceLocale);
  const media = block.media
    ? renderImage(
        { mediaId: block.media.mediaId, alt: block.media.alt, decorative: block.media.decorative, className: "pd-hero-media" },
        ctx,
      )
    : null;
  return h(
    "div",
    { className: "pd-hero" },
    heading ? h("h2", { className: "pd-hero-heading", ...langAttrs(heading, ctx.locale) }, heading.value) : null,
    sub ? h("p", { className: "pd-hero-subheading", ...langAttrs(sub, ctx.locale) }, sub.value) : null,
    media,
    block.cta ? h("div", { className: "pd-hero-actions" }, renderCtaButton(block.cta, ctx)) : null,
  );
}
