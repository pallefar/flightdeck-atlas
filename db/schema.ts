import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
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

export const workRecords = sqliteTable(
  "atlas_work_records",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    owner: text("owner").notNull(),
    data: text("data").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
    availableAt: text("available_at").notNull().default(""),
    closed: integer("closed").notNull().default(0),
  },
  (t) => [
    index("idx_atlas_work_project").on(t.projectId, t.kind),
    index("idx_atlas_work_owner_due").on(t.owner, t.availableAt),
  ],
);

/** Atlas -> FlightDeck OS onboarding sends (plan §4.7). A row is reserved
 * with a fresh idempotency key BEFORE the remote call; a lost response keeps
 * the row and its key, so a retry can never file a second request. At most
 * one open send per Atlas project (reserved, filed, promoted or linked).
 * `setup_state` and `checked_at` extend the §4.7 list: the status timeline
 * and the server-side one-read-a-minute throttle need them. */
export const flightdeckOperations = sqliteTable(
  "atlas_flightdeck_operations",
  {
    id: text("id").primaryKey(),
    atlasProjectId: text("atlas_project_id").notNull(),
    atlasRevision: integer("atlas_revision").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    destinationWorkspaceId: text("destination_workspace_id").notNull(),
    proposedLabel: text("proposed_label").notNull(),
    proposedProjectId: text("proposed_project_id"),
    state: text("state").notNull(),
    submissionId: text("submission_id"),
    receivedAt: text("received_at"),
    payloadSha256: text("payload_sha256"),
    reasonCode: text("reason_code"),
    setupState: text("setup_state"),
    createdBy: text("created_by").notNull(),
    updatedAt: text("updated_at").notNull(),
    checkedAt: text("checked_at"),
  },
  (t) => [
    index("idx_atlas_fd_operations_project").on(t.atlasProjectId, t.updatedAt),
    uniqueIndex("uniq_atlas_fd_operations_open")
      .on(t.atlasProjectId)
      .where(sql`state IN ('reserved','filed','promoted','linked')`),
  ],
);
/** Confirmed Atlas <-> OS project links (PROJECT-BRIDGE-CONTRACT.md:27-32).
 * Written only after the OS read-back says promoted AND read:context lists
 * the project. Installation-scoped, outside the editable project JSON. */
export const projectLinks = sqliteTable(
  "atlas_project_links",
  {
    installationId: text("installation_id").notNull(),
    osInstanceId: text("os_instance_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    osProjectId: text("os_project_id").notNull(),
    atlasProjectId: text("atlas_project_id").notNull(),
    submissionId: text("submission_id"),
    linkedAt: text("linked_at").notNull(),
    linkedBy: text("linked_by").notNull(),
    sourceRevision: integer("source_revision"),
    lastCheckedAt: text("last_checked_at").notNull(),
    accessState: text("access_state").notNull(),
  },
  (t) => [
    uniqueIndex("uniq_atlas_project_links_os").on(
      t.installationId,
      t.osInstanceId,
      t.workspaceId,
      t.osProjectId,
    ),
    uniqueIndex("uniq_atlas_project_links_atlas").on(
      t.installationId,
      t.atlasProjectId,
    ),
  ],
);
