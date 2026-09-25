// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/tabs.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The tabs block, as the WAI-ARIA tabs pattern (APG "Tabs with automatic
// activation"): a tablist of buttons with aria-selected and aria-controls, one
// tabpanel per tab labelled by its tab, and a roving tabindex, so Tab enters
// the list once and ArrowLeft/ArrowRight (wrapping), Home and End move focus
// and selection together. Every panel is rendered (the hidden ones with
// `hidden`), so the server markup carries all the text.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
import { createElement as h, useRef, useState, type ReactNode } from "react";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, type RenderContext } from "../context.js";

export type TabsBlock = Extract<Block, { type: "tabs" }>;
type Inner = TabsBlock["tabs"][number]["blocks"][number];

interface TabView {
  id: string;
  label: ReactNode;
  labelAttrs: Record<string, string>;
  body: ReactNode;
}

/** The one DOM method used (the server typecheck has no DOM lib). */
interface Focusable {
  focus(): void;
}

interface KeyLike {
  key: string;
  preventDefault(): void;
}

function Tabs({ tabs }: { tabs: TabView[] }): ReactNode {
  // Selection is held by tab id, not position, from the first render on: when
  // an editor reorders the tabs the tab the reader sees stays selected (chosen
  // or initial), and when the selected tab is deleted the first remaining tab
  // takes over and its id is stored, so there is always one selected panel and
  // one tab stop.
  const [selectedId, setSelectedId] = useState<string | null>(() => tabs[0]?.id ?? null);
  const found = selectedId === null ? -1 : tabs.findIndex((t) => t.id === selectedId);
  const selected = found === -1 ? 0 : found;
  const fallbackId = found === -1 ? (tabs[0]?.id ?? null) : selectedId;
  // adjusting state while rendering (React's documented pattern for state
  // derived from props): React re-renders at once, before the DOM is touched
  if (fallbackId !== selectedId) setSelectedId(fallbackId);
  const refs = useRef<Array<Focusable | null>>([]);

  const select = (i: number) => {
    const t = tabs[i];
    if (!t) return;
    setSelectedId(t.id);
    refs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyLike) => {
    const last = tabs.length - 1;
    const next =
      e.key === "ArrowRight" ? (selected === last ? 0 : selected + 1)
      : e.key === "ArrowLeft" ? (selected === 0 ? last : selected - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return h(
    "div",
    { className: "pd-tabs" },
    h(
      "div",
      { className: "pd-tablist", role: "tablist" },
      tabs.map((t, i) =>
        h(
          "button",
          {
            key: t.id,
            ref: (el: unknown) => {
              refs.current[i] = el as Focusable | null;
            },
            type: "button",
            role: "tab",
            id: `pd-tab-${t.id}`,
            className: "pd-tab",
            "aria-selected": i === selected ? "true" : "false",
            "aria-controls": `pd-tabpanel-${t.id}`,
            tabIndex: i === selected ? 0 : -1,
            onClick: () => select(i),
            onKeyDown,
            ...t.labelAttrs,
          },
          t.label,
        ),
      ),
    ),
    tabs.map((t, i) =>
      h(
        "div",
        {
          key: t.id,
          role: "tabpanel",
          id: `pd-tabpanel-${t.id}`,
          className: "pd-tabpanel",
          "aria-labelledby": `pd-tab-${t.id}`,
          tabIndex: 0,
          hidden: i !== selected,
        },
        t.body,
      ),
    ),
  );
}

/** `renderBlock` is Section's per-block renderer (isolation included), passed in to avoid an import cycle. */
export function renderTabs(block: TabsBlock, ctx: RenderContext, renderBlock: (b: Inner, ctx: RenderContext) => ReactNode): ReactNode {
  const tabs: TabView[] = block.tabs.map((tab) => {
    const label = pickLocalized(tab.label, ctx.locale, ctx.sourceLocale);
    return {
      id: tab.id,
      label: label ? label.value : "",
      labelAttrs: label ? langAttrs(label, ctx.locale) : {},
      body: tab.blocks.map((b) => renderBlock(b, ctx)),
    };
  });
  return h(Tabs, { tabs });
}
