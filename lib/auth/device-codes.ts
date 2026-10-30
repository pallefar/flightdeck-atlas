/**
 * The device-code sign-in, as a pure state machine.
 *
 * The app asks for a code, the person approves it in the browser they are
 * already signed in to, and the app collects a device token exactly once. The
 * token is held on the row only between approval and collection, and the row is
 * deleted on delivery — so this is a hand-off, not a second credential.
 */
export type DeviceCodeRow = {
  code: string;
  createdAt: string;
  expiresAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  token: string | null;
  deliveredAt: string | null;
};
export type DeviceCodeState = "pending" | "approved" | "expired" | "delivered" | "unknown";

/** No vowels and no look-alikes: a code is read aloud and typed by a person. */
const ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
export function newDeviceCode(random: (max: number) => number = cryptoRandom): string {
  let code = "";
  for (let i = 0; i < 8; i += 1) code += ALPHABET[random(ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
function cryptoRandom(max: number): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % max;
}

/** Where a code stands, given the clock. Expiry wins over everything. */
export function deviceCodeState(row: DeviceCodeRow | null, now: Date): DeviceCodeState {
  if (!row) return "unknown";
  if (row.deliveredAt) return "delivered";
  if (Date.parse(row.expiresAt) <= now.getTime()) return "expired";
  return row.token ? "approved" : "pending";
}

/** A code is valid for ten minutes: long enough to sign in, short enough that a
 * leaked code is worthless. */
export const CODE_TTL_MS = 10 * 60 * 1000;

/** The token may be handed over once, and only to a poll after approval. */
export function collectToken(row: DeviceCodeRow, now: Date): { token: string } | { error: string } {
  const state = deviceCodeState(row, now);
  if (state !== "approved" || !row.token) return { error: "The code is not ready." };
  return { token: row.token };
}
