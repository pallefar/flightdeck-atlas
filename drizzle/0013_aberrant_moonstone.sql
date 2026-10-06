CREATE TABLE `atlas_vision_delivery_outbox` (
	`project_id` text PRIMARY KEY NOT NULL,
	`atlas_revision` integer NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
