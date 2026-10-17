ALTER TABLE `generation_tasks` ADD `execution_input_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `content_plan_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `selected_mechanisms_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stage` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `failed_stage` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stage_started_at` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stage_finished_at` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `stage_timings_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `last_error_code` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `plan_model_name` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `plan_usage_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_model_name` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `validator_usage_json` text;--> statement-breakpoint
ALTER TABLE `generation_tasks` ADD `semantic_validation_json` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `validation_status` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `can_auto_apply` integer DEFAULT 0 NOT NULL;