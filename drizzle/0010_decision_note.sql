ALTER TABLE `atlas_flightdeck_transitions` ADD `note` text;--> statement-breakpoint
ALTER TABLE `atlas_flightdeck_transitions` ADD `fields` text;--> statement-breakpoint
-- Hand-added (not generated): the reviewer note (D-037 item 5) is kept only
-- on a send's latest row. Any later row of the same send (sent again,
-- closed) deletes it, whoever writes the row, and applyObservedStage stays
-- one conditional INSERT…SELECT. tests/project-bridge.spec.ts pins it.
CREATE TRIGGER `atlas_fd_transitions_note_moves_on`
AFTER INSERT ON `atlas_flightdeck_transitions`
BEGIN
	UPDATE `atlas_flightdeck_transitions` SET `note` = NULL, `fields` = NULL
	WHERE `send_id` = NEW.`send_id` AND `seq` < NEW.`seq`
		AND (`note` IS NOT NULL OR `fields` IS NOT NULL);
END;
