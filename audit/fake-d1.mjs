function normalize(sql) {
  return String(sql).replace(/\s+/gu, ' ').trim().toLowerCase();
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class FakeD1 {
  constructor() {
    this.works = [];
    this.versions = [];
    this.tasks = [];
    this.storyFacts = [];
    this.storyMemory = [];
    this.adoptionEvents = [];
    this.transportAttempts = [];
    this.restoreEvents = [];
    this.stopEvents = [];
    this.validationRuns = [];
    this.workStoryPlans = [];
    this.memoryAnnotations = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    const before = this.snapshot();
    try {
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      Object.assign(this, {
        works: before.works, versions: before.versions, tasks: before.tasks, storyFacts: before.storyFacts,
        storyMemory: before.storyMemory,
        adoptionEvents: before.adoptionEvents, transportAttempts: before.transportAttempts, restoreEvents: before.restoreEvents,
        stopEvents: before.stopEvents, validationRuns: before.validationRuns, workStoryPlans: before.workStoryPlans,
        memoryAnnotations: before.memoryAnnotations
      });
      throw error;
    }
  }

  snapshot() {
    return clone({
      works: this.works,
      versions: this.versions,
      tasks: this.tasks,
      storyFacts: this.storyFacts,
      storyMemory: this.storyMemory,
      adoptionEvents: this.adoptionEvents,
      transportAttempts: this.transportAttempts,
      restoreEvents: this.restoreEvents,
      stopEvents: this.stopEvents,
      validationRuns: this.validationRuns
      , workStoryPlans: this.workStoryPlans, memoryAnnotations: this.memoryAnnotations
    });
  }
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = normalize(sql);
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    if (this.sql.startsWith('select * from versions where id = ?')) {
      return clone(this.db.versions.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith("select * from versions where work_id = ? and status = 'candidate'")) {
      return clone(this.db.versions.filter((row) => row.work_id === this.args[0] && row.status === 'candidate')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null);
    }
    if (this.sql.startsWith('select * from works where id = ?')) {
      return clone(this.db.works.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from works order by updated_at desc')) {
      return clone([...this.db.works].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null);
    }
    if (this.sql.startsWith('select * from story_facts_snapshots where version_id = ?')) {
      return clone(this.db.storyFacts.find((row) => row.version_id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from story_memory_snapshots where version_id = ?')) {
      return clone(this.db.storyMemory.find((row) => row.version_id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from work_story_plans where work_id = ?')) {
      return clone(this.db.workStoryPlans.find((row) => row.work_id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from story_memory_annotations where work_id = ? and version_id = ?')) {
      return clone(this.db.memoryAnnotations.filter((row) => row.work_id === this.args[0] && row.version_id === this.args[1])
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)));
    }
    if (this.sql.startsWith('select * from generation_tasks where id = ?')) {
      return clone(this.db.tasks.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from generation_tasks where work_id = ? order by created_at desc')) {
      return clone(this.db.tasks.filter((row) => row.work_id === this.args[0])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null);
    }
    if (this.sql.startsWith('select * from generation_tasks where result_version_id = ? and work_id = ?')) {
      return clone(this.db.tasks.filter((row) => row.result_version_id === this.args[0] && row.work_id === this.args[1])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null);
    }
    if (this.sql.startsWith('select * from candidate_validation_runs where id = ?')) {
      return clone(this.db.validationRuns.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith("select * from candidate_validation_runs where candidate_version_id = ? and trigger = 'legacy_snapshot'")) {
      return clone(this.db.validationRuns.find((row) => row.candidate_version_id === this.args[0]
        && row.trigger === 'legacy_snapshot') || null);
    }
    throw new Error(`FakeD1 first() does not support: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith('select * from story_memory_annotations where work_id = ? and version_id = ?')) {
      return { results: clone(this.db.memoryAnnotations.filter((row) => row.work_id === this.args[0] && row.version_id === this.args[1])
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))) };
    }
    if (this.sql.startsWith('select * from story_memory_snapshots where work_id = ? order by created_at asc')) {
      return { results: clone(this.db.storyMemory.filter((row) => row.work_id === this.args[0])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))) };
    }
    if (this.sql.startsWith('select * from versions where work_id = ? order by created_at desc')) {
      return {
        results: clone(this.db.versions
          .filter((row) => row.work_id === this.args[0])
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 40))
      };
    }
    if (this.sql.startsWith('select * from provider_transport_attempts where task_id = ? order by attempt_number asc')) {
      return { results: clone(this.db.transportAttempts.filter((row) => row.task_id === this.args[0])
        .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number))) };
    }
    if (this.sql.startsWith('select * from provider_transport_attempts where validation_run_id = ? order by attempt_number asc')) {
      return { results: clone(this.db.transportAttempts.filter((row) => row.validation_run_id === this.args[0])
        .sort((a, b) => Number(a.attempt_number) - Number(b.attempt_number))) };
    }
    if (this.sql.startsWith('select * from candidate_validation_runs where candidate_version_id = ? order by created_at desc')) {
      return { results: clone(this.db.validationRuns.filter((row) => row.candidate_version_id === this.args[0])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))) };
    }
    if (this.sql.startsWith("select * from candidate_validation_runs where work_id = ? and status = 'running'")) {
      return { results: clone(this.db.validationRuns.filter((row) => row.work_id === this.args[0] && row.status === 'running')
        .sort((a, b) => a.created_at.localeCompare(b.created_at))) };
    }
    throw new Error(`FakeD1 all() does not support: ${this.sql}`);
  }

  async run() {
    const a = this.args;
    if (this.sql.startsWith('insert into works')) {
      this.db.works.push({ id: a[0], title: a[1], current_version_id: a[2], created_at: a[3], updated_at: a[4] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into versions') && this.sql.includes(' select ')) {
      const work = this.db.works.find((row) => row.id === a[a.length - 2] && row.current_version_id === a[a.length - 1]);
      if (!work) return { success: true, meta: { changes: 0 } };
      const fields = this.sql.match(/insert into versions \((.+?)\) select/u)[1].split(',').map((field) => field.trim().replaceAll('`', ''));
      this.db.versions.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into versions')) {
      const fields = this.sql.match(/insert into versions \((.+?)\) values/u)[1].split(',').map((field) => field.trim().replaceAll('`', ''));
      this.db.versions.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into generation_tasks')) {
      const fields = this.sql.match(/insert into generation_tasks \((.+?)\) values/u)[1].split(',').map((field) => field.trim().replaceAll('`', ''));
      this.db.tasks.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set writer_provider_config_version = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[5]);
      if (row) Object.assign(row, { writer_provider_config_version: a[0], writer_credential_ref: a[1],
        validator_provider_config_version: a[2], validator_credential_ref: a[3], planner_provider_id: a[4] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('insert into story_facts_snapshots')) {
      const fields = ['id', 'work_id', 'version_id', 'content_hash', 'facts_json', 'extraction_status', 'provider', 'model_name',
        'validator_version', 'created_at', 'updated_at'];
      const next = Object.fromEntries(fields.map((field, index) => [field, a[index]]));
      const existing = this.db.storyFacts.find((row) => row.version_id === next.version_id);
      if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
      else this.db.storyFacts.push(next);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into story_memory_snapshots')) {
      if (this.sql.includes(' select ')) {
        const work = this.db.works.find((row) => row.id === a[a.length - 2] && row.current_version_id === a[a.length - 1]);
        if (!work) return { success: true, meta: { changes: 0 } };
      }
      const fields = ['id', 'work_id', 'version_id', 'content_hash', 'memory_json', 'memory_status', 'extraction_source',
        'source_version_id', 'validation_run_id', 'provider', 'model_name', 'validator_version', 'created_at', 'updated_at'];
      const next = Object.fromEntries(fields.map((field, index) => [field, a[index]]));
      const existing = this.db.storyMemory.find((row) => row.version_id === next.version_id);
      if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
      else this.db.storyMemory.push(next);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into work_story_plans')) {
      const next = { work_id: a[0], future_plot_json: a[1], ending_plan_json: a[2],
        foreshadowing_json: a[3], updated_at: a[4] };
      const existing = this.db.workStoryPlans.find((row) => row.work_id === next.work_id);
      if (existing) Object.assign(existing, next); else this.db.workStoryPlans.push(next);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into story_memory_annotations')) {
      const fields = ['id', 'work_id', 'version_id', 'memory_item_id', 'action', 'value_json', 'note', 'created_at', 'updated_at'];
      this.db.memoryAnnotations.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update works set title = ?, updated_at = ? where id = ?')) {
      const row = this.db.works.find((item) => item.id === a[2]);
      if (row) Object.assign(row, { title: a[0], updated_at: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('insert into adoption_events')) {
      if (this.sql.includes(' select ')) {
        const work = this.db.works.find((row) => row.id === a[a.length - 2] && row.current_version_id === a[a.length - 1]);
        if (!work) return { success: true, meta: { changes: 0 } };
      }
      const fields = ['id', 'work_id', 'candidate_version_id', 'previous_current_version_id', 'new_current_version_id', 'result', 'created_at'];
      this.db.adoptionEvents.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into provider_transport_attempts')) {
      const fields = this.sql.match(/insert into provider_transport_attempts \((.+?)\) values/u)[1]
        .split(',').map((field) => field.trim().replaceAll('`', ''));
      this.db.transportAttempts.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into version_restore_events')) {
      if (this.sql.includes(' select ') && !this.db.versions.some((row) => row.id === a[a.length - 1])) {
        return { success: true, meta: { changes: 0 } };
      }
      const fields = ['id', 'work_id', 'source_version_id', 'previous_current_version_id', 'new_current_version_id', 'result', 'created_at'];
      this.db.restoreEvents.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into task_stop_events')) {
      const fields = ['id', 'task_id', 'work_id', 'stage', 'attempt_id', 'result', 'remote_outcome_unknown', 'created_at'];
      this.db.stopEvents.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert or ignore into candidate_validation_runs')
      || this.sql.startsWith('insert into candidate_validation_runs')) {
      const fields = this.sql.match(/candidate_validation_runs \((.+?)\) values/u)[1]
        .split(',').map((field) => field.trim().replaceAll('`', ''));
      const next = Object.fromEntries(fields.map((field, index) => [field, a[index]]));
      const duplicateId = this.db.validationRuns.some((row) => row.id === next.id);
      const duplicateLegacy = next.trigger === 'legacy_snapshot'
        && this.db.validationRuns.some((row) => row.candidate_version_id === next.candidate_version_id && row.trigger === 'legacy_snapshot');
      const duplicateActive = next.status === 'running'
        && this.db.validationRuns.some((row) => row.candidate_version_id === next.candidate_version_id && row.status === 'running');
      if (duplicateId || duplicateLegacy || duplicateActive) {
        if (this.sql.startsWith('insert or ignore')) return { success: true, meta: { changes: 0 } };
        throw new Error('UNIQUE constraint failed: candidate_validation_runs');
      }
      this.db.validationRuns.push(next);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update works set title = ?, current_version_id = ?, updated_at = ?') && this.sql.includes('and current_version_id is null')) {
      const row = this.db.works.find((item) => item.id === a[3] && item.current_version_id == null);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { title: a[0], current_version_id: a[1], updated_at: a[2] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update works set title = ?, current_version_id = ?, updated_at = ?') && this.sql.includes('and current_version_id = ?')) {
      const row = this.db.works.find((item) => item.id === a[3] && item.current_version_id === a[4]);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { title: a[0], current_version_id: a[1], updated_at: a[2] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update works set title = ?, current_version_id = ?, updated_at = ?')) {
      const row = this.db.works.find((item) => item.id === a[3]);
      Object.assign(row, { title: a[0], current_version_id: a[1], updated_at: a[2] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update works set updated_at = ?')) {
      const row = this.db.works.find((item) => item.id === a[1]);
      row.updated_at = a[0];
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update works set story_status = ?')) {
      const row = this.db.works.find((item) => item.id === a[4] && item.current_version_id === a[5]);
      if (row) Object.assign(row, { story_status: a[0], completed_version_id: a[1], completed_at: a[2], updated_at: a[3] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set status = ?, adopted_at = ?')) {
      const guarded = this.sql.includes('exists (select 1 from works');
      const includesValidationView = this.sql.includes('checks_json = ?');
      const versionIdIndex = includesValidationView ? 9 : 2;
      const versionWorkIdIndex = includesValidationView ? 10 : 3;
      const guardWorkIdIndex = includesValidationView ? 11 : 4;
      const guardCurrentVersionIndex = includesValidationView ? 12 : 5;
      const work = guarded ? this.db.works.find((item) => item.id === a[guardWorkIdIndex]
        && item.current_version_id === a[guardCurrentVersionIndex]) : true;
      const row = work && this.db.versions.find((item) => item.id === a[versionIdIndex]
        && (!guarded || item.work_id === a[versionWorkIdIndex]));
      if (row) Object.assign(row, includesValidationView ? {
        status: a[0], adopted_at: a[1], checks_json: a[2], validator_version: a[3],
        validation_status: a[4], can_auto_apply: a[5], validator_provider_id: a[6],
        validator_model_id: a[7], validated_at: a[8]
      } : { status: a[0], adopted_at: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set writer_provider_config_version = ?')) {
      const row = this.db.versions.find((item) => item.id === a[2]);
      if (row) Object.assign(row, { writer_provider_config_version: a[0], validator_provider_config_version: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith("update story_facts_snapshots set extraction_status = 'available'")) {
      const work = this.db.works.find((item) => item.id === a[3] && item.current_version_id === a[4]);
      const row = work && this.db.storyFacts.find((item) => item.version_id === a[1] && item.content_hash === a[2]);
      if (row) Object.assign(row, { extraction_status: 'available', updated_at: a[0] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set current_validation_run_id = ?')) {
      const row = this.db.versions.find((item) => item.id === a[1] && item.current_validation_run_id == null);
      if (row) row.current_validation_run_id = a[0];
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set checks_json = ?, validator_version = ?, validation_status = ?, can_auto_apply = ?, validator_provider_id = ?')
      && this.sql.includes('current_validation_run_id = ?')) {
      const row = this.db.versions.find((item) => item.id === a[8] && item.content_hash === a[9]);
      if (row) Object.assign(row, { checks_json: a[0], validator_version: a[1], validation_status: a[2], can_auto_apply: a[3],
        validator_provider_id: a[4], validator_model_id: a[5], validated_at: a[6], current_validation_run_id: a[7] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set checks_json = ?, validator_version = ?, validation_status = ?, can_auto_apply = ?, validator_provider_id = ?')) {
      const row = this.db.versions.find((item) => item.id === a[7]);
      if (row) Object.assign(row, { checks_json: a[0], validator_version: a[1], validation_status: a[2], can_auto_apply: a[3],
        validator_provider_id: a[4], validator_model_id: a[5], validated_at: a[6] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set checks_json = ?, validator_version = ?, validation_status = ?, can_auto_apply = ?, validated_at = ?')) {
      const row = this.db.versions.find((item) => item.id === a[5]);
      if (row) Object.assign(row, { checks_json: a[0], validator_version: a[1], validation_status: a[2], can_auto_apply: a[3], validated_at: a[4] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set validation_status = ?, can_auto_apply = ?')) {
      const row = this.db.versions.find((item) => item.id === a[2]);
      if (row) Object.assign(row, { validation_status: a[0], can_auto_apply: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update provider_transport_attempts set status = ?, sent_at = ?')) {
      const row = this.db.transportAttempts.find((item) => item.id === a[2] && item.status === a[3]);
      if (row) Object.assign(row, { status: a[0], sent_at: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update provider_transport_attempts set status = ?, finished_at = ?, http_status = ?, error_code = ?')) {
      const row = this.db.transportAttempts.find((item) => item.id === a[4] && ['prepared', 'in_flight'].includes(item.status));
      if (row) Object.assign(row, { status: a[0], finished_at: a[1], http_status: a[2], error_code: a[3] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update provider_transport_attempts set status = ?, finished_at = ?, error_code = ?')) {
      const row = this.db.transportAttempts.find((item) => item.id === a[3] && item.status === a[4]);
      if (row) Object.assign(row, { status: a[0], finished_at: a[1], error_code: a[2] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update candidate_validation_runs set status = ?, outcome_unknown = ?')
      && this.sql.includes('provider_id = coalesce')) {
      const row = this.db.validationRuns.find((item) => item.id === a[7] && item.status === 'running');
      if (row) Object.assign(row, { status: a[0], outcome_unknown: a[1], retry_confirmation_required: a[2],
        provider_id: a[3] || row.provider_id, model_name: a[4] || row.model_name,
        error_code: a[5], completed_at: a[6] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update candidate_validation_runs set status = ?, outcome_unknown = ?')) {
      const row = this.db.validationRuns.find((item) => item.id === a[5] && item.status === 'running');
      if (row) Object.assign(row, { status: a[0], outcome_unknown: a[1], retry_confirmation_required: a[2],
        error_code: a[3], completed_at: a[4] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update candidate_validation_runs set provider_id = ?, model_name = ?, status = ?')) {
      const row = this.db.validationRuns.find((item) => item.id === a[7] && item.status === 'running');
      if (row) Object.assign(row, { provider_id: a[0], model_name: a[1], status: a[2], checks_json: a[3],
        semantic_validation_json: a[4], usage_json: a[5], outcome_unknown: 0, retry_confirmation_required: 0,
        error_code: null, completed_at: a[6] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith("update candidate_validation_runs set status = 'unavailable'")) {
      const row = this.db.validationRuns.find((item) => item.id === a[1] && item.status === 'running');
      if (row) Object.assign(row, { status: 'unavailable', retry_confirmation_required: 1,
        error_code: 'VALIDATION_STALE', completed_at: a[0] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, stage_started_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[6] && (item.stage || item.status) === a[7]);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], stage_started_at: a[2], stage_finished_at: null,
        failed_stage: null, last_error_code: null, error_code: null, error_message: null,
        retry_confirmation_required: 0, execution_instance_id: a[3], execution_token: a[4], stop_requested_at: null,
        stopped_at: null, stop_state: null, stop_reason: null, updated_at: a[5], completed_at: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, updated_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[3] && item.stage === a[4]
        && item.execution_token === a[5] && !item.stop_requested_at);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], updated_at: a[2] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, failed_stage = ?, stop_requested_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[17] && (item.stage || item.status) === a[18]
        && (item.execution_token || '') === (a[19] || ''));
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], failed_stage: a[2], stop_requested_at: a[3], stopped_at: a[4],
        stop_state: a[5], stop_reason: a[6], outcome_unknown: a[7], unknown_stage: a[8], retry_confirmation_required: a[9],
        validation_status: a[10] === 'validate' && row.result_version_id ? 'unavailable' : row.validation_status,
        last_error_code: a[11], error_code: a[12], error_message: a[13], stage_finished_at: a[14], updated_at: a[15],
        completed_at: a[16] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set stage = ?, status = ?, failed_stage = ?, stage_finished_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[13] && (item.stage || item.status) === a[14]
        && (item.updated_at || item.stage_started_at || item.created_at) === a[15]);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], failed_stage: a[2], stage_finished_at: a[3],
        last_error_code: a[4], error_code: a[5], error_message: a[6], validation_status: a[7] === 'validate' ? 'unavailable' : row.validation_status,
        outcome_unknown: a[8], unknown_stage: a[9], retry_confirmation_required: a[10], updated_at: a[11], completed_at: a[12] });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set transport_attempts = ?, attempt_count = ?, validator_attempts = ?, updated_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[4]);
      if (row) Object.assign(row, { transport_attempts: a[0], attempt_count: a[1], validator_attempts: a[2], updated_at: a[3] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set format_repair_attempts = ?, updated_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[2]);
      if (row) Object.assign(row, { format_repair_attempts: a[0], updated_at: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set retry_of_task_id = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[1]);
      if (row) row.retry_of_task_id = a[0];
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, content_plan_json = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[9]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], content_plan_json: a[2], selected_mechanisms_json: a[3],
        creative_brief_json: a[4], execution_input_json: a[5], plan_model_name: a[6], plan_usage_json: a[7], updated_at: a[8] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, stage_finished_at = ?, stage_timings_json = ?, updated_at = ?, creative_brief_json = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[14]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], stage_finished_at: a[2], stage_timings_json: a[3], updated_at: a[4],
        creative_brief_json: a[5], execution_input_json: a[6], content_plan_json: a[7], selected_mechanisms_json: a[8],
        plan_model_name: a[9], plan_usage_json: a[10], attempt_count: a[11], transport_attempts: a[12], format_repair_attempts: a[13],
        last_error_code: null, error_code: null, error_message: null });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, stage_finished_at = ?, stage_timings_json = ?, updated_at = ?, provider = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[17]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], stage_finished_at: a[2], stage_timings_json: a[3], updated_at: a[4],
        provider: a[5], model_name: a[6], usage_json: a[7], result_version_id: a[8], attempt_count: a[9], transport_attempts: a[10],
        format_repair_attempts: a[11], output_kind: a[12], candidate_content_hash: a[13], validator_version: a[14],
        validation_status: a[15], source_is_current: a[16], last_error_code: null, error_code: null, error_message: null });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, stage_finished_at = ?, stage_timings_json = ?, updated_at = ?, validator_model_name = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[12]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], stage_finished_at: a[2], stage_timings_json: a[3], updated_at: a[4],
        validator_model_name: a[5], validator_usage_json: a[6], semantic_validation_json: a[7], validator_attempts: a[8],
        validation_status: a[9], source_is_current: a[10], last_error_code: null, error_code: null, error_message: null, completed_at: a[11] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, failed_stage = ?, stage_finished_at = ?, stage_timings_json = ?')) {
      const extended = this.sql.includes('outcome_unknown = ?');
      const row = this.db.tasks.find((item) => item.id === a[extended ? 18 : 15]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], failed_stage: a[2], stage_finished_at: a[3], stage_timings_json: a[4],
        last_error_code: a[5], updated_at: a[6], error_code: a[7], error_message: a[8], attempt_count: a[9],
        transport_attempts: a[10], format_repair_attempts: a[11], validator_attempts: a[12],
        validation_status: a[13] ?? row.validation_status,
        ...(extended ? { outcome_unknown: a[14], unknown_stage: a[15], retry_confirmation_required: a[16], completed_at: a[17] }
          : { completed_at: a[14] }) });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set validator_model_name = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[2]);
      if (row) Object.assign(row, { validator_model_name: a[0], semantic_validation_json: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ? where id = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[1]);
      row.status = a[0];
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, creative_brief_json = ? where id = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[2]);
      Object.assign(row, { status: a[0], creative_brief_json: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.includes('update generation_tasks set status = ?, provider = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[15]);
      Object.assign(row, {
        status: a[0], provider: a[1], model_name: a[2], usage_json: a[3], result_version_id: a[4],
        attempt_count: a[5], transport_attempts: a[6], format_repair_attempts: a[7], validator_attempts: a[8],
        output_kind: a[9], candidate_content_hash: a[10], validator_version: a[11], validation_status: a[12],
        source_is_current: a[13], completed_at: a[14]
      });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.includes('update generation_tasks set status = ?, error_code = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[9]);
      Object.assign(row, {
        status: a[0], error_code: a[1], error_message: a[2], attempt_count: a[3], transport_attempts: a[4],
        format_repair_attempts: a[5], validator_attempts: a[6], validation_status: a[7], completed_at: a[8]
      });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    throw new Error(`FakeD1 run() does not support: ${this.sql}`);
  }
}
