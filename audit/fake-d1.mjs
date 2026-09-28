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
      const fields = ['id', 'work_id', 'parent_version_id', 'operation', 'status', 'title', 'content', 'generated_segment',
        'creative_brief_json', 'change_summary', 'checks_json', 'model_name', 'usage_json', 'content_hash', 'validator_version',
        'validated_at', 'adopted_at', 'created_at'];
      this.db.versions.push(Object.fromEntries(fields.map((field, index) => [field, a[index]])));
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.startsWith('insert into generation_tasks')) {
      const fields = ['id', 'work_id', 'source_version_id', 'creative_brief_json', 'source_hash', 'status', 'cost_state', 'attempt_count',
        'transport_attempts', 'format_repair_attempts', 'validator_attempts', 'prompt_template_id', 'merge_strategy', 'output_kind',
        'validator_version', 'validation_status', 'created_at'];
      this.db.tasks.push({
        ...Object.fromEntries(fields.map((field, index) => [field, a[index]])),
        error_code: null, error_message: null, provider: null, model_name: null,
        usage_json: null, result_version_id: null, completed_at: null
      });
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
    if (this.sql.startsWith('update generation_tasks set status = ? where id = ?')) {
      const row = this.db.tasks.find((item) => item.id === a[1]);
      row.status = a[0];
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
