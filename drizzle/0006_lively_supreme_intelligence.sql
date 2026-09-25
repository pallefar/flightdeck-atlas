CREATE TABLE `atlas_flightdeck_transitions` (
	`send_id` text NOT NULL,
	`seq` integer NOT NULL,
	`stage` text NOT NULL,
	`observed_at` text,
	`source` text NOT NULL,
	FOREIGN KEY (`send_id`) REFERENCES `atlas_flightdeck_operations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "atlas_fd_transitions_source" CHECK("atlas_flightdeck_transitions"."source" IN ('atlas','poll','webhook','backfill'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_atlas_fd_transitions_send_seq` ON `atlas_flightdeck_transitions` (`send_id`,`seq`);--> statement-breakpoint
-- Hand-added backfill (not generated): one 'backfill' row per send that
-- predates the log, at the stage stageFor() gives its stored state, with no
-- observed time (shown as "before tracking"). Mirrors stageFor() in
-- lib/flightdeck/onboarding.ts; tests/flightdeck-transitions.spec.ts pins the
-- two together for every state, reason and setup state.
INSERT INTO `atlas_flightdeck_transitions` (`send_id`,`seq`,`stage`,`observed_at`,`source`)
SELECT `id`, 1,
	CASE `state`
		WHEN 'reserved' THEN 'not-confirmed'
		WHEN 'filed' THEN 'submitted'
		WHEN 'promoted' THEN 'submitted'
		WHEN 'linked' THEN CASE
			WHEN `setup_state` = 'complete' THEN 'setup-complete'
			WHEN `setup_state` IN ('awaiting-cowork','result-landed') THEN 'setup-in-progress'
			ELSE 'linked' END
		WHEN 'rejected' THEN CASE WHEN `reason_code` = 'needs-more-info' THEN 'needs-more-info' ELSE 'rejected' END
		WHEN 'refused' THEN CASE WHEN `reason_code` = 'abandoned' THEN 'closed' ELSE 'not-sent' END
	END,
	NULL, 'backfill'
FROM `atlas_flightdeck_operations`
WHERE `state` IN ('reserved','filed','promoted','linked','rejected','refused')
ORDER BY rowid;
