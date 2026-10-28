import { env } from "cloudflare:workers";
import { verifyDeviceToken } from "./auth/device-tokens";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  permissions,
  type AccessProfile,
  type Permission,
} from "./access-policy";
export const superAdminEmail = () =>
  (env.ATLAS_SUPERADMIN_EMAIL || "").trim().toLowerCase();
export async function getAccess(): Promise<AccessProfile | null> {
  const user = await getChatGPTUser();
  if (!user) return null;
  const email = user.email.trim().toLowerCase();
  if (superAdminEmail() && email === superAdminEmail())
    return {
      userId: user.userId,
      email,
      name: user.displayName,
      roleId: "superadmin",
      roleName: "Super Admin",
      superAdmin: true,
      permissions,
    };
  if (!env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT m.user_id, m.role_id, r.name, r.permissions FROM atlas_members m JOIN atlas_roles r ON r.id = m.role_id WHERE m.email = ? AND m.disabled = 0",
  )
    .bind(email)
    .first<{
      user_id: string | null;
      role_id: string;
      name: string;
      permissions: string;
    }>();
  if (!row || (row.user_id && row.user_id !== user.userId)) return null;
  if (!row.user_id) {
    await env.DB.prepare(
      "UPDATE atlas_members SET user_id = ? WHERE email = ? AND user_id IS NULL AND disabled = 0",
    )
      .bind(user.userId, email)
      .run();
    const bound = await env.DB.prepare(
      "SELECT user_id, disabled FROM atlas_members WHERE email = ?",
    )
      .bind(email)
      .first<{ user_id: string; disabled: number }>();
    if (!bound || bound.disabled || bound.user_id !== user.userId) return null;
  }
  const granted: unknown = JSON.parse(row.permissions);
  if (!Array.isArray(granted)) return null;
  return {
    userId: user.userId,
    email,
    name: user.displayName,
    roleId: row.role_id,
    roleName: row.name,
    superAdmin: false,
    permissions: granted.filter(
      (p): p is Permission =>
        typeof p === "string" && permissions.includes(p as Permission),
    ),
  };
}
/** Resolve a Bearer device token to an AccessProfile, or null. The token is
 * only a way in: it maps to an existing Atlas grant, and a disabled member or
 * a revoked token denies. Server-only (reads the D1 binding). */
async function bearerAccess(token: string): Promise<AccessProfile | null> {
  if (!env.DB) return null;
  const grant = await verifyDeviceToken(
    {
      prepare: (query: string) => env.DB!.prepare(query),
    } as never,
    token,
  );
  if (!grant) return null;
  const email = grant.email.trim().toLowerCase();
  if (superAdminEmail() && email === superAdminEmail())
    return {
      userId: `device:${grant.id}`,
      email,
      name: email,
      roleId: "superadmin",
      roleName: "Super Admin",
      superAdmin: true,
      permissions,
    };
  const row = await env.DB.prepare(
    "SELECT m.user_id, m.role_id, r.name, r.permissions FROM atlas_members m JOIN atlas_roles r ON r.id = m.role_id WHERE m.email = ? AND m.disabled = 0",
  )
    .bind(email)
    .first<{ user_id: string | null; role_id: string; name: string; permissions: string }>();
  if (!row) return null;
  const granted: unknown = JSON.parse(row.permissions);
  if (!Array.isArray(granted)) return null;
  return {
    userId: row.user_id || `device:${grant.id}`,
    email,
    name: email,
    roleId: row.role_id,
    roleName: row.name,
    superAdmin: false,
    permissions: granted.filter(
      (p): p is Permission => typeof p === "string" && permissions.includes(p as Permission),
    ),
  };
}

export async function authorize(
  permission?: Permission,
  superOnly = false,
  request?: Request,
): Promise<
  { access: AccessProfile; error?: never } | { access?: never; error: Response }
> {
  // A presented Bearer token must not fall through to the cookie identity:
  // an invalid token is a 401, never a silent downgrade to another account.
  const header = request?.headers.get("authorization");
  if (header && /^bearer /i.test(header)) {
    const token = header.slice(7).trim();
    try {
      const access = await bearerAccess(token);
      if (!access)
        return {
          error: Response.json(
            { error: "That device token is not valid." },
            { status: 401 },
          ),
        };
      if (
        (superOnly && !access.superAdmin) ||
        (permission && !access.permissions.includes(permission))
      )
        return {
          error: Response.json(
            {
              error:
                "Your account does not have permission for this action. Contact the Super Admin.",
            },
            { status: 403 },
          ),
        };
      return { access };
    } catch {
      return {
        error: Response.json(
          { error: "Access could not be verified. Please try again." },
          { status: 503 },
        ),
      };
    }
  }
  const user = await getChatGPTUser();
  if (!user)
    return {
      error: Response.json({ error: "Sign in to continue." }, { status: 401 }),
    };
  try {
    const access = await getAccess();
    if (
      !access ||
      (superOnly && !access.superAdmin) ||
      (permission && !access.permissions.includes(permission))
    )
      return {
        error: Response.json(
          {
            error:
              "Your account does not have permission for this action. Contact the Super Admin.",
          },
          { status: 403 },
        ),
      };
    return { access };
  } catch {
    return {
      error: Response.json(
        { error: "Access could not be verified. Please try again." },
        { status: 503 },
      ),
    };
  }
}
