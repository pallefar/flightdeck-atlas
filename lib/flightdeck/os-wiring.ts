// Every OS reader and writer of one isolate, over ONE shared cache (apps-32).
// Kept free of `cloudflare:workers` so the spec runs exactly this wiring over
// a fake OS; lib/flightdeck/os-server.ts builds one per isolate and passes
// the configured credential in on each call.
//
// REVOCATION IS CREDENTIAL-WIDE and FAILS CLOSED: when ANY reader here sees
// the OS refuse the credential (context lists, whoami, features, the apps
// directory or a submission: 401/403), `revoke` drops every cached answer
// (context lists, directory lists, the directory capability), the kept
// Connections whoami and the kept feature flags. Only the credential-wide
// rate-limit block survives, so a refusal never becomes a way to press the OS.
import {
  createCachedReader,
  createContextClient,
  createGuardedSubmissions,
  createSubmissionClient,
  createWhoamiLoader,
  createWhoamiReader,
  forgetCredential,
  type ContextConfig,
  type ContextResult,
  type Fetcher,
  type WhoamiRead,
} from "./context-client";
import { createDirectoryOs } from "./apps-directory-route";
import {
  createFeatureReader,
  type FeatureReader,
  type InboundFeatures,
} from "./features";

type Cache = Map<string, { until: number; value?: ContextResult<unknown> }>;

// The Connections line's whoami: a successful answer is kept per isolate for
// a minute, so page views by many members do not spend the credential's 30
// requests a minute. A failure is never kept (the rate-limit block is, in the
// shared cache), so the next view asks again.
export const WHOAMI_KEEP_MS = 60_000;

export function createOsWiring(deps: {
  cache: Cache;
  fetch?: Fetcher;
  now?: () => number;
}) {
  const { cache } = deps;
  const now = deps.now || Date.now;
  const client = deps.fetch ? { fetch: deps.fetch } : {};
  let keptWhoami: { at: number; value: WhoamiRead } | null = null;
  // One features read per isolate, kept at most five minutes.
  let featureReader: FeatureReader | null = null;
  const revoke = () => {
    forgetCredential(cache);
    keptWhoami = null;
    featureReader = null;
  };
  const refusing = { ...client, now, onRefused: revoke };
  return {
    /** Drops everything held for the credential (see the header). */
    revoke,
    /** The context reader. `fresh` bypasses cached lists. */
    reader: (config: ContextConfig, fresh: boolean) =>
      createCachedReader(createContextClient(config, client), cache, {
        fresh,
        now,
        onRefused: revoke,
      }),
    /** The apps directory (keys carry the OS origin and a one-way
     * fingerprint of the credential). */
    directory: (config: ContextConfig) =>
      createDirectoryOs({ config, cache, ...refusing }),
    submissions: (config: ContextConfig) =>
      createGuardedSubmissions(createSubmissionClient(config, client), cache, {
        now,
        onRefused: revoke,
      }),
    /** This credential's optional-feature flags, read before each send. */
    features(config: ContextConfig): Promise<InboundFeatures> {
      featureReader ??= createFeatureReader(
        createWhoamiLoader(config, cache, refusing),
        { now },
      );
      return featureReader.read();
    },
    /** The whoami read for the Connections line. `fresh` skips the kept
     * answer. */
    whoami(config: ContextConfig, fresh: boolean): () => Promise<WhoamiRead> {
      const read = createWhoamiReader(config, cache, refusing);
      return async () => {
        const at = now();
        if (!fresh && keptWhoami && at - keptWhoami.at <= WHOAMI_KEEP_MS)
          return keptWhoami.value;
        const value = await read();
        // A refusal has already revoked (and so cleared keptWhoami).
        keptWhoami = value.state === "ok" ? { at, value } : null;
        return value;
      };
    },
  };
}
