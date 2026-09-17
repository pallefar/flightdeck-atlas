import { z } from "zod";
import { authorize, superAdminEmail } from "@/lib/access";
import { database, json, sameOrigin } from "@/lib/server-projects";
import { permissions } from "@/lib/access-policy";
export const dynamic = "force-dynamic";
const operation = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("grant"),
    email: z.string().trim().email().max(254),
    roleId: z.string().max(80),
  }),
  z.object({
    action: z.literal("revoke"),
    email: z.string().trim().email().max(254),
  }),
  z.object({
    action: z.literal("create-role"),
    name: z.string().trim().min(2).max(50),
    permissions: z
      .array(
        z.enum(
          permissions as [
            (typeof permissions)[number],
            ...(typeof permissions)[number][],
          ],
        ),
      )
      .min(1)
      .max(20),
  }),
]);
export async function GET() {
  const result = await authorize(undefined, true);
  if (result.error) return result.error;
  try {
    const db = database();
    const [roles, members, events] = await Promise.all([
      db.prepare("SELECT * FROM atlas_roles ORDER BY builtin DESC, name").all(),
      db
        .prepare(
          "SELECT m.email, m.role_id, m.user_id IS NOT NULL AS joined, m.disabled, m.created_at, r.name AS role_name FROM atlas_members m JOIN atlas_roles r ON r.id=m.role_id ORDER BY m.disabled, m.email",
        )
        .all(),
      db
        .prepare(
          "SELECT action, target, created_at FROM atlas_access_events ORDER BY created_at DESC LIMIT 30",
        )
        .all(),
    ]);
    return json({
      superAdmin: superAdminEmail(),
      roles: roles.results.map((r) => ({
        ...r,
        permissions: JSON.parse(r.permissions as string),
      })),
      members: members.results,
      events: events.results,
    });
  } catch {
    return json(
      { error: "Access management is temporarily unavailable." },
      503,
    );
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return json({ error: "Request origin is not allowed." }, 403);
  const auth = await authorize(undefined, true);
  if (auth.error) return auth.error;
  let data;
  try {
    const text = await request.text();
    if (text.length > 8000) throw Error();
    data = operation.parse(JSON.parse(text));
  } catch {
    return json({ error: "Check the email, role name, and permissions." }, 400);
  }
  try {
    const db = database(),
      at = new Date().toISOString();
    let target = "",
      label = "",
      statement;
    if (data.action === "create-role") {
      if (/^(superadmin|admin|owner)$/i.test(data.name.replace(/[^a-z]/gi, "")))
        return json({ error: "That role name is reserved." }, 400);
      if (!data.permissions.includes("projects.read"))
        return json(
          { error: "Dashboard roles must include project viewing." },
          400,
        );
      if (
        (data.permissions.includes("projects.archive_all") &&
          !data.permissions.includes("projects.edit_all")) ||
        (data.permissions.includes("projects.archive_own") &&
          !data.permissions.includes("projects.edit_own") &&
          !data.permissions.includes("projects.edit_all"))
      )
        return json(
          { error: "Archiving requires the matching project edit permission." },
          400,
        );
      if (
        await db
          .prepare("SELECT id FROM atlas_roles WHERE lower(name)=lower(?)")
          .bind(data.name)
          .first()
      )
        return json({ error: "A role with this name already exists." }, 409);
      target = data.name;
      label = "Created role";
      statement = db
        .prepare(
          "INSERT INTO atlas_roles (id,name,permissions,builtin) VALUES (?,?,?,0)",
        )
        .bind(
          crypto.randomUUID(),
          data.name,
          JSON.stringify([...new Set(data.permissions)]),
        );
    } else {
      const email = data.email.toLowerCase();
      if (email === superAdminEmail())
        return json(
          { error: "The Super Admin is protected and cannot be changed here." },
          400,
        );
      target = email;
      if (data.action === "grant") {
        const role = await db
          .prepare("SELECT name FROM atlas_roles WHERE id=?")
          .bind(data.roleId)
          .first<{ name: string }>();
        if (!role) return json({ error: "Select an existing role." }, 400);
        label = `Granted ${role.name}`;
        statement = db
          .prepare(
            "INSERT INTO atlas_members (email,role_id,disabled,created_at) VALUES (?,?,0,?) ON CONFLICT(email) DO UPDATE SET role_id=excluded.role_id,disabled=0",
          )
          .bind(email, data.roleId, at);
      } else {
        label = "Revoked access";
        statement = db
          .prepare("UPDATE atlas_members SET disabled=1 WHERE email=?")
          .bind(email);
      }
    }
    await db.batch([
      statement,
      db
        .prepare(
          "INSERT INTO atlas_access_events (id,actor,action,target,created_at) VALUES (?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), auth.access.userId, label, target, at),
    ]);
    return json({ success: true });
  } catch {
    return json(
      { error: "The access change could not be saved. Please try again." },
      503,
    );
  }
}
