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
//
// A read IN FLIGHT across a revocation is discarded (review round 3): every
// call notes the revocation generation it started in. If a revocation has
// happened by the time its answer arrives, the answer was given for a
// credential the OS has since refused, so an ok answer is returned as
// "unauthorized" (no features, for the feature flags) and nothing it read is
// cached or kept. Its view of the shared cache then records only the
// credential-wide rate-limit block. Fails closed: the worst case is one
// extra read.
import {
  createCachedReader,
  createContextClient,
  createGuardedSubmissions,
  createSubmissionClient,
  createWhoamiLoader,
  createWhoamiReader,
  forgetCredential,
  RATE_LIMIT_KEY,
  type ContextConfig,
  type ContextReader,
  type ContextResult,
  type Fetcher,
  type WhoamiRead,
} from "./context-client";
import { createDirectoryOs, type DirectoryOs } from "./apps-directory-route";
import {
  createFeatureReader,
  NO_FEATURES,
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
  // Bumped by every revocation; a call started in an older one is late.
  let generation = 0;
  const revoke = () => {
    generation++;
    forgetCredential(cache);
    keptWhoami = null;
    featureReader = null;
  };
  /** The shared cache as seen by a call that started in generation `g`:
   * once a revocation has happened since, it records nothing but the
   * credential-wide rate-limit block. */
  const cacheFor = (g: number): Cache =>
    new Proxy(cache, {
      get(target, prop) {
        if (prop === "set")
          return (key: string, value: Parameters<Cache["set"]>[1]) => {
            if (g === generation || key === RATE_LIMIT_KEY)
              target.set(key, value);
            return target;
          };
        const member = Reflect.get(target, prop, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
  /** Runs one read in the current generation; an ok answer that arrives
   * after a revocation is returned as "unauthorized". */
  async function current<R extends { state: string }>(
    run: (g: number) => Promise<R>,
  ): Promise<R | { state: "unauthorized" }> {
    const g = generation;
    const value = await run(g);
    return g !== generation && value.state === "ok"
      ? { state: "unauthorized" }
      : value;
  }
  const refusing = { ...client, now, onRefused: revoke };
  return {
    /** Drops everything held for the credential (see the header). */
    revoke,
    /** The context reader. `fresh` bypasses cached lists. */
    reader(config: ContextConfig, fresh: boolean): ContextReader {
      const at = (g: number) =>
        createCachedReader(createContextClient(config, client), cacheFor(g), {
          fresh,
          now,
          onRefused: revoke,
        });
      return {
        workspaces: () => current((g) => at(g).workspaces()),
        projects: (id) => current((g) => at(g).projects(id)),
        apps: (id) => current((g) => at(g).apps!(id)),
        appsDirectory: (id, project, locale) =>
          current((g) => at(g).appsDirectory!(id, project, locale)),
        appsForProject: (id, project) =>
          current((g) => at(g).appsForProject!(id, project)),
        appCatalog: (id, locale) =>
          current((g) => at(g).appCatalog!(id, locale)),
      };
    },
    /** The apps directory (keys carry the OS origin and a one-way
     * fingerprint of the credential). */
    directory(config: ContextConfig): DirectoryOs {
      const at = (g: number) =>
        createDirectoryOs({ config, cache: cacheFor(g), ...refusing });
      return {
        capability: () => current((g) => at(g).capability()),
        directory: (id, project, locale) =>
          current((g) => at(g).directory(id, project, locale)),
      };
    },
    submissions: (config: ContextConfig) =>
      createGuardedSubmissions(createSubmissionClient(config, client), cache, {
        now,
        onRefused: revoke,
      }),
    /** This credential's optional-feature flags, read before each send.
     * A read that straddles a revocation answers no features. */
    async features(config: ContextConfig): Promise<InboundFeatures> {
      const g = generation;
      featureReader ??= createFeatureReader(
        createWhoamiLoader(config, cacheFor(g), refusing),
        { now },
      );
      const value = await featureReader.read();
      return g === generation ? value : NO_FEATURES;
    },
    /** The whoami read for the Connections line. `fresh` skips the kept
     * answer. */
    whoami(config: ContextConfig, fresh: boolean): () => Promise<WhoamiRead> {
      return async () => {
        const at = now();
        if (!fresh && keptWhoami && at - keptWhoami.at <= WHOAMI_KEEP_MS)
          return keptWhoami.value;
        const g = generation;
        const value = await createWhoamiReader(config, cacheFor(g), refusing)();
        if (g !== generation)
          // Revoked meanwhile (possibly by this very read): keep nothing.
          return value.state === "ok" ? { state: "unauthorized" } : value;
        keptWhoami = value.state === "ok" ? { at, value } : null;
        return value;
      };
    },
  };
}
