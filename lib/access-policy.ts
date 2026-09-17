export const permissionLabels = {
  "projects.read": "View all projects",
  "projects.create": "Create projects",
  "projects.edit_own": "Edit own projects",
  "projects.edit_all": "Edit all projects",
  "projects.archive_own": "Archive own projects",
  "projects.archive_all": "Archive all projects",
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
