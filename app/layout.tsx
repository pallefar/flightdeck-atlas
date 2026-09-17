import type { Metadata } from "next";
import "./globals.css";
import "./te-theme.css";
import ThemeProvider from "./theme-provider";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
