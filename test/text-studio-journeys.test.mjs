import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import worker from '../dist/server/index.js';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';
import { applyMigrations } from '../local/migrations.mjs';
import { sha256 } from '../worker/core.mjs';

function response(content, model) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 } }), { status: 200 });
}

function memoryFor(content) {
  const quote = String(content || '').slice(0, Math.min(12, String(content || '').length));
  return { completeness: quote ? 'available' : 'incomplete', characters: [], persistent_facts: [], open_threads: [],
    events: quote ? [{ id: 'current_event', event: '当前正式剧情节点', sequence: 1, causes: [], results: [], status: 'active',
      truth_status: 'objective', certainty: 'confirmed', time_context: '当前', evidence: [{ quote, start: 0, end: quote.length }] }] : [] };
}

function validationFor(user) {
  const candidate = user.candidate?.content || '';
  const source = user.source_version?.content || '';
  return { findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    source_story_memory: memoryFor(source), candidate_story_memory: memoryFor(candidate) };
}

async function call(env, route, body = undefined) {
  const responseValue = await worker.fetch(new Request(`https://workbench.test${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env);
  return { status: responseValue.status, payload: await responseValue.json() };
}

async function generateAdopt(env, { workId = null, source = null, operation, instruction, targetScope,
  writerContent, writerTitle = '合成作品', endingIntent = null }) {
  env.nextWriter = { output_kind: operation === 'CONTINUE' ? 'continuation'
    : targetScope?.type === 'selection' ? 'segment' : 'full', title: writerTitle,
  content: writerContent, change_summary: '受控生成', model_warnings: [] };
  const brief = { operation, source_version_id: source?.id || null, target_scope: targetScope,
    user_instruction: instruction, ending_intent: endingIntent,
    output_preferences: { target_length: Math.max(20, [...writerContent].length), person: '第二人称', tone: '克制' } };
  const created = await call(env, '/api/generate', { work_id: workId, context: '', brief,
    source_hash: source ? await sha256(`${source.title}\n${source.content}`) : null });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const written = await call(env, `/api/tasks/${created.payload.task.id}/write`, {});
  assert.equal(written.status, 201, JSON.stringify(written.payload));
  const validated = await call(env, `/api/tasks/${created.payload.task.id}/validate`, {});
  assert.equal(validated.status, 200, JSON.stringify(validated.payload));
  const adopted = await call(env, '/api/versions/adopt', { work_id: created.payload.work_id,
    version_id: validated.payload.candidate.id });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.payload));
  return { workId: created.payload.work_id, version: adopted.payload.version };
}

test('complete controlled text-studio journey preserves contracts through ending and explicit completion', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dramago-v13-journey-'));
  const db = new SQLiteD1(path.join(root, 'journey.sqlite'));
  await applyMigrations(db, path.resolve('drizzle'));
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  const originalFetch = globalThis.fetch;
  const calls = [];
  const env = { DB: db, OPENAI_API_KEY: 'controlled-not-real', OPENAI_MODEL: 'writer-a',
    VALIDATOR_MODEL: 'validator-b', OPENAI_ENDPOINT: 'https://controlled.invalid/chat/completions', nextWriter: null };
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const system = body.messages[0].content;
    const user = JSON.parse(body.messages[1].content);
    const role = system.includes('独立于 Writer') ? 'validator' : 'writer';
    calls.push({ role, model: body.model, operation: user.creative_brief?.operation || null });
    return role === 'validator' ? response(validationFor(user), 'validator-b') : response(env.nextWriter, 'writer-a');
  };
  try {
    const created = await generateAdopt(env, { operation: 'CREATE', instruction: '生成初稿。', targetScope: { type: 'full' },
      writerContent: '林川拥有产权清晰的土地。他仍背负债务。' });
    const rewriteText = '产权已经核验清楚';
    const rewriteStart = created.version.content.indexOf('产权清晰');
    const rewritten = await generateAdopt(env, { workId: created.workId, source: created.version, operation: 'REWRITE',
      instruction: '改写产权表述。', targetScope: { type: 'selection', start: rewriteStart,
        end: rewriteStart + '产权清晰'.length, selected_text: '产权清晰' }, writerContent: rewriteText });
    assert.match(rewritten.version.content, /产权已经核验清楚/u);
    const debtStart = rewritten.version.content.indexOf('他仍背负债务。');
    const expanded = await generateAdopt(env, { workId: created.workId, source: rewritten.version, operation: 'EXPAND',
      instruction: '扩写承担债务。', targetScope: { type: 'selection', start: debtStart,
        end: debtStart + '他仍背负债务。'.length, selected_text: '他仍背负债务。' }, writerContent: '他仍背负债务，并开始逐笔记录还款。' });
    const continued = await generateAdopt(env, { workId: created.workId, source: expanded.version, operation: 'CONTINUE',
      instruction: '从第二天继续。', targetScope: { type: 'next_segment' }, writerContent: '第二天，他主动联系债权人。',
      writerTitle: '第二集：清晨' });
    assert.equal(continued.version.title, '合成作品');
    assert.equal(continued.version.segment_title, '第二集：清晨');
    assert.ok(continued.version.content.startsWith(expanded.version.content));
    const finalSentence = '往后的路，他决定自己走。';
    const ended = await generateAdopt(env, { workId: created.workId, source: continued.version, operation: 'CONTINUE',
      instruction: '按指定结局收尾。', targetScope: { type: 'next_segment' },
      endingIntent: { mode: 'specified_ending', requirements: '处理债务并保留选择权。', exact_final_sentence: finalSentence },
      writerContent: `他与债权人达成了分期安排。${finalSentence}`, writerTitle: '尾声' });
    assert.equal(ended.version.checks.find((item) => item.check === 'EXACT_FINAL_SENTENCE').status, 'pass');
    const beforeStatus = await call(env, `/api/works/${created.workId}/overview`);
    assert.equal(beforeStatus.payload.work.story_status, 'active');
    const completed = await call(env, `/api/works/${created.workId}/status`, {
      story_status: 'completed', expected_current_version_id: ended.version.id
    });
    assert.equal(completed.payload.work.story_status, 'completed');
    const overview = await call(env, `/api/works/${created.workId}/overview`);
    assert.equal(overview.payload.formal_story.version_id, ended.version.id);
    assert.equal(overview.payload.candidate_story, null);
    assert.equal(calls.filter((item) => item.role === 'writer').length, 5);
    assert.equal(calls.filter((item) => item.role === 'validator').length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

