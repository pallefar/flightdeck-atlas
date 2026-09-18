import { database, fromRow } from "./server-projects";
import { projectPolicy, type AccessProfile } from "./access-policy";
import { sharingSchema, type Sharing, type Team } from "./collaboration";
export async function teamList() {
  const rows = await database()
    .prepare("SELECT * FROM atlas_teams ORDER BY name")
    .all();
  return rows.results.map((r) => ({
    ...JSON.parse(r.data as string),
    id: r.id,
    revision: r.revision,
  })) as Team[];
}
export async function directory(access: AccessProfile) {
  const rows = await database()
    .prepare(
      "SELECT email, user_id, role_id FROM atlas_members WHERE disabled = 0",
    )
    .all();
  const { superAdminEmail } = await import("./access");
  const emails = rows.results.map((r) => ({
    email: r.email as string,
    userId: r.user_id as string | null,
    roleId: r.role_id as string,
  }));
  const admin = superAdminEmail();
  if (admin && !emails.some((m) => m.email === admin))
    emails.unshift({
      email: admin,
      userId: access.superAdmin ? access.userId : null,
      roleId: "superadmin",
    });
  return emails;
}
export async function rights(
  access: AccessProfile,
  row: Record<string, unknown>,
  teams?: Team[],
) {
  const shareRow = await database()
    .prepare("SELECT * FROM atlas_project_shares WHERE project_id = ?")
    .bind(row.id)
    .first();
  const share: Sharing = shareRow
    ? {
        ...sharingSchema.parse(JSON.parse(shareRow.data as string)),
        revision: Number(shareRow.revision),
      }
    : { visibility: "all", grants: [], revision: 0 };
  return {
    ...projectPolicy(
      access,
      row.owner_id as string,
      share,
      teams || (await teamList()),
    ),
    sharing: share,
  };
}
export async function projectFor(access: AccessProfile, id: string) {
  const row = await database()
    .prepare("SELECT * FROM atlas_projects WHERE id = ?")
    .bind(id)
    .first();
  if (!row) return null;
  const r = await rights(access, row);
  if (!r.read) return null;
  return {
    row,
    rights: r,
    project: {
      ...fromRow(row),
      canEdit: r.edit,
      canComment: r.comment,
      canShare: r.share,
      canArchive: r.archive,
      ownedByMe: row.owner_id === access.userId,
    },
  };
}
export async function visibleProjects(access: AccessProfile) {
  const rows = await database()
    .prepare("SELECT * FROM atlas_projects ORDER BY updated_at DESC")
    .all();
  const groups = await teamList();
  const result = [];
  for (const row of rows.results) {
    const r = await rights(access, row, groups);
    if (r.read)
      result.push({
        ...fromRow(row),
        canEdit: r.edit,
        canComment: r.comment,
        canShare: r.share,
        canArchive: r.archive,
        ownedByMe: row.owner_id === access.userId,
      });
  }
  return result;
}
export async function activeProjectPeople(access: AccessProfile, id: string) {
  const p = await projectFor(access, id);
  if (!p) return [];
  const people = await directory(access);
  const result = [];
  for (const member of people) {
    const role = await database()
      .prepare("SELECT permissions FROM atlas_roles WHERE id = ?")
      .bind(member.roleId)
      .first();
    const a: AccessProfile = {
      ...access,
      email: member.email,
      userId: member.userId || `unbound:${member.email}`,
      superAdmin: member.roleId === "superadmin",
      roleId: member.roleId,
      permissions: role ? JSON.parse(role.permissions as string) : [],
    };
    if ((await rights(a, p.row)).read) result.push(member);
  }
  return result;
}
