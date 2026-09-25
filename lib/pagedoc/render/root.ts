// MIRROR of FlightDeck OS flightdeck/pagedoc/render/root.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The themed root element. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
import { createElement, type ReactNode } from "react";

/** The closed theme preset set; each host maps --pd-* to its own tokens. */
export const PAGEDOC_THEMES = ["default", "calm", "accent"] as const;
export type PageDocTheme = (typeof PAGEDOC_THEMES)[number];

export interface PageDocRootProps {
  theme: PageDocTheme;
  /** BCP 47 language of the rendered text. */
  lang: string;
  /** Inside the editor canvas. */
  editing?: boolean;
  children?: ReactNode;
}

/** The element every rendered doc sits in; pagedoc.css scopes to `.pd-root`. */
export function PageDocRoot({ theme, lang, editing, children }: PageDocRootProps) {
  return createElement(
    "div",
    { className: "pd-root", "data-pd-theme": theme, lang, ...(editing ? { "data-pd-editing": "true" } : {}) },
    children,
  );
}
