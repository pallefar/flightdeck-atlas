CREATE TABLE `atlas_device_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`token` text,
	`delivered_at` text
);
