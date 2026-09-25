// Worker wiring for every FlightDeck OS call. Server-only: it reads the
// inbound credential from the Worker environment. The credential is placed
// only in the Authorization header of requests to the configured OS origin;
// it is never logged, returned, stored or sent to the browser.
import { env } from "cloudflare:workers";
import {
  createCachedReader,
  createContextClient,
  createGuardedSubmissions,
  createSubmissionClient,
  createWhoamiLoader,
  createWhoamiReader,
  type WhoamiRead,
  readContextConfig,
  type ContextResult,
} from "./context-client";
import {
  NO_FEATURES,
  createFeatureReader,
  type FeatureReader,
  type InboundFeatures,
} from "./features";
import { createDirectoryOs } from "./apps-directory-route";

// One cache per isolate for the context lists and for the credential-wide
// rate limit, shared by the context and onboarding routes: they spend the
// same 30 requests a minute.
const cache = new Map<
  string,
  { until: number; value?: ContextResult<unknown> }
>();
const config = () =>
  readContextConfig({
    url: env.ATLAS_FLIGHTDECK_URL,
    token: env.ATLAS_FLIGHTDECK_INBOUND_TOKEN,
  });
/** The OS reader, or null when FlightDeck is not configured. `fresh`
 * bypasses cached lists. */
export function osReader(fresh: boolean) {
  const c = config();
  return c
    ? createCachedReader(createContextClient(c), cache, { fresh })
    : null;
}
/** The apps directory reader (apps-32), or null when FlightDeck is not
 * configured. Its keys carry the OS origin and a one-way fingerprint of the
 * credential, in the same isolate cache so it honours the same rate limit. */
export function osDirectory() {
  const c = config();
  return c ? createDirectoryOs({ config: c, cache }) : null;
}
export function osSubmissions() {
  const c = config();
  return c ? createGuardedSubmissions(createSubmissionClient(c), cache) : null;
}
// One features read per isolate, kept at most five minutes.
let featureReader: FeatureReader | null = null;
/** This credential's optional-feature flags, read before each send. All
 * off when FlightDeck is not configured or the read fails. */
export function osFeatures(): Promise<InboundFeatures> {
  const c = config();
  if (!c) return Promise.resolve(NO_FEATURES);
  featureReader ??= createFeatureReader(createWhoamiLoader(c, cache));
  return featureReader.read();
}
// The Connections line's whoami: a successful answer is kept per isolate for
// a minute, so page views by many members do not spend the credential's 30
// requests a minute. A failure is never kept (the rate-limit block is, in the
// shared cache), so the next view asks again.
const WHOAMI_KEEP_MS = 60_000;
let keptWhoami: { at: number; value: WhoamiRead } | null = null;
/** The whoami reader for /api/flightdeck/connection, or null when FlightDeck
 * is not configured. `fresh` skips the kept answer. */
export function osWhoami(fresh: boolean): (() => Promise<WhoamiRead>) | null {
  const c = config();
  if (!c) return null;
  const read = createWhoamiReader(c, cache);
  return async () => {
    const now = Date.now();
    if (!fresh && keptWhoami && now - keptWhoami.at <= WHOAMI_KEEP_MS)
      return keptWhoami.value;
    const value = await read();
    keptWhoami = value.state === "ok" ? { at: now, value } : null;
    return value;
  };
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
