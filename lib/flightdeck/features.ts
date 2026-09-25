import { z } from "zod";
// The optional project-onboarding features FlightDeck OS allows THIS Atlas
// credential, read from GET /api/inbound/v1/whoami (OS onb-contract-
// capabilities; plan 2026-09-25 §7 lane A). Shared by the server route and
// the payload builder, so it must stay free of server-only imports.
//
// The OS refuses a payload field whose feature is off with 400 FEATURE_OFF
// and never strips it, and a missing route or a 400 is never a capability
// signal. So Atlas reads the flags before each send (at most five minutes
// stale) and leaves out every field whose flag is not true. Everything here
// FAILS CLOSED: an older OS without `features`, a missing or non-boolean
// flag, or a failed read all mean "off".

/** The flags the OS advertises, in the contract's order. */
export const INBOUND_FEATURES = [
  "decisionNote",
  "supersedes",
  "appDiscovery",
  "requestedSubapps",
  "aiAgents",
] as const;
export type InboundFeature = (typeof INBOUND_FEATURES)[number];
export type InboundFeatures = Readonly<Record<InboundFeature, boolean>>;
export const NO_FEATURES: InboundFeatures = Object.freeze(
  Object.fromEntries(INBOUND_FEATURES.map((f) => [f, false])) as Record<
    InboundFeature,
    boolean
  >,
);

/** The payload field each flag gates (the contract's features.flags[*].
 * payloadField). A flag without a field gates a read-back or a route, never
 * something Atlas sends. */
export const FEATURE_PAYLOAD_FIELDS = {
  supersedes: "supersedes",
  requestedSubapps: "requestedSubapps",
  aiAgents: "aiAgents",
} as const satisfies Partial<Record<InboundFeature, string>>;
export type GatedPayloadField =
  (typeof FEATURE_PAYLOAD_FIELDS)[keyof typeof FEATURE_PAYLOAD_FIELDS];
export type GatedPayload = Partial<Record<GatedPayloadField, unknown>>;

/** Only the part of a whoami answer this module needs; the rest is the
 * credential's own business and is dropped. */
const whoamiSchema = z.object({
  integrationId: z.string().min(1).max(64),
  features: z.unknown().optional(),
});

/** The flags in a whoami answer, or null when the body is not one. A flag
 * is true only when the OS says exactly `true`. */
export function parseWhoamiFeatures(body: unknown): InboundFeatures | null {
  const parsed = whoamiSchema.safeParse(body);
  if (!parsed.success) return null;
  const raw = parsed.data.features;
  const flags =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    INBOUND_FEATURES.map((f) => [f, flags[f] === true]),
  ) as InboundFeatures;
}

/** Only the gated fields whose flag is true; nothing when no flags were
 * read. */
export function gatedFields(
  gated: GatedPayload | undefined,
  features: InboundFeatures | undefined,
): GatedPayload {
  const out: GatedPayload = {};
  if (!gated || !features) return out;
  for (const [flag, field] of Object.entries(FEATURE_PAYLOAD_FIELDS) as [
    InboundFeature,
    GatedPayloadField,
  ][])
    if (features[flag] === true && gated[field] !== undefined)
      out[field] = gated[field];
  return out;
}

/** The oldest a features read may be when Atlas sends. */
export const FEATURES_MAX_AGE_MS = 5 * 60_000;
export interface FeatureReader {
  read(): Promise<InboundFeatures>;
}
/** Reads whoami through `load` (the body, or null when the OS did not
 * answer 200 JSON) and keeps a successful read for at most
 * FEATURES_MAX_AGE_MS. A failure is never kept, so the next send asks
 * again, and it answers NO_FEATURES meanwhile. */
export function createFeatureReader(
  load: () => Promise<unknown>,
  options: { now?: () => number; maxAgeMs?: number } = {},
): FeatureReader {
  const now = options.now ?? Date.now;
  const maxAge = options.maxAgeMs ?? FEATURES_MAX_AGE_MS;
  let kept: { at: number; value: InboundFeatures } | null = null;
  return {
    async read() {
      const started = now();
      if (kept && started - kept.at <= maxAge) return kept.value;
      kept = null;
      let body: unknown = null;
      try {
        body = await load();
      } catch {
        return NO_FEATURES;
      }
      const value = parseWhoamiFeatures(body);
      if (!value) return NO_FEATURES;
      kept = { at: started, value };
      return value;
    },
  };
}
