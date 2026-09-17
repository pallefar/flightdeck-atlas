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
