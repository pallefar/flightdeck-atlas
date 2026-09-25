// Write policy for /api/decks. The route file wires in the real
// authorisation, projectFor() rights and the D1 binding; no Worker bindings
// are imported here so tests/deck-policy.spec.ts runs the same handlers.
//
// Fails closed:
// - create: edit on EVERY source project;
// - update: the owner AND edit on every source project;
// - delete: the owner (a deck is the owner's own artefact; removing it
//   discloses nothing from the sources);
// - a missing, unreadable or erroring rights lookup refuses the write.
// GET stays in the route file and is unchanged.
import { json, sameOrigin } from "./http";
import { deckSchema } from "./presentations";
export type SourceRights = { edit: boolean } | null;
export type DeckAccess = { userId: string };
export type DeckAuth<A extends DeckAccess = DeckAccess> =
  { access: A; error?: never } | { access?: never; error: Response };
export type DeckDb = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number } }>;
    };
  };
};
export type DeckPolicyCode =
  "deck_source_unavailable" | "deck_source_read_only" | "deck_not_owner";
export type DeckDecision =
  | { ok: true }
  | { ok: false; status: 403; code: DeckPolicyCode; error: string };
type RightsLookup<A extends DeckAccess = DeckAccess> = (
  access: A,
  id: string,
) => Promise<SourceRights>;
const messages: Record<DeckPolicyCode, string> = {
  deck_source_unavailable:
    "Source project access changed. Reload before saving.",
  deck_source_read_only:
    "You can view but not edit a source project of this presentation.",
  deck_not_owner: "Only the owner can change or remove this presentation.",
};
const deny = (code: DeckPolicyCode): DeckDecision => ({
  ok: false,
  status: 403,
  code,
  error: messages[code],
});
export async function deckWriteDecision<A extends DeckAccess>(input: {
  op: "create" | "update" | "delete";
  actorId: string;
  ownerId?: string | null;
  projectIds: string[];
  access: A;
  sourceRights: RightsLookup<A>;
}): Promise<DeckDecision> {
  if (
    input.op !== "create" &&
    (!input.ownerId || input.ownerId !== input.actorId)
  )
    return deny("deck_not_owner");
  if (input.op === "delete") return { ok: true };
  if (!input.projectIds.length) return deny("deck_source_unavailable");
  for (const id of input.projectIds) {
    const r = await input.sourceRights(input.access, id);
    if (!r) return deny("deck_source_unavailable");
    if (r.edit !== true) return deny("deck_source_read_only");
  }
  return { ok: true };
}
const stale = (error: string) => json({ error, code: "deck_stale" }, 409);
const refused = (d: Exclude<DeckDecision, { ok: true }>) =>
  json({ error: d.error, code: d.code }, d.status);
export function createDeckWriteRoute<A extends DeckAccess>(deps: {
  authorize: () => Promise<DeckAuth<A>>;
  database: () => DeckDb;
  sourceRights: RightsLookup<A>;
}) {
  const owner = async (db: DeckDb, id: string) =>
    await db
      .prepare("SELECT owner_id, revision FROM atlas_decks WHERE id=?")
      .bind(id)
      .first<{ owner_id: string; revision: number }>();
  return {
    async POST(req: Request) {
      if (!sameOrigin(req))
        return json({ error: "Request origin is not allowed." }, 403);
      const a = await deps.authorize();
      if (a.error) return a.error;
      let b: { id?: unknown; revision?: unknown },
        data: ReturnType<typeof deckSchema.parse>;
      try {
        const raw = await req.text();
        if (raw.length > 450000)
          return json({ error: "Presentation is too large." }, 400);
        b = JSON.parse(raw);
        data = deckSchema.parse((b as { data?: unknown }).data);
        if (
          (b.id != null && typeof b.id !== "string") ||
          (b.revision != null &&
            !(Number.isInteger(b.revision) && Number(b.revision) >= 0))
        )
          throw Error("Invalid identity");
      } catch {
        return json(
          {
            error:
              "Presentation could not be saved. Check slide lengths and source selection.",
          },
          400,
        );
      }
      if (data.snapshots.some((s) => !data.projectIds.includes(s.id)))
        return json({ error: "Invalid source snapshot." }, 400);
      try {
        const db = deps.database(),
          id = (b.id as string | undefined) || crypto.randomUUID(),
          revision = Number(b.revision || 0),
          at = new Date().toISOString();
        let ownerId: string | null = null;
        if (revision) {
          const row = await owner(db, id);
          if (!row)
            return stale(
              "Presentation changed or was removed. Reload before saving.",
            );
          ownerId = row.owner_id;
        }
        const d = await deckWriteDecision({
          op: revision ? "update" : "create",
          actorId: a.access.userId,
          ownerId,
          projectIds: data.projectIds,
          access: a.access,
          sourceRights: deps.sourceRights,
        });
        if (!d.ok) return refused(d);
        // owner_id stays in the WHERE so an ownership change between the
        // check and the write still cannot let someone else's deck through.
        const r = revision
          ? await db
              .prepare(
                "UPDATE atlas_decks SET data=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?",
              )
              .bind(JSON.stringify(data), at, id, a.access.userId, revision)
              .run()
          : await db
              .prepare(
                "INSERT OR IGNORE INTO atlas_decks(id,owner_id,data,revision,updated_at) VALUES (?,?,?,1,?)",
              )
              .bind(id, a.access.userId, JSON.stringify(data), at)
              .run();
        return r.meta.changes
          ? json({
              deck: {
                ...data,
                id,
                revision: revision + 1,
                updatedAt: at,
                canEdit: true,
              },
            })
          : stale(
              "Presentation changed or is read-only. Reload before saving.",
            );
      } catch {
        return json({ error: "Presentations are unavailable." }, 503);
      }
    },
    async DELETE(req: Request) {
      if (!sameOrigin(req))
        return json({ error: "Request origin is not allowed." }, 403);
      const a = await deps.authorize();
      if (a.error) return a.error;
      const u = new URL(req.url),
        id = u.searchParams.get("id") || "",
        revision = Number(u.searchParams.get("revision"));
      try {
        const db = deps.database(),
          row = await owner(db, id);
        if (!row) return stale("Presentation changed or was removed.");
        const d = await deckWriteDecision({
          op: "delete",
          actorId: a.access.userId,
          ownerId: row.owner_id,
          projectIds: [],
          access: a.access,
          sourceRights: deps.sourceRights,
        });
        if (!d.ok) return refused(d);
        const r = await db
          .prepare(
            "DELETE FROM atlas_decks WHERE id=? AND owner_id=? AND revision=?",
          )
          .bind(id, a.access.userId, revision)
          .run();
        return r.meta.changes
          ? json({ success: true })
          : stale("Presentation changed or is read-only.");
      } catch {
        return json({ error: "Presentation could not be removed." }, 503);
      }
    },
  };
}
