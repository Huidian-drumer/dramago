ALTER TABLE `generation_tasks` ADD `outcome_unknown` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `unknown_stage` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `retry_confirmation_required` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `retry_of_task_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `execution_instance_id` text;
--> statement-breakpoint
CREATE TABLE `provider_transport_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`stage` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model_name` text,
	`execution_instance_id` text,
	`prepared_at` text NOT NULL,
	`sent_at` text,
	`finished_at` text,
	`http_status` integer,
	`error_code` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_transport_attempts_task_number_unique` ON `provider_transport_attempts` (`task_id`,`attempt_number`);
--> statement-breakpoint
CREATE INDEX `idx_provider_attempts_task_stage` ON `provider_transport_attempts` (`task_id`,`stage`,`attempt_number`);
--> statement-breakpoint
CREATE INDEX `idx_provider_attempts_status` ON `provider_transport_attempts` (`status`);
--> statement-breakpoint
CREATE TABLE `version_restore_events` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`previous_current_version_id` text,
	`new_current_version_id` text,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_restore_events_work_created` ON `version_restore_events` (`work_id`,`created_at`);
