CREATE TABLE `atlas_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`by` text NOT NULL,
	`source` text NOT NULL,
	`screen` text DEFAULT '' NOT NULL,
	`project_id` text,
	`stage` text,
	`rating` text NOT NULL,
	`category` text,
	`comment` text DEFAULT '' NOT NULL,
	`app_version` text,
	`created_at` text NOT NULL,
	CONSTRAINT "atlas_feedback_rating" CHECK("atlas_feedback"."rating" IN ('ok','minor_issue','major_issue'))
);
--> statement-breakpoint
CREATE INDEX `idx_atlas_feedback_by` ON `atlas_feedback` (`by`,`created_at`);