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
import { json, sameOrigin } from "./http";
import { deckSchema } from "./presentations";
import type { DeckAccess, DeckAuth } from "./deck-policy";

export const DECK_EXPORT_FORMAT = "atlas-decks-v0";
/** The OS import refuses a file over DECK_IMPORT_FILE_MAX_BYTES (5 MiB); a
 * deck that would push the file past it is withheld, so the file imports. */
export const DECK_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
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
        const decks: (Record<string, unknown> & { checksum: string })[] = [],
          withheld: { id: string; reason: WithheldReason }[] = [];
        let bytes = 0;
        for (const row of rows.results) {
          let data;
          try {
            data = deckSchema.parse(JSON.parse(row.data));
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
          const deck = {
            id: row.id,
            revision: row.revision,
            updatedAt: row.updated_at,
            ...data,
          };
          const utf8 = new TextEncoder().encode(canonicalJson(deck));
          if (bytes + utf8.length > maxBytes) {
            withheld.push({ id: row.id, reason: "too_large" });
            continue;
          }
          bytes += utf8.length;
          decks.push({ ...deck, checksum: await sha256(utf8) });
        }
        return json({
          format: DECK_EXPORT_FORMAT,
          exportedAt: new Date().toISOString(),
          decks,
          withheld,
        });
      } catch {
        return json({ error: "Presentations could not be exported." }, 503);
      }
    },
  };
}
