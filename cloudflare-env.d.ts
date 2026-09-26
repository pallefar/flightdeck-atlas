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
    /** Browser-facing FlightDeck Admin url for the reserved launcher card
     * (https, or http on loopback only). Unset: no card. */
    ATLAS_FLIGHTDECK_ADMIN_URL?: string;
    /** Comma-separated Atlas role ids also shown the admin card (Atlas
     * superAdmins always are). A visibility heuristic, not an entitlement. */
    ATLAS_FLIGHTDECK_ADMIN_ROLES?: string;
    /** "true" shows editors the project page's FlightDeck card and lets
     * them ask the Super Admin to send a revision (the onboarding send
     * request marker); only the Super Admin sends. Default off (D-037
     * item 4). */
    ATLAS_REQUESTER_REQUESTS?: string;
    /** Onboarding measures (hashes and moments only, no values). Off unless
     * exactly "true". */
    ONB_METRICS_ENABLED?: string;
    /** Owner-set response policy in working days (1 to 60). Unset (the
     * default): no ETA is shown. */
    ONB_RESPONSE_POLICY_DAYS?: string;
  }
}
