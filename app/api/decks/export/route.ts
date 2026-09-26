import { authorize } from "@/lib/access";
import { projectFor } from "@/lib/project-access";
import { createDeckExportRoute } from "@/lib/deck-export";
import { database } from "@/lib/server-projects";
export const dynamic = "force-dynamic";
// Owner-only export for the FlightDeck OS import (lib/deck-export.ts): same
// origin, signed in, only the caller's own decks, and every source project
// re-checked through projectFor() now; a deck with a lost source is withheld.
const exporter = createDeckExportRoute({
  authorize: () => authorize("projects.read"),
  database,
  canReadSource: async (access, id) => !!(await projectFor(access, id)),
});
export function GET(req: Request) {
  return exporter.GET(req);
}
