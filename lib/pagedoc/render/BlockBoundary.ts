// MIRROR of FlightDeck OS flightdeck/pagedoc/render/BlockBoundary.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// Per-block failure isolation. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// One broken block (a host adapter that throws, a widget that crashes, a block
// type this renderer does not know) must never blank the page. Two layers:
// - Section renders each block's content inside try/catch, which also holds
//   during server rendering, where React error boundaries do not run;
// - BlockBoundary, an error boundary, catches what a block's child components
//   throw in the browser (the host widget runtime, later block families).
// Both replace only that block with BlockFallback.
import { Component, createElement as h, type ReactNode } from "react";
import type { Locale } from "../schema/index.js";
import { BLOCK_ERROR_TEXT } from "./context.js";

/** Stands in for a block that failed; keeps its slot and its id. */
export function BlockFallback({ blockId, locale }: { blockId: string; locale: Locale }) {
  return h("div", { className: "pd-block pd-block-error", "data-pd-id": blockId, lang: locale }, BLOCK_ERROR_TEXT[locale]);
}

export interface BlockBoundaryProps {
  blockId: string;
  locale: Locale;
  onError?: ((blockId: string, error: unknown) => void) | undefined;
  children?: ReactNode;
}

export class BlockBoundary extends Component<BlockBoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError?.(this.props.blockId, error);
  }

  override render(): ReactNode {
    if (this.state.failed) return h(BlockFallback, { blockId: this.props.blockId, locale: this.props.locale });
    return this.props.children;
  }
}
