// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/blocksContent.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The content blocks: media, gallery, feature grid, benefits, FAQ, CTA, app
// cards, widget and tabs, and the closed `blockSchema` union of every block.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
//
// Rules shared by every block here:
// - alt text and captions are stored per use IN THE DOC, never on the shared
//   media row, so the approval of a revision covers them (plan 2026-09-25
//   section 7: "approval must cover shared media captions");
// - every list is bounded (limits.ts) and every list item carries its own id,
//   so a merge or a reorder can address it; ids are unique doc-wide;
// - tabs hold any block except tabs, which bounds nesting to
//   section > column > tabs > tab > block.
import { z } from "zod/v4";
import {
  ALT_OR_DECORATIVE,
  appIdSchema,
  ctaActionSchema,
  CTA_STYLES,
  dividerBlockSchema,
  hasAltXorDecorative,
  heroBlockSchema,
  idSchema,
  mediaFileRefSchema,
  mediaRefSchema,
  richTextBlockSchema,
} from "./blocksCore.js";
import { LIMITS } from "./limits.js";
import { localizedPlain } from "./localized.js";
import { localizedRich } from "./text.js";

const uniqueIds = (items: ReadonlyArray<{ id: string }>) => new Set(items.map((i) => i.id)).size === items.length;

/** A focal point, as fractions of the width and height (0,0 = top left). */
export const focalSchema = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/** Caption tracks for a video, one library file per language. */
export const captionTracksSchema = z
  .strictObject({ en: mediaFileRefSchema.optional(), de: mediaFileRefSchema.optional() })
  .refine((c) => c.en !== undefined || c.de !== undefined, { message: "captions need at least one language" });

export const MEDIA_KINDS = ["image", "video"] as const;

export const mediaBlockSchema = z
  .strictObject({
    id: idSchema,
    type: z.literal("media"),
    kind: z.enum(MEDIA_KINDS),
    mediaRef: mediaFileRefSchema,
    alt: localizedPlain(300).optional(),
    decorative: z.literal(true).optional(),
    caption: localizedPlain(300).optional(),
    focal: focalSchema.optional(),
    posterRef: mediaFileRefSchema.optional(),
    captions: captionTracksSchema.optional(),
  })
  .superRefine((m, ctx) => {
    if (!hasAltXorDecorative(m)) ctx.addIssue({ code: "custom", path: ["alt"], message: ALT_OR_DECORATIVE });
    if (m.kind !== "video") {
      if (m.posterRef !== undefined) ctx.addIssue({ code: "custom", path: ["posterRef"], message: "only a video has a poster" });
      if (m.captions !== undefined) ctx.addIssue({ code: "custom", path: ["captions"], message: "only a video has caption tracks" });
    }
  });

export const galleryItemSchema = z
  .strictObject({
    id: idSchema,
    mediaRef: mediaFileRefSchema,
    alt: localizedPlain(300).optional(),
    decorative: z.literal(true).optional(),
    caption: localizedPlain(300).optional(),
  })
  .refine(hasAltXorDecorative, { message: ALT_OR_DECORATIVE, path: ["alt"] });

export const galleryBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("gallery"),
  items: z.array(galleryItemSchema).min(1).max(LIMITS.maxGalleryItems).refine(uniqueIds, "item ids must be unique"),
});

export const featureItemSchema = z.strictObject({
  id: idSchema,
  title: localizedPlain(120),
  text: localizedPlain(400).optional(),
  media: mediaRefSchema.optional(),
});

export const featureGridBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("featureGrid"),
  heading: localizedPlain(200).optional(),
  items: z.array(featureItemSchema).min(1).max(LIMITS.maxFeatureItems).refine(uniqueIds, "item ids must be unique"),
});

export const benefitItemSchema = z.strictObject({
  id: idSchema,
  title: localizedPlain(120),
  text: localizedPlain(400).optional(),
});

export const benefitsBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("benefits"),
  heading: localizedPlain(200).optional(),
  items: z.array(benefitItemSchema).min(1).max(LIMITS.maxBenefitItems).refine(uniqueIds, "item ids must be unique"),
});

export const faqItemSchema = z.strictObject({
  id: idSchema,
  q: localizedPlain(300),
  a: localizedRich,
});

export const faqBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("faq"),
  heading: localizedPlain(200).optional(),
  items: z.array(faqItemSchema).min(1).max(LIMITS.maxFaqItems).refine(uniqueIds, "item ids must be unique"),
});

export const ctaBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("cta"),
  heading: localizedPlain(200).optional(),
  text: localizedPlain(400).optional(),
  label: localizedPlain(80),
  style: z.enum(CTA_STYLES),
  action: ctaActionSchema,
});

/** Either named apps (in this order) or every app the reader may see. */
export const appCardsBlockSchema = z
  .strictObject({
    id: idSchema,
    type: z.literal("appCards"),
    heading: localizedPlain(200).optional(),
    appIds: z
      .array(appIdSchema)
      .min(1)
      .max(LIMITS.maxAppCards)
      .refine((a) => new Set(a).size === a.length, "an app may appear once")
      .optional(),
    source: z.literal("all-visible").optional(),
  })
  .refine((b) => (b.appIds === undefined) !== (b.source === undefined), {
    message: "app cards need either appIds or source: 'all-visible' (not both)",
  });

const configKey = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const configScalar = z.union([z.string().max(500), z.number().finite(), z.boolean()]);

/** A live widget slot. The config is bounded plain data; the widget itself
 * is checked by the host's widget containment before it renders. */
export const widgetBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("widget"),
  widgetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "widgetId must be a widget id"),
  config: z
    .record(z.string().regex(configKey, "config keys are plain names"), z.union([configScalar, z.array(configScalar).max(20)]))
    .refine((c) => Object.keys(c).length <= LIMITS.maxWidgetConfigKeys, `a widget config holds at most ${LIMITS.maxWidgetConfigKeys} keys`)
    .optional(),
});

/** Every block that may sit inside a tab: all of them except tabs. */
export const nonTabsBlockSchema = z.discriminatedUnion("type", [
  heroBlockSchema,
  richTextBlockSchema,
  dividerBlockSchema,
  mediaBlockSchema,
  galleryBlockSchema,
  featureGridBlockSchema,
  benefitsBlockSchema,
  faqBlockSchema,
  ctaBlockSchema,
  appCardsBlockSchema,
  widgetBlockSchema,
]);

export const tabSchema = z.strictObject({
  id: idSchema,
  label: localizedPlain(60),
  blocks: z.array(nonTabsBlockSchema).max(LIMITS.maxBlocks),
});
export type Tab = z.infer<typeof tabSchema>;

export const tabsBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("tabs"),
  tabs: z.array(tabSchema).min(LIMITS.minTabs).max(LIMITS.maxTabs),
});

export const BLOCK_TYPES = [
  "hero",
  "richText",
  "divider",
  "media",
  "gallery",
  "featureGrid",
  "benefits",
  "faq",
  "cta",
  "appCards",
  "widget",
  "tabs",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** The closed union of every block: an unknown `type` is refused. */
export const blockSchema = z.discriminatedUnion("type", [...nonTabsBlockSchema.options, tabsBlockSchema]);
export type Block = z.infer<typeof blockSchema>;
