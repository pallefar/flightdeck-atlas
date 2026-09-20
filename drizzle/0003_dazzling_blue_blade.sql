CREATE TABLE `atlas_work_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`available_at` text DEFAULT '' NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_work_project` ON `atlas_work_records` (`project_id`,`kind`);--> statement-breakpoint
CREATE INDEX `idx_atlas_work_owner_due` ON `atlas_work_records` (`owner`,`available_at`);