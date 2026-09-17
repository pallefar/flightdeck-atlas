CREATE TABLE `atlas_access_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `atlas_members` (
	`email` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`role_id` text NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `atlas_roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `atlas_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`permissions` text NOT NULL,
	`builtin` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_roles_name_unique` ON `atlas_roles` (`name`);
--> statement-breakpoint
INSERT INTO atlas_roles (id,name,permissions,builtin) VALUES ('admin','Admin','["projects.read", "projects.create", "projects.edit_own", "projects.edit_all", "projects.archive_own", "projects.archive_all", "briefings.read", "ideas.use"]',1);

--> statement-breakpoint
INSERT INTO atlas_roles (id,name,permissions,builtin) VALUES ('owner','Owner','["projects.read", "projects.create", "projects.edit_own", "projects.archive_own", "briefings.read", "ideas.use"]',1);
