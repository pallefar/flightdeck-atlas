import { env } from "cloudflare:workers";
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
export async function authorize(
  permission?: Permission,
  superOnly = false,
): Promise<
  { access: AccessProfile; error?: never } | { access?: never; error: Response }
> {
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
