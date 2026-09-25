// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/layout.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Sections and columns. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// A section's `layout` names its column ratios, and the number of columns must
// match it exactly. On a phone the columns either stack in document order or
// the second column is hidden. There is deliberately no 'stack-reverse': CSS
// reordering breaks reading order for screen readers and keyboard users
// (WCAG 1.3.2), so authors order the columns instead (plan section 7, Lane C).
import { z } from "zod/v4";
import { idSchema } from "./blocksCore.js";
import { blockSchema } from "./blocksContent.js";
import { LIMITS } from "./limits.js";

export const SECTION_LAYOUTS = ["1", "1-1", "2-1", "1-2", "1-1-1"] as const;
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

/** How many columns each layout has. */
export function columnCount(layout: SectionLayout): number {
  return layout.split("-").length;
}

export const SECTION_EMPHASIS = ["none", "subtle", "strong"] as const;
export const SECTION_SPACING = ["compact", "normal", "spacious"] as const;
export const SECTION_PHONE = ["stack", "hide-second"] as const;
/** 'content-only': text and media stay editable, blocks cannot be moved, added or removed (plan J17). */
export const SECTION_LOCK = ["none", "content-only"] as const;

export const columnSchema = z.strictObject({
  id: idSchema,
  blocks: z.array(blockSchema).max(LIMITS.maxBlocks),
});
export type Column = z.infer<typeof columnSchema>;

export const sectionSchema = z
  .strictObject({
    id: idSchema,
    layout: z.enum(SECTION_LAYOUTS),
    emphasis: z.enum(SECTION_EMPHASIS),
    spacing: z.enum(SECTION_SPACING),
    phone: z.enum(SECTION_PHONE),
    lock: z.enum(SECTION_LOCK).optional(),
    columns: z.array(columnSchema).min(1).max(LIMITS.maxColumns),
  })
  .superRefine((s, ctx) => {
    const want = columnCount(s.layout);
    if (s.columns.length !== want) {
      ctx.addIssue({
        code: "custom",
        path: ["columns"],
        message: `layout '${s.layout}' needs ${want} column(s), got ${s.columns.length}`,
      });
    }
    if (s.phone === "hide-second" && want < 2) {
      ctx.addIssue({ code: "custom", path: ["phone"], message: "hide-second needs a layout with two or more columns" });
    }
  });
export type Section = z.infer<typeof sectionSchema>;
