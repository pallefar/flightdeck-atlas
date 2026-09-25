// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/text.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Rich text: a restricted node tree. PORTABLE: mirrored byte for byte into
// Atlas lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths
// inside flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// There is no HTML anywhere in a PageDoc: the renderer builds elements from
// these nodes, so markup cannot be smuggled in as text. The node set is closed:
// paragraph, heading (level 2 or 3; the page title is the h1), bullet and
// ordered lists of plain inline runs, and text runs with bold, italic, code and
// link marks. A link's href must pass isSafeHref.
import { z } from "zod/v4";
import { LIMITS } from "./limits.js";
import { localized } from "./localized.js";

/**
 * True only for an href the renderer may emit:
 * - `https:` with a host;
 * - `mailto:` with an address;
 * - a same-origin path starting with exactly one '/'.
 * Refused: every other scheme (javascript:, data:, http:, vbscript: ...), a
 * protocol-relative '//host', any backslash (browsers read '\' as '/'), any
 * whitespace or control character, and a relative path.
 */
export function isSafeHref(href: unknown): boolean {
  if (typeof href !== "string" || href.length === 0 || href.length > 2048) return false;
  if (/[\s\u0000-\u001f\u007f\\]/.test(href)) return false;
  if (href.startsWith("/")) return !href.startsWith("//");
  if (/^mailto:/i.test(href)) return /^mailto:[^/?#@]+@[^/?#@]+(\?.*)?$/i.test(href);
  if (!href.startsWith("https://")) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === "";
}

export const hrefSchema = z.string().refine(isSafeHref, "link must be https:, mailto: or a path starting with a single '/'");

const markSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bold") }),
  z.strictObject({ type: z.literal("italic") }),
  z.strictObject({ type: z.literal("code") }),
  z.strictObject({ type: z.literal("link"), href: hrefSchema }),
]);

export const textRunSchema = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z
    .array(markSchema)
    .max(4)
    .refine((ms) => new Set(ms.map((m) => m.type)).size === ms.length, "a mark may appear once per run")
    .optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;

const inlines = z.array(textRunSchema).max(500);

const listItemSchema = z.strictObject({ content: inlines });

export const richNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("paragraph"), content: inlines }),
  z.strictObject({ type: z.literal("heading"), level: z.union([z.literal(2), z.literal(3)]), content: inlines }),
  z.strictObject({ type: z.literal("bulletList"), items: z.array(listItemSchema).min(1).max(LIMITS.maxListItems) }),
  z.strictObject({ type: z.literal("orderedList"), items: z.array(listItemSchema).min(1).max(LIMITS.maxListItems) }),
]);
export type RichNode = z.infer<typeof richNodeSchema>;

/** One locale's rich text: a list of top-level nodes. */
export const richTextSchema = z.array(richNodeSchema).min(1).max(500);
export type RichText = z.infer<typeof richTextSchema>;

export const localizedRich = localized(richTextSchema);
