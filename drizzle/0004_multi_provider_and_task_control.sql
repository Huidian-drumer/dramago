ALTER TABLE `generation_tasks` ADD `writer_provider_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `writer_model_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `planner_model_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_provider_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_model_id` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `provider_config_version` integer;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `credential_ref` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `execution_token` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stop_requested_at` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stopped_at` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stop_state` text;
--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stop_reason` text;
--> statement-breakpoint
ALTER TABLE `provider_transport_attempts` ADD `provider_id` text;
--> statement-breakpoint
ALTER TABLE `provider_transport_attempts` ADD `credential_ref` text;
--> statement-breakpoint
ALTER TABLE `provider_transport_attempts` ADD `execution_token` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `writer_provider_id` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `writer_model_id` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `validator_provider_id` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `validator_model_id` text;
--> statement-breakpoint
ALTER TABLE `versions` ADD `provider_config_version` integer;
--> statement-breakpoint
CREATE TABLE `task_stop_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`work_id` text NOT NULL,
	`stage` text,
	`attempt_id` text,
	`result` text NOT NULL,
	`remote_outcome_unknown` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_task_stop_events_task_created` ON `task_stop_events` (`task_id`,`created_at`);
