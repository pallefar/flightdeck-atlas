// MIRROR of FlightDeck OS flightdeck/pagedoc/render/context.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// What every block renderer receives, and locale picking. PORTABLE: mirrored
// byte for byte into Atlas lib/pagedoc, so only react, react-dom, 'zod/v4' and
// relative paths inside flightdeck/pagedoc may be imported
// (scripts/check-pagedoc-portable.mjs).
import type { PageDocAdapters } from "../adapters.js";
import type { Locale } from "../schema/index.js";

export interface RenderContext {
  /** The language the reader asked for. */
  locale: Locale;
  /** The language the page is written in (doc.meta.sourceLocale). */
  sourceLocale: Locale;
  adapters: PageDocAdapters;
  /** Inside the editor canvas: links do not navigate. */
  editing: boolean;
  onBlockError?: ((blockId: string, error: unknown) => void) | undefined;
}

export interface Picked<T> {
  value: T;
  /** The language `value` is written in. */
  lang: Locale;
  /** True when `value` is not in the requested locale. */
  fallback: boolean;
}

const other = (l: Locale): Locale => (l === "en" ? "de" : "en");

/**
 * The value of a localized field: the requested locale, else the other
 * locale, else the source locale. Null only when the field is absent (the
 * schema requires at least one locale in a present field).
 */
export function pickLocalized<T>(
  value: { en?: T | undefined; de?: T | undefined } | undefined,
  locale: Locale,
  sourceLocale: Locale,
): Picked<T> | null {
  if (!value) return null;
  for (const l of [locale, other(locale), sourceLocale]) {
    const v = value[l];
    if (v !== undefined) return { value: v, lang: l, fallback: l !== locale };
  }
  return null;
}

/** Attributes for an element holding picked text: fallback text says which
 * language it is really in (WCAG 3.1.2) and that the translation is missing. */
export function langAttrs(picked: Picked<unknown>, locale: Locale): Record<string, string> {
  return picked.fallback ? { lang: picked.lang, "data-missing-translation": locale } : {};
}

/** The renderer's built-in words: the failed-block notice. */
export const BLOCK_ERROR_TEXT: Readonly<Record<Locale, string>> = {
  en: "This block could not be shown.",
  de: "Dieser Block kann nicht angezeigt werden.",
};

/** The renderer's other built-in words: media states, the video's Play
 * button, app and page button labels and the widget and app-card notices. */
export const UI_TEXT = {
  mediaLoading: { en: "Loading media…", de: "Medien werden geladen …" },
  mediaMissing: { en: "This media is no longer available.", de: "Dieses Medium ist nicht mehr verfügbar." },
  mediaForbidden: { en: "You do not have access to this media.", de: "Sie haben keinen Zugriff auf dieses Medium." },
  play: { en: "Play video", de: "Video abspielen" },
  appEnter: { en: "Open", de: "Öffnen" },
  appEnable: { en: "Enable app", de: "App aktivieren" },
  appRequest: { en: "Request access", de: "Zugang anfragen" },
  appPending: { en: "Access requested", de: "Zugang angefragt" },
  appDenied: { en: "Access denied", de: "Zugang abgelehnt" },
  appUnavailable: { en: "Not available", de: "Nicht verfügbar" },
  pageGone: { en: "Page no longer available", de: "Seite nicht mehr verfügbar" },
  noApps: { en: "No apps available.", de: "Keine Apps verfügbar." },
  widgetOffline: { en: "Open in FlightDeck OS to see live data", de: "In FlightDeck OS öffnen, um Live-Daten zu sehen" },
  captionsLabel: { en: "English", de: "Deutsch" },
} as const satisfies Record<string, Readonly<Record<Locale, string>>>;
