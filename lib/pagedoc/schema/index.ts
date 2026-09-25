// MIRROR of FlightDeck OS flightdeck/pagedoc/schema/index.ts at commit 3a0b1994affddd11d907bf030f8fa6f2e7d02bd8 (pallefar FlightDeck OS, branch integration/unified-2026-09-22). Byte-identical below this line; lib/pagedoc/MANIFEST.json holds its sha256. Change the OS copy first, never this one.
// PageDoc schema entry point. PORTABLE: mirrored byte for byte into Atlas
// lib/pagedoc, so only react, react-dom, 'zod/v4' and relative paths inside
// flightdeck/pagedoc may be imported (scripts/check-pagedoc-portable.mjs).
//
// parsePageDoc is the ONLY way a host reads a doc: it negotiates the version
// (older docs are migrated, newer ones refused as 'too_new' so the reader can
// say 'This page needs a FlightDeck update'), enforces the size, count, depth
// and id limits, then validates the closed zod schema. Nothing is half-read.
import { z } from "zod/v4";
import { PAGEDOC_SCHEMA_VERSION, pageDocV2Schema, type PageDocV2 } from "./envelope.js";
import { LIMITS, utf8Bytes } from "./limits.js";

export * from "./envelope.js";
export * from "./localized.js";
export * from "./text.js";
export * from "./blocksCore.js";
export * from "./blocksContent.js";
export * from "./layout.js";
export * from "./limits.js";

/** Every schema version this tree can read (after migration). */
export const SUPPORTED_VERSIONS: readonly number[] = [PAGEDOC_SCHEMA_VERSION];
/** Kept for the portable-tree slice's callers; the same list. */
export const PAGEDOC_READABLE_VERSIONS = SUPPORTED_VERSIONS;

/** A doc's `schemaVersion` field: only the current version parses. */
export const pageDocVersionSchema = z.literal(PAGEDOC_SCHEMA_VERSION);

export type PageDocIssueCode =
  | "schema"
  | "version"
  | "doc_too_large"
  | "block_too_large"
  | "too_many_blocks"
  | "duplicate_id"
  | "too_deep";

export interface PageDocIssue {
  code: PageDocIssueCode;
  path: Array<string | number>;
  message: string;
}

export type PageDocFailureCode = "invalid" | "too_new" | "too_old";

export type ParsePageDocResult =
  | { ok: true; doc: PageDocV2 }
  | { ok: false; code: PageDocFailureCode; issues: PageDocIssue[] };

export type MigratePageDocResult =
  | { ok: true; doc: unknown }
  | { ok: false; code: PageDocFailureCode; issues: PageDocIssue[] };

/**
 * One step per version: MIGRATIONS[n] turns a vn doc into a v(n+1) doc.
 * Empty today: v2 is the first block-body version. The v1 "page doc" is the
 * page REGISTRY record (server/ui/pageStore.ts pageDocSchema: nav metadata,
 * no body) and a legacy grid page is converted by its own audited flow
 * (plan J15), so neither is migrated here: both are 'too_old'.
 */
const MIGRATIONS: Readonly<Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>> = {};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (code: PageDocFailureCode, issue: PageDocIssue) => ({ ok: false as const, code, issues: [issue] });

/** Brings an older doc up to the current version. It does not validate the
 * result (parsePageDoc does) and never mutates its input. */
export function migratePageDoc(input: unknown): MigratePageDocResult {
  if (!isRecord(input)) return fail("invalid", { code: "schema", path: [], message: "a page doc must be an object" });
  const raw = input.schemaVersion;
  if (raw === undefined) {
    if (input.version === 1) {
      return fail("too_old", { code: "version", path: ["version"], message: "a v1 page record has no block body" });
    }
    return fail("invalid", { code: "version", path: ["schemaVersion"], message: "schemaVersion is missing" });
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return fail("invalid", { code: "version", path: ["schemaVersion"], message: "schemaVersion must be a positive integer" });
  }
  if (raw > PAGEDOC_SCHEMA_VERSION) {
    return fail("too_new", {
      code: "version",
      path: ["schemaVersion"],
      message: `schemaVersion ${raw} is newer than this FlightDeck reads (${PAGEDOC_SCHEMA_VERSION})`,
    });
  }
  let doc: Record<string, unknown> = input;
  for (let v = raw; v < PAGEDOC_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      return fail("too_old", { code: "version", path: ["schemaVersion"], message: `schemaVersion ${raw} can no longer be read` });
    }
    doc = { ...step(doc), schemaVersion: v + 1 };
  }
  return { ok: true, doc };
}

/** The keys that hold child nodes, and so add one nesting level. */
const CHILD_KEYS = ["columns", "blocks", "tabs"] as const;

/** Keys inside localized text that carry structure, not words. */
const STRUCTURAL_TEXT_KEYS = new Set(["type", "id", "href"]);

/**
 * UTF-8 bytes of TEXT in one block: every string inside a locale value (`en`
 * or `de`, both languages together), except node/mark `type`, `id` and link
 * `href`. Ids, block types and translation `basis` hashes live outside the
 * locale values and are not text, so the declared 20 KB is 20 KB of words.
 * Iterative (explicit stack), because it runs on the raw, unvalidated doc: a
 * junk property nested thousands of levels deep must produce a refusal from
 * the schema, never a stack overflow here.
 */
function textBytes(block: Record<string, unknown>): number {
  let n = 0;
  const stack: Array<[unknown, boolean]> = [[block, false]];
  while (stack.length > 0) {
    const [v, inText] = stack.pop()!;
    if (typeof v === "string") {
      if (inText) n += utf8Bytes(v);
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push([x, inText]);
    } else if (isRecord(v)) {
      for (const [k, x] of Object.entries(v)) {
        // a nested block list counts toward its own blocks, not the container's
        if (k === "blocks") continue;
        if (inText && STRUCTURAL_TEXT_KEYS.has(k)) continue;
        stack.push([x, inText || k === "en" || k === "de"]);
      }
    }
  }
  return n;
}

/** The limits zod cannot see from one node: doc-wide block count, unique ids,
 * nesting depth and per-block text size. Walks the raw (unvalidated) doc
 * generically, so it also bounds block families this tree does not know. */
function structuralIssues(doc: Record<string, unknown>): PageDocIssue[] {
  const issues: PageDocIssue[] = [];
  const sections = doc.sections;
  if (!Array.isArray(sections)) return issues;
  const seen = new Map<string, string>();
  let blocks = 0;
  const claim = (node: Record<string, unknown>, path: Array<string | number>) => {
    if (typeof node.id !== "string") return;
    const first = seen.get(node.id);
    if (first !== undefined) {
      issues.push({ code: "duplicate_id", path: [...path, "id"], message: `id '${node.id}' is already used at ${first}` });
    } else {
      seen.set(node.id, path.join("."));
    }
  };
  const visit = (node: unknown, depth: number, path: Array<string | number>, isBlock: boolean) => {
    if (!isRecord(node)) return;
    claim(node, path);
    if (isBlock) {
      blocks++;
      const bytes = textBytes(node);
      if (bytes > LIMITS.maxBlockTextBytes) {
        issues.push({
          code: "block_too_large",
          path,
          message: `block holds ${bytes} bytes of text; the limit is ${LIMITS.maxBlockTextBytes}`,
        });
      }
    }
    // list items (gallery, feature grid, benefits, FAQ) carry ids too; they
    // share the doc-wide namespace but add no nesting level
    if (isBlock && Array.isArray(node.items)) {
      node.items.forEach((item, i) => {
        if (isRecord(item)) claim(item, [...path, "items", i]);
      });
    }
    for (const key of CHILD_KEYS) {
      const children = node[key];
      if (!Array.isArray(children)) continue;
      if (depth + 1 > LIMITS.maxDepth) {
        issues.push({
          code: "too_deep",
          path: [...path, key],
          message: `nesting is limited to section > column > block > tab > block (${LIMITS.maxDepth} levels)`,
        });
        continue;
      }
      children.forEach((c, i) => visit(c, depth + 1, [...path, key, i], key === "blocks"));
    }
  };
  sections.forEach((s, i) => visit(s, 1, ["sections", i], false));
  if (blocks > LIMITS.maxBlocks) {
    issues.push({ code: "too_many_blocks", path: ["sections"], message: `${blocks} blocks; the limit is ${LIMITS.maxBlocks}` });
  }
  return issues;
}

/** Reads a doc from any source (store, import, Atlas feed, template). */
export function parsePageDoc(input: unknown): ParsePageDocResult {
  const migrated = migratePageDoc(input);
  if (!migrated.ok) return migrated;
  const doc = migrated.doc as Record<string, unknown>;

  let serialized: string;
  try {
    serialized = JSON.stringify(doc);
  } catch {
    return fail("invalid", { code: "schema", path: [], message: "the doc is not serializable JSON" });
  }
  const bytes = utf8Bytes(serialized);
  if (bytes > LIMITS.maxDocBytes) {
    return fail("invalid", { code: "doc_too_large", path: [], message: `doc is ${bytes} bytes; the limit is ${LIMITS.maxDocBytes}` });
  }

  const issues = structuralIssues(doc);
  const parsed = pageDocV2Schema.safeParse(doc);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      issues.push({ code: "schema", path: i.path.map((p) => (typeof p === "number" ? p : String(p))), message: i.message });
    }
  }
  if (issues.length > 0 || !parsed.success) return { ok: false, code: "invalid", issues };
  return { ok: true, doc: parsed.data };
}

/** A fresh id matching LIMITS.idPattern: 16 random lower-case letters/digits. */
export function newPageDocId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Returns a copy of a doc, a section, or a list of blocks in which every node
 * `id` is new and unique. The plan (section 7, Lane C) runs it on every
 * paste, duplicate and JSON import of blocks or pages. Internal
 * references are remapped: by convention a property named `...Ref` (one id)
 * or `...Refs` (a list of ids) that points at an id inside the copied value
 * follows it; a reference to something outside the copy is left as it is.
 * A widget block's `config` is opaque data owned by the widget: an `id` or
 * `...Ref` key there is a value (e.g. a customer id), not a node, so it is
 * copied unchanged.
 * The input is never mutated.
 */
export function reissueIds<T>(value: T, makeId: () => string = newPageDocId): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const children = (v: Record<string, unknown>) =>
    Object.entries(v).filter(([k]) => !(k === "config" && v.type === "widget"));
  const remap = new Map<string, string>();
  const used = new Set<string>();
  const collect = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (!isRecord(v)) return;
    if (typeof v.id === "string") used.add(v.id);
    children(v).forEach(([, x]) => collect(x));
  };
  collect(copy);
  const fresh = () => {
    for (;;) {
      const id = makeId();
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  const assign = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(assign);
    if (!isRecord(v)) return;
    if (typeof v.id === "string") {
      const id = fresh();
      remap.set(v.id, id);
      v.id = id;
    }
    children(v).forEach(([, x]) => assign(x));
  };
  assign(copy);
  const relink = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(relink);
    if (!isRecord(v)) return;
    for (const [k, x] of children(v)) {
      if (k.endsWith("Ref") && typeof x === "string") v[k] = remap.get(x) ?? x;
      else if (k.endsWith("Refs") && Array.isArray(x)) v[k] = x.map((r) => (typeof r === "string" ? (remap.get(r) ?? r) : r));
      else relink(x);
    }
  };
  relink(copy);
  return copy;
}
