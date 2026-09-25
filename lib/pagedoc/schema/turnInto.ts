// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/turnInto.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// "Turn into": converting one block into a compatible block family. PORTABLE:
// mirrored byte for byte into Atlas lib/pagedoc, so only react, react-dom,
// 'zod/v4' and relative paths inside flightdeck/pagedoc may be imported
// (scripts/check-pagedoc-portable.mjs).
//
// Pure: the input is never mutated, the block keeps its id, and nothing is
// silently dropped. A conversion either preserves all content (`lossy: []`) or
// names every field path it could not carry (`lossy: ["media", "items.8"]`),
// so the editor can say what will be lost before the author confirms. A
// conversion that would need content the source does not have (a hero with no
// button cannot become a CTA) is refused as 'incomplete' with the missing
// fields. The result is validated against the block schema before it is
// returned: an invalid block is never handed back.
import { newPageDocId } from "./index.js";
import { blockSchema, type Block, type BlockType } from "./blocksContent.js";
import { LIMITS } from "./limits.js";
import { LOCALES, type Locale } from "./localized.js";
import type { RichNode, RichText } from "./text.js";

/** Which block families each block may be turned into. */
export const TURN_INTO_TARGETS: Readonly<Record<BlockType, readonly BlockType[]>> = {
  hero: ["cta"],
  cta: ["hero"],
  featureGrid: ["benefits"],
  benefits: ["featureGrid"],
  richText: ["faq"],
  divider: [],
  media: [],
  gallery: [],
  faq: [],
  appCards: [],
  widget: [],
  tabs: [],
};

export type TurnIntoResult =
  | { ok: true; block: Block; lossy: string[] }
  | { ok: false; reason: "unsupported" }
  | { ok: false; reason: "incomplete"; missing: string[] };

type Of<T extends BlockType> = Extract<Block, { type: T }>;
type Draft = { block: Record<string, unknown>; lossy: string[] } | { missing: string[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function heroToCta(b: Of<"hero">): Draft {
  if (!b.cta) return { missing: ["cta"] };
  const out: Record<string, unknown> = { id: b.id, type: "cta", heading: b.heading };
  if (b.subheading) out.text = b.subheading;
  Object.assign(out, b.cta);
  return { block: out, lossy: b.media ? ["media"] : [] };
}

function ctaToHero(b: Of<"cta">): Draft {
  // a CTA without its own heading shows its label as the hero heading
  const out: Record<string, unknown> = { id: b.id, type: "hero", heading: b.heading ?? b.label };
  if (b.text) out.subheading = b.text;
  out.cta = { label: b.label, style: b.style, action: b.action };
  return { block: out, lossy: [] };
}

function featureGridToBenefits(b: Of<"featureGrid">): Draft {
  const lossy: string[] = [];
  const items = b.items.flatMap((item, i) => {
    if (i >= LIMITS.maxBenefitItems) {
      lossy.push(`items.${i}`);
      return [];
    }
    if (item.media) lossy.push(`items.${i}.media`);
    return [{ id: item.id, title: item.title, ...(item.text ? { text: item.text } : {}) }];
  });
  return { block: { id: b.id, type: "benefits", ...(b.heading ? { heading: b.heading } : {}), items }, lossy };
}

function benefitsToFeatureGrid(b: Of<"benefits">): Draft {
  return { block: { ...b, type: "featureGrid" }, lossy: [] };
}

const QUESTION_MAX_CHARS = 300;

/** Headings become questions; the nodes up to the next heading become the answer. */
function richTextToFaq(b: Of<"richText">, makeId: () => string): Draft {
  const lossy: string[] = [];
  const perLocale: Partial<Record<Locale, Array<{ q: string; a: RichText }>>> = {};
  for (const loc of LOCALES) {
    const nodes = b.content[loc];
    if (!nodes) continue;
    const pairs: Array<{ q: string; a: RichNode[] }> = [];
    let current: { q: string; a: RichNode[] } | null = null;
    nodes.forEach((node, i) => {
      const at = `content.${loc}.${i}`;
      if (node.type !== "heading") {
        if (current) current.a.push(node);
        else lossy.push(at);
        return;
      }
      let q = node.content.map((r) => r.text).join("");
      if (node.content.some((r) => r.marks && r.marks.length > 0)) lossy.push(`${at}.marks`);
      if (q.length > QUESTION_MAX_CHARS) {
        q = q.slice(0, QUESTION_MAX_CHARS);
        lossy.push(at);
      }
      if (q.trim().length === 0 || pairs.length >= LIMITS.maxFaqItems) {
        // a blank heading cannot be a question, and a FAQ holds maxFaqItems
        lossy.push(at);
        current = null;
        return;
      }
      current = { q, a: [] };
      pairs.push(current);
    });
    perLocale[loc] = pairs.map((p) => ({ q: p.q, a: p.a.length > 0 ? p.a : [{ type: "paragraph", content: [] }] }));
  }
  if (b.content.basis) lossy.push("content.basis");
  const count = Math.max(0, ...LOCALES.map((l) => perLocale[l]?.length ?? 0));
  if (count === 0) return { missing: ["content.heading"] };
  const items = Array.from({ length: count }, (_, i) => {
    const q: Record<string, string> = {};
    const a: Record<string, RichText> = {};
    for (const loc of LOCALES) {
      const pair = perLocale[loc]?.[i];
      if (pair) {
        q[loc] = pair.q;
        a[loc] = pair.a;
      }
    }
    return { id: makeId(), q, a };
  });
  return { block: { id: b.id, type: "faq", items }, lossy };
}

/**
 * Converts `block` into a block of type `to`. `makeId` issues ids for new
 * list items (richText -> faq); it defaults to newPageDocId.
 */
export function turnInto(block: Block, to: BlockType, makeId: () => string = newPageDocId): TurnIntoResult {
  if (!TURN_INTO_TARGETS[block.type].includes(to)) return { ok: false, reason: "unsupported" };
  const b = clone(block);
  let draft: Draft;
  if (b.type === "hero") draft = heroToCta(b);
  else if (b.type === "cta") draft = ctaToHero(b);
  else if (b.type === "featureGrid") draft = featureGridToBenefits(b);
  else if (b.type === "benefits") draft = benefitsToFeatureGrid(b);
  else if (b.type === "richText") draft = richTextToFaq(b, makeId);
  else return { ok: false, reason: "unsupported" };
  if ("missing" in draft) return { ok: false, reason: "incomplete", missing: draft.missing };
  const parsed = blockSchema.safeParse(draft.block);
  if (!parsed.success) {
    return { ok: false, reason: "incomplete", missing: parsed.error.issues.map((i) => i.path.join(".") || "block") };
  }
  return { ok: true, block: parsed.data, lossy: draft.lossy };
}
