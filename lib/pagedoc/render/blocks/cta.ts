// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/cta.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The call-to-action block, and the button the hero shares with it.
// PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only react,
// react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may be
// imported (scripts/check-pagedoc-portable.mjs).
//
// What the button says and does comes from the host's state, never from the
// label alone (plan 2026-09-25: "the real state beats the editorial label"):
// - openApp / requestAccess: adapters.appState(appId) gives one of six
//   states. The author's label is shown only when the state is the one the
//   author meant (enter for openApp, request for requestAccess); otherwise the
//   state's own label. enter, enable and request are buttons that call
//   adapters.appAction; pending, denied and unavailable are disabled.
// - openPage: adapters.resolvePage(pageId) (the immutable page_id). A page the
//   host cannot resolve is a disabled "Page no longer available".
// - openUrl: a plain https link, checked again here.
// In the editor nothing acts: a link has no href and a button does nothing.
import { createElement as h, type ReactNode } from "react";
import type { PageDocAppAction, PageDocAppState } from "../../adapters.js";
import { isSafeHref, type Block, type CtaButton } from "../../schema/index.js";
import { langAttrs, pickLocalized, UI_TEXT, type RenderContext } from "../context.js";
import { onLinkClick } from "../richText.js";
import { localizedText } from "./text.js";

export type CtaBlock = Extract<Block, { type: "cta" }>;

const STATE_LABEL: Readonly<Record<PageDocAppState, Readonly<Record<"en" | "de", string>>>> = {
  enter: UI_TEXT.appEnter,
  enable: UI_TEXT.appEnable,
  request: UI_TEXT.appRequest,
  pending: UI_TEXT.appPending,
  denied: UI_TEXT.appDenied,
  unavailable: UI_TEXT.appUnavailable,
};

const ACTIONABLE: ReadonlySet<PageDocAppState> = new Set<PageDocAppState>(["enter", "enable", "request"]);

/** A button for a sub-app in its current state. `authorLabel` wins only in `authorState`. */
export function appButton(
  appId: string,
  className: string,
  ctx: RenderContext,
  authorLabel?: { text: ReactNode; attrs: Record<string, string>; state: PageDocAppState },
): ReactNode {
  const state = ctx.adapters.appState(appId);
  const own = authorLabel && authorLabel.state === state;
  const label = own ? authorLabel.text : STATE_LABEL[state][ctx.locale];
  if (!ACTIONABLE.has(state)) {
    return h("button", { type: "button", className: `${className} pd-button-disabled`, disabled: true }, label);
  }
  return h(
    "button",
    {
      type: "button",
      className,
      ...(own ? authorLabel.attrs : {}),
      onClick: () => {
        if (!ctx.editing) ctx.adapters.appAction(appId, state as PageDocAppAction);
      },
    },
    label,
  );
}

/** A CTA button (the CTA block's and the hero's). */
export function renderCtaButton(button: CtaButton, ctx: RenderContext): ReactNode {
  const className = `pd-button pd-button-${button.style}`;
  const picked = pickLocalized(button.label, ctx.locale, ctx.sourceLocale);
  const text = picked ? picked.value : "";
  const attrs = picked ? langAttrs(picked, ctx.locale) : {};
  const action = button.action;
  switch (action.type) {
    case "openApp":
    case "requestAccess":
      return appButton(action.appId, className, ctx, {
        text,
        attrs,
        state: action.type === "openApp" ? "enter" : "request",
      });
    case "openPage": {
      const href = ctx.adapters.resolvePage(action.pageId);
      if (href === null || !isSafeHref(href)) {
        return h("button", { type: "button", className: `${className} pd-button-disabled`, disabled: true }, UI_TEXT.pageGone[ctx.locale]);
      }
      return link(href, className, text, attrs, ctx);
    }
    case "openUrl":
      if (!action.url.startsWith("https://") || !isSafeHref(action.url)) {
        return h("button", { type: "button", className: `${className} pd-button-disabled`, disabled: true }, text);
      }
      return link(action.url, className, text, attrs, ctx);
  }
}

function link(href: string, className: string, text: string, attrs: Record<string, string>, ctx: RenderContext): ReactNode {
  const target = ctx.editing ? { "data-pd-href": href } : { href };
  return h("a", { ...target, className, rel: "noopener noreferrer", onClick: onLinkClick(href, ctx), ...attrs }, text);
}

export function renderCta(block: CtaBlock, ctx: RenderContext): ReactNode {
  return h(
    "div",
    { className: "pd-cta" },
    localizedText("h2", "pd-block-heading", block.heading, ctx),
    localizedText("p", "pd-cta-text", block.text, ctx),
    renderCtaButton({ label: block.label, style: block.style, action: block.action }, ctx),
  );
}
