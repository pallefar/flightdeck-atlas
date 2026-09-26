// Worker wiring for every FlightDeck OS call. Server-only: it reads the
// inbound credential from the Worker environment. The credential is placed
// only in the Authorization header of requests to the configured OS origin;
// it is never logged, returned, stored or sent to the browser.
import { env } from "cloudflare:workers";
import {
  readContextConfig,
  type ContextResult,
  type WhoamiRead,
} from "./context-client";
import { NO_FEATURES, type InboundFeatures } from "./features";
import { createOsWiring } from "./os-wiring";

// One cache per isolate for the context lists and for the credential-wide
// rate limit, shared by the context and onboarding routes: they spend the
// same 30 requests a minute. Every reader below goes through ONE wiring
// (lib/flightdeck/os-wiring.ts) over this cache.
const cache = new Map<
  string,
  { until: number; value?: ContextResult<unknown> }
>();
const wiring = createOsWiring({ cache });
const config = () =>
  readContextConfig({
    url: env.ATLAS_FLIGHTDECK_URL,
    token: env.ATLAS_FLIGHTDECK_INBOUND_TOKEN,
  });
/** The OS reader, or null when FlightDeck is not configured. `fresh`
 * bypasses cached lists. */
export function osReader(fresh: boolean) {
  const c = config();
  return c ? wiring.reader(c, fresh) : null;
}
/** The apps directory reader (apps-32), or null when FlightDeck is not
 * configured. Its keys carry the OS origin and a one-way fingerprint of the
 * credential, in the same isolate cache so it honours the same rate limit. */
export function osDirectory() {
  const c = config();
  return c ? wiring.directory(c) : null;
}
/** The CRM reads (crm-40), never cached, or null when FlightDeck is not
 * configured. Same credential-wide rate limit and revocation. */
export function osCrm() {
  const c = config();
  return c ? wiring.crm(c) : null;
}
export function osSubmissions() {
  const c = config();
  return c ? wiring.submissions(c) : null;
}
/** This credential's optional-feature flags, read before each send. All
 * off when FlightDeck is not configured or the read fails. */
export function osFeatures(): Promise<InboundFeatures> {
  const c = config();
  return c ? wiring.features(c) : Promise.resolve(NO_FEATURES);
}
/** The whoami reader for /api/flightdeck/connection (a successful answer is
 * kept a minute per isolate), or null when FlightDeck is not configured.
 * `fresh` skips the kept answer. */
export function osWhoami(fresh: boolean): (() => Promise<WhoamiRead>) | null {
  const c = config();
  return c ? wiring.whoami(c, fresh) : null;
}
/** The OS's origin, for a LINK in the UI — never for a call.
 *
 * ⛔ WHY THIS IS SAFE TO HAND THE BROWSER when nothing else in this module is:
 * it returns ONLY the url half of the same config. The inbound credential
 * stays where this file's header put it — the Authorization header of
 * server-side calls — and cannot ride along, because it is never read here.
 * Keeping the accessor in this module rather than reading `env` from a route
 * is the point: every OS wiring decision stays in one server-only place.
 *
 * "" when FlightDeck is not configured, so a caller renders no link rather
 * than one to nowhere. The trailing slash is stripped so callers can append a
 * path without doubling it.
 */
export function osOrigin(): string {
  return (env.ATLAS_FLIGHTDECK_URL ?? "").trim().replace(/\/+$/, "");
}
const INSTALLATION_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Scopes Atlas's link records. Unset means the one local installation;
 * set it once, before the first send, and never change it. An invalid
 * value fails closed. */
export function atlasInstallationId() {
  const value = env.ATLAS_INSTALLATION_ID?.trim();
  if (!value) return "atlas-local";
  return INSTALLATION_RE.test(value) ? value : null;
}
