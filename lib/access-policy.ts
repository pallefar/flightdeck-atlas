export const permissionLabels = {
  "projects.read": "View permitted projects",
  "projects.create": "Create projects",
  "projects.edit_own": "Edit own projects",
  "projects.edit_all": "Edit all permitted projects",
  "projects.archive_own": "Archive own projects",
  "projects.archive_all": "Archive all permitted projects",
  "briefings.read": "View briefings",
  "ideas.use": "Use ideas and AI updates",
} as const;
export type Permission = keyof typeof permissionLabels;
export const permissions = Object.keys(permissionLabels) as Permission[];
export type AccessProfile = {
  userId: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  superAdmin: boolean;
  permissions: Permission[];
};
export const builtinRoles = [
  { id: "admin", name: "Admin", permissions },
  {
    id: "owner",
    name: "Owner",
    permissions: permissions.filter((p) => !p.endsWith("_all")),
  },
];
export function canChangeProject(
  access: AccessProfile,
  ownerId: string,
  archive = false,
) {
  const prefix = archive ? "projects.archive" : "projects.edit";
  return (
    access.superAdmin ||
    access.permissions.includes(`${prefix}_all` as Permission) ||
    (access.userId === ownerId &&
      access.permissions.includes(`${prefix}_own` as Permission))
  );
}

export function projectPolicy(
  access: AccessProfile,
  ownerId: string,
  share: {
    visibility: "private" | "shared" | "all";
    grants: {
      type: "person" | "team";
      target: string;
      role: "viewer" | "commenter" | "editor";
    }[];
  },
  teams: { id: string; members: string[] }[],
) {
  const owner = ownerId === access.userId;
  const roles =
    share.visibility === "shared"
      ? share.grants
          .filter((g) =>
            g.type === "person"
              ? g.target === access.email
              : teams.some(
                  (t) => t.id === g.target && t.members.includes(access.email),
                ),
          )
          .map((g) => g.role)
      : [];
  const read =
    access.superAdmin ||
    owner ||
    share.visibility === "all" ||
    roles.length > 0;
  const edit =
    read && (canChangeProject(access, ownerId) || roles.includes("editor"));
  return {
    read,
    edit,
    comment: read && (edit || roles.includes("commenter")),
    share: access.superAdmin || owner,
    archive: read && canChangeProject(access, ownerId, true),
  };
}
