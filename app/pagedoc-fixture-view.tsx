"use client";
// Hydrates a PageDoc fixture with stub adapters (the dev-only fixture route,
// app/%5F%5Fpagedoc-fixtures/[name]/page.tsx).
// Every media item is "ready" at the route's placeholder image; each id the
// renderer asks for is recorded in window.__pagedocFixture.media, so the
// conformance spec can tell that a video resolved nothing before Play.
// data-hydrated turns "true" once React has hydrated the tree.
import { useEffect, useMemo, useRef } from "react";
import type { PageDocAdapters } from "@/lib/pagedoc/adapters.js";
import { PageDocRenderer, type PageDocTheme } from "@/lib/pagedoc/render/index.js";
import type { PageDocV2 } from "@/lib/pagedoc/schema/index.js";
import { pagedocFixtureMediaUrl } from "@/lib/pagedoc-fixtures";

interface Probe {
  media: string[];
  navigated: string[];
  actions: string[];
}

export default function FixtureView({
  doc,
  locale,
  theme,
}: {
  doc: PageDocV2;
  locale: "en" | "de";
  theme?: PageDocTheme;
}) {
  const view = useRef<HTMLDivElement>(null);
  const probe = useMemo<Probe>(() => ({ media: [], navigated: [], actions: [] }), []);
  const adapters = useMemo<PageDocAdapters>(
    () => ({
      media: {
        resolve: (mediaId) => {
          if (!probe.media.includes(mediaId)) probe.media.push(mediaId);
          return { status: "ready", url: pagedocFixtureMediaUrl(mediaId) };
        },
      },
      resolvePage: (pageId) => `/pages/${pageId}`,
      navigate: (href) => {
        probe.navigated.push(href);
      },
      widget: () => null,
      appState: () => "request",
      appAction: (appId, action) => {
        probe.actions.push(`${appId}:${action}`);
      },
      appCard: (appId) => ({ name: appId }),
      visibleApps: () => ["contracts"],
    }),
    [probe],
  );
  useEffect(() => {
    (window as unknown as { __pagedocFixture: Probe }).__pagedocFixture = probe;
    // the DOM is marked, not state: a re-render adds nothing to the test
    view.current?.setAttribute("data-hydrated", "true");
  }, [probe]);
  return (
    <div ref={view} data-pagedoc-fixture-view="" data-hydrated="false">
      <PageDocRenderer doc={doc} locale={locale} adapters={adapters} theme={theme} />
    </div>
  );
}
