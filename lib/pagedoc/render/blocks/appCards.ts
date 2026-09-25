// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/appCards.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The app cards block: named apps (in the doc's order) or every app the reader
// may see, each a card with its name (h3), tagline and a button for its state.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
//
// An app the host will not name for this reader (appCard returns null) is left
// out entirely, so a page never discloses an app the reader may not learn of.
import { createElement as h, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { UI_TEXT, type RenderContext } from "../context.js";
import { appButton } from "./cta.js";
import { localizedText } from "./text.js";

export type AppCardsBlock = Extract<Block, { type: "appCards" }>;

export function renderAppCards(block: AppCardsBlock, ctx: RenderContext): ReactNode {
  const ids = block.appIds ?? ctx.adapters.visibleApps();
  const cards: ReactNode[] = [];
  for (const appId of ids) {
    const card = ctx.adapters.appCard(appId);
    if (!card) continue;
    cards.push(
      h(
        "li",
        { key: appId, className: "pd-app-card" },
        h("h3", { className: "pd-app-card-name" }, card.name),
        card.tagline ? h("p", { className: "pd-app-card-tagline" }, card.tagline) : null,
        appButton(appId, "pd-button pd-button-secondary", ctx),
      ),
    );
  }
  return h(
    "div",
    { className: "pd-app-cards-block" },
    localizedText("h2", "pd-block-heading", block.heading, ctx),
    cards.length > 0
      ? h("ul", { className: "pd-app-cards" }, cards)
      : h("p", { className: "pd-app-cards-empty" }, UI_TEXT.noApps[ctx.locale]),
  );
}
