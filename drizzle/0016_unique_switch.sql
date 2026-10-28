CREATE TABLE `atlas_device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`role_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atlas_device_tokens_token_hash_unique` ON `atlas_device_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_atlas_device_tokens_email` ON `atlas_device_tokens` (`email`);