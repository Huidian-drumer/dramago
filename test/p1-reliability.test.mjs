import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { applyMigrations } from '../local/migrations.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-p1-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function env(db, instance = 'runtime-new') {
  return {
    DB: db,
    OPENAI_API_KEY: 'controlled-test-key',
    OPENAI_ENDPOINT: 'https://controlled.invalid/chat/completions',
    OPENAI_MODEL: 'writer-test',
    VALIDATOR_MODEL: 'validator-test',
    LOCAL_RUNTIME_INSTANCE_ID: instance
  };
}

async function api(db, pathname, { method = 'POST', body, instance } = {}) {
  const response = await worker.fetch(new Request(`http://local.test${pathname}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  }), env(db, instance));
  return { status: response.status, payload: await response.json() };
}

function providerResponse(content, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const writer = {
  output_kind: 'full', title: '受控候选',
  content: '林晚保留当前选择，并完成了这一阶段的行动。'.repeat(30),
  change_summary: '受控生成', model_warnings: []
};

const validator = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林晚'], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

test('历史查看不改 current，确认恢复以当前版为 parent 建立新版本并保留旧版', async (t) => {
  const db = await database(t);
  const v1 = await api(db, '/api/versions/save', { body: { work_id: 'restore_work', title: '版本一', content: '第一版正文。' } });
  const v2 = await api(db, '/api/versions/save', { body: {
    work_id: 'restore_work', source_version_id: v1.payload.version.id, title: '版本二', content: '第二版正文。'
  } });
  const viewed = await api(db, '/api/bootstrap?work_id=restore_work', { method: 'GET' });
  assert.equal(viewed.payload.work.current_version_id, v2.payload.version.id);
  assert.equal(viewed.payload.versions.find((row) => row.id === v1.payload.version.id).content, '第一版正文。');

  const restored = await api(db, '/api/versions/restore', { body: {
    work_id: 'restore_work', source_version_id: v1.payload.version.id,
    expected_current_version_id: v2.payload.version.id
  } });
  assert.equal(restored.status, 201);
  assert.notEqual(restored.payload.version.id, v1.payload.version.id);
  assert.equal(restored.payload.version.parent_version_id, v2.payload.version.id);
  assert.equal(restored.payload.version.content, '第一版正文。');
  assert.equal(restored.payload.version.operation, 'RESTORE');
  assert.equal(restored.payload.version.validator_version, null);
  assert.equal(restored.payload.version.validation_status, 'pending');
  assert.equal((await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('restore_work').first()).current_version_id,
    restored.payload.version.id);
  assert.equal((await db.prepare('SELECT content FROM versions WHERE id = ?').bind(v1.payload.version.id).first()).content, '第一版正文。');
  assert.equal((await db.prepare('SELECT content FROM versions WHERE id = ?').bind(v2.payload.version.id).first()).content, '第二版正文。');

  const duplicate = await api(db, '/api/versions/restore', { body: {
    work_id: 'restore_work', source_version_id: v1.payload.version.id,
    expected_current_version_id: v2.payload.version.id
  } });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.payload.error.code, 'SOURCE_VERSION_CONFLICT');
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM versions WHERE operation = 'RESTORE'").first()).count, 1);
});

test('历史恢复事务任一步失败时 current 与版本集合都不产生假成功', async (t) => {
  const db = await database(t);
  const v1 = await api(db, '/api/versions/save', { body: { work_id: 'rollback_work', title: '一', content: '一。' } });
  const v2 = await api(db, '/api/versions/save', { body: {
    work_id: 'rollback_work', source_version_id: v1.payload.version.id, title: '二', content: '二。'
  } });
  db.exec("CREATE TRIGGER fail_restore_event BEFORE INSERT ON version_restore_events BEGIN SELECT RAISE(ABORT, 'controlled restore failure'); END;");
  const failed = await api(db, '/api/versions/restore', { body: {
    work_id: 'rollback_work', source_version_id: v1.payload.version.id,
    expected_current_version_id: v2.payload.version.id
  } });
  assert.equal(failed.status, 500);
  assert.equal((await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('rollback_work').first()).current_version_id,
    v2.payload.version.id);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM versions WHERE operation = 'RESTORE'").first()).count, 0);
});

test('旧进程 in_flight attempt 重启后变为 outcome_unknown，未确认不重发，确认后创建新任务', async (t) => {
  const db = await database(t);
  const created = await api(db, '/api/generate', { body: {
    work_id: 'unknown_work', context: '',
    brief: { operation: 'CREATE', user_instruction: '生成受控故事。', output_preferences: { target_length: 300 } }
  }, instance: 'runtime-old' });
  const taskId = created.payload.task.id;
  const old = await db.prepare('SELECT * FROM generation_tasks WHERE id = ?').bind(taskId).first();
  await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, failed_stage = NULL, stage_started_at = ?,
    updated_at = ?, execution_instance_id = ?, transport_attempts = ?, attempt_count = ? WHERE id = ?`)
    .bind('generating', 'generating', old.created_at, old.created_at, 'runtime-old', 1, 1, taskId).run();
  await db.prepare(`INSERT INTO provider_transport_attempts
    (id, task_id, stage, attempt_number, status, provider, model_name, execution_instance_id, prepared_at, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('attempt_unknown', taskId, 'write', 1, 'in_flight', 'openai-compatible', 'writer-test', 'runtime-old', old.created_at, old.created_at).run();

  const recovered = await api(db, `/api/tasks/${taskId}`, { method: 'GET', instance: 'runtime-new' });
  assert.equal(recovered.payload.task.stage, 'abandoned');
  assert.equal(recovered.payload.task.outcome_unknown, true);
  assert.equal(recovered.payload.task.retry_confirmation_required, true);
  assert.match(recovered.payload.task.error_message, /可能已经发送并产生费用/u);
  assert.equal(recovered.payload.transport_attempt_records[0].status, 'outcome_unknown');

  const denied = await api(db, `/api/tasks/${taskId}/retry`, { body: {}, instance: 'runtime-new' });
  assert.equal(denied.status, 409);
  assert.equal(denied.payload.error.code, 'RETRY_CONFIRMATION_REQUIRED');
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM generation_tasks').first()).count, 1);

  const retried = await api(db, `/api/tasks/${taskId}/retry`, {
    body: { confirm_unknown_outcome: true }, instance: 'runtime-new'
  });
  assert.equal(retried.status, 201);
  assert.notEqual(retried.payload.task.id, taskId);
  assert.equal(retried.payload.task.retry_of_task_id, taskId);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM generation_tasks').first()).count, 2);
});

test('prepared 但未发送的 attempt 重启后明确取消，不冒充远端已执行', async (t) => {
  const db = await database(t);
  const created = await api(db, '/api/generate', { body: {
    work_id: 'prepared_work', context: '',
    brief: { operation: 'CREATE', user_instruction: '生成受控故事。', output_preferences: { target_length: 300 } }
  }, instance: 'runtime-old' });
  const taskId = created.payload.task.id;
  const timestamp = created.payload.task.created_at;
  await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, stage_started_at = ?, updated_at = ?,
    execution_instance_id = ?, transport_attempts = ?, attempt_count = ? WHERE id = ?`)
    .bind('generating', 'generating', timestamp, timestamp, 'runtime-old', 1, 1, taskId).run();
  await db.prepare(`INSERT INTO provider_transport_attempts
    (id, task_id, stage, attempt_number, status, provider, model_name, execution_instance_id, prepared_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('attempt_prepared', taskId, 'write', 1, 'prepared', 'openai-compatible', 'writer-test', 'runtime-old', timestamp).run();
  const recovered = await api(db, `/api/tasks/${taskId}`, { method: 'GET', instance: 'runtime-new' });
  assert.equal(recovered.payload.task.outcome_unknown, false);
  assert.equal(recovered.payload.task.retry_confirmation_required, false);
  assert.equal(recovered.payload.transport_attempt_records[0].status, 'cancelled_before_send');
});

test('Validator 未决结果必须确认后复用原候选，且 transport 计数与记录一致', async (t) => {
  const db = await database(t);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? providerResponse(writer, 'writer-test') : providerResponse(validator, 'validator-test');
  };
  try {
    const created = await api(db, '/api/generate', { body: {
      work_id: 'validator_unknown_work', context: '',
      brief: { operation: 'CREATE', user_instruction: '生成受控故事。', output_preferences: { target_length: 300 } }
    }, instance: 'runtime-old' });
    const taskId = created.payload.task.id;
    const written = await api(db, `/api/tasks/${taskId}/write`, { body: {}, instance: 'runtime-old' });
    const candidateId = written.payload.candidate.id;
    const timestamp = new Date().toISOString();
    await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, failed_stage = NULL, stage_started_at = ?, updated_at = ?,
      execution_instance_id = ?, transport_attempts = ?, attempt_count = ?, validator_attempts = ? WHERE id = ?`)
      .bind('validating', 'validating', timestamp, timestamp, 'runtime-old', 2, 2, 1, taskId).run();
    await db.prepare(`INSERT INTO provider_transport_attempts
      (id, task_id, stage, attempt_number, status, provider, model_name, execution_instance_id, prepared_at, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('validator_unknown', taskId, 'validate', 2, 'in_flight', 'openai-compatible', 'validator-test', 'runtime-old', timestamp, timestamp).run();
    await api(db, `/api/tasks/${taskId}`, { method: 'GET', instance: 'runtime-new' });
    const denied = await api(db, `/api/tasks/${taskId}/validate`, { body: {}, instance: 'runtime-new' });
    assert.equal(denied.status, 409);
    assert.equal(denied.payload.error.code, 'RETRY_CONFIRMATION_REQUIRED');
    const confirmed = await api(db, `/api/tasks/${taskId}/validate`, {
      body: { confirm_unknown_outcome: true }, instance: 'runtime-new'
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.payload.candidate.id, candidateId);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('validator_unknown_work').first()).count, 1);
    const task = await db.prepare('SELECT transport_attempts, validator_attempts FROM generation_tasks WHERE id = ?').bind(taskId).first();
    const records = await db.prepare('SELECT * FROM provider_transport_attempts WHERE task_id = ?').bind(taskId).all();
    assert.equal(task.transport_attempts, records.results.length);
    assert.equal(task.transport_attempts, 3);
    assert.equal(task.validator_attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
