import { authorize } from "@/lib/access";
import {
  listDeviceTokens,
  mintDeviceToken,
  revokeDeviceToken,
} from "@/lib/auth/device-tokens";
import { database } from "@/lib/server-projects";
import { json, sameOrigin } from "@/lib/http";
export const dynamic = "force-dynamic";

// Device tokens for the native clients. Super Admin only, same-origin, and the
// token is returned exactly once: only its sha256 is stored, so there is no
// "show it again". A token maps to an existing Atlas grant; it never creates
// one, and revoking it denies the next request.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function GET(request: Request) {
  const auth = await authorize(undefined, true, request);
  if (auth.error) return auth.error;
  try {
    return json({ tokens: await listDeviceTokens(database()) });
  } catch {
    return json({ error: "Device tokens are unavailable." }, 503);
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize(undefined, true, request);
  if (auth.error) return auth.error;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a JSON body.", code: "bad_body" }, 400);
  }
  const input = body as { label?: unknown; email?: unknown; roleId?: unknown };
  const label = typeof input.label === "string" ? input.label.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const roleId = typeof input.roleId === "string" ? input.roleId.trim() : "";
  if (!label || label.length > 80)
    return json({ error: "Give the token a label.", code: "label_required" }, 400);
  if (!EMAIL.test(email))
    return json({ error: "Choose the person this token acts for.", code: "email_required" }, 400);
  if (!roleId)
    return json({ error: "Choose the Atlas role this token carries.", code: "role_required" }, 400);
  try {
    const db = database();
    const role = await db
      .prepare("SELECT id FROM atlas_roles WHERE id = ?")
      .bind(roleId)
      .first();
    if (!role)
      return json({ error: "That role does not exist.", code: "unknown_role" }, 400);
    const minted = await mintDeviceToken(db as never, {
      id: crypto.randomUUID(),
      label,
      email,
      roleId,
      createdBy: auth.access.email,
      at: new Date().toISOString(),
    });
    // Returned once. The response carries no other token and is never cached.
    return json({ id: minted.id, token: minted.token, email, roleId }, 201);
  } catch {
    return json({ error: "The token could not be created." }, 503);
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize(undefined, true, request);
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return json({ error: "Name the token to revoke.", code: "id_required" }, 400);
  try {
    const revoked = await revokeDeviceToken(database() as never, id, new Date().toISOString());
    if (!revoked)
      return json({ error: "That token does not exist or was already revoked.", code: "not_found" }, 404);
    return json({ id, revoked: true });
  } catch {
    return json({ error: "The token could not be revoked." }, 503);
  }
}
