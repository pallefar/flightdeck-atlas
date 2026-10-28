// Device tokens for the native clients.
//
// A token is a bearer credential the Super Admin mints for one person and one
// role. Three rules make it safe to introduce:
// 1. Only a sha256 hash is stored, so a database read cannot replay a token.
// 2. A token never grants anything by itself: it resolves to an existing
//    Atlas grant (email + role), so revoking the grant or disabling the member
//    denies the next request exactly like the hosted sign-in does.
// 3. An unknown, revoked or malformed token fails closed with 401 — it never
//    falls through to another identity source.
import { sha256Hex } from "../domain/digest";
import type { ChainDb } from "../audit/chain";
/** A random 32-byte token, hex encoded. Shown once, never stored. */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export const hashToken = (token: string) => sha256Hex(token);
/** Constant-time comparison of two equal-length strings. */
export function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export type DeviceGrant = { id: string; email: string; roleId: string };
/** Resolve a presented token to its grant, or null. Fail closed. */
export async function verifyDeviceToken(
  db: ChainDb,
  token: string,
): Promise<DeviceGrant | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const hash = await hashToken(token);
  const row = await db
    .prepare(
      "SELECT id, token_hash, email, role_id FROM atlas_device_tokens WHERE revoked_at IS NULL AND token_hash = ?",
    )
    .bind(hash)
    .first<{ id: string; token_hash: string; email: string; role_id: string }>();
  if (!row || !sameHash(row.token_hash, hash)) return null;
  return { id: row.id, email: row.email, roleId: row.role_id };
}
/** Record that the token was used. A failure here never fails the request:
 * last-used is observability, not authorization. */
export async function touchDeviceToken(db: ChainDb, id: string, at: string) {
  try {
    await db
      .prepare("UPDATE atlas_device_tokens SET last_used_at = ? WHERE id = ?")
      .bind(at, id)
      .run();
  } catch {
    // ignore: the token still authorizes; its last use is simply not recorded
  }
}
export async function mintDeviceToken(
  db: ChainDb,
  input: {
    id: string;
    label: string;
    email: string;
    roleId: string;
    createdBy: string;
    at: string;
  },
): Promise<{ token: string; id: string }> {
  const token = newToken();
  await db
    .prepare(
      `INSERT INTO atlas_device_tokens
         (id, label, token_hash, email, role_id, created_by, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      input.id,
      input.label,
      await hashToken(token),
      input.email,
      input.roleId,
      input.createdBy,
      input.at,
    )
    .run();
  return { token, id: input.id };
}
export async function listDeviceTokens(db: ChainDb, email?: string) {
  const query =
    "SELECT id, label, email, role_id, created_at, last_used_at, revoked_at FROM atlas_device_tokens";
  const { results } = email
    ? await db
        .prepare(`${query} WHERE email = ? ORDER BY created_at DESC`)
        .bind(email)
        .all<Record<string, unknown>>()
    : await db
        .prepare(`${query} ORDER BY created_at DESC`)
        .bind()
        .all<Record<string, unknown>>();
  return results.map((row) => ({
    id: row.id as string,
    label: row.label as string,
    email: row.email as string,
    roleId: row.role_id as string,
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    revoked: row.revoked_at !== null,
  }));
}
export async function revokeDeviceToken(db: ChainDb, id: string, at: string) {
  const written = await db
    .prepare(
      "UPDATE atlas_device_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(at, id)
    .run();
  return written.meta.changes === 1;
}
