CREATE TABLE `atlas_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `atlas_collaboration` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`author` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_collaboration_project` ON `atlas_collaboration` (`project_id`);--> statement-breakpoint
CREATE TABLE `atlas_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_decks_owner` ON `atlas_decks` (`owner_id`);--> statement-breakpoint
CREATE TABLE `atlas_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`author` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_files_project` ON `atlas_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `atlas_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_notifications_recipient` ON `atlas_notifications` (`recipient`,`created_at`);--> statement-breakpoint
CREATE TABLE `atlas_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `atlas_project_shares` (
	`project_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `atlas_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
