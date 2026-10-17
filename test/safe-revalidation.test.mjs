import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { parseSemanticValidationJson } from '../worker/core.mjs';
import { applyMigrations } from '../local/migrations.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-safe-revalidation-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function environment(db) {
  return {
    DB: db,
    LOCAL_RUNTIME_INSTANCE_ID: 'safe-revalidation-test',
    PROVIDER_TIMEOUT_MS: '10000',
    PROVIDER_CONFIG_RESOLVER: async (input = {}) => ({
      provider_id: input.provider_id || 'deepseek',
      provider_name: 'controlled-deepseek',
      endpoint: 'https://controlled.test/chat/completions',
      writer_model_id: input.writer_model_id || 'deepseek-v4-pro',
      planner_model_id: 'deepseek-flash',
      validator_model_id: 'deepseek-flash',
      provider_config_version: 1,
      credential_ref: 'deepseek:controlled',
      ...(input.include_secret ? { api_key: 'controlled-key' } : {})
    })
  };
}

async function api(env, pathname, { method = 'POST', body = {} } = {}) {
  const response = await worker.fetch(new Request(`http://local.test${pathname}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body) : undefined
  }), env);
  return { status: response.status, payload: await response.json() };
}

function providerResponse(content, model = 'deepseek-flash') {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function validation(findings = [], overrides = {}) {
  return {
    findings, blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: findings.length === 0, severity: findings.length ? 'blocking' : 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    ...overrides
  };
}

function finding(type, evidence, locations) {
  return {
    finding_type: type, severity: 'blocking', confidence: 0.99,
    source_priority: type === 'STORY_FACT_CONFLICT' ? 'source_version_fact' : 'explicit_user_hard_constraint',
    fact_basis: type === 'STORY_FACT_CONFLICT' ? 'confirmed_objective' : 'insufficient_evidence',
    evidence, evidence_scope: locations.length === 1 ? locations[0].source : 'cross_scope',
    evidence_locations: locations, reason: '合成回归中的明确违规。'
  };
}

function hashDocument(version) {
  return crypto.createHash('sha256').update(`${version.title}\n${version.content}`).digest('hex');
}

async function createBlockedContinueFixture(t, segment = '第二天清晨，她整理好资料，准备面对新的问题。') {
  const db = await database(t);
  const env = environment(db);
  const sourceContent = '昨晚，她在办公室签完合同，并把钥匙放进抽屉。\n\n父亲已经去世五年。';
  const saved = await api(env, '/api/versions/save', { body: { work_id: 'revalidate-work', title: '合成故事', content: sourceContent } });
  assert.equal(saved.status, 201);
  const source = saved.payload.version;
  const created = await api(env, '/api/generate', { body: {
    work_id: source.work_id, source_hash: hashDocument(source),
    model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
    brief: {
      operation: 'CONTINUE', source_version_id: source.id, target_scope: { type: 'next_segment' },
      user_instruction: '从第二天开始续写。不得复述上一集，也不得重新描写昨晚签合同。',
      negative_constraints: ['不得复述上一集', '不得重新描写昨晚签合同'], hard_preserve: ['保留既有事实']
    }
  } });
  assert.equal(created.status, 201);
  let writerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    writerCalls += 1;
    return providerResponse({ output_kind: 'continuation', title: '合成故事', content: segment,
      change_summary: '追加下一段', model_warnings: [] }, JSON.parse(options.body).model);
  };
  const written = await api(env, `/api/tasks/${created.payload.task.id}/write`);
  globalThis.fetch = originalFetch;
  assert.equal(written.status, 201);
  assert.equal(writerCalls, 1);
  const candidate = written.payload.candidate;
  const timestamp = new Date().toISOString();
  // content-semantic-v2 stored the concrete issue code as finding_type. This
  // reproduces the real legacy shape that previously survived revalidation.
  const oldChecks = [...candidate.checks, { finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', check: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', status: 'fail',
    message: '旧版错误地把来源正文归因于新增内容。', candidate_version_id: candidate.id,
    content_hash: candidate.content_hash, validator_version: 'content-semantic-v2' }];
  await db.batch([
    db.prepare(`UPDATE versions SET checks_json = ?, validator_version = ?, validation_status = 'blocked',
      can_auto_apply = 0, validated_at = ? WHERE id = ?`).bind(JSON.stringify(oldChecks), 'content-semantic-v2', timestamp, candidate.id),
    db.prepare(`UPDATE generation_tasks SET status = 'completed', stage = 'completed', validation_status = 'blocked',
      validator_version = ?, semantic_validation_json = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
      .bind('content-semantic-v2', JSON.stringify(validation([])), timestamp, timestamp, created.payload.task.id)
  ]);
  return { db, env, source, candidate: { ...candidate, checks: oldChecks, validator_version: 'content-semantic-v2', validation_status: 'blocked' },
    taskId: created.payload.task.id, writerCalls };
}

async function revalidate(env, candidate, body = {}) {
  return api(env, `/api/versions/${candidate.id}/revalidate`, { body: {
    work_id: candidate.work_id, candidate_content_hash: candidate.content_hash,
    confirm_validator_cost: true, confirm_third_party_disclosure: true, ...body
  } });
}

async function createLegacyPassedResidualFixture(t, { semantic = validation([]), segment } = {}) {
  const fixture = await createBlockedContinueFixture(t, segment);
  fixture.env.PROVIDER_TIMEOUT_MS = '25';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        reject(new DOMException('controlled timeout', 'AbortError'));
      }, { once: true }));
    }
    return providerResponse(semantic, JSON.parse(options.body).model);
  };
  try {
    const unknown = await revalidate(fixture.env, fixture.candidate, {
      confirm_third_party_disclosure: true,
      validator_selection: { provider_id: 'zhipu', validator_model_id: 'glm-4.7-flash' }
    });
    assert.equal(unknown.status, 504);
    const passed = await revalidate(fixture.env, fixture.candidate, {
      confirm_third_party_disclosure: true,
      validator_selection: { provider_id: 'deepseek', validator_model_id: 'deepseek-flash' }
    });
    assert.equal(passed.status, 200, JSON.stringify(passed.payload));
    const legacyResidual = {
      finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', check: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', status: 'fail',
      message: '旧版把来源正文误归因到本次续写。', candidate_version_id: fixture.candidate.id,
      content_hash: fixture.candidate.content_hash, validator_version: 'content-semantic-v2'
    };
    const staleChecks = [legacyResidual, ...passed.payload.validation_run.checks];
    await fixture.db.batch([
      fixture.db.prepare(`UPDATE versions SET checks_json = ?, validation_status = 'passed', can_auto_apply = 0,
        current_validation_run_id = ? WHERE id = ?`)
        .bind(JSON.stringify(staleChecks), passed.payload.validation_run.id, fixture.candidate.id),
      fixture.db.prepare(`UPDATE candidate_validation_runs SET checks_json = ?, status = 'passed',
        outcome_unknown = 0, retry_confirmation_required = 0 WHERE id = ?`)
        .bind(JSON.stringify(staleChecks), passed.payload.validation_run.id)
    ]);
    return { ...fixture, calls: () => calls, currentRunId: passed.payload.validation_run.id, staleChecks };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function makeLegacyDeterministicBindingsIncomplete(fixture) {
  const row = await fixture.db.prepare('SELECT checks_json FROM candidate_validation_runs WHERE id = ?')
    .bind(fixture.currentRunId).first();
  const checks = JSON.parse(row.checks_json);
  let deterministicIndex = 0;
  const legacyChecks = checks.map((check) => {
    if (!['deterministic', 'manual_pending', 'model_judgment'].includes(check.finding_type)) return check;
    deterministicIndex += 1;
    const copy = { ...check };
    if (deterministicIndex === 1) delete copy.candidate_version_id;
    else if (deterministicIndex === 2) delete copy.content_hash;
    else copy.validator_version = 'content-semantic-v2';
    return copy;
  });
  await fixture.db.batch([
    fixture.db.prepare('UPDATE versions SET checks_json = ?, can_auto_apply = 0 WHERE id = ?')
      .bind(JSON.stringify(legacyChecks), fixture.candidate.id),
    fixture.db.prepare('UPDATE candidate_validation_runs SET checks_json = ? WHERE id = ?')
      .bind(JSON.stringify(legacyChecks), fixture.currentRunId)
  ]);
  return legacyChecks;
}

async function markCurrentPassedRunAsV21(fixture) {
  const row = await fixture.db.prepare('SELECT checks_json, semantic_validation_json FROM candidate_validation_runs WHERE id = ?')
    .bind(fixture.currentRunId).first();
  const legacyVersion = 'content-semantic-v2.1-scope';
  const checks = JSON.parse(row.checks_json).map((item) => ({ ...item,
    validator_version: item.validator_version === 'content-semantic-v2.2-language' ? legacyVersion : item.validator_version }));
  const semantic = JSON.parse(row.semantic_validation_json);
  delete semantic.languageQuality;
  await fixture.db.batch([
    fixture.db.prepare('UPDATE candidate_validation_runs SET validator_version = ?, checks_json = ?, semantic_validation_json = ? WHERE id = ?')
      .bind(legacyVersion, JSON.stringify(checks), JSON.stringify(semantic), fixture.currentRunId),
    fixture.db.prepare('UPDATE versions SET validator_version = ?, checks_json = ? WHERE id = ?')
      .bind(legacyVersion, JSON.stringify(checks), fixture.candidate.id),
    fixture.db.prepare('UPDATE generation_tasks SET validator_version = ? WHERE id = ?')
      .bind(legacyVersion, fixture.taskId)
  ]);
  return legacyVersion;
}

async function appendSupersedingRun(fixture, status) {
  const current = await fixture.db.prepare('SELECT * FROM candidate_validation_runs WHERE id = ?')
    .bind(fixture.currentRunId).first();
  const createdAt = new Date(Date.parse(current.created_at) + 1000).toISOString();
  const completedAt = new Date(Date.parse(createdAt) + 1000).toISOString();
  const id = `validation_newer_${status}`;
  await fixture.db.prepare(`INSERT INTO candidate_validation_runs
    (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id,
      source_content_hash, operation, trigger, validator_version, provider_id, model_name,
      status, checks_json, semantic_validation_json, confirmed_cost_risk, outcome_unknown,
      retry_confirmation_required, error_code, created_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user_revalidation', ?, 'deepseek', 'deepseek-flash',
      ?, ?, ?, 1, ?, ?, ?, ?, ?)`)
    .bind(id, fixture.taskId, fixture.candidate.work_id, fixture.candidate.id, fixture.candidate.content_hash,
      fixture.source.id, fixture.source.content_hash, 'CONTINUE', 'content-semantic-v2.2-language',
      status, JSON.stringify([]), status === 'blocked' ? JSON.stringify(validation([finding(
        'EXPLICIT_HARD_CONSTRAINT_VIOLATION', ['昨晚，她在办公室签完合同'], [
          { source: 'generated_segment', quote: '昨晚，她在办公室签完合同', start: 0, end: 14 }
        ])])) : null, status === 'outcome_unknown' ? 1 : 0, 1,
      status === 'outcome_unknown' ? 'PROVIDER_TIMEOUT' : null, createdAt, completedAt).run();
  return id;
}

test('V1.4 accepts a bound V2.1 passed run as historical review without another model call', async (t) => {
  const fixture = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(fixture);
  const runsBefore = await fixture.db.prepare('SELECT id, status, validator_version, checks_json FROM candidate_validation_runs WHERE candidate_version_id = ? ORDER BY created_at')
    .bind(fixture.candidate.id).all();
  const originalFetch = globalThis.fetch;
  let modelCalls = 0;
  globalThis.fetch = async () => { modelCalls += 1; throw new Error('No model call allowed for compatibility'); };
  try {
    const refreshed = await api(fixture.env,
      `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.payload.candidate.validation_legacy_compatible, true);
    assert.equal(refreshed.payload.candidate.validator_version, 'content-semantic-v2.1-scope');
    assert.equal(refreshed.payload.adoption_readiness.legacy_validator_compatible, true);
    assert.equal(refreshed.payload.adoption_readiness.can_adopt, true, JSON.stringify(refreshed.payload.adoption_readiness));
    const beforeMemory = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
      .bind(fixture.candidate.id).first();
    assert.equal(beforeMemory.count, 0);
    const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
      work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
    } });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
    assert.equal(adopted.payload.version.validator_version, 'content-semantic-v2.1-scope');
    const afterMemory = await fixture.db.prepare('SELECT validation_run_id, validator_version FROM story_memory_snapshots WHERE version_id = ?')
      .bind(fixture.candidate.id).first();
    assert.equal(afterMemory.validation_run_id, fixture.currentRunId);
    assert.equal(afterMemory.validator_version, 'content-semantic-v2.1-scope');
    const runsAfter = await fixture.db.prepare('SELECT id, status, validator_version, checks_json FROM candidate_validation_runs WHERE candidate_version_id = ? ORDER BY created_at')
      .bind(fixture.candidate.id).all();
    assert.deepEqual(runsAfter.results, runsBefore.results, 'all original validation records must remain unchanged');
    assert.equal(modelCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a newer blocked or outcome_unknown run cannot be hidden behind an older passed pointer', async (t) => {
  for (const status of ['blocked', 'outcome_unknown']) {
    const fixture = await createLegacyPassedResidualFixture(t);
    await markCurrentPassedRunAsV21(fixture);
    await appendSupersedingRun(fixture, status);
    const refreshed = await api(fixture.env,
      `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
    assert.equal(refreshed.payload.adoption_readiness.can_adopt, false);
    assert.equal(refreshed.payload.adoption_readiness.reasons[0].code, 'VALIDATION_RUN_SUPERSEDED');
    const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
      work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
    } });
    assert.equal(adopted.status, 409);
    const work = await fixture.db.prepare('SELECT current_version_id FROM works WHERE id = ?')
      .bind(fixture.candidate.work_id).first();
    assert.equal(work.current_version_id, fixture.source.id);
  }
});

test('historical compatibility still rejects old blocked, changed hashes, stale source and cross-work adopt', async (t) => {
  const blocked = await createBlockedContinueFixture(t);
  const blockedAdopt = await api(blocked.env, '/api/versions/adopt', { body: {
    work_id: blocked.candidate.work_id, version_id: blocked.candidate.id
  } });
  assert.equal(blockedAdopt.status, 409);

  const fixture = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(fixture);
  const wrongWork = await api(fixture.env, '/api/versions/adopt', { body: {
    work_id: 'another-work', version_id: fixture.candidate.id
  } });
  assert.equal(wrongWork.status, 404);
  await fixture.db.prepare('UPDATE versions SET content = ? WHERE id = ?')
    .bind('被篡改的合成候选正文', fixture.candidate.id).run();
  const tampered = await api(fixture.env,
    `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(tampered.payload.adoption_readiness.can_adopt, false);
  assert.ok(tampered.payload.adoption_readiness.reasons.some((reason) => reason.code === 'CANDIDATE_CONTENT_HASH_MISMATCH'));

  const sourceFixture = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(sourceFixture);
  await sourceFixture.db.prepare('UPDATE versions SET content = ? WHERE id = ?')
    .bind('来源版本正文被修改', sourceFixture.source.id).run();
  const sourceChanged = await api(sourceFixture.env,
    `/api/versions/${sourceFixture.candidate.id}/validations?work_id=${sourceFixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(sourceChanged.payload.adoption_readiness.can_adopt, false);
  assert.ok(sourceChanged.payload.adoption_readiness.reasons.some((reason) => reason.code === 'VALIDATION_RUN_SOURCE_HASH_MISMATCH'));

  const staleFixture = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(staleFixture);
  const saved = await api(staleFixture.env, '/api/versions/save', { body: {
    work_id: staleFixture.candidate.work_id, source_version_id: staleFixture.source.id,
    title: '合成故事', content: '作者保存了更新的正式正文。'
  } });
  assert.equal(saved.status, 201);
  const stale = await api(staleFixture.env, '/api/versions/adopt', { body: {
    work_id: staleFixture.candidate.work_id, version_id: staleFixture.candidate.id
  } });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.error.code, 'SOURCE_VERSION_CONFLICT');
});

test('V1.4 current validator remains required for new candidates and untrusted legacy provenance', async (t) => {
  const fresh = await createLegacyPassedResidualFixture(t);
  const current = await api(fresh.env,
    `/api/versions/${fresh.candidate.id}/validations?work_id=${fresh.candidate.work_id}`, { method: 'GET' });
  assert.equal(current.payload.adoption_readiness.can_adopt, true);
  assert.equal(current.payload.candidate.validation_legacy_compatible, false);

  const forged = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(forged);
  await forged.db.prepare('UPDATE candidate_validation_runs SET provider_id = NULL WHERE id = ?')
    .bind(forged.currentRunId).run();
  const untrusted = await api(forged.env,
    `/api/versions/${forged.candidate.id}/validations?work_id=${forged.candidate.work_id}`, { method: 'GET' });
  assert.equal(untrusted.payload.adoption_readiness.can_adopt, false);
  assert.ok(untrusted.payload.adoption_readiness.reasons.some((reason) => reason.code === 'VALIDATOR_PROVIDER_PROVENANCE_MISSING'));
});

test('historical passed label cannot mask a real semantic conflict or invalid time order', async (t) => {
  const conflict = await createLegacyPassedResidualFixture(t, { segment: '第二天清晨，父亲迎面走来。' });
  await markCurrentPassedRunAsV21(conflict);
  const sourceQuote = '父亲已经去世五年';
  const addedQuote = '父亲迎面走来';
  const forgedConflict = validation([finding('STORY_FACT_CONFLICT', [sourceQuote, addedQuote], [
    { source: 'source_content', quote: sourceQuote, start: 0, end: sourceQuote.length },
    { source: 'generated_segment', quote: addedQuote, start: 0, end: addedQuote.length }
  ])]);
  await conflict.db.prepare('UPDATE candidate_validation_runs SET semantic_validation_json = ? WHERE id = ?')
    .bind(JSON.stringify(parseSemanticValidationJson(JSON.stringify(forgedConflict))), conflict.currentRunId).run();
  const blocked = await api(conflict.env,
    `/api/versions/${conflict.candidate.id}/validations?work_id=${conflict.candidate.work_id}`, { method: 'GET' });
  assert.equal(blocked.payload.adoption_readiness.can_adopt, false);

  const badTime = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(badTime);
  await badTime.db.prepare('UPDATE candidate_validation_runs SET completed_at = ? WHERE id = ?')
    .bind('2000-01-01T00:00:00.000Z', badTime.currentRunId).run();
  const timed = await api(badTime.env,
    `/api/versions/${badTime.candidate.id}/validations?work_id=${badTime.candidate.work_id}`, { method: 'GET' });
  assert.equal(timed.payload.adoption_readiness.can_adopt, false);
  assert.ok(timed.payload.adoption_readiness.reasons.some((reason) => reason.code === 'VALIDATION_RUN_TIME_ORDER_INVALID'));
});

test('blocked CONTINUE can be revalidated without Writer and source-only evidence no longer blocks', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const oldContent = fixture.candidate.content;
  const originalFetch = globalThis.fetch;
  let validatorCalls = 0;
  globalThis.fetch = async (_url, options) => {
    validatorCalls += 1;
    const quote = '昨晚，她在办公室签完合同';
    return providerResponse(validation([finding('EXPLICIT_HARD_CONSTRAINT_VIOLATION', [quote], [
      { source: 'generated_segment', quote, start: 0, end: quote.length }
    ])]), JSON.parse(options.body).model);
  };
  try {
    const result = await revalidate(fixture.env, fixture.candidate);
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.writer_called, false);
    assert.equal(result.payload.candidate.validation_status, 'passed');
    assert.equal(result.payload.candidate.can_auto_apply, true);
    assert.equal(result.payload.candidate.content, oldContent);
    assert.equal(validatorCalls, 1);
    assert.equal(result.payload.validation_runs.length, 2);
    assert.equal(result.payload.validation_runs[0].trigger, 'user_revalidation');
    assert.equal(result.payload.validation_runs[1].trigger, 'legacy_snapshot');
    assert.equal(result.payload.validation_runs[1].checks.some((item) => item.message === '旧版错误地把来源正文归因于新增内容。'), true);
    const attempts = await fixture.db.prepare(`SELECT * FROM provider_transport_attempts
      WHERE validation_run_id = ?`).bind(result.payload.validation_run.id).all();
    assert.equal(attempts.results.length, 1);
    assert.equal(attempts.results[0].stage, 'revalidate');
    const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
      work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
    } });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy blocked to outcome_unknown to cross-provider passed binds only the latest checks and adopts safely', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  fixture.env.PROVIDER_TIMEOUT_MS = '1000';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) {
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        reject(new DOMException('controlled timeout', 'AbortError'));
      }, { once: true }));
    }
    return providerResponse(validation([]), JSON.parse(options.body).model);
  };
  try {
    const unknown = await revalidate(fixture.env, fixture.candidate, {
      confirm_third_party_disclosure: true,
      validator_selection: { provider_id: 'zhipu', validator_model_id: 'glm-4.7-flash' }
    });
    assert.equal(unknown.status, 504);
    assert.equal(unknown.payload.validation_run.status, 'outcome_unknown');
    assert.equal(unknown.payload.candidate.validation_status, 'blocked');

    const passed = await revalidate(fixture.env, fixture.candidate, {
      confirm_third_party_disclosure: true,
      validator_selection: { provider_id: 'deepseek', validator_model_id: 'deepseek-flash' }
    });
    assert.equal(passed.status, 200, JSON.stringify(passed.payload));
    assert.equal(passed.payload.candidate.validation_status, 'passed');
    assert.equal(passed.payload.candidate.can_auto_apply, true);
    assert.equal(passed.payload.candidate.current_validation_run_id, passed.payload.validation_run.id);
    assert.equal(passed.payload.validation_runs.length, 3);
    assert.deepEqual(passed.payload.validation_runs.map((run) => run.status), ['passed', 'outcome_unknown', 'blocked']);
    assert.equal(passed.payload.candidate.checks.some((check) => check.status === 'fail'), false);
    assert.equal(passed.payload.validation_runs[2].checks.some((check) => check.status === 'fail'), true);
    const refreshed = await api(fixture.env,
      `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`,
      { method: 'GET' });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.payload.current_validation_run.id, passed.payload.validation_run.id);
    assert.equal(refreshed.payload.adoption_readiness.can_adopt, true);
    assert.equal(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.strategy, 'stored');
    assert.equal(refreshed.payload.candidate.checks.some((check) => check.status === 'fail'), false);
    assert.equal(refreshed.payload.validation_runs[2].checks.some((check) => check.status === 'fail'), true);
    const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
      work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
    } });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy passed run with residual dynamic blocking checks upgrades without another Validator call', async (t) => {
  const fixture = await createLegacyPassedResidualFixture(t);
  const callsBeforeUpgradeRead = fixture.calls();
  const before = await fixture.db.prepare('SELECT checks_json, status FROM versions WHERE id = ?')
    .bind(fixture.candidate.id).first();
  assert.equal(JSON.parse(before.checks_json).some((item) => item.status === 'fail'), true);

  const refreshed = await api(fixture.env,
    `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.payload));
  assert.equal(refreshed.payload.current_validation_run.id, fixture.currentRunId);
  assert.equal(refreshed.payload.candidate.validation_status, 'passed');
  assert.equal(refreshed.payload.candidate.validation_compatibility_reconstructed, true);
  assert.equal(refreshed.payload.candidate.checks.some((item) => item.status === 'fail'), false);
  assert.equal(refreshed.payload.adoption_readiness.can_adopt, true, JSON.stringify(refreshed.payload.adoption_readiness));
  assert.equal(fixture.calls(), callsBeforeUpgradeRead);
  const afterRead = await fixture.db.prepare('SELECT checks_json FROM versions WHERE id = ?').bind(fixture.candidate.id).first();
  assert.equal(afterRead.checks_json, before.checks_json, 'read-time reconstruction must not rewrite legacy rows');

  const candidateMemoryBefore = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
    .bind(fixture.candidate.id).first();
  assert.equal(candidateMemoryBefore.count, 0);
  const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
    work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
  } });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
  assert.equal(fixture.calls(), callsBeforeUpgradeRead, 'compatibility adoption must not call Validator');
  const candidateMemoryAfter = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
    .bind(fixture.candidate.id).first();
  assert.equal(candidateMemoryAfter.count, 1);
  const history = await fixture.db.prepare('SELECT status, checks_json FROM candidate_validation_runs WHERE candidate_version_id = ? ORDER BY created_at DESC')
    .bind(fixture.candidate.id).all();
  assert.deepEqual(history.results.map((item) => item.status), ['passed', 'outcome_unknown', 'blocked']);
  assert.equal(JSON.parse(history.results[0].checks_json).some((item) => item.status === 'fail'), true,
    'the original passed run remains immutable audit history');
});

test('legacy incomplete deterministic bindings are rebuilt locally and adopt without another Validator call', async (t) => {
  const fixture = await createLegacyPassedResidualFixture(t);
  const legacyChecks = await makeLegacyDeterministicBindingsIncomplete(fixture);
  const callsBeforeRead = fixture.calls();
  const historyBefore = await fixture.db.prepare(`SELECT id, status, checks_json FROM candidate_validation_runs
    WHERE candidate_version_id = ? ORDER BY created_at DESC`).bind(fixture.candidate.id).all();
  const versionBefore = await fixture.db.prepare(`SELECT content, content_hash, checks_json, current_validation_run_id
    FROM versions WHERE id = ?`).bind(fixture.candidate.id).first();

  const refreshed = await api(fixture.env,
    `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.payload));
  assert.equal(refreshed.payload.adoption_readiness.can_adopt, true,
    JSON.stringify(refreshed.payload.adoption_readiness));
  assert.equal(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.strategy,
    'recomputed_from_candidate_source_and_contract');
  assert.ok(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.missing_fields.candidate_version_id > 0);
  assert.ok(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.missing_fields.content_hash > 0);
  assert.ok(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.mismatched_fields.validator_version > 0);
  assert.equal(refreshed.payload.candidate.checks.some((item) => item.check === 'CONTINUATION_PRESERVES_SOURCE'
    && item.status === 'pass'), true);
  assert.equal(fixture.calls(), callsBeforeRead, 'read-time compatibility must not call Validator');

  const versionAfterRead = await fixture.db.prepare(`SELECT content, content_hash, checks_json, current_validation_run_id
    FROM versions WHERE id = ?`).bind(fixture.candidate.id).first();
  assert.deepEqual(versionAfterRead, versionBefore, 'compatibility read must not mutate candidate storage');
  assert.deepEqual(JSON.parse(versionAfterRead.checks_json), legacyChecks);

  const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
    work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
  } });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
  assert.equal(fixture.calls(), callsBeforeRead, 'compatibility adoption must not call Validator');
  const work = await fixture.db.prepare('SELECT current_version_id FROM works WHERE id = ?')
    .bind(fixture.candidate.work_id).first();
  assert.equal(work.current_version_id, fixture.candidate.id);
  const memory = await fixture.db.prepare('SELECT content_hash FROM story_memory_snapshots WHERE version_id = ?')
    .bind(fixture.candidate.id).first();
  assert.equal(memory.content_hash, fixture.candidate.content_hash);
  const historyAfter = await fixture.db.prepare(`SELECT id, status, checks_json FROM candidate_validation_runs
    WHERE candidate_version_id = ? ORDER BY created_at DESC`).bind(fixture.candidate.id).all();
  assert.deepEqual(historyAfter.results, historyBefore.results, 'all historical validation runs stay immutable');
});

test('legacy deterministic binding repair fails closed when generated segment cannot prove the merge', async (t) => {
  const fixture = await createLegacyPassedResidualFixture(t);
  await makeLegacyDeterministicBindingsIncomplete(fixture);
  await fixture.db.prepare('UPDATE versions SET generated_segment = NULL WHERE id = ?')
    .bind(fixture.candidate.id).run();
  const refreshed = await api(fixture.env,
    `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.payload.adoption_readiness.can_adopt, false);
  assert.equal(refreshed.payload.adoption_readiness.reasons[0].code, 'DETERMINISTIC_REBUILD_SEGMENT_MISSING');
  assert.equal(refreshed.payload.adoption_readiness.binding_diagnostics.deterministic.strategy, 'rebuild_failed');
});

test('candidate content tampering and missing Validator provenance remain precisely blocked', async (t) => {
  const contentFixture = await createLegacyPassedResidualFixture(t);
  await makeLegacyDeterministicBindingsIncomplete(contentFixture);
  await contentFixture.db.prepare('UPDATE versions SET content = content || ? WHERE id = ?')
    .bind('\n未经绑定的改动', contentFixture.candidate.id).run();
  const tampered = await api(contentFixture.env,
    `/api/versions/${contentFixture.candidate.id}/validations?work_id=${contentFixture.candidate.work_id}`,
    { method: 'GET' });
  assert.equal(tampered.status, 200);
  assert.equal(tampered.payload.adoption_readiness.can_adopt, false);
  assert.equal(tampered.payload.adoption_readiness.reasons[0].code, 'CANDIDATE_CONTENT_HASH_MISMATCH');

  const provenanceFixture = await createLegacyPassedResidualFixture(t);
  await makeLegacyDeterministicBindingsIncomplete(provenanceFixture);
  await provenanceFixture.db.prepare('UPDATE candidate_validation_runs SET provider_id = NULL WHERE id = ?')
    .bind(provenanceFixture.currentRunId).run();
  const noProvenance = await api(provenanceFixture.env,
    `/api/versions/${provenanceFixture.candidate.id}/validations?work_id=${provenanceFixture.candidate.work_id}`,
    { method: 'GET' });
  assert.equal(noProvenance.status, 200);
  assert.equal(noProvenance.payload.adoption_readiness.can_adopt, false);
  assert.equal(noProvenance.payload.adoption_readiness.reasons[0].code,
    'VALIDATOR_PROVIDER_PROVENANCE_MISSING');
});

test('legacy deterministic repair rejects source document hash drift and invalid PROGRAM_APPEND', async (t) => {
  const sourceHashFixture = await createLegacyPassedResidualFixture(t);
  await makeLegacyDeterministicBindingsIncomplete(sourceHashFixture);
  await sourceHashFixture.db.prepare('UPDATE generation_tasks SET source_hash = ? WHERE id = ?')
    .bind('invalid-source-document-hash', sourceHashFixture.taskId).run();
  const sourceHashDrift = await api(sourceHashFixture.env,
    `/api/versions/${sourceHashFixture.candidate.id}/validations?work_id=${sourceHashFixture.candidate.work_id}`,
    { method: 'GET' });
  assert.equal(sourceHashDrift.status, 200);
  assert.equal(sourceHashDrift.payload.adoption_readiness.can_adopt, false);
  assert.equal(sourceHashDrift.payload.adoption_readiness.reasons[0].code,
    'TASK_SOURCE_DOCUMENT_HASH_MISMATCH');

  const appendFixture = await createLegacyPassedResidualFixture(t);
  const legacyChecks = await makeLegacyDeterministicBindingsIncomplete(appendFixture);
  const invalidContent = `${appendFixture.source.content}\n\n这段正文与已保存 generated_segment 不一致。`;
  const invalidHash = crypto.createHash('sha256').update(invalidContent).digest('hex');
  const reboundChecks = legacyChecks.map((check) => check.content_hash
    ? { ...check, content_hash: invalidHash }
    : check);
  await appendFixture.db.batch([
    appendFixture.db.prepare('UPDATE versions SET content = ?, content_hash = ?, checks_json = ? WHERE id = ?')
      .bind(invalidContent, invalidHash, JSON.stringify(reboundChecks), appendFixture.candidate.id),
    appendFixture.db.prepare(`UPDATE generation_tasks SET candidate_content_hash = ? WHERE id = ?`)
      .bind(invalidHash, appendFixture.taskId),
    appendFixture.db.prepare(`UPDATE candidate_validation_runs
      SET candidate_content_hash = ?, checks_json = ? WHERE id = ?`)
      .bind(invalidHash, JSON.stringify(reboundChecks), appendFixture.currentRunId)
  ]);
  const invalidAppend = await api(appendFixture.env,
    `/api/versions/${appendFixture.candidate.id}/validations?work_id=${appendFixture.candidate.work_id}`,
    { method: 'GET' });
  assert.equal(invalidAppend.status, 200);
  assert.equal(invalidAppend.payload.adoption_readiness.can_adopt, false);
  assert.equal(invalidAppend.payload.adoption_readiness.reasons[0].code,
    'DETERMINISTIC_REBUILD_MERGE_MISMATCH');
});

test('legacy passed compatibility reconstruction refuses semantic conflicts, hash drift, and stale source', async (t) => {
  const quote = '父亲推门走了进来';
  const conflictFixture = await createLegacyPassedResidualFixture(t, { semantic: validation([
    finding('STORY_FACT_CONFLICT', ['父亲已经去世五年', quote], [
      { source: 'source_content', quote: '父亲已经去世五年', start: 0, end: 8 },
      { source: 'generated_segment', quote, start: 0, end: quote.length }
    ])
  ]) });
  const conflict = await api(conflictFixture.env,
    `/api/versions/${conflictFixture.candidate.id}/validations?work_id=${conflictFixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(conflict.status, 200);
  assert.equal(conflict.payload.adoption_readiness.can_adopt, false);
  assert.equal(conflict.payload.candidate.checks.some((item) => item.status === 'fail'), true);

  const hashFixture = await createLegacyPassedResidualFixture(t);
  await hashFixture.db.prepare('UPDATE candidate_validation_runs SET candidate_content_hash = ? WHERE id = ?')
    .bind('invalid-hash', hashFixture.currentRunId).run();
  const hashDrift = await api(hashFixture.env,
    `/api/versions/${hashFixture.candidate.id}/validations?work_id=${hashFixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(hashDrift.payload.adoption_readiness.can_adopt, false);
  assert.ok(hashDrift.payload.adoption_readiness.reasons.some((item) => item.code === 'VALIDATION_RUN_CANDIDATE_HASH_MISMATCH'));

  const staleFixture = await createLegacyPassedResidualFixture(t);
  await api(staleFixture.env, '/api/versions/save', { body: {
    work_id: staleFixture.candidate.work_id, source_version_id: staleFixture.source.id,
    title: '合成故事', content: '作者已经保存了较新的正式正文。'
  } });
  const stale = await api(staleFixture.env,
    `/api/versions/${staleFixture.candidate.id}/validations?work_id=${staleFixture.candidate.work_id}`, { method: 'GET' });
  assert.equal(stale.payload.adoption_readiness.can_adopt, false);
  assert.ok(stale.payload.adoption_readiness.reasons.some((item) => item.code === 'SOURCE_VERSION_CONFLICT'));
});

test('true replay in generated segment and cross-scope fact conflict remain blocking', async (t) => {
  const repeated = '昨晚，她在办公室签完合同，并把钥匙放进抽屉。';
  const replayFixture = await createBlockedContinueFixture(t, repeated);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => providerResponse(validation([
    finding('EXPLICIT_HARD_CONSTRAINT_VIOLATION', [repeated], [
      { source: 'generated_segment', quote: repeated, start: 0, end: repeated.length }
    ])
  ]), JSON.parse(options.body).model);
  try {
    const replay = await revalidate(replayFixture.env, replayFixture.candidate);
    assert.equal(replay.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.candidate.validation_status, 'blocked');
    assert.equal(replay.payload.can_auto_apply, false);
  } finally { globalThis.fetch = originalFetch; }

  const factFixture = await createBlockedContinueFixture(t, '第二天，已经去世五年的父亲推门走了进来。');
  globalThis.fetch = async (_url, options) => providerResponse(validation([
    finding('STORY_FACT_CONFLICT', ['父亲已经去世五年', '父亲推门走了进来'], [
      { source: 'source_content', quote: '父亲已经去世五年', start: 0, end: 8 },
      { source: 'generated_segment', quote: '父亲推门走了进来', start: 0, end: 9 }
    ])
  ], { candidate_internal_consistency: { consistent: false, conflicts: [] } }), JSON.parse(options.body).model);
  try {
    const fact = await revalidate(factFixture.env, factFixture.candidate);
    assert.equal(fact.status, 200, JSON.stringify(fact.payload));
    assert.equal(fact.payload.candidate.validation_status, 'blocked');
    assert.equal(fact.payload.candidate.checks.some((item) => item.check === 'STORY_FACT_CONFLICT' && item.status === 'fail'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('429 preserves candidate and old checks, records one unavailable run, and never auto-retries', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const oldChecks = JSON.stringify(fixture.candidate.checks);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'controlled rate limit' } }), { status: 429 });
  };
  try {
    const result = await revalidate(fixture.env, fixture.candidate);
    assert.equal(result.status, 502);
    assert.equal(result.payload.error.code, 'PROVIDER_RATE_LIMITED');
    assert.equal(result.payload.validation_run.status, 'unavailable');
    assert.equal(result.payload.validation_run.retry_confirmation_required, true);
    assert.equal(result.payload.validation_run.outcome_unknown, false);
    assert.equal(result.payload.candidate.validation_status, 'blocked');
    assert.equal(JSON.stringify(result.payload.candidate.checks), oldChecks);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('Validator timeout is outcome_unknown, preserves old candidate state, and is not retried', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  fixture.env.PROVIDER_TIMEOUT_MS = '1000';
  const oldChecks = JSON.stringify(fixture.candidate.checks);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      reject(new DOMException('controlled timeout', 'AbortError'));
    }, { once: true }));
  };
  try {
    const result = await revalidate(fixture.env, fixture.candidate);
    assert.equal(result.status, 504);
    assert.equal(result.payload.error.code, 'PROVIDER_TIMEOUT');
    assert.equal(result.payload.validation_run.status, 'outcome_unknown');
    assert.equal(result.payload.validation_run.outcome_unknown, true);
    assert.equal(result.payload.validation_run.retry_confirmation_required, true);
    assert.equal(result.payload.candidate.validation_status, 'blocked');
    assert.equal(JSON.stringify(result.payload.candidate.checks), oldChecks);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('rapid duplicate revalidation creates only one paid Validator request', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let release;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    startedResolve();
    await gate;
    return providerResponse(validation([]), JSON.parse(options.body).model);
  };
  try {
    const firstPromise = revalidate(fixture.env, fixture.candidate);
    await started;
    const duplicate = await revalidate(fixture.env, fixture.candidate);
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.payload.error.code, 'REVALIDATION_IN_PROGRESS');
    assert.equal(calls, 1);
    release();
    const first = await firstPromise;
    assert.equal(first.status, 200);
  } finally {
    release?.();
    globalThis.fetch = originalFetch;
  }
});

test('stale source and missing cost confirmation stop before Validator', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not be called'); };
  try {
    const noConfirmation = await api(fixture.env, `/api/versions/${fixture.candidate.id}/revalidate`, { body: {
      work_id: fixture.candidate.work_id, candidate_content_hash: fixture.candidate.content_hash
    } });
    assert.equal(noConfirmation.status, 409);
    assert.equal(noConfirmation.payload.error.code, 'VALIDATOR_COST_CONFIRMATION_REQUIRED');
    await api(fixture.env, '/api/versions/save', { body: {
      work_id: fixture.candidate.work_id, source_version_id: fixture.source.id,
      title: '合成故事', content: '作者已经保存了更新正文。'
    } });
    const stale = await revalidate(fixture.env, fixture.candidate);
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.error.code, 'SOURCE_VERSION_CONFLICT');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('interrupted running validation is reconciled as outcome_unknown without retrying', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  await fixture.db.prepare(`INSERT INTO candidate_validation_runs
    (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id, source_content_hash,
      operation, trigger, validator_version, status, confirmed_cost_risk, outcome_unknown, retry_confirmation_required,
      execution_instance_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 1, 0, 0, ?, ?)`)
    .bind('validation_crashed', fixture.taskId, fixture.candidate.work_id, fixture.candidate.id,
      fixture.candidate.content_hash, fixture.source.id, fixture.source.content_hash,
      'CONTINUE', 'user_revalidation', 'content-semantic-v2.1-scope', 'old-process', new Date().toISOString()).run();
  await fixture.db.prepare(`INSERT INTO provider_transport_attempts
    (id, task_id, stage, attempt_number, status, provider, model_name, prepared_at, sent_at, validation_run_id)
    VALUES (?, ?, 'revalidate', 2, 'in_flight', 'controlled', 'deepseek-flash', ?, ?, ?)`)
    .bind('attempt_crashed', fixture.taskId, new Date().toISOString(), new Date().toISOString(), 'validation_crashed').run();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not retry'); };
  try {
    const bootstrap = await api(fixture.env, `/api/bootstrap?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
    assert.equal(bootstrap.status, 200);
    const run = bootstrap.payload.validation_runs.find((item) => item.id === 'validation_crashed');
    assert.equal(run.status, 'outcome_unknown');
    assert.equal(run.retry_confirmation_required, true);
    assert.equal(calls, 0);
    const attempt = await fixture.db.prepare('SELECT status FROM provider_transport_attempts WHERE id = ?')
      .bind('attempt_crashed').first();
    assert.equal(attempt.status, 'outcome_unknown');
  } finally { globalThis.fetch = originalFetch; }
});

test('incompatible historical passed review offers explicit paid recovery, then manual adopt without rewriting', async (t) => {
  const fixture = await createLegacyPassedResidualFixture(t);
  await markCurrentPassedRunAsV21(fixture);
  // A genuinely older semantic version is not on the audited advisory-only
  // compatibility allowlist, so local adoption must fail closed.
  await fixture.db.batch([
    fixture.db.prepare('UPDATE candidate_validation_runs SET validator_version = ? WHERE id = ?')
      .bind('content-semantic-v2', fixture.currentRunId),
    fixture.db.prepare('UPDATE versions SET validator_version = ? WHERE id = ?')
      .bind('content-semantic-v2', fixture.candidate.id)
  ]);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    return providerResponse(validation([]), JSON.parse(options.body).model);
  };
  try {
    const before = await api(fixture.env,
      `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
    assert.equal(before.payload.adoption_readiness.can_adopt, false);
    assert.ok(before.payload.blocking_reasons.some((item) => item.code === 'VALIDATOR_VERSION_UNSUPPORTED'));
    assert.equal(before.payload.revalidation_readiness.can_revalidate, true);
    assert.ok(before.payload.available_actions.includes('revalidate'));
    assert.equal(calls, 0);
    const noConsent = await api(fixture.env, `/api/versions/${fixture.candidate.id}/revalidate`, {
      body: { work_id: fixture.candidate.work_id, candidate_content_hash: fixture.candidate.content_hash }
    });
    assert.equal(noConsent.payload.error.code, 'VALIDATOR_COST_CONFIRMATION_REQUIRED');
    assert.equal(calls, 0);
    const noDisclosure = await revalidate(fixture.env, fixture.candidate, { confirm_third_party_disclosure: false });
    assert.equal(noDisclosure.payload.error.code, 'PROVIDER_DISCLOSURE_REQUIRED');
    assert.equal(calls, 0);
    const checked = await revalidate(fixture.env, fixture.candidate);
    assert.equal(checked.status, 200, JSON.stringify(checked.payload));
    assert.equal(checked.payload.writer_called, false);
    assert.equal(checked.payload.adoption_readiness.can_adopt, true);
    assert.equal(checked.payload.candidate.content_hash, fixture.candidate.content_hash);
    assert.equal(checked.payload.candidate.content, fixture.candidate.content);
    assert.equal(calls, 1);
    const historical = checked.payload.validation_runs.map((run) => run.status);
    assert.ok(historical.includes('blocked'));
    assert.ok(historical.includes('outcome_unknown'));
    assert.ok(historical.includes('passed'));
    const beforeMemory = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
      .bind(fixture.candidate.id).first();
    assert.equal(beforeMemory.count, 0);
    const adopted = await api(fixture.env, '/api/versions/adopt', { body: {
      work_id: fixture.candidate.work_id, version_id: fixture.candidate.id
    } });
    assert.equal(adopted.status, 200);
    const afterMemory = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
      .bind(fixture.candidate.id).first();
    assert.equal(afterMemory.count, 1);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('capability resolver separates adopted, blocked, unavailable, unknown and running without an automatic call', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('no automatic transport'); };
  try {
    const url = `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`;
    const blocked = await api(fixture.env, url, { method: 'GET' });
    assert.equal(blocked.payload.adoption_readiness.can_adopt, false);
    assert.equal(blocked.payload.revalidation_readiness.can_revalidate, true);
    assert.ok(blocked.payload.available_actions.includes('view_candidate'));
    await fixture.db.prepare("UPDATE versions SET validation_status = 'unavailable' WHERE id = ?")
      .bind(fixture.candidate.id).run();
    const unavailable = await api(fixture.env, url, { method: 'GET' });
    assert.equal(unavailable.payload.revalidation_readiness.can_revalidate, true);
    await fixture.db.prepare("UPDATE versions SET validation_status = 'blocked' WHERE id = ?")
      .bind(fixture.candidate.id).run();
    const runningId = 'validation_capability_running';
    await fixture.db.prepare(`INSERT INTO candidate_validation_runs
      (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id,
       source_content_hash, operation, trigger, validator_version, status, confirmed_cost_risk,
       outcome_unknown, retry_confirmation_required, execution_instance_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'user_revalidation', ?, 'running', 1, 0, 0, ?, ?)`)
      .bind(runningId, fixture.taskId, fixture.candidate.work_id, fixture.candidate.id,
        fixture.candidate.content_hash, fixture.source.id, fixture.source.content_hash,
        'content-semantic-v2.2-language', fixture.env.LOCAL_RUNTIME_INSTANCE_ID, new Date().toISOString()).run();
    const running = await api(fixture.env, url, { method: 'GET' });
    assert.equal(running.payload.revalidation_readiness.can_revalidate, false);
    assert.equal(running.payload.revalidation_readiness.reasons[0].code, 'REVALIDATION_IN_PROGRESS');
    const duplicate = await revalidate(fixture.env, fixture.candidate);
    assert.equal(duplicate.payload.error.code, 'REVALIDATION_IN_PROGRESS');
    await fixture.db.prepare("UPDATE candidate_validation_runs SET status = 'outcome_unknown', outcome_unknown = 1, error_code = 'PROVIDER_TIMEOUT', completed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), runningId).run();
    const unknown = await api(fixture.env, url, { method: 'GET' });
    assert.equal(unknown.payload.revalidation_readiness.can_revalidate, true);
    assert.match(unknown.payload.recovery_guidance, /可能已发送并产生费用/u);
    await fixture.db.prepare("UPDATE versions SET status = 'adopted' WHERE id = ?").bind(fixture.candidate.id).run();
    const adopted = await api(fixture.env, url, { method: 'GET' });
    assert.equal(adopted.payload.revalidation_readiness.can_revalidate, false);
    assert.equal(adopted.payload.revalidation_readiness.reasons[0].code, 'CANDIDATE_REQUIRED');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('hash damage and source conflict block both adoption and paid recovery with exact reasons', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const url = `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`;
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('no transport permitted'); };
  try {
    await fixture.db.prepare('UPDATE versions SET content = ? WHERE id = ?')
      .bind('damaged synthetic content', fixture.candidate.id).run();
    const damaged = await api(fixture.env, url, { method: 'GET' });
    assert.equal(damaged.payload.revalidation_readiness.can_revalidate, false);
    assert.ok(damaged.payload.blocking_reasons.some((item) => item.code === 'CANDIDATE_CONTENT_HASH_MISMATCH'));
    assert.ok(damaged.payload.available_actions.includes('diagnose_integrity'));
    const denied = await revalidate(fixture.env, fixture.candidate);
    assert.equal(denied.payload.error.code, 'CANDIDATE_CONTENT_HASH_MISMATCH');
    await fixture.db.prepare('UPDATE versions SET content = ? WHERE id = ?')
      .bind(fixture.candidate.content, fixture.candidate.id).run();
    await api(fixture.env, '/api/versions/save', { body: {
      work_id: fixture.candidate.work_id, source_version_id: fixture.source.id,
      title: '合成故事', content: '更新的合成正文。'
    } });
    const stale = await api(fixture.env, url, { method: 'GET' });
    assert.equal(stale.payload.revalidation_readiness.can_revalidate, false);
    assert.ok(stale.payload.available_actions.includes('create_from_current'));
    assert.ok(stale.payload.blocking_reasons.some((item) => item.code === 'SOURCE_VERSION_CONFLICT'));
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('401, 403, 429 and timeout retain candidate and expose provider-specific recovery without retries', async (t) => {
  for (const status of [401, 403, 429, 'timeout']) {
    const fixture = await createBlockedContinueFixture(t);
    fixture.env.PROVIDER_TIMEOUT_MS = status === 'timeout' ? '25' : '10000';
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      if (status === 'timeout') return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () =>
        reject(new DOMException('controlled timeout', 'AbortError')), { once: true }));
      return new Response(JSON.stringify({ error: { code: 'controlled_failure' } }), { status,
        headers: { 'content-type': 'application/json' } });
    };
    try {
      const result = await revalidate(fixture.env, fixture.candidate);
      assert.notEqual(result.status, 200);
      const expected = status === 401 ? 'PROVIDER_AUTH_FAILED' : status === 403 ? 'PROVIDER_MODEL_ACCESS_DENIED'
        : status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_TIMEOUT';
      assert.equal(result.payload.error.code, expected);
      assert.equal(result.payload.candidate.content_hash, fixture.candidate.content_hash);
      assert.equal(calls, 1);
      const snapshot = await api(fixture.env,
        `/api/versions/${fixture.candidate.id}/validations?work_id=${fixture.candidate.work_id}`, { method: 'GET' });
      assert.equal(snapshot.payload.revalidation_readiness.can_revalidate, true);
      assert.ok(snapshot.payload.available_actions.includes('provider_settings'));
      if (status === 401) assert.match(snapshot.payload.recovery_guidance, /API Key/u);
      if (status === 403) assert.match(snapshot.payload.recovery_guidance, /无权访问/u);
      if (status === 429) assert.match(snapshot.payload.recovery_guidance, /限流/u);
      if (status === 'timeout') assert.match(snapshot.payload.recovery_guidance, /可能已发送并产生费用/u);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('candidate memory preview cites candidate text but never becomes formal memory before adopt', async (t) => {
  const fixture = await createBlockedContinueFixture(t);
  const quote = '第二天清晨，她整理好资料';
  const proposal = {
    completeness: 'available',
    characters: [{ id: 'character_1', name: '她', identity: '主角', relationships: ['与父亲的关系待确认'],
      truth_status: 'objective', certainty: 'confirmed', status: 'active', evidence: [{ quote }] }],
    events: [{ id: 'event_1', event: '第二天开始整理资料', sequence: 1, status: 'active',
      truth_status: 'objective', certainty: 'confirmed', time_context: '第二天', evidence: [{ quote }] }],
    persistent_facts: [], open_threads: []
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => providerResponse(validation([], {
    candidate_story_memory: proposal
  }), JSON.parse(options.body).model);
  try {
    const checked = await revalidate(fixture.env, fixture.candidate);
    assert.equal(checked.status, 200);
    const preview = checked.payload.memory_preview;
    assert.equal(preview.status, 'proposed');
    assert.equal(preview.formal, false);
    assert.equal(preview.candidate_content_hash, fixture.candidate.content_hash);
    assert.equal(preview.memory.characters[0].evidence[0].quote, quote);
    assert.equal(preview.memory.events[0].time_context, '第二天');
    const formal = await fixture.db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
      .bind(fixture.candidate.id).first();
    assert.equal(formal.count, 0);
  } finally { globalThis.fetch = originalFetch; }
});
