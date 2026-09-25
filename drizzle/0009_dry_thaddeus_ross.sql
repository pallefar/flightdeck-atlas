ALTER TABLE `atlas_notifications` ADD `send_id` text;--> statement-breakpoint
ALTER TABLE `atlas_notifications` ADD `seq` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_notifications_send_seq_recipient` ON `atlas_notifications` (`send_id`,`seq`,`recipient`);