// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/blocksCore.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The core blocks: hero, richText, divider, and the pieces other blocks share
// (ids, media references, the call-to-action button). PORTABLE: mirrored byte
// for byte into Atlas lib/pagedoc, so only react, react-dom, 'zod/v4' and
// relative paths inside flightdeck/pagedoc may be imported
// (scripts/check-pagedoc-portable.mjs).
//
// The content blocks (media, gallery, feature grid, benefits, FAQ, CTA, app
// cards, widget, tabs) live in blocksContent.ts, which also builds the closed
// `blockSchema` union: an unknown `type` is refused, never skipped.
import { z } from "zod/v4";
import { ID_PATTERN, MEDIA_ID_PATTERN } from "./limits.js";
import { localizedPlain } from "./localized.js";
import { isSafeHref, localizedRich } from "./text.js";

export const idSchema = z.string().regex(ID_PATTERN, "id must be 10-24 lower-case letters or digits");

/**
 * A media library item id. The doc never holds a URL: each host resolves the
 * id through its own adapter (adapters.ts mediaUrl) behind its own rights
 * check, so a doc cannot point a reader at an arbitrary origin.
 */
export const mediaIdSchema = z.string().regex(MEDIA_ID_PATTERN, "mediaId must be a 24-character library id, not a URL");

/** A bare reference to a library item (a video poster, a captions file). */
export const mediaFileRefSchema = z.strictObject({ mediaId: mediaIdSchema });
export type MediaFileRef = z.infer<typeof mediaFileRefSchema>;

/** Alt text is stored per use in the doc (plan: approval covers alt text and
 * captions), and an image without alt must say it is decorative. */
export const ALT_OR_DECORATIVE = "an image needs alt text or decorative: true (not both)";
export const hasAltXorDecorative = (m: { alt?: unknown; decorative?: unknown }) =>
  (m.alt === undefined) !== (m.decorative === undefined);

/** An inline image (hero, feature item): library id plus its per-use alt. */
export const mediaRefSchema = z
  .strictObject({
    mediaId: mediaIdSchema,
    alt: localizedPlain(300).optional(),
    decorative: z.literal(true).optional(),
  })
  .refine(hasAltXorDecorative, { message: ALT_OR_DECORATIVE });
export type MediaRef = z.infer<typeof mediaRefSchema>;

/** A sub-app id (the SUBAPP_ID_RE convention, bounded). */
export const appIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "appId must be a sub-app id");

/** The immutable page_id (a lower-case UUID), never a slug, so renaming a page never breaks a link. */
export const pageIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "pageId must be a page_id, not a slug");

/** What a call-to-action does. A link must be https (isSafeHref, and no mailto: or path). */
export const ctaActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("openApp"), appId: appIdSchema }),
  z.strictObject({ type: z.literal("requestAccess"), appId: appIdSchema }),
  z.strictObject({ type: z.literal("openPage"), pageId: pageIdSchema }),
  z.strictObject({
    type: z.literal("openUrl"),
    url: z.string().refine((u) => u.startsWith("https://") && isSafeHref(u), "openUrl needs an https:// link"),
  }),
]);
export type CtaAction = z.infer<typeof ctaActionSchema>;

export const CTA_STYLES = ["primary", "secondary"] as const;

/** A button: its label, look and action. Stored in the doc, so approval covers the destination. */
export const ctaButtonSchema = z.strictObject({
  label: localizedPlain(80),
  style: z.enum(CTA_STYLES),
  action: ctaActionSchema,
});
export type CtaButton = z.infer<typeof ctaButtonSchema>;

export const heroBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("hero"),
  heading: localizedPlain(200),
  subheading: localizedPlain(400).optional(),
  media: mediaRefSchema.optional(),
  cta: ctaButtonSchema.optional(),
});

export const richTextBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("richText"),
  content: localizedRich,
});

export const dividerBlockSchema = z.strictObject({
  id: idSchema,
  type: z.literal("divider"),
});

export const CORE_BLOCK_TYPES = ["hero", "richText", "divider"] as const;
