// The one Atlas i18n module (x-atlas-i18n, plan 2026-09-25 §2): English and
// German, no dependency. Each lane (onb.*, apps.*, pages.*, crm.*) adds its own
// keys to en.ts and de.ts and migrates its own strings; nothing obliges a
// whole-app migration. See README "i18n".
import { en, type MessageKey } from "./en";
import { de } from "./de";

export type { MessageKey } from "./en";
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export type Messages = Record<Locale, Record<MessageKey, string>>;
export const messages: Messages = { en, de };
export type Params = Record<string, string | number>;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** "de-AT" → "de"; anything unsupported → null. */
export function toLocale(tag: string | null | undefined): Locale | null {
  const base = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  return isLocale(base) ? base : null;
}

/** The first supported language of an Accept-Language header, by weight
 * (ties keep header order). */
export function fromAcceptLanguage(header: string | null | undefined) {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag, ...rest] = part.trim().split(";");
      const q = rest
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const entry of ranked) {
    const locale = toLocale(entry.tag);
    if (locale) return locale;
  }
  return null;
}

/** Which language to show: a saved profile preference if one exists (none is
 * stored yet), else the page's <html lang>, else the browser's
 * Accept-Language, else English. Unsupported values are skipped, never
 * guessed. */
export function resolveLocale(source: {
  preference?: string | null;
  htmlLang?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  return (
    toLocale(source.preference) ??
    toLocale(source.htmlLang) ??
    fromAcceptLanguage(source.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

const fill = (text: string, params?: Params) =>
  params
    ? text.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in params ? String(params[name]) : whole,
      )
    : text;

/** A translator over the given tables. Strict (outside production) a missing
 * key throws so the gap is found in tests and development; lenient (in
 * production) it falls back to English, then to the key itself. */
export function createTranslator(
  tables: Messages,
  { strict }: { strict: boolean },
) {
  return (key: MessageKey, locale: Locale, params?: Params): string => {
    const own = tables[locale]?.[key];
    if (own !== undefined) return fill(own, params);
    if (strict)
      throw new Error(`i18n: missing key "${key}" for locale "${locale}"`);
    return fill(tables.en[key] ?? key, params);
  };
}

export const t = createTranslator(messages, {
  strict: process.env.NODE_ENV !== "production",
});
