CREATE TABLE `atlas_project_roles` (
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`assigned_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `role`),
	FOREIGN KEY (`project_id`) REFERENCES `atlas_projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_project_roles_role" CHECK("atlas_project_roles"."role" IN ('owner','process_owner','teoa_approver','vision_approver'))
);
--> statement-breakpoint
CREATE TABLE `atlas_workspace_members` (
	`workspace_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`added_by` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace_id`, `email`),
	FOREIGN KEY (`workspace_id`) REFERENCES `atlas_workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_workspace_members_role" CHECK("atlas_workspace_members"."role" IN ('admin','member'))
);
--> statement-breakpoint
CREATE TABLE `atlas_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_workspaces_slug_unique` ON `atlas_workspaces` (`slug`);--> statement-breakpoint
ALTER TABLE `atlas_onboarding` ADD `workspace_id` text;--> statement-breakpoint
INSERT INTO `atlas_workspaces` (`id`,`name`,`slug`,`created_by`,`created_at`)
  VALUES ('general','General','general','migration-0017','2026-10-29T00:00:00.000Z');
--> statement-breakpoint
UPDATE `atlas_onboarding` SET `workspace_id` = 'general' WHERE `workspace_id` IS NULL;
