// The OS inbound-API contract range this Atlas build speaks
// (upd-atlas-contract-advert; plan 2026-09-25 admin/updates, D-035).
//
// Atlas calls only /api/inbound/v1/*, so it supports contract major 1 and
// nothing newer. Every inbound call carries this range in the
// X-FlightDeck-Contract header so the OS can record, per credential, which
// contract its callers still need before it ships a breaking v2. The range is
// an advertisement, never an authority: the OS validates it and records a
// malformed value as "invalid" rather than trusting it. Change it only
// together with a move to a new /api/inbound/vN path.
export const FLIGHTDECK_CONTRACT_HEADER = "X-FlightDeck-Contract";
export const FLIGHTDECK_CONTRACT_RANGE = ">=1 <2";
