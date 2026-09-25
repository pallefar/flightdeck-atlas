// The /api/flightdeck/connection handler: the Connections page's one
// connection line, derived from the credential's whoami. Dependencies are
// passed in so the spec runs exactly this code; the route file wires the real
// authorisation and whoami reader. No Worker bindings are imported here.
//
// WHO SEES IT: any Atlas member with projects.read. The answer is only the
// derived state and the known scopes (connectionViewSchema), never the
// credential, the integration id, its expiry, limits or features, so it
// says no more than the page's old "Connected / Not enabled" chips did.
// FAILS CLOSED: no reader, a thrown read, or an answer that does not parse
// is "Not connected".
import { json } from "../http";
import type { WhoamiRead } from "./context-client";
import { connectionFromWhoami } from "./connection";

export type ConnectionAuth =
  | { access: { userId: string; superAdmin: boolean }; error?: never }
  | { access?: never; error: Response };

export function createConnectionRoute(deps: {
  authorize: () => Promise<ConnectionAuth>;
  /** The whoami reader, or null when FlightDeck is not configured. `fresh`
   * skips a kept answer. */
  whoami: (fresh: boolean) => (() => Promise<WhoamiRead>) | null;
}) {
  async function GET(request: Request) {
    const auth = await deps.authorize();
    if (auth.error) return auth.error;
    const fresh = new URL(request.url).searchParams.get("refresh") === "1";
    const read = deps.whoami(fresh);
    if (!read) return json(connectionFromWhoami({ state: "not_configured" }));
    try {
      return json(connectionFromWhoami(await read()));
    } catch {
      return json({ state: "check_failed" });
    }
  }
  return { GET };
}
