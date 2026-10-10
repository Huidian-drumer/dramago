import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { FakeD1 } from '../audit/fake-d1.mjs';

const env = (db) => ({
  DB: db,
  OPENAI_API_KEY: 'test-secret-never-logged',
  OPENAI_MODEL: 'deepseek-v4-pro',
  VALIDATOR_MODEL: 'deepseek-flash',
  OPENAI_ENDPOINT: 'https://provider.invalid/chat/completions'
});

const api = async (db, path, { method = 'POST', body } = {}) => {
  const response = await worker.fetch(new Request(`https://workbench.test${path}`, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  }), env(db));
  return { status: response.status, payload: await response.json() };
};

const providerResponse = (content, model, usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model, usage }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });

const plan = {
  identity_fantasy: '低调进入公司的继承人', core_conflict: '同事不知身份且项目失败在即',
  audience_expectation: '身份信息差得到兑现', primary_agency: '主角亲自找出合作方案',
  main_payoff: '能力与身份共同兑现', ending_mode: '完整收束', negative_constraints: [],
  opening_promises: ['观众知道主角有底牌'], required_payoffs: ['身份优势必须真正影响结果'],
  selected_mechanisms: ['audience_leads_information_gap', 'promise_payoff']
};

const writer = {
  output_kind: 'full', title: '底牌',
  content: '你进入公司后一直隐藏身份。'.repeat(30) + '你亲自整理方案、说服团队，最终公开身份完成承诺，但结果来自你的行动。',
  change_summary: '生成完整正文', model_warnings: []
};

const validator = {
  findings: [],
  blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] },
  operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['主角'], relationships: [], irreversible_facts: ['身份已公开'], major_events: ['完成项目'], time_anchors: [] }
};

test('B CREATE 分阶段持久化，重复阶段请求不重复调用模型或创建候选', async () => {
  const db = new FakeD1();
  const models = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    models.push(request.model);
    if (models.length === 1) return providerResponse(plan, 'deepseek-flash');
    if (models.length === 2) return providerResponse(writer, 'deepseek-v4-pro');
    return providerResponse(validator, 'deepseek-flash');
  };
  try {
    const created = await api(db, '/api/generate', { body: {
      work_id: 'work_staged_b', context: '', create_pipeline: 'content_intelligence_v0.1',
      brief: { operation: 'CREATE', user_instruction: '写一个隐藏身份后兑现的完整故事。', output_preferences: { target_length: 300 } }
    } });
    assert.equal(created.status, 201);
    assert.equal(created.payload.task.stage, 'created');
    assert.equal(created.payload.next_stage, 'plan');
    const taskId = created.payload.task.id;

    const planned = await api(db, `/api/tasks/${taskId}/plan`);
    assert.equal(planned.status, 200);
    assert.equal(planned.payload.task.stage, 'planned');
    assert.equal(planned.payload.task.planner_model, 'deepseek-flash');
    const plannedAgain = await api(db, `/api/tasks/${taskId}/plan`);
    assert.equal(plannedAgain.payload.idempotent, true);
    assert.equal(models.length, 1);

    const written = await api(db, `/api/tasks/${taskId}/write`);
    assert.equal(written.status, 201);
    assert.equal(written.payload.task.stage, 'generated');
    assert.equal(written.payload.candidate.validation_status, 'pending');
    assert.equal(written.payload.candidate.can_auto_apply, false);
    assert.equal(db.versions.length, 1);
    const writtenAgain = await api(db, `/api/tasks/${taskId}/write`);
    assert.equal(writtenAgain.payload.idempotent, true);
    assert.equal(db.versions.length, 1);
    assert.equal(models.length, 2);

    const earlyAdopt = await api(db, '/api/versions/adopt', { body: { work_id: 'work_staged_b', version_id: written.payload.candidate.id } });
    assert.equal(earlyAdopt.status, 409);

    const validated = await api(db, `/api/tasks/${taskId}/validate`);
    assert.equal(validated.status, 200);
    assert.equal(validated.payload.task.stage, 'completed');
    assert.equal(validated.payload.task.validation_status, 'passed');
    assert.equal(validated.payload.candidate.can_auto_apply, true);
    assert.deepEqual(models, ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-flash']);
    const validatedAgain = await api(db, `/api/tasks/${taskId}/validate`);
    assert.equal(validatedAgain.payload.idempotent, true);
    assert.equal(models.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Validator 失败时候选保留为 unavailable 且不可采用', async () => {
  const db = new FakeD1();
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call === 1) return providerResponse(writer, 'deepseek-v4-pro');
    return new Response(JSON.stringify({ choices: [] }), { status: 200 });
  };
  try {
    const created = await api(db, '/api/generate', { body: {
      work_id: 'work_validator_unavailable', context: '',
      brief: { operation: 'CREATE', user_instruction: '写一篇完整身份短剧。', output_preferences: { target_length: 300 } }
    } });
    const taskId = created.payload.task.id;
    const written = await api(db, `/api/tasks/${taskId}/write`);
    const validated = await api(db, `/api/tasks/${taskId}/validate`);
    assert.equal(validated.status, 502);
    assert.equal(validated.payload.task.stage, 'failed');
    assert.equal(validated.payload.task.failed_stage, 'validate');
    assert.equal(validated.payload.candidate.id, written.payload.candidate.id);
    assert.equal(validated.payload.candidate.validation_status, 'unavailable');
    assert.equal(validated.payload.can_auto_apply, false);
    assert.equal(db.versions.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('读取超时活跃阶段会以条件更新标记 abandoned', async () => {
  const db = new FakeD1();
  const created = await api(db, '/api/generate', { body: {
    work_id: 'work_abandoned', context: '',
    brief: { operation: 'CREATE', user_instruction: '写一篇完整身份短剧。', output_preferences: { target_length: 300 } }
  } });
  const row = db.tasks[0];
  row.stage = 'generating';
  row.status = 'generating';
  row.stage_started_at = '2020-01-01T00:00:00.000Z';
  row.updated_at = '2020-01-01T00:00:00.000Z';
  const status = await api(db, `/api/tasks/${created.payload.task.id}`, { method: 'GET' });
  assert.equal(status.status, 200);
  assert.equal(status.payload.task.stage, 'abandoned');
  assert.equal(status.payload.task.failed_stage, 'write');
  assert.equal(status.payload.task.last_error_code, 'STAGE_STALE');
});
