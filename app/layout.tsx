import type { Metadata } from "next";
import "./globals.css";
import "./te-theme.css";
import "./settings.css";
import "./hub.css";
import "./motion.css";
import "./wellbeing.css";
import "./globe-command.css";
import "./productivity.css";
import "./suite.css";
import "./work-management.css";
import "./work-studio.css";
import "./navigation.css";
import "../lib/pagedoc/pagedoc.css";
import "./pagedoc-host.css";
import { headers } from "next/headers";
import ThemeProvider from "./theme-provider";
import { resolveRequestLocale } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/react";

export const metadata: Metadata = {
  title: "TE Connectivity | Atlas",
  description:
    "Your projects, your progress, your world. A TE-themed dashboard and globe prepared for the FlightDeck SDK.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // No profile language is stored yet, so the browser's Accept-Language
  // decides; <html lang> then carries it to the client (x-atlas-i18n).
  const locale = resolveRequestLocale(await headers());
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <I18nProvider locale={locale}>
          <ThemeProvider>{children}</ThemeProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
