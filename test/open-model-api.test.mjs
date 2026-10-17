import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { applyMigrations } from '../local/migrations.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';
import {
  MemoryProviderSecretStore, defaultProviderConfiguration, deleteProviderConfiguration,
  selectProviderRoles, updateProviderConfiguration, validateProviderEndpoint
} from '../local/secure-config.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-open-model-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function resolver() {
  const definitions = {
    glm: { name: 'Controlled GLM', endpoint: 'https://glm.controlled/chat/completions', writer: 'glm-writer', validator: 'glm-validator', version: 3 },
    deepseek: { name: 'Controlled DeepSeek', endpoint: 'https://deepseek.controlled/chat/completions', writer: 'deepseek-writer', validator: 'deepseek-validator', version: 5 },
    qwen: { name: 'Controlled Qwen', endpoint: 'https://qwen.controlled/chat/completions', writer: 'qwen-writer', validator: 'qwen-validator', version: 7,
      caps: { temperature: false, response_format_json_object: false, max_tokens: false } }
  };
  return async (input = {}) => {
    const role = input.role || 'writer';
    const providerId = input.provider_id || (role === 'writer' ? 'glm' : 'deepseek');
    const definition = definitions[providerId];
    if (!definition) throw Object.assign(new Error('unknown provider'), { code: 'PROVIDER_NOT_ALLOWED' });
    const model = input.model_id || input.writer_model_id || input.validator_model_id
      || (role === 'writer' ? definition.writer : definition.validator);
    const credentialRef = `${providerId}:v${definition.version}:controlled`;
    if (input.credential_ref && input.credential_ref !== credentialRef) {
      throw Object.assign(new Error('credential changed'), { code: 'TASK_CREDENTIAL_UNAVAILABLE', status: 409 });
    }
    return {
      provider_id: providerId, provider_name: definition.name, endpoint: definition.endpoint,
      writer_model_id: role === 'writer' ? model : definition.writer,
      planner_model_id: role === 'planner' ? model : definition.validator,
      validator_model_id: role === 'validator' ? model : definition.validator,
      model_id: model, provider_config_version: definition.version, credential_ref: credentialRef,
      request_capabilities: definition.caps || { temperature: true, response_format_json_object: true, max_tokens: false },
      timeout_ms: 10000, ...(input.include_secret ? { api_key: `${providerId}-secret` } : {})
    };
  };
}

function environment(db, extra = {}) {
  return { DB: db, LOCAL_RUNTIME_INSTANCE_ID: 'open-model-test', PROVIDER_TIMEOUT_MS: '10000',
    MAX_AUTO_REPAIRS: '0', PROVIDER_CONFIG_RESOLVER: resolver(), ...extra };
}

async function api(env, pathname, { method = 'POST', body = {} } = {}) {
  const response = await worker.fetch(new Request(`http://local.test${pathname}`, {
    method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body) : undefined
  }), env);
  return { status: response.status, payload: await response.json() };
}

function providerResponse(content, model) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 } }),
  { status: 200, headers: { 'content-type': 'application/json' } });
}

const writer = { output_kind: 'full', title: '跨平台故事', content: '她依靠自己的判断完成了选择。'.repeat(30),
  change_summary: '受控生成', model_warnings: [] };
const validatorPass = { findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['主角'], relationships: [], irreversible_facts: [], major_events: ['完成选择'], time_anchors: [] } };

test('provider configuration supports add, edit, independent role selection, deletion and isolated keys', async () => {
  let config = structuredClone(defaultProviderConfiguration);
  config = updateProviderConfiguration(config, { provider_id: 'qwen_cn', preset_id: 'qwen_bailian',
    display_name: '我的百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    writer_model_id: 'qwen-plus', validator_model_id: 'qwen-turbo', disclosure_confirmed: true,
    select_writer: false, select_validator: false });
  config = updateProviderConfiguration(config, { provider_id: 'router_team', preset_id: 'openrouter',
    display_name: 'OpenRouter 团队', endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    writer_model_id: 'vendor/writer', validator_model_id: 'vendor/validator', disclosure_confirmed: true,
    select_writer: false, select_validator: false });
  config = selectProviderRoles(config, { writer_provider_id: 'qwen_cn', validator_provider_id: 'router_team' });
  assert.equal(config.selected_writer.provider_id, 'qwen_cn');
  assert.equal(config.selected_validator.provider_id, 'router_team');
  const store = new MemoryProviderSecretStore();
  await store.set('qwen_cn', 'qwen-key');
  await store.set('router_team', 'router-key');
  assert.equal(await store.get('qwen_cn'), 'qwen-key');
  assert.equal(await store.get('router_team'), 'router-key');
  config = deleteProviderConfiguration(config, 'deepseek');
  assert.equal(config.providers.deepseek, undefined);
  assert.equal(await store.get('router_team'), 'router-key');
});

test('custom endpoint security requires HTTPS or explicit loopback HTTP and never accepts credentials', () => {
  assert.equal(validateProviderEndpoint('https://example.test/v1/chat/completions'), 'https://example.test/v1/chat/completions');
  assert.throws(() => validateProviderEndpoint('http://example.test/v1/chat/completions'), /HTTPS/u);
  assert.throws(() => validateProviderEndpoint('https://user:pass@example.test/v1/chat/completions'), /凭据/u);
  assert.throws(() => validateProviderEndpoint('http://127.0.0.1:9999/chat/completions'), /单独确认/u);
  assert.equal(validateProviderEndpoint('http://127.0.0.1:9999/chat/completions', { allowInsecureLocalHttp: true }),
    'http://127.0.0.1:9999/chat/completions');
});

test('Writer and Validator can use different providers without changing candidate isolation or CAS', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), model: body.model, authorization: options.headers.authorization });
    return providerResponse(calls.length === 1 ? writer : validatorPass, body.model);
  };
  try {
    const created = await api(env, '/api/generate', { body: { work_id: 'cross-provider-work', context: '',
      model_selection: { writer_provider_id: 'glm', writer_model_id: 'glm-writer',
        validator_provider_id: 'deepseek', validator_model_id: 'deepseek-validator' },
      brief: { operation: 'CREATE', user_instruction: '生成一个受控故事。', output_preferences: { target_length: 300 } } } });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.task.writer_provider_id, 'glm');
    assert.equal(created.payload.task.validator_provider_id, 'deepseek');
    const taskId = created.payload.task.id;
    const written = await api(env, `/api/tasks/${taskId}/write`);
    const validated = await api(env, `/api/tasks/${taskId}/validate`);
    assert.equal(validated.status, 200, JSON.stringify(validated.payload));
    assert.deepEqual(calls.map((item) => item.model), ['glm-writer', 'deepseek-validator']);
    assert.match(calls[0].authorization, /^Bearer glm-secret$/u);
    assert.match(calls[1].authorization, /^Bearer deepseek-secret$/u);
    assert.equal(written.payload.candidate.content_hash, validated.payload.candidate.content_hash);
    const adopted = await api(env, '/api/versions/adopt', { body: { work_id: 'cross-provider-work',
      version_id: validated.payload.candidate.id } });
    assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
  } finally { globalThis.fetch = originalFetch; }
});

test('capability adapter omits unsupported parameters and incompatible output fails closed', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }], model: 'qwen-writer' }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const created = await api(env, '/api/generate', { body: { work_id: 'capability-work', context: '',
      model_selection: { writer_provider_id: 'qwen', writer_model_id: 'qwen-writer',
        validator_provider_id: 'deepseek', validator_model_id: 'deepseek-validator' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } } } });
    const result = await api(env, `/api/tasks/${created.payload.task.id}/write`);
    assert.equal(result.status, 502);
    assert.equal(result.payload.error.code, 'PROVIDER_FORMAT_INVALID');
    assert.equal('temperature' in requests[0], false);
    assert.equal('response_format' in requests[0], false);
  } finally { globalThis.fetch = originalFetch; }
});

test('cross-provider revalidation calls only selected Validator, preserves hash and old history', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    if (calls.length === 1) return providerResponse(writer, body.model);
    if (calls.length === 2) return providerResponse({ ...validatorPass,
      findings: [{ finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', severity: 'blocking', confidence: 0.99,
        source_priority: 'explicit_user_hard_constraint', fact_basis: 'confirmed_objective', evidence: ['她依靠'],
        evidence_scope: 'candidate_content', evidence_locations: [{ source: 'candidate_content', quote: '她依靠', start: 0, end: 3 }], reason: '受控阻断。' }] }, body.model);
    return providerResponse(validatorPass, body.model);
  };
  try {
    const created = await api(env, '/api/generate', { body: { work_id: 'revalidate-cross-work', context: '',
      model_selection: { writer_provider_id: 'glm', writer_model_id: 'glm-writer',
        validator_provider_id: 'glm', validator_model_id: 'glm-validator' },
      brief: { operation: 'CREATE', user_instruction: '生成故事，不得违反受控要求。',
        negative_constraints: ['不得违反受控要求'], output_preferences: { target_length: 300 } } } });
    const written = await api(env, `/api/tasks/${created.payload.task.id}/write`);
    const blocked = await api(env, `/api/tasks/${created.payload.task.id}/validate`);
    assert.equal(blocked.payload.candidate.validation_status, 'blocked');
    const beforeHash = written.payload.candidate.content_hash;
    const beforeContent = written.payload.candidate.content;
    const revalidated = await api(env, `/api/versions/${written.payload.candidate.id}/revalidate`, { body: {
      work_id: written.payload.candidate.work_id, candidate_content_hash: beforeHash,
      confirm_validator_cost: true, confirm_third_party_disclosure: true,
      validator_selection: { provider_id: 'deepseek', validator_model_id: 'deepseek-validator' }
    } });
    assert.equal(revalidated.status, 200, JSON.stringify(revalidated.payload));
    assert.deepEqual(calls, ['glm-writer', 'glm-validator', 'deepseek-validator']);
    assert.equal(revalidated.payload.writer_called, false);
    assert.equal(revalidated.payload.candidate.content_hash, beforeHash);
    assert.equal(revalidated.payload.candidate.content, beforeContent);
    assert.equal(revalidated.payload.validation_runs.length, 2);
    assert.equal(revalidated.payload.validation_runs[0].provider_id, 'deepseek');
    assert.equal(revalidated.payload.validation_runs[1].provider_id, 'glm');
  } finally { globalThis.fetch = originalFetch; }
});

test('migration 0007 upgrades a database through 0006 without deleting old rows', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-open-model-migration-'));
  const oldMigrations = path.join(directory, 'migrations');
  await mkdir(oldMigrations);
  for (const name of ['0000_low_the_fallen.sql', '0001_kind_the_spike.sql', '0002_conscious_oracle.sql',
    '0003_transport_attempts_and_version_restores.sql', '0004_multi_provider_and_task_control.sql',
    '0005_candidate_validation_runs.sql', '0006_story_memory_snapshots.sql']) {
    await writeFile(path.join(oldMigrations, name), await (await import('node:fs/promises')).readFile(path.join(migrations, name)));
  }
  const db = new SQLiteD1(path.join(directory, 'old.sqlite'));
  await applyMigrations(db, oldMigrations);
  await db.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('old-work', '旧作品', null, '2026-01-01', '2026-01-01').run();
  await applyMigrations(db, migrations);
  const work = await db.prepare('SELECT * FROM works WHERE id = ?').bind('old-work').first();
  const columns = await db.prepare('PRAGMA table_info(generation_tasks)').all();
  assert.equal(work.title, '旧作品');
  assert.ok(columns.results.some((item) => item.name === 'validator_credential_ref'));
  db.close();
  t.after(() => rm(directory, { recursive: true, force: true }));
});
