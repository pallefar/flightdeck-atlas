CREATE TABLE `atlas_flightdeck_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`atlas_project_id` text NOT NULL,
	`atlas_revision` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`destination_workspace_id` text NOT NULL,
	`proposed_label` text NOT NULL,
	`proposed_project_id` text,
	`state` text NOT NULL,
	`submission_id` text,
	`received_at` text,
	`payload_sha256` text,
	`reason_code` text,
	`setup_state` text,
	`created_by` text NOT NULL,
	`updated_at` text NOT NULL,
	`checked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_flightdeck_operations_idempotency_key_unique` ON `atlas_flightdeck_operations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_atlas_fd_operations_project` ON `atlas_flightdeck_operations` (`atlas_project_id`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_fd_operations_open` ON `atlas_flightdeck_operations` (`atlas_project_id`) WHERE state IN ('reserved','filed','promoted','linked');--> statement-breakpoint
CREATE TABLE `atlas_project_links` (
	`installation_id` text NOT NULL,
	`os_instance_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`os_project_id` text NOT NULL,
	`atlas_project_id` text NOT NULL,
	`submission_id` text,
	`linked_at` text NOT NULL,
	`linked_by` text NOT NULL,
	`source_revision` integer,
	`last_checked_at` text NOT NULL,
	`access_state` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_project_links_os` ON `atlas_project_links` (`installation_id`,`os_instance_id`,`workspace_id`,`os_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_project_links_atlas` ON `atlas_project_links` (`installation_id`,`atlas_project_id`);