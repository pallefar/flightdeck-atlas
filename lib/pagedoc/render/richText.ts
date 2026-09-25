// MIRROR of FlightDeck OS flightdeck/pagedoc/render/richText.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Rich text nodes to React elements. PORTABLE: mirrored byte for byte into
// Atlas lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths
// inside flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// Every node and mark becomes an element built here; text is always a React
// text child, so markup in a doc stays text. A link is emitted only when its
// href passes isSafeHref again at render time (defence in depth for a doc that
// bypassed parsePageDoc); otherwise the run renders as plain text.
import { Fragment, createElement as h, type ReactNode } from "react";
import { isSafeHref, type RichNode, type RichText, type TextRun } from "../schema/index.js";
import type { RenderContext } from "./context.js";

interface ClickLike {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/** A same-origin link goes through the host's navigate adapter; a modified
 * click (new tab or window) and external or mailto links stay the browser's.
 * In the editor no link leaves the canvas (and the anchor has no href). */
export function onLinkClick(href: string, ctx: RenderContext) {
  return (e: ClickLike) => {
    if (ctx.editing) {
      e.preventDefault();
      return;
    }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!href.startsWith("/")) return;
    e.preventDefault();
    ctx.adapters.navigate(href);
  };
}

function renderRun(run: TextRun, key: number, ctx: RenderContext): ReactNode {
  const has = (t: string) => run.marks?.some((m) => m.type === t) ?? false;
  // Fixed nesting whatever the stored mark order: a > strong > em > code.
  let node: ReactNode = run.text;
  if (has("code")) node = h("code", null, node);
  if (has("italic")) node = h("em", null, node);
  if (has("bold")) node = h("strong", null, node);
  const link = run.marks?.find((m) => m.type === "link");
  if (link && link.type === "link" && isSafeHref(link.href)) {
    // In the editor the anchor carries no href: without one the browser offers
    // no activation path at all (middle-click, "Open link", drag-out), so the
    // target is kept only as data-pd-href for the editor to show.
    const target = ctx.editing ? { "data-pd-href": link.href } : { href: link.href };
    node = h("a", { ...target, rel: "noopener noreferrer", onClick: onLinkClick(link.href, ctx) }, node);
  }
  return h(Fragment, { key }, node);
}

function inlines(content: readonly TextRun[], ctx: RenderContext): ReactNode[] {
  return content.map((run, i) => renderRun(run, i, ctx));
}

function renderNode(node: RichNode, key: number, ctx: RenderContext): ReactNode {
  switch (node.type) {
    case "paragraph":
      return h("p", { key }, inlines(node.content, ctx));
    case "heading":
      return h(node.level === 2 ? "h2" : "h3", { key }, inlines(node.content, ctx));
    case "bulletList":
    case "orderedList":
      return h(
        node.type === "bulletList" ? "ul" : "ol",
        { key },
        node.items.map((item, i) => h("li", { key: i }, inlines(item.content, ctx))),
      );
  }
}

/** One locale's rich text as a list of elements. */
export function renderRichText(text: RichText, ctx: RenderContext): ReactNode[] {
  return text.map((node, i) => renderNode(node, i, ctx));
}
