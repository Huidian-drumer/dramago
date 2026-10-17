import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { applyMigrations } from '../local/migrations.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-operation-routing-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function environment(db) {
  return {
    DB: db,
    LOCAL_RUNTIME_INSTANCE_ID: 'operation-routing-test',
    PROVIDER_TIMEOUT_MS: '10000',
    PROVIDER_CONFIG_RESOLVER: async (input = {}) => {
      const providerId = input.provider_id || 'deepseek';
      const writer = input.writer_model_id || (providerId === 'zhipu' ? 'glm-4.7' : 'deepseek-v4-pro');
      const validator = providerId === 'zhipu' ? 'glm-4.7-flash' : 'deepseek-flash';
      return {
        provider_id: providerId,
        provider_name: providerId,
        endpoint: `https://${providerId}.controlled.test/chat/completions`,
        writer_model_id: writer,
        planner_model_id: validator,
        validator_model_id: validator,
        provider_config_version: 1,
        credential_ref: `${providerId}:controlled`,
        ...(input.include_secret ? { api_key: 'controlled-key' } : {})
      };
    }
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

function providerResponse(content, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
    model,
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const validator = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

function documentHash(version) {
  return crypto.createHash('sha256').update(`${version.title}\n${version.content}`).digest('hex');
}

async function saveVersion(env, workId, content, sourceVersionId = null) {
  const result = await api(env, '/api/versions/save', { body: {
    work_id: workId, source_version_id: sourceVersionId, title: '受控作品', content
  } });
  assert.equal(result.status, 201);
  return result.payload.version;
}

async function adopt(env, workId, versionId) {
  const result = await api(env, '/api/versions/adopt', { body: { work_id: workId, version_id: versionId } });
  assert.equal(result.status, 200);
  return result.payload.version;
}

test('existing work rejects unconfirmed CREATE/full before any paid transport and omission cannot bypass it', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const source = await saveVersion(env, 'existing-create-guard', '已经采用的来源正文。'.repeat(20));
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  try {
    const omitted = await api(env, '/api/generate', { body: {
      work_id: 'existing-create-guard',
      brief: { operation: 'CREATE', user_instruction: '生成整篇新候选。', target_scope: { type: 'full' } }
    } });
    assert.equal(omitted.status, 409);
    assert.equal(omitted.payload.error.code, 'FULL_REPLACEMENT_CONFIRMATION_REQUIRED');

    const unconfirmed = await api(env, '/api/generate', { body: {
      work_id: 'existing-create-guard', source_hash: documentHash(source),
      brief: { operation: 'CREATE', source_version_id: source.id, user_instruction: '生成整篇新候选。', target_scope: { type: 'full' } }
    } });
    assert.equal(unconfirmed.status, 409);
    assert.equal(unconfirmed.payload.error.code, 'FULL_REPLACEMENT_CONFIRMATION_REQUIRED');
    assert.equal(providerCalls, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM generation_tasks WHERE work_id = ?').bind('existing-create-guard').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('confirmed full CREATE keeps source binding and candidate isolation', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const source = await saveVersion(env, 'confirmed-full-create', '来源正文保持为当前版本。'.repeat(20));
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    providerCalls += 1;
    const { model } = JSON.parse(options.body);
    return providerResponse({ output_kind: 'full', title: '整篇候选', content: '这是明确确认后生成的完整新候选。'.repeat(25), change_summary: '完整重生成', model_warnings: [] }, model);
  };
  try {
    const created = await api(env, '/api/generate', { body: {
      work_id: 'confirmed-full-create', source_hash: documentHash(source), confirm_full_replacement: true,
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', source_version_id: source.id, user_instruction: '生成整篇新候选。', target_scope: { type: 'full' } }
    } });
    assert.equal(created.status, 201);
    assert.deepEqual(created.payload.task.contract, {
      operation: 'CREATE', source_version_id: source.id, target_scope: { type: 'full' },
      merge_strategy: 'MODEL_FULL_REPLACE', expected_output_kind: 'full',
      writer_provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro',
      validator_provider_id: 'deepseek', validator_model_id: 'deepseek-flash', full_replacement_confirmed: true
    });
    const written = await api(env, `/api/tasks/${created.payload.task.id}/write`);
    assert.equal(written.status, 201);
    assert.equal(written.payload.candidate.parent_version_id, source.id);
    assert.equal(written.payload.candidate.operation, 'CREATE');
    assert.equal((await db.prepare('SELECT current_version_id FROM works WHERE id = ?').bind('confirmed-full-create').first()).current_version_id, source.id);
    assert.equal(providerCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('GLM CREATE to DeepSeek selection REWRITE to GLM CONTINUE preserves the entire rewritten source', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.messages.map((item) => item.content).join('\n');
    calls.push({ model: request.model, prompt });
    if (request.model.endsWith('flash')) return providerResponse(validator, request.model);
    if (/"operation"\s*:\s*"REWRITE"/u.test(prompt)) {
      return providerResponse({ output_kind: 'segment', title: '受控作品', content: '改写后的中段保持克制。', change_summary: '局部改写', model_warnings: [] }, request.model);
    }
    if (/"operation"\s*:\s*"CONTINUE"/u.test(prompt)) {
      return providerResponse({ output_kind: 'continuation', title: '受控作品', content: '第二天，你带着空白简历走进第一家公司。', change_summary: '追加下一段', model_warnings: [] }, request.model);
    }
    return providerResponse({ output_kind: 'full', title: '受控作品', content: '第一段是 GLM 创建的正文。\n\n中段等待改写。\n\n结尾保留现实后果。', change_summary: '完整创建', model_warnings: [] }, request.model);
  };
  try {
    const created = await api(env, '/api/generate', { body: {
      work_id: 'cross-provider-continue', model_selection: { provider_id: 'zhipu', writer_model_id: 'glm-4.7' },
      brief: { operation: 'CREATE', user_instruction: '创建受控正文。', target_scope: { type: 'full' } }
    } });
    const firstWrite = await api(env, `/api/tasks/${created.payload.task.id}/write`);
    await api(env, `/api/tasks/${created.payload.task.id}/validate`);
    const first = await adopt(env, 'cross-provider-continue', firstWrite.payload.candidate.id);

    const selected = '中段等待改写。';
    const start = first.content.indexOf(selected);
    const rewriteCreated = await api(env, '/api/generate', { body: {
      work_id: 'cross-provider-continue', source_hash: documentHash(first),
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'REWRITE', source_version_id: first.id, user_instruction: '只改写选区。',
        target_scope: { type: 'selection', start, end: start + selected.length, selected_text: selected } }
    } });
    const rewriteWrite = await api(env, `/api/tasks/${rewriteCreated.payload.task.id}/write`);
    await api(env, `/api/tasks/${rewriteCreated.payload.task.id}/validate`);
    const rewritten = await adopt(env, 'cross-provider-continue', rewriteWrite.payload.candidate.id);

    const continueCreated = await api(env, '/api/generate', { body: {
      work_id: 'cross-provider-continue', source_hash: documentHash(rewritten),
      model_selection: { provider_id: 'zhipu', writer_model_id: 'glm-4.7' },
      brief: { operation: 'CONTINUE', source_version_id: rewritten.id, user_instruction: '从第二天继续。', target_scope: { type: 'next_segment' } }
    } });
    assert.equal(continueCreated.payload.task.operation, 'CONTINUE');
    assert.equal(continueCreated.payload.task.contract.merge_strategy, 'PROGRAM_APPEND');
    assert.equal(continueCreated.payload.task.contract.expected_output_kind, 'continuation');
    assert.equal(continueCreated.payload.task.contract.writer_provider_id, 'zhipu');
    const continueWrite = await api(env, `/api/tasks/${continueCreated.payload.task.id}/write`);
    const candidate = continueWrite.payload.candidate;
    assert.equal(candidate.parent_version_id, rewritten.id);
    assert.equal(candidate.operation, 'CONTINUE');
    assert.equal(candidate.generated_segment, '第二天，你带着空白简历走进第一家公司。');
    assert.equal(candidate.content, `${rewritten.content.trimEnd()}\n\n${candidate.generated_segment}`);
    assert.equal(continueWrite.payload.task.output_kind, 'continuation');
    assert.equal(continueWrite.payload.task.merge_strategy, 'PROGRAM_APPEND');
    await api(env, `/api/tasks/${continueCreated.payload.task.id}/validate`);
    const continued = await adopt(env, 'cross-provider-continue', candidate.id);
    assert.equal(continued.id, candidate.id);
    assert.deepEqual(calls.map((item) => item.model), [
      'glm-4.7', 'glm-4.7-flash', 'deepseek-v4-pro', 'deepseek-flash', 'glm-4.7', 'glm-4.7-flash'
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test('invalid CONTINUE scope, persisted task mismatch and stale source all stop before provider', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const source = await saveVersion(env, 'continue-contract-guard', '来源正文。'.repeat(30));
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  try {
    const invalidScope = await api(env, '/api/generate', { body: {
      work_id: 'continue-contract-guard', source_hash: documentHash(source),
      brief: { operation: 'CONTINUE', source_version_id: source.id, user_instruction: '继续。', target_scope: { type: 'full' } }
    } });
    assert.equal(invalidScope.status, 409);
    assert.equal(invalidScope.payload.error.code, 'OPERATION_SCOPE_MISMATCH');

    const mismatched = await api(env, '/api/generate', { body: {
      work_id: 'continue-contract-guard', source_hash: documentHash(source),
      brief: { operation: 'CONTINUE', source_version_id: source.id, user_instruction: '继续。', target_scope: { type: 'next_segment' } }
    } });
    assert.equal(mismatched.status, 201);
    await db.prepare('UPDATE generation_tasks SET merge_strategy = ? WHERE id = ?')
      .bind('MODEL_FULL_REPLACE', mismatched.payload.task.id).run();
    const rejectedMismatch = await api(env, `/api/tasks/${mismatched.payload.task.id}/write`);
    assert.equal(rejectedMismatch.status, 409);
    assert.equal(rejectedMismatch.payload.error.code, 'TASK_CONTRACT_MISMATCH');

    const staleTask = await api(env, '/api/generate', { body: {
      work_id: 'continue-contract-guard', source_hash: documentHash(source),
      brief: { operation: 'CONTINUE', source_version_id: source.id, user_instruction: '继续。', target_scope: { type: 'next_segment' } }
    } });
    assert.equal(staleTask.status, 201);
    await saveVersion(env, 'continue-contract-guard', '生成前保存的更新正文。'.repeat(20), source.id);
    const staleWrite = await api(env, `/api/tasks/${staleTask.payload.task.id}/write`);
    assert.equal(staleWrite.status, 409);
    assert.equal(staleWrite.payload.error.code, 'SOURCE_VERSION_CONFLICT');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('selection text mismatch is rejected before any Writer transport', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const content = '开头👩‍🚀。\n\n第一段，“你好！”\n第二段🙂继续。\n\n结尾。';
  const source = await saveVersion(env, 'selection-preflight-guard', content);
  const expected = '第一段，“你好！”\n第二段🙂继续。';
  const start = content.indexOf(expected);
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  try {
    const rejected = await api(env, '/api/generate', { body: {
      work_id: 'selection-preflight-guard', source_hash: documentHash(source),
      brief: { operation: 'REWRITE', source_version_id: source.id, user_instruction: '只改写选区。',
        target_scope: { type: 'selection', start, end: start + expected.length, selected_text: `${expected}已变化` } }
    } });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.payload.error.code, 'SELECTION_SOURCE_MISMATCH');
    assert.equal(providerCalls, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM generation_tasks').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('a created task can be stopped after client contract rejection without calling Writer', async (t) => {
  const db = await database(t);
  const env = environment(db);
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; throw new Error('provider must not be called'); };
  try {
    const created = await api(env, '/api/generate', { body: {
      work_id: 'client-contract-reject',
      brief: { operation: 'CREATE', user_instruction: '创建候选。', target_scope: { type: 'full' } }
    } });
    assert.equal(created.status, 201);
    const stopped = await api(env, `/api/tasks/${created.payload.task.id}/stop`, { body: { reason: 'client_contract_mismatch' } });
    assert.equal(stopped.status, 200);
    assert.equal(stopped.payload.task.status, 'stopped');
    assert.equal(stopped.payload.task.stop_state, 'stopped_before_send');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
