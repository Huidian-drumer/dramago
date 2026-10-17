ALTER TABLE `versions` ADD `current_validation_run_id` text;
--> statement-breakpoint
ALTER TABLE `provider_transport_attempts` ADD `validation_run_id` text;
--> statement-breakpoint
CREATE TABLE `candidate_validation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`work_id` text NOT NULL,
	`candidate_version_id` text NOT NULL,
	`candidate_content_hash` text NOT NULL,
	`source_version_id` text,
	`source_content_hash` text,
	`operation` text NOT NULL,
	`trigger` text NOT NULL,
	`validator_version` text NOT NULL,
	`provider_id` text,
	`model_name` text,
	`status` text NOT NULL,
	`checks_json` text,
	`semantic_validation_json` text,
	`usage_json` text,
	`confirmed_cost_risk` integer DEFAULT 0 NOT NULL,
	`outcome_unknown` integer DEFAULT 0 NOT NULL,
	`retry_confirmation_required` integer DEFAULT 0 NOT NULL,
	`execution_instance_id` text,
	`execution_token` text,
	`error_code` text,
	`created_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_validation_runs_candidate_created` ON `candidate_validation_runs` (`candidate_version_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_validation_runs_task_created` ON `candidate_validation_runs` (`task_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_validation_runs_one_active` ON `candidate_validation_runs` (`candidate_version_id`) WHERE `status` = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX `candidate_validation_runs_one_legacy` ON `candidate_validation_runs` (`candidate_version_id`,`trigger`) WHERE `trigger` = 'legacy_snapshot';
