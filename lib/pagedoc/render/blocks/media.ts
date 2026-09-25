// MIRROR of FlightDeck OS flightdeck/pagedoc/render/blocks/media.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// The media block (an image or a video) and the image every other block
// shares. PORTABLE: mirrored byte for byte into Atlas lib/pagedoc, so only
// react, react-dom, 'zod/v4' and relative paths inside flightdeck/pagedoc may
// be imported (scripts/check-pagedoc-portable.mjs).
//
// Media is never loaded by an address from the doc: the host's media adapter
// fetches the bytes (D-034) and reports loading | ready | missing | forbidden.
// Only a ready item yields an element with a src; the other states carry no
// address and no library id. A video asks for nothing but its poster until the
// reader presses Play; only then are its bytes and caption tracks resolved.
//
// A resolve call may start the host's fetch, so below-the-fold media (every
// image but the hero's, and video posters) is not resolved while rendering:
// it renders a placeholder and resolves only once an IntersectionObserver sees
// it within NEAR_VIEWPORT_MARGIN of the viewport. Native loading="lazy" alone
// would not help, because the host has already fetched the bytes by the time
// the <img> exists. Inside a hidden tab panel nothing intersects, so a hidden
// tab's media waits until the tab is shown. The server render resolves no lazy
// media (effects do not run there), which also keeps hydration consistent.
// Where IntersectionObserver does not exist the media resolves after mount.
import { createElement as h, useCallback, useEffect, useState, type ReactNode } from "react";
import type { PageDocMediaState } from "../../adapters.js";
import type { Block } from "../../schema/index.js";
import { langAttrs, pickLocalized, UI_TEXT, type RenderContext } from "../context.js";

export type MediaBlock = Extract<Block, { type: "media" }>;

type Localized = { en?: string | undefined; de?: string | undefined } | undefined;

/** The placeholder for a media item that is not ready. A decorative one says nothing. */
export function mediaStatus(state: PageDocMediaState, decorative: boolean, ctx: RenderContext): ReactNode {
  const loading = state.status === "loading";
  const text =
    state.status === "forbidden" ? UI_TEXT.mediaForbidden : state.status === "missing" ? UI_TEXT.mediaMissing : UI_TEXT.mediaLoading;
  return h(
    "div",
    {
      className: `pd-media-status pd-media-${state.status}`,
      ...(loading ? { "aria-busy": "true" } : {}),
      ...(decorative ? { "aria-hidden": "true" } : {}),
    },
    decorative ? null : text[ctx.locale],
  );
}

/** A focal point (0..1) as object-position classes in 10% steps, so the
 * renderer never writes an inline style (a strict style-src CSP host). */
function focalClasses(focal: { x: number; y: number } | undefined): string {
  if (!focal) return "";
  const step = (v: number) => Math.round(v * 10) * 10;
  return ` pd-focal pd-fx-${step(focal.x)} pd-fy-${step(focal.y)}`;
}

/** How close to the viewport lazy media starts resolving. */
export const NEAR_VIEWPORT_MARGIN = "200px";

/** The slice of IntersectionObserver used (the server typecheck has no DOM lib). */
interface NearObserver {
  observe(target: unknown): void;
  disconnect(): void;
}
type NearObserverCtor = new (
  callback: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void,
  options: { rootMargin: string },
) => NearObserver;

/**
 * True once the element given to the returned ref has come within
 * NEAR_VIEWPORT_MARGIN of the viewport (and from then on). False on the server.
 */
function useNearViewport(): [(el: unknown) => void, boolean] {
  const [el, setEl] = useState<unknown>(null);
  const [near, setNear] = useState(false);
  const ref = useCallback((node: unknown) => setEl(node), []);
  useEffect(() => {
    if (near || el === null) return;
    const IO = (globalThis as { IntersectionObserver?: NearObserverCtor }).IntersectionObserver;
    if (!IO) {
      setNear(true);
      return;
    }
    const observer = new IO(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          setNear(true);
        }
      },
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, near]);
  return [ref, near];
}

export interface ImageOptions {
  mediaId: string;
  alt: Localized;
  decorative?: boolean | undefined;
  className: string;
  /** Below-the-fold images resolve only near the viewport; the hero stays eager. */
  lazy?: boolean;
  focal?: { x: number; y: number } | undefined;
}

/** An image through the media adapter: an <img> when ready, else its status. */
export function renderImage(o: ImageOptions, ctx: RenderContext): ReactNode {
  return o.lazy ? h(LazyImage, { o, ctx }) : resolveImage(o, ctx);
}

/** Until it nears the viewport: a placeholder that names the image (role img) and asks the host for nothing. */
function LazyImage({ o, ctx }: { o: ImageOptions; ctx: RenderContext }): ReactNode {
  const [ref, near] = useNearViewport();
  if (near) return resolveImage(o, ctx);
  const alt = o.decorative === true ? null : pickLocalized(o.alt, ctx.locale, ctx.sourceLocale);
  return h("div", {
    ref,
    className: `${o.className} pd-media-deferred`,
    ...(alt ? { role: "img", "aria-label": alt.value, ...langAttrs(alt, ctx.locale) } : { "aria-hidden": "true" }),
  });
}

function resolveImage(o: ImageOptions, ctx: RenderContext): ReactNode {
  const state = ctx.adapters.media.resolve(o.mediaId);
  const decorative = o.decorative === true;
  if (state.status !== "ready") return mediaStatus(state, decorative, ctx);
  const alt = decorative ? null : pickLocalized(o.alt, ctx.locale, ctx.sourceLocale);
  return h("img", {
    className: o.className + focalClasses(o.focal),
    src: state.url,
    alt: alt ? alt.value : "",
    ...(o.lazy ? { loading: "lazy", decoding: "async" } : {}),
    ...(alt ? langAttrs(alt, ctx.locale) : {}),
  });
}

export function renderCaption(value: Localized, ctx: RenderContext): ReactNode {
  const c = pickLocalized(value, ctx.locale, ctx.sourceLocale);
  return c ? h("figcaption", { className: "pd-media-caption", ...langAttrs(c, ctx.locale) }, c.value) : null;
}

interface VideoProps {
  block: MediaBlock;
  ctx: RenderContext;
}

/** Poster and Play first (the poster once the video nears the viewport); the video and its caption tracks are resolved only after Play. */
function Video({ block, ctx }: VideoProps): ReactNode {
  const [playing, setPlaying] = useState(false);
  const [ref, near] = useNearViewport();
  const poster = block.posterRef && (near || playing) ? ctx.adapters.media.resolve(block.posterRef.mediaId) : null;
  const alt = block.decorative ? null : pickLocalized(block.alt, ctx.locale, ctx.sourceLocale);
  const label = alt ? { "aria-label": alt.value, ...langAttrs(alt, ctx.locale) } : {};
  const posterUrl = poster?.status === "ready" ? poster.url : undefined;

  if (!playing) {
    return h(
      "div",
      { className: "pd-video", ref },
      posterUrl
        ? h("img", { className: "pd-video-poster", src: posterUrl, alt: alt ? alt.value : "", ...(alt ? langAttrs(alt, ctx.locale) : {}) })
        : poster && poster.status !== "loading"
          ? mediaStatus(poster, true, ctx)
          : null,
      h("button", { type: "button", className: "pd-video-play", onClick: () => setPlaying(true) }, UI_TEXT.play[ctx.locale]),
    );
  }

  const video = ctx.adapters.media.resolve(block.mediaRef.mediaId);
  if (video.status !== "ready") return h("div", { className: "pd-video" }, mediaStatus(video, false, ctx));
  const tracks: ReactNode[] = [];
  // the reader's language first, and that track is the default
  for (const lang of [ctx.locale, ctx.locale === "en" ? "de" : "en"] as const) {
    const ref = block.captions?.[lang];
    if (!ref) continue;
    const t = ctx.adapters.media.resolve(ref.mediaId);
    if (t.status !== "ready") continue;
    tracks.push(
      h("track", {
        key: lang,
        kind: "captions",
        src: t.url,
        srcLang: lang,
        label: UI_TEXT.captionsLabel[lang],
        ...(tracks.length === 0 ? { default: true } : {}),
      }),
    );
  }
  return h(
    "div",
    { className: "pd-video" },
    h(
      "video",
      { className: "pd-video-el", src: video.url, controls: true, autoPlay: true, playsInline: true, poster: posterUrl, ...label },
      tracks,
    ),
  );
}

export function renderMedia(block: MediaBlock, ctx: RenderContext): ReactNode {
  const body =
    block.kind === "video"
      ? // keyed by the video's id: a replaced video is a new component, so Play
        // (consent to fetch) never carries over and the poster comes first again
        h(Video, { key: block.mediaRef.mediaId, block, ctx })
      : renderImage(
          {
            mediaId: block.mediaRef.mediaId,
            alt: block.alt,
            decorative: block.decorative,
            className: "pd-media-img",
            lazy: true,
            focal: block.focal,
          },
          ctx,
        );
  return h("figure", { className: "pd-media" }, body, renderCaption(block.caption, ctx));
}
