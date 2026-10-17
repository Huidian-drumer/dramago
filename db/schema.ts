import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const works = sqliteTable('works', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('未命名短剧'),
  currentVersionId: text('current_version_id'),
  storyStatus: text('story_status').notNull().default('active'),
  completedVersionId: text('completed_version_id'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const versions = sqliteTable('versions', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  parentVersionId: text('parent_version_id'),
  operation: text('operation').notNull(),
  status: text('status').notNull(),
  title: text('title').notNull(),
  segmentTitle: text('segment_title'),
  content: text('content').notNull(),
  generatedSegment: text('generated_segment'),
  creativeBriefJson: text('creative_brief_json').notNull(),
  changeSummary: text('change_summary'),
  checksJson: text('checks_json'),
  modelName: text('model_name'),
  usageJson: text('usage_json'),
  contentHash: text('content_hash'),
  validatorVersion: text('validator_version'),
  validationStatus: text('validation_status'),
  canAutoApply: integer('can_auto_apply').notNull().default(0),
  currentValidationRunId: text('current_validation_run_id'),
  writerProviderId: text('writer_provider_id'),
  writerModelId: text('writer_model_id'),
  validatorProviderId: text('validator_provider_id'),
  validatorModelId: text('validator_model_id'),
  providerConfigVersion: integer('provider_config_version'),
  writerProviderConfigVersion: integer('writer_provider_config_version'),
  validatorProviderConfigVersion: integer('validator_provider_config_version'),
  validatedAt: text('validated_at'),
  adoptedAt: text('adopted_at'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('idx_versions_work_created').on(table.workId, table.createdAt),
  index('idx_versions_parent').on(table.parentVersionId)
]);

export const workStoryPlans = sqliteTable('work_story_plans', {
  workId: text('work_id').primaryKey(),
  futurePlotJson: text('future_plot_json').notNull().default('[]'),
  endingPlanJson: text('ending_plan_json').notNull().default('[]'),
  foreshadowingJson: text('foreshadowing_json').notNull().default('[]'),
  updatedAt: text('updated_at').notNull()
});

export const workEditDrafts = sqliteTable('work_edit_drafts', {
  workId: text('work_id').primaryKey(),
  draftId: text('draft_id').notNull(),
  basedOnVersionId: text('based_on_version_id'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const workOperationDrafts = sqliteTable('work_operation_drafts', {
  workId: text('work_id').notNull(),
  operation: text('operation').notNull(),
  draftId: text('draft_id').notNull(),
  sourceVersionId: text('source_version_id'),
  instruction: text('instruction').notNull().default(''),
  formJson: text('form_json').notNull().default('{}'),
  status: text('status').notNull().default('active'),
  revision: integer('revision').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  consumedAt: text('consumed_at')
}, (table) => [index('idx_work_operation_drafts_updated').on(table.workId, table.updatedAt)]);

export const storyMemoryAnnotations = sqliteTable('story_memory_annotations', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  versionId: text('version_id').notNull(),
  memoryItemId: text('memory_item_id').notNull(),
  action: text('action').notNull(),
  valueJson: text('value_json'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [index('idx_memory_annotations_work_version').on(table.workId, table.versionId, table.updatedAt)]);

export const generationTasks = sqliteTable('generation_tasks', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  sourceVersionId: text('source_version_id'),
  creativeBriefJson: text('creative_brief_json').notNull(),
  executionInputJson: text('execution_input_json'),
  contentPlanJson: text('content_plan_json'),
  selectedMechanismsJson: text('selected_mechanisms_json'),
  sourceHash: text('source_hash'),
  status: text('status').notNull(),
  stage: text('stage'),
  failedStage: text('failed_stage'),
  stageStartedAt: text('stage_started_at'),
  stageFinishedAt: text('stage_finished_at'),
  stageTimingsJson: text('stage_timings_json'),
  lastErrorCode: text('last_error_code'),
  updatedAt: text('updated_at'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  provider: text('provider'),
  modelName: text('model_name'),
  usageJson: text('usage_json'),
  planModelName: text('plan_model_name'),
  planUsageJson: text('plan_usage_json'),
  validatorModelName: text('validator_model_name'),
  validatorUsageJson: text('validator_usage_json'),
  semanticValidationJson: text('semantic_validation_json'),
  costState: text('cost_state').notNull().default('unknown'),
  resultVersionId: text('result_version_id'),
  attemptCount: integer('attempt_count').notNull().default(0),
  transportAttempts: integer('transport_attempts').notNull().default(0),
  formatRepairAttempts: integer('format_repair_attempts').notNull().default(0),
  validatorAttempts: integer('validator_attempts').notNull().default(0),
  promptTemplateId: text('prompt_template_id'),
  mergeStrategy: text('merge_strategy'),
  outputKind: text('output_kind'),
  candidateContentHash: text('candidate_content_hash'),
  validatorVersion: text('validator_version'),
  validationStatus: text('validation_status'),
  sourceIsCurrent: integer('source_is_current'),
  writerProviderId: text('writer_provider_id'),
  writerModelId: text('writer_model_id'),
  plannerProviderId: text('planner_provider_id'),
  plannerModelId: text('planner_model_id'),
  validatorProviderId: text('validator_provider_id'),
  validatorModelId: text('validator_model_id'),
  providerConfigVersion: integer('provider_config_version'),
  credentialRef: text('credential_ref'),
  writerProviderConfigVersion: integer('writer_provider_config_version'),
  writerCredentialRef: text('writer_credential_ref'),
  validatorProviderConfigVersion: integer('validator_provider_config_version'),
  validatorCredentialRef: text('validator_credential_ref'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at')
}, (table) => [
  index('idx_tasks_work_created').on(table.workId, table.createdAt),
  index('idx_tasks_status').on(table.status)
]);

export const storyFactsSnapshots = sqliteTable('story_facts_snapshots', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  versionId: text('version_id').notNull().unique(),
  contentHash: text('content_hash').notNull(),
  factsJson: text('facts_json').notNull(),
  extractionStatus: text('extraction_status').notNull(),
  provider: text('provider'),
  modelName: text('model_name'),
  validatorVersion: text('validator_version').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('idx_story_facts_work_version').on(table.workId, table.versionId)
]);

export const storyMemorySnapshots = sqliteTable('story_memory_snapshots', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  versionId: text('version_id').notNull().unique(),
  contentHash: text('content_hash').notNull(),
  memoryJson: text('memory_json').notNull(),
  memoryStatus: text('memory_status').notNull(),
  extractionSource: text('extraction_source').notNull(),
  sourceVersionId: text('source_version_id'),
  validationRunId: text('validation_run_id'),
  provider: text('provider'),
  modelName: text('model_name'),
  validatorVersion: text('validator_version'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('idx_story_memory_work_version').on(table.workId, table.versionId),
  index('idx_story_memory_source_version').on(table.sourceVersionId)
]);

export const adoptionEvents = sqliteTable('adoption_events', {
  id: text('id').primaryKey(),
  workId: text('work_id').notNull(),
  candidateVersionId: text('candidate_version_id').notNull(),
  previousCurrentVersionId: text('previous_current_version_id'),
  newCurrentVersionId: text('new_current_version_id'),
  result: text('result').notNull(),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('idx_adoption_events_work_created').on(table.workId, table.createdAt)
]);
