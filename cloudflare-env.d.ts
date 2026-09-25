declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ATLAS_SUPERADMIN_EMAIL?: string;
    BUCKET?: R2Bucket;
    /** FlightDeck OS origin for the read-only inbound context API. */
    ATLAS_FLIGHTDECK_URL?: string;
    /** OS inbound machine credential (read:context). Server-only secret. */
    ATLAS_FLIGHTDECK_INBOUND_TOKEN?: string;
    /** Slug that scopes Atlas's FlightDeck link records. Optional; unset
     * means "atlas-local". Set once, before the first send. */
    ATLAS_INSTALLATION_ID?: string;
    /** Onboarding measures (hashes and moments only, no values). Off unless
     * exactly "true". */
    ONB_METRICS_ENABLED?: string;
  }
}
