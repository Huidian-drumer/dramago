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
    this.adoptionEvents = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  snapshot() {
    return clone({
      works: this.works,
      versions: this.versions,
      tasks: this.tasks,
      storyFacts: this.storyFacts,
      adoptionEvents: this.adoptionEvents
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
    if (this.sql.startsWith('select * from works where id = ?')) {
      return clone(this.db.works.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from works order by updated_at desc')) {
      return clone([...this.db.works].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null);
    }
    if (this.sql.startsWith('select * from story_facts_snapshots where version_id = ?')) {
      return clone(this.db.storyFacts.find((row) => row.version_id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from generation_tasks where id = ?')) {
      return clone(this.db.tasks.find((row) => row.id === this.args[0]) || null);
    }
    if (this.sql.startsWith('select * from generation_tasks where work_id = ? order by created_at desc')) {
      return clone(this.db.tasks.filter((row) => row.work_id === this.args[0])
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null);
    }
    throw new Error(`FakeD1 first() does not support: ${this.sql}`);
  }

  async all() {
    if (this.sql.startsWith('select * from versions where work_id = ? order by created_at desc')) {
      return {
        results: clone(this.db.versions
          .filter((row) => row.work_id === this.args[0])
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 40))
      };
    }
    throw new Error(`FakeD1 all() does not support: ${this.sql}`);
  }

  async run() {
    const a = this.args;
    if (this.sql.startsWith('insert into works')) {
      this.db.works.push({ id: a[0], title: a[1], current_version_id: a[2], created_at: a[3], updated_at: a[4] });
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
    if (this.sql.startsWith('insert into story_facts_snapshots')) {
      const fields = ['id', 'work_id', 'version_id', 'content_hash', 'facts_json', 'extraction_status', 'provider', 'model_name',
        'validator_version', 'created_at', 'updated_at'];
      const next = Object.fromEntries(fields.map((field, index) => [field, a[index]]));
      const existing = this.db.storyFacts.find((row) => row.version_id === next.version_id);
      if (existing) Object.assign(existing, next, { id: existing.id, created_at: existing.created_at });
      else this.db.storyFacts.push(next);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into adoption_events')) {
      const fields = ['id', 'work_id', 'candidate_version_id', 'previous_current_version_id', 'new_current_version_id', 'result', 'created_at'];
      this.db.adoptionEvents.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
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
    if (this.sql.startsWith('update versions set status = ?, adopted_at = ?')) {
      const row = this.db.versions.find((item) => item.id === a[2]);
      Object.assign(row, { status: a[0], adopted_at: a[1] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update versions set checks_json = ?, validator_version = ?, validation_status = ?, can_auto_apply = ?, validated_at = ?')) {
      const row = this.db.versions.find((item) => item.id === a[5]);
      if (row) Object.assign(row, { checks_json: a[0], validator_version: a[1], validation_status: a[2], can_auto_apply: a[3], validated_at: a[4] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, stage_started_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[4] && (item.stage || item.status) === a[5]);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], stage_started_at: a[2], stage_finished_at: null,
        failed_stage: null, last_error_code: null, error_code: null, error_message: null, updated_at: a[3], completed_at: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('update generation_tasks set stage = ?, status = ?, failed_stage = ?, stage_finished_at = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[10] && (item.stage || item.status) === a[11]
        && (item.updated_at || item.stage_started_at || item.created_at) === a[12]);
      if (!row) return { success: true, meta: { changes: 0 } };
      Object.assign(row, { status: a[0], stage: a[1], failed_stage: a[2], stage_finished_at: a[3],
        last_error_code: a[4], error_code: a[5], error_message: a[6], validation_status: a[7] === 'validate' ? 'unavailable' : row.validation_status,
        updated_at: a[8], completed_at: a[9] });
      return { success: true, meta: { changes: 1 } };
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
        validation_status: a[9], source_is_current: a[10], last_error_code: null, error_code: null, error_message: null, completed_at: a[12] });
      return { success: true, meta: { changes: row ? 1 : 0 } };
    }
    if (this.sql.startsWith('update generation_tasks set status = ?, stage = ?, failed_stage = ?, stage_finished_at = ?, stage_timings_json = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[15]);
      if (row) Object.assign(row, { status: a[0], stage: a[1], failed_stage: a[2], stage_finished_at: a[3], stage_timings_json: a[4],
        last_error_code: a[5], updated_at: a[6], error_code: a[7], error_message: a[8], attempt_count: a[9],
        transport_attempts: a[10], format_repair_attempts: a[11], validator_attempts: a[12],
        validation_status: a[13] ?? row.validation_status, completed_at: a[14] });
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
