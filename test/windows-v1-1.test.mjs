import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import { applyMigrations } from '../local/migrations.mjs';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { createLocalRuntime } from '../local/server.mjs';
import {
  defaultProviderConfiguration,
  MemoryProviderSecretStore,
  writeProviderConfiguration
} from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';
import { assertProviderModel, listProviders, recommendedValidatorModel } from '../worker/provider-registry.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-v1-1-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function providerResolver(keys = { zhipu: 'zhipu-test-key', deepseek: 'deepseek-test-key' }) {
  const definitions = {
    zhipu: { endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', writer: 'glm-4.7', validator: 'glm-4.7-flash', version: 4 },
    deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', writer: 'deepseek-v4-pro', validator: 'deepseek-flash', version: 7 }
  };
  let selected = 'deepseek';
  return {
    select(providerId) { selected = providerId; },
    async resolve(input = {}) {
      const providerId = input.provider_id || selected;
      const definition = definitions[providerId];
      if (!definition) throw Object.assign(new Error('不支持该模型平台。'), { code: 'PROVIDER_NOT_ALLOWED' });
      const writerModel = input.writer_model_id || definition.writer;
      assertProviderModel(providerId, writerModel, 'writer');
      const credentialRef = `${providerId}:key:${keys[providerId]}`;
      if (input.credential_ref && input.credential_ref !== credentialRef) {
        throw Object.assign(new Error('旧凭据不可用。'), { code: 'TASK_CREDENTIAL_UNAVAILABLE', status: 409 });
      }
      return {
        provider_id: providerId, provider_name: providerId, endpoint: definition.endpoint,
        writer_model_id: writerModel, planner_model_id: definition.validator,
        validator_model_id: definition.validator, provider_config_version: definition.version,
        credential_ref: credentialRef, ...(input.include_secret ? { api_key: keys[providerId] } : {})
      };
    }
  };
}

function env(db, resolver, extra = {}) {
  return {
    DB: db,
    LOCAL_RUNTIME_INSTANCE_ID: 'v1-1-test-runtime',
    PROVIDER_CONFIG_RESOLVER: resolver.resolve,
    PROVIDER_TIMEOUT_MS: '10000',
    ...extra
  };
}

async function api(environment, pathname, { method = 'POST', body = {} } = {}) {
  const response = await worker.fetch(new Request(`http://local.test${pathname}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body) : undefined
  }), environment);
  return { status: response.status, payload: await response.json() };
}

function response(content, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 5, completion_tokens: 8, total_tokens: 13 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const writer = {
  output_kind: 'full', title: '受控候选', content: '你完成了本次选择，并承担由此产生的后果。'.repeat(25),
  change_summary: '受控生成', model_warnings: []
};
const validator = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

test('provider registry exposes open-model presets while preserving DeepSeek and GLM defaults', () => {
  const providers = listProviders();
  assert.deepEqual(providers.map((item) => item.provider_id).sort(),
    ['custom', 'deepseek', 'openrouter', 'qwen_bailian', 'siliconflow', 'zhipu']);
  assert.equal(recommendedValidatorModel('zhipu', 'glm-4.7'), 'glm-4.7-flash');
  assert.equal(recommendedValidatorModel('deepseek', 'deepseek-v4-pro'), 'deepseek-flash');
  assert.throws(() => assertProviderModel('deepseek', 'glm-4.7', 'writer'), /不在/u);
  assert.throws(() => assertProviderModel('zhipu', 'arbitrary-model', 'writer'), /不在/u);
});

test('provider secrets remain independent in secure-store abstraction', async () => {
  const store = new MemoryProviderSecretStore();
  await store.set('zhipu', 'z-key');
  await store.set('deepseek', 'd-key');
  assert.equal(await store.get('zhipu'), 'z-key');
  assert.equal(await store.get('deepseek'), 'd-key');
  await store.clear('zhipu');
  assert.equal(await store.get('zhipu'), null);
  assert.equal(await store.get('deepseek'), 'd-key');
});

test('connection diagnostics distinguish authentication, quota, permission, rate limit, upstream failure and offline', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-v1-1-errors-'));
  const paths = localPaths(directory);
  await ensureLocalDirectories(paths);
  await writeProviderConfiguration(paths.providerConfig, structuredClone(defaultProviderConfiguration));
  const secretStore = new MemoryProviderSecretStore({ deepseek: 'controlled-key' });
  let upstreamStatus = 401;
  const upstream = createServer((request, response) => {
    request.resume();
    response.writeHead(upstreamStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'redacted controlled error' } }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const runtime = await createLocalRuntime({
    dataRoot: directory,
    disableLock: true,
    providerSecretStore: secretStore,
    qaProviderEndpoint: `http://127.0.0.1:${upstreamPort}/chat/completions`
  });
  await runtime.listen();
  t.after(async () => {
    await runtime.close().catch(() => {});
    await new Promise((resolve) => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  for (const [status, code] of [[401, 'PROVIDER_AUTH_FAILED'], [402, 'PROVIDER_QUOTA_EXHAUSTED'],
    [403, 'PROVIDER_MODEL_ACCESS_DENIED'], [429, 'PROVIDER_RATE_LIMITED'], [500, 'PROVIDER_REQUEST_FAILED']]) {
    upstreamStatus = status;
    await assert.rejects(runtime.testProviderConnection({ provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro', confirm_billable_test: true }),
      (error) => error.code === code);
  }
  await new Promise((resolve) => upstream.close(resolve));
  await assert.rejects(runtime.testProviderConnection({ provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro', confirm_billable_test: true }),
    (error) => error.code === 'PROVIDER_CONNECTION_FAILED');
});

test('task freezes provider/model/credential route and validator stays on the same provider', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url: String(url), authorization: options.headers.authorization, model: request.model });
    return request.model === 'glm-4.7' ? response(writer, request.model) : response(validator, request.model);
  };
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'frozen-provider-work', context: '',
      model_selection: { provider_id: 'zhipu', writer_model_id: 'glm-4.7' },
      brief: { operation: 'CREATE', user_instruction: '生成一个受控故事。', output_preferences: { target_length: 300 } }
    } });
    assert.equal(created.status, 201);
    resolver.select('deepseek');
    const taskId = created.payload.task.id;
    const written = await api(environment, `/api/tasks/${taskId}/write`);
    const validated = await api(environment, `/api/tasks/${taskId}/validate`);
    assert.equal(validated.status, 200);
    assert.deepEqual(calls.map((call) => call.model), ['glm-4.7', 'glm-4.7-flash']);
    assert.ok(calls.every((call) => call.url.startsWith('https://open.bigmodel.cn/')));
    assert.ok(calls.every((call) => call.authorization === 'Bearer zhipu-test-key'));
    assert.equal(written.payload.task.writer_provider_id, 'zhipu');
    assert.equal(validated.payload.task.validator_provider_id, 'zhipu');
    assert.equal(validated.payload.candidate.writer_provider_id, 'zhipu');
    assert.equal(validated.payload.candidate.validator_model_id, 'glm-4.7-flash');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('stop before transport send is confirmed locally and never invokes provider', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  let environment;
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; return response(writer, 'deepseek-v4-pro'); };
  environment = env(db, resolver, {
    PROVIDER_ATTEMPT_HOOK: async (event) => {
      if (event.point === 'prepared') await api(environment, `/api/tasks/${event.task_id}/stop`, { body: { reason: 'controlled-before-send' } });
    }
  });
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'stop-before-send', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    const result = await api(environment, `/api/tasks/${created.payload.task.id}/write`);
    assert.equal(result.status, 409);
    assert.equal(result.payload.error.code, 'TASK_STOPPED');
    assert.equal(providerCalls, 0);
    const task = await api(environment, `/api/tasks/${created.payload.task.id}`, { method: 'GET' });
    assert.equal(task.payload.task.stop_state, 'stopped_before_send');
    assert.equal(task.payload.task.outcome_unknown, false);
    assert.equal(task.payload.transport_attempt_records[0].status, 'cancelled_before_send');
  } finally { globalThis.fetch = originalFetch; }
});

test('stopping an in-flight PLAN marks the remote outcome unknown and creates no candidate', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const originalFetch = globalThis.fetch;
  let notifyFetchStarted;
  const fetchStarted = new Promise((resolve) => { notifyFetchStarted = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    notifyFetchStarted();
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'stop-plan-in-flight', context: '', create_pipeline: 'content_intelligence_v0.1',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '先规划再生成故事。', output_preferences: { target_length: 300 } }
    } });
    assert.equal(created.payload.next_stage, 'plan');
    const taskId = created.payload.task.id;
    const planning = api(environment, `/api/tasks/${taskId}/plan`);
    await fetchStarted;
    const stopped = await api(environment, `/api/tasks/${taskId}/stop`, { body: { reason: 'controlled-plan-stop' } });
    const planResult = await planning;
    assert.equal(stopped.status, 200);
    assert.equal(stopped.payload.remote_outcome_unknown, true);
    assert.equal(planResult.status, 409);
    assert.equal(stopped.payload.task.unknown_stage, 'plan');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('stop-plan-in-flight').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('stop after transport send aborts local wait, marks outcome unknown, and keeps retry manual', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const originalFetch = globalThis.fetch;
  let notifyFetchStarted;
  const fetchStarted = new Promise((resolve) => { notifyFetchStarted = resolve; });
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    notifyFetchStarted();
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'stop-in-flight', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    const taskId = created.payload.task.id;
    const writing = api(environment, `/api/tasks/${taskId}/write`);
    await fetchStarted;
    const stopped = await api(environment, `/api/tasks/${taskId}/stop`, { body: { reason: 'controlled-in-flight' } });
    const writeResult = await writing;
    assert.equal(stopped.status, 200);
    assert.equal(stopped.payload.remote_outcome_unknown, true);
    assert.equal(writeResult.status, 409);
    const status = await api(environment, `/api/tasks/${taskId}`, { method: 'GET' });
    assert.equal(status.payload.task.stage, 'stopped');
    assert.equal(status.payload.task.retry_confirmation_required, true);
    assert.equal(status.payload.transport_attempt_records[0].status, 'outcome_unknown');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('stop-in-flight').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('late writer response after confirmed stop cannot create a candidate', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const originalFetch = globalThis.fetch;
  let releaseResponse;
  let notifyStarted;
  const started = new Promise((resolve) => { notifyStarted = resolve; });
  globalThis.fetch = async () => new Promise((resolve) => {
    releaseResponse = () => resolve(response(writer, 'deepseek-v4-pro'));
    notifyStarted();
  });
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'late-response-work', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    const taskId = created.payload.task.id;
    const writing = api(environment, `/api/tasks/${taskId}/write`);
    await started;
    const stopped = await api(environment, `/api/tasks/${taskId}/stop`, { body: { reason: 'late-response-test' } });
    releaseResponse();
    const writeResult = await writing;
    assert.equal(stopped.status, 200);
    assert.equal(writeResult.status, 409);
    assert.equal(writeResult.payload.error.code, 'TASK_STOPPED');
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('late-response-work').first()).count, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('stopping validator retains the one saved candidate and never marks it passed', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let notifyValidatorStarted;
  const validatorStarted = new Promise((resolve) => { notifyValidatorStarted = resolve; });
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) return response(writer, 'deepseek-v4-pro');
    return new Promise((_resolve, reject) => {
      notifyValidatorStarted();
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  };
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'stop-validator-work', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    const taskId = created.payload.task.id;
    const written = await api(environment, `/api/tasks/${taskId}/write`);
    const validating = api(environment, `/api/tasks/${taskId}/validate`);
    await validatorStarted;
    const stopped = await api(environment, `/api/tasks/${taskId}/stop`, { body: { reason: 'stop-validator-test' } });
    const validationResult = await validating;
    assert.equal(stopped.status, 200);
    assert.equal(validationResult.status, 409);
    assert.equal(stopped.payload.candidate.id, written.payload.candidate.id);
    assert.equal(stopped.payload.candidate.validation_status, 'unavailable');
    assert.equal(stopped.payload.candidate.can_auto_apply, false);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM versions WHERE work_id = ?').bind('stop-validator-work').first()).count, 1);
    const repeated = await api(environment, `/api/tasks/${taskId}/stop`, { body: { reason: 'duplicate-click' } });
    assert.equal(repeated.status, 200);
    assert.equal(repeated.payload.idempotent, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('rotated credential does not fall back to a new key for an existing task', async (t) => {
  const db = await database(t);
  const keys = { zhipu: 'z-key', deepseek: 'deep-key-v1' };
  const resolver = providerResolver(keys);
  const environment = env(db, resolver);
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { providerCalls += 1; return response(writer, 'deepseek-v4-pro'); };
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'rotated-key-work', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    keys.deepseek = 'deep-key-v2';
    const result = await api(environment, `/api/tasks/${created.payload.task.id}/write`);
    assert.equal(result.status, 409);
    assert.equal(result.payload.error.code, 'TASK_CREDENTIAL_UNAVAILABLE');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('bootstrap reconciles interrupted validator before returning candidate state', async (t) => {
  const db = await database(t);
  const resolver = providerResolver();
  const environment = env(db, resolver);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => response(writer, JSON.parse(options.body).model);
  try {
    const created = await api(environment, '/api/generate', { body: {
      work_id: 'bootstrap-validator-recovery', context: '',
      model_selection: { provider_id: 'deepseek', writer_model_id: 'deepseek-v4-pro' },
      brief: { operation: 'CREATE', user_instruction: '生成故事。', output_preferences: { target_length: 300 } }
    } });
    const taskId = created.payload.task.id;
    const written = await api(environment, `/api/tasks/${taskId}/write`);
    const timestamp = new Date().toISOString();
    await db.prepare(`UPDATE generation_tasks SET status = ?, stage = ?, execution_instance_id = ?,
      execution_token = ?, updated_at = ?, stage_started_at = ? WHERE id = ?`)
      .bind('validating', 'validating', 'previous-runtime', 'previous-token', timestamp, timestamp, taskId).run();
    await db.prepare(`INSERT INTO provider_transport_attempts
      (id, task_id, stage, attempt_number, status, provider, model_name, execution_instance_id,
       prepared_at, sent_at, provider_id, credential_ref, execution_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind('bootstrap-validator-attempt', taskId, 'validate', 2, 'in_flight', 'DeepSeek 官方 API',
        'deepseek-flash', 'previous-runtime', timestamp, timestamp, 'deepseek',
        written.payload.task.credential_ref, 'previous-token').run();

    const bootstrapped = await api(environment, '/api/bootstrap?work_id=bootstrap-validator-recovery', { method: 'GET' });
    const candidate = bootstrapped.payload.versions.find((version) => version.id === written.payload.candidate.id);
    assert.equal(bootstrapped.payload.latest_task.status, 'abandoned');
    assert.equal(bootstrapped.payload.latest_task.unknown_stage, 'validate');
    assert.equal(candidate.validation_status, 'unavailable');
    assert.equal(candidate.can_auto_apply, false);
  } finally { globalThis.fetch = originalFetch; }
});
