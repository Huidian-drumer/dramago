CREATE TABLE `adoption_events` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`candidate_version_id` text NOT NULL,
	`previous_current_version_id` text,
	`new_current_version_id` text,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_adoption_events_work_created` ON `adoption_events` (`work_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `story_facts_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`version_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`facts_json` text NOT NULL,
	`extraction_status` text NOT NULL,
	`provider` text,
	`model_name` text,
	`validator_version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_facts_snapshots_version_id_unique` ON `story_facts_snapshots` (`version_id`);--> statement-breakpoint
CREATE INDEX `idx_story_facts_work_version` ON `story_facts_snapshots` (`work_id`,`version_id`);--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `transport_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `format_repair_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `prompt_template_id` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `merge_strategy` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `output_kind` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `candidate_content_hash` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_version` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validation_status` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `source_is_current` integer;--> statement-breakpoint
ALTER TABLE `versions` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `validator_version` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `validated_at` text;