CREATE TABLE `atlas_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`data` text NOT NULL,
	`source` text DEFAULT 'atlas' NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_projects_owner` ON `atlas_projects` (`owner_id`);