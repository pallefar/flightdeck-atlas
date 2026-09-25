// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/localized.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Localized values. PORTABLE: mirrored byte for byte into Atlas lib/pagedoc,
// so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// A page is written in a source language (meta.sourceLocale) and may carry the
// other one. Content written only in German is allowed (plan J7), so neither
// locale is mandatory, but at least one is. `basis` records, per translated
// locale, the sha1 (hex) of the SOURCE text the translation was made from; the
// editor compares it with the current source to show 'Source changed since
// translation'.
import { z } from "zod/v4";

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

const SHA1_HEX = /^[0-9a-f]{40}$/;
export const basisSchema = z.strictObject({
  en: z.string().regex(SHA1_HEX, "basis must be a lower-case sha1 hex digest").optional(),
  de: z.string().regex(SHA1_HEX, "basis must be a lower-case sha1 hex digest").optional(),
});

/** Wraps a per-locale value schema into {en?, de?, basis?}, with at least one
 * locale present and a basis only for a locale that is present. */
export function localized<T extends z.ZodType>(value: T) {
  return z
    .strictObject({
      en: value.optional(),
      de: value.optional(),
      basis: basisSchema.optional(),
    })
    .superRefine((v, ctx) => {
      if (v.en === undefined && v.de === undefined) {
        ctx.addIssue({ code: "custom", message: "at least one locale (en or de) is required" });
      }
      for (const loc of LOCALES) {
        if (v.basis?.[loc] !== undefined && v[loc] === undefined) {
          ctx.addIssue({ code: "custom", path: ["basis", loc], message: `basis.${loc} without ${loc} text` });
        }
      }
    });
}

/** Plain text in one locale: non-blank, bounded, no control characters. */
export function plainText(maxChars: number) {
  return z
    .string()
    .max(maxChars)
    .refine((s) => s.trim().length > 0, "text must not be blank")
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), "control characters are not allowed");
}

export const localizedPlain = (maxChars: number) => localized(plainText(maxChars));
