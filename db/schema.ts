import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable(
  "atlas_projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    data: text("data").notNull(),
    source: text("source").notNull().default("atlas"),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [index("idx_atlas_projects_owner").on(t.ownerId)],
);

export const roles = sqliteTable("atlas_roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  permissions: text("permissions").notNull(),
  builtin: integer("builtin").notNull().default(0),
});
export const members = sqliteTable("atlas_members", {
  email: text("email").primaryKey(),
  userId: text("user_id"),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  disabled: integer("disabled").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
export const accessEvents = sqliteTable("atlas_access_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: text("created_at").notNull(),
});

export const teams = sqliteTable("atlas_teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const projectShares = sqliteTable("atlas_project_shares", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const apps = sqliteTable("atlas_apps", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
export const collaboration = sqliteTable(
  "atlas_collaboration",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    data: text("data").notNull(),
    author: text("author").notNull(),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
  },
  (t) => [index("idx_atlas_collaboration_project").on(t.projectId)],
);
export const notifications = sqliteTable(
  "atlas_notifications",
  {
    id: text("id").primaryKey(),
    recipient: text("recipient").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
    read: integer("read").notNull().default(0),
  },
  (t) => [
    index("idx_atlas_notifications_recipient").on(t.recipient, t.createdAt),
  ],
);
export const files = sqliteTable(
  "atlas_files",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_atlas_files_project").on(t.projectId)],
);
export const decks = sqliteTable(
  "atlas_decks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    data: text("data").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_atlas_decks_owner").on(t.ownerId)],
);
export const preferences = sqliteTable("atlas_preferences", {
  userId: text("user_id").primaryKey(),
  data: text("data").notNull(),
  revision: integer("revision").notNull().default(1),
});
