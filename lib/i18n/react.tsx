"use client";
/** @jsxImportSource react */
// (The pragma keeps React's own JSX runtime when a Playwright spec renders
// the provider in Node, as tests/workspace-tools-apps.spec.ts does.)
import { createContext, useCallback, useContext } from "react";
import {
  DEFAULT_LOCALE,
  t,
  type Locale,
  type MessageKey,
  type Params,
} from "./index";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

/** Set once in the root layout from the server's resolveRequestLocale; a
 * component rendered outside it reads English. */
export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);

/** t() bound to the provider's locale. */
export function useT() {
  const locale = useLocale();
  return useCallback(
    (key: MessageKey, params?: Params) => t(key, locale, params),
    [locale],
  );
}
