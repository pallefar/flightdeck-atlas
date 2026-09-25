// Owner-only export of Atlas decks for the FlightDeck OS import
// (deck-atlas-export). The route file wires in the real authorisation,
// projectFor() and the D1 binding; no Worker bindings are imported here so
// tests/deck-export.spec.ts runs the same handler.
//
// Fails closed:
// - same origin and a signed-in caller, or nothing is read;
// - only decks the caller OWNS are read; a shared deck of someone else is
//   never exported and never named;
// - every source project is re-checked now: a deck with one source the owner
//   can no longer read is withheld (reported by deck id only, never by which
//   project), because exporting it would copy source data the owner lost;
// - a rights lookup or database that errors refuses the whole export (503).
//
// Each deck is written in the Atlas v0 shape the OS reads with its strict
// atlasV0Schema (flightdeck/deckdoc/migrate/atlasV0.ts), plus a `checksum`:
// the sha256 of the deck's canonical JSON, which the OS import pairs with the
// deck id for idempotency (D-048). The OS reader must drop `checksum` before
// it validates the deck.
import { z } from "zod";
import { json, sameOrigin } from "./http";
import { deckSchema } from "./presentations";
import type { DeckAccess, DeckAuth } from "./deck-policy";

export const DECK_EXPORT_FORMAT = "atlas-decks-v0";
/** The OS import refuses a file over DECK_IMPORT_FILE_MAX_BYTES (5 MiB); a
 * deck that would push the DOWNLOADED FILE (envelope, checksums, withheld
 * report and indentation included) past it is withheld, so the file imports. */
export const DECK_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
/** The exact text the Studio saves as the export file. The size budget is
 * taken over these bytes, so both sides must use this one function. */
export function serializeDeckExport(body: unknown): string {
  return JSON.stringify(body, null, 2);
}
/** The whole deck as the OS atlasV0Schema reads it. deckSchema checks only the
 * stored data; the identity comes from the row, and the POST handler accepts
 * any string id, so the assembled deck is checked here: a deck the import
 * would refuse is withheld as `invalid`, never announced as exported. */
const importSchema = deckSchema
  .extend({
    id: z.string().min(1).max(80),
    revision: z.number().int(),
    updatedAt: z.string().max(80),
  })
  .strict();
const utf8Length = (text: string) => new TextEncoder().encode(text).length;
export type WithheldReason = "source_unavailable" | "invalid" | "too_large";
export type DeckExportDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
  };
};
type Row = { id: string; data: string; revision: number; updated_at: string };

/** JSON with object keys sorted at every level: the bytes the checksum is
 * taken over, independent of key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
async function sha256(utf8: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", utf8);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createDeckExportRoute<A extends DeckAccess>(deps: {
  authorize: () => Promise<DeckAuth<A>>;
  database: () => DeckExportDb;
  /** True only when the caller can read that source project now. */
  canReadSource: (access: A, projectId: string) => Promise<boolean>;
  maxBytes?: number;
}) {
  const maxBytes = deps.maxBytes ?? DECK_EXPORT_MAX_BYTES;
  return {
    async GET(req: Request) {
      if (!sameOrigin(req))
        return json({ error: "Request origin is not allowed." }, 403);
      const a = await deps.authorize();
      if (a.error) return a.error;
      try {
        const rows = await deps
          .database()
          .prepare(
            "SELECT id, data, revision, updated_at FROM atlas_decks WHERE owner_id=? ORDER BY updated_at DESC, id DESC",
          )
          .bind(a.access.userId)
          .all<Row>();
        type Exported = Record<string, unknown> & {
          id: string;
          checksum: string;
        };
        const eligible: Exported[] = [],
          withheld: { id: string; reason: WithheldReason }[] = [];
        for (const row of rows.results) {
          let data, deck;
          try {
            data = deckSchema.parse(JSON.parse(row.data));
            deck = {
              id: row.id,
              revision: row.revision,
              updatedAt: row.updated_at,
              ...data,
            };
            importSchema.parse(deck);
          } catch {
            withheld.push({ id: row.id, reason: "invalid" });
            continue;
          }
          let readable = true;
          for (const pid of data.projectIds)
            if (!(await deps.canReadSource(a.access, pid))) {
              readable = false;
              break;
            }
          if (!readable) {
            withheld.push({ id: row.id, reason: "source_unavailable" });
            continue;
          }
          const utf8 = new TextEncoder().encode(canonicalJson(deck));
          eligible.push({ ...deck, checksum: await sha256(utf8) });
        }
        const body = {
          format: DECK_EXPORT_FORMAT,
          exportedAt: new Date().toISOString(),
          decks: [] as Exported[],
          withheld,
        };
        // Budget the downloaded file itself. A deck sits in the file at
        // indentation depth 2: its own pretty text with every line indented
        // 4 more, then ",\n" between elements; a non-empty array is "[\n"
        // ... "\n  ]" (6 bytes) where the empty one measured here is "[]".
        const fileSize = (deckBytes: number, count: number) =>
          utf8Length(serializeDeckExport({ ...body, decks: [] })) +
          (count ? deckBytes + 2 * count + 2 : 0);
        let deckBytes = 0;
        for (const deck of eligible) {
          const text = serializeDeckExport(deck);
          const size = utf8Length(text) + 4 * (text.split("\n").length - 1) + 4;
          if (fileSize(deckBytes + size, body.decks.length + 1) > maxBytes) {
            withheld.push({ id: deck.id, reason: "too_large" });
            continue;
          }
          deckBytes += size;
          body.decks.push(deck);
        }
        // The withheld entries added after a deck was accepted can still
        // push the file over: measure the real bytes and give back decks,
        // newest-accepted last, until it fits (fails closed on the limit).
        while (utf8Length(serializeDeckExport(body)) > maxBytes) {
          const last = body.decks.pop();
          if (!last)
            return json({ error: "Presentations could not be exported." }, 503);
          withheld.push({ id: last.id, reason: "too_large" });
        }
        return json(body);
      } catch {
        return json({ error: "Presentations could not be exported." }, 503);
      }
    },
  };
}
