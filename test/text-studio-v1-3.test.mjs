import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../dist/server/index.js';
import { FakeD1 } from '../audit/fake-d1.mjs';
import {
  buildProviderMessages,
  classifyProviderHttpFailure,
  classifyProviderTransportFailure,
  createCreativeBrief,
  mergeModelResult,
  normalizeStoryMemory,
  runDeterministicChecks,
  semanticValidationBlocks,
  sha256,
  storyMemoryForWriter
} from '../worker/core.mjs';

const env = (db) => ({ DB: db, OPENAI_API_KEY: 'controlled-not-real', OPENAI_MODEL: 'writer-fixture',
  VALIDATOR_MODEL: 'validator-fixture', OPENAI_ENDPOINT: 'https://provider.invalid/chat/completions' });

async function api(db, path, { method = 'GET', body } = {}) {
  const response = await worker.fetch(new Request(`https://workbench.test${path}`, {
    method, headers: method === 'POST' ? { 'content-type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined
  }), env(db));
  return { status: response.status, payload: await response.json() };
}

test('CONTINUE keeps the work title and stores a model title only as a segment title', () => {
  const source = { id: 'v5', title: '一日倾覆', content: '前文已经确立。' };
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: source.id,
    target_scope: { type: 'next_segment' }, user_instruction: '继续写结局。' });
  const candidate = mergeModelResult({ brief, source, modelResult: {
    outputKind: 'continuation', title: '结局：自己撑住明天', content: '第二天，他继续处理后果。'
  } });
  assert.equal(candidate.title, '一日倾覆');
  assert.equal(candidate.segmentTitle, '结局：自己撑住明天');
  assert.equal(candidate.content, '前文已经确立。\n\n第二天，他继续处理后果。');
});

test('selection and full editing cannot silently rename an existing work', () => {
  const source = { id: 'v2', title: '一日倾覆', content: '产权清晰。债务仍在。' };
  const selectionBrief = createCreativeBrief({ operation: 'REWRITE', source_version_id: source.id,
    target_scope: { type: 'selection', start: 0, end: 4, selected_text: '产权清晰' }, user_instruction: '改清楚。' });
  const selection = mergeModelResult({ brief: selectionBrief, source, modelResult: {
    outputKind: 'segment', title: '模型擅自的新标题', content: '产权已经核验清楚'
  } });
  assert.equal(selection.title, '一日倾覆');
  const fullBrief = createCreativeBrief({ operation: 'REWRITE', source_version_id: source.id,
    target_scope: { type: 'full' }, user_instruction: '重写全文但保留作品身份。' });
  const full = mergeModelResult({ brief: fullBrief, source, modelResult: {
    outputKind: 'full', title: '另一个擅自标题', content: '重写后的正文。'
  } });
  assert.equal(full.title, '一日倾覆');
});

test('specified ending verifies the exact final sentence locally and reports measured length', () => {
  const source = { id: 'v1', title: '合成故事', content: '旧正文。' };
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: source.id,
    target_scope: { type: 'next_segment' }, user_instruction: '完成结局。',
    ending_intent: { mode: 'specified_ending', requirements: '主角承担后果。', exact_final_sentence: '明天仍要由他自己走。' },
    output_preferences: { target_length: 20 } });
  const pass = mergeModelResult({ brief, source, modelResult: { outputKind: 'continuation', title: '尾声',
    content: '他承担了自己的选择。明天仍要由他自己走。' } });
  const passChecks = runDeterministicChecks({ brief, source, candidate: pass });
  assert.equal(passChecks.find((item) => item.check === 'EXACT_FINAL_SENTENCE').status, 'pass');
  assert.match(passChecks.find((item) => item.check === 'TARGET_LENGTH_MEASURED').message, /本次生成 \d+ 字/u);
  const fail = mergeModelResult({ brief, source, modelResult: { outputKind: 'continuation', title: '尾声',
    content: '他承担了自己的选择，但故事又多写了一句。' } });
  assert.equal(runDeterministicChecks({ brief, source, candidate: fail })
    .find((item) => item.check === 'EXACT_FINAL_SENTENCE').status, 'fail');
});

test('provider failures keep authentication, quota, rate limit, DNS, proxy and timeout distinct', () => {
  assert.equal(classifyProviderHttpFailure(401, {}), 'PROVIDER_AUTH_FAILED');
  assert.equal(classifyProviderHttpFailure(402, {}), 'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(classifyProviderHttpFailure(400, { error: { code: 'insufficient_balance' } }), 'PROVIDER_QUOTA_EXHAUSTED');
  assert.equal(classifyProviderHttpFailure(429, {}), 'PROVIDER_RATE_LIMITED');
  assert.equal(classifyProviderTransportFailure({ cause: { code: 'ENOTFOUND' } }), 'PROVIDER_DNS_FAILED');
  assert.equal(classifyProviderTransportFailure({ cause: { code: 'PROXY_AUTH_FAILED' } }), 'PROVIDER_PROXY_FAILED');
  assert.equal(classifyProviderTransportFailure({ cause: { code: 'ETIMEDOUT' } }), 'PROVIDER_UPSTREAM_TIMEOUT');
});

test('confirmed land ownership enters Writer context and a contradictory new segment needs two-scope evidence', () => {
  const source = { id: 'v5', title: '一日倾覆', content: '外公留下的土地已经登记在林川名下，产权清晰。' };
  const quote = source.content;
  const memory = normalizeStoryMemory({ completeness: 'available', persistent_facts: [{
    id: 'land_owner', fact: '外公留下的土地已登记在林川名下且产权清晰', status: 'active',
    truth_status: 'objective', certainty: 'confirmed', time_context: '',
    evidence: [{ quote, start: 0, end: quote.length }]
  }] }, { content: source.content, versionId: source.id });
  const writerMemory = storyMemoryForWriter(memory);
  assert.equal(writerMemory.memory_completeness, 'available');
  assert.equal(writerMemory.confirmed_objective.persistent_facts[0].id, 'land_owner');
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: source.id,
    target_scope: { type: 'next_segment' }, user_instruction: '继续写处理土地的结局。' });
  const messages = buildProviderMessages({ brief, source, context: '', storyMemory: memory });
  assert.match(messages.user, /land_owner/u);
  const segment = '土地其实仍在外公名下，继承手续尚未办理。';
  const candidate = { content: `${source.content}\n\n${segment}`, generated_segment: segment };
  const validation = { findings: [{ findingType: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: 0.98,
    sourcePriority: 'source_version_fact', factBasis: 'confirmed_objective', memoryFactIds: ['land_owner'],
    evidence: [quote, segment], evidenceScope: 'cross_scope', reason: '新增段落无解释地推翻已确认产权事实',
    evidenceLocations: [{ source: 'source_content', quote, start: 0, end: quote.length },
      { source: 'generated_segment', quote: segment, start: 0, end: segment.length }] }] };
  assert.equal(semanticValidationBlocks(validation, brief, { source, candidate, sourceMemory: memory }), true);
  const claimOnly = { findings: [{ ...validation.findings[0], factBasis: 'character_claim' }] };
  assert.equal(semanticValidationBlocks(claimOnly, brief, { source, candidate, sourceMemory: memory }), false);
});

test('work overview separates adopted memory, unadopted candidate and author future planning', async () => {
  const db = new FakeD1();
  const content = '林川正式接手土地。';
  const contentHash = await sha256(content);
  db.works.push({ id: 'work-overview', title: '合成作品', current_version_id: 'v1', story_status: 'active',
    completed_version_id: null, completed_at: null, created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z' });
  db.versions.push({ id: 'v1', work_id: 'work-overview', parent_version_id: null, operation: 'CREATE', status: 'adopted',
    title: '合成作品', content, creative_brief_json: '{}', content_hash: contentHash, created_at: '2026-10-15T00:00:00.000Z' },
  { id: 'v2', work_id: 'work-overview', parent_version_id: 'v1', operation: 'CONTINUE', status: 'candidate',
    title: '合成作品', content: `${content}\n\n候选内容。`, creative_brief_json: '{}', content_hash: 'candidate-hash',
    validation_status: 'pending', created_at: '2026-10-15T01:00:00.000Z' });
  db.storyMemory.push({ id: 'm1', work_id: 'work-overview', version_id: 'v1', content_hash: contentHash,
    memory_status: 'available', extraction_source: 'semantic_validator', source_version_id: null,
    memory_json: JSON.stringify(normalizeStoryMemory({ completeness: 'available', persistent_facts: [{
      id: 'land', fact: '林川正式接手土地', status: 'active', truth_status: 'objective', certainty: 'confirmed',
      evidence: [{ quote: content, start: 0, end: content.length }]
    }] }, { content, versionId: 'v1' })), created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z' });
  db.workStoryPlans.push({ work_id: 'work-overview', future_plot_json: '["以后处理债务"]', ending_plan_json: '["保留选择权"]',
    foreshadowing_json: '["旧钥匙"]', updated_at: '2026-10-15T02:00:00.000Z' });
  const result = await api(db, '/api/works/work-overview/overview');
  assert.equal(result.status, 200);
  assert.equal(result.payload.formal_story.version_id, 'v1');
  assert.equal(result.payload.formal_story.important_facts[0].id, 'land');
  assert.equal(result.payload.candidate_story.version_id, 'v2');
  assert.match(result.payload.candidate_story.notice, /不属于正式剧情/u);
  assert.deepEqual(result.payload.future_planning.future_plot, ['以后处理债务']);
});

test('completion status changes only after explicit request and can be reopened', async () => {
  const db = new FakeD1();
  db.works.push({ id: 'work-status', title: '故事', current_version_id: 'v-final', story_status: 'active',
    created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z' });
  db.versions.push({ id: 'v-final', work_id: 'work-status', status: 'adopted', operation: 'CONTINUE', title: '故事',
    content: '结局正文。', creative_brief_json: '{}', created_at: '2026-10-15T00:00:00.000Z' });
  const complete = await api(db, '/api/works/work-status/status', { method: 'POST',
    body: { story_status: 'completed', expected_current_version_id: 'v-final' } });
  assert.equal(complete.status, 200);
  assert.equal(complete.payload.work.story_status, 'completed');
  assert.equal(complete.payload.work.completed_version_id, 'v-final');
  const reopen = await api(db, '/api/works/work-status/status', { method: 'POST',
    body: { story_status: 'active', expected_current_version_id: 'v-final' } });
  assert.equal(reopen.payload.work.story_status, 'active');
  assert.equal(reopen.payload.work.completed_version_id, null);
});

test('migration 0008 is append-only and preserves migrations 0000 through 0007', async () => {
  const sql = await readFile(new URL('../drizzle/0008_text_studio_completion_and_planning.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter table `works` add `story_status`/iu);
  assert.match(sql, /create table `work_story_plans`/iu);
  assert.doesNotMatch(sql, /drop table|delete from|update versions/iu);
});

