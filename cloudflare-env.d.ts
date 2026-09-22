declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ATLAS_SUPERADMIN_EMAIL?: string;
    BUCKET?: R2Bucket;
    /** FlightDeck OS origin for the read-only inbound context API. */
    ATLAS_FLIGHTDECK_URL?: string;
    /** OS inbound machine credential (read:context). Server-only secret. */
    ATLAS_FLIGHTDECK_INBOUND_TOKEN?: string;
  }
}
