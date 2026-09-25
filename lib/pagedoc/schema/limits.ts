// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/limits.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// PageDoc v2 model limits. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// The numbers are the plan's (docs/PLAN-2026-09-25-ONBOARDING-APPS-PAGES-CRM.md
// section 7, Lane C, "Block model limits live in pagedoc/schema/limits.ts").
// The editor, the store and the Atlas reader all import them from here, so a
// limit is changed in exactly one place.

/** Every section, column, block, tab and list-item id: lower-case letters and digits. */
export const ID_PATTERN = /^[a-z0-9]{10,24}$/;

/** A media library item id: exactly 24 lower-case letters or digits (never a URL). */
export const MEDIA_ID_PATTERN = /^[a-z0-9]{24}$/;

export const LIMITS = {
  idPattern: ID_PATTERN,
  /** Sections per doc. */
  maxSections: 40,
  /** Columns per section (the widest layout is '1-1-1'). */
  maxColumns: 3,
  /** Blocks per doc, counted at every depth (blocks inside tabs included). */
  maxBlocks: 150,
  /** Items in one rich-text list. */
  maxListItems: 30,
  /** Tabs in one tabs block: at least two (one tab is not a choice), at most six. */
  minTabs: 2,
  maxTabs: 6,
  /** Images in one gallery. */
  maxGalleryItems: 24,
  /** Items in one feature grid. */
  maxFeatureItems: 12,
  /** Items in one benefits list. */
  maxBenefitItems: 8,
  /** Question/answer pairs in one FAQ. */
  maxFaqItems: 30,
  /** Apps named in one app-cards block. */
  maxAppCards: 12,
  /** Keys in one widget block's config. */
  maxWidgetConfigKeys: 20,
  /** UTF-8 bytes of text in one block, every language together. */
  maxBlockTextBytes: 20 * 1024,
  /** UTF-8 bytes of the serialized doc. */
  maxDocBytes: 512 * 1024,
  /** section (1) > column (2) > block (3) > tab (4) > block (5). */
  maxDepth: 5,
  /** Characters in a page title, per language (the v1 page registry's bound). */
  maxTitleChars: 80,
} as const;

/** UTF-8 byte length without Buffer (portable: browsers and Node). */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
