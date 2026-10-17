import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import worker from '../dist/server/index.js';
import {
  buildProviderMessages,
  buildSemanticValidatorMessages,
  createCreativeBrief,
  normalizeStoryMemory,
  parseSemanticValidationJson,
  semanticValidationBlocks,
  storyMemoryForWriter
} from '../dist/server/core.mjs';
import { applyMigrations } from '../local/migrations.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const migrations = path.resolve('drizzle');

async function database(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-story-memory-'));
  const db = new SQLiteD1(path.join(directory, 'dramago.sqlite'));
  await applyMigrations(db, migrations);
  t.after(() => db.close());
  t.after(() => rm(directory, { recursive: true, force: true }));
  return db;
}

function environment(db) {
  return {
    DB: db,
    LOCAL_RUNTIME_INSTANCE_ID: 'story-memory-test',
    PROVIDER_TIMEOUT_MS: '10000',
    PROVIDER_CONFIG_RESOLVER: async (input = {}) => ({
      provider_id: input.provider_id || 'controlled', provider_name: 'controlled',
      endpoint: 'https://controlled.test/chat/completions', writer_model_id: input.writer_model_id || 'writer-a',
      planner_model_id: 'validator-a', validator_model_id: 'validator-a', provider_config_version: 1,
      credential_ref: 'controlled:key', ...(input.include_secret ? { api_key: 'controlled-key' } : {})
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

function providerResponse(content, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 17, completion_tokens: 23, total_tokens: 40 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function evidence(content, quote) {
  const start = content.indexOf(quote);
  assert.notEqual(start, -1, `fixture quote not found: ${quote}`);
  return [{ quote, start, end: start + quote.length }];
}

function memoryFor(content, { repaid = false } = {}) {
  const base = {
    completeness: 'available',
    characters: [{ id: 'char_aluo', name: '阿洛', identity: '离职后重新找工作的年轻人', relationships: ['向阿坤借款'],
      state: repaid ? '已还清借款' : '正在承担债务', status: repaid ? 'changed' : 'active',
      truth_status: 'objective', certainty: 'confirmed', time_context: '', evidence: evidence(content, '阿洛') }],
    events: [{ id: 'event_borrow', event: '阿洛向阿坤借款20万元', sequence: 1, causes: [], results: ['形成债务'],
      status: 'historical', truth_status: 'objective', certainty: 'confirmed', time_context: '',
      evidence: evidence(content, '阿洛向阿坤借款20万元') }],
    persistent_facts: [],
    open_threads: []
  };
  if (repaid) {
    base.events.push({ id: 'event_repay', event: '阿洛用工作收入还清借款', sequence: 2, causes: ['持续工作'], results: ['债务结清'],
      status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '三个月后',
      evidence: evidence(content, '三个月后，阿洛用工作收入还清了阿坤的20万元借款') });
    base.persistent_facts.push({ id: 'fact_debt', fact: '阿洛用工作收入还清了阿坤的20万元借款', status: 'resolved',
      truth_status: 'objective', certainty: 'confirmed', time_context: '三个月后',
      evidence: evidence(content, '三个月后，阿洛用工作收入还清了阿坤的20万元借款') });
  } else {
    base.persistent_facts.push({ id: 'fact_debt', fact: '阿洛向阿坤借款20万元', status: 'active',
      truth_status: 'objective', certainty: 'confirmed', time_context: '',
      evidence: evidence(content, '阿洛向阿坤借款20万元') });
    base.open_threads.push({ id: 'thread_repay', thread: '阿洛如何偿还借款', status: 'open',
      truth_status: 'interpretation', certainty: 'pending', time_context: '未来',
      evidence: evidence(content, '一年内偿还') });
  }
  return base;
}

function validation(candidateContent, options = {}) {
  return {
    findings: options.findings || [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: ['阿洛', '阿坤'], relationships: ['债权人与债务人'],
      irreversible_facts: [], major_events: [], time_anchors: [] },
    source_story_memory: options.sourceMemory || { completeness: 'incomplete', characters: [], events: [], persistent_facts: [], open_threads: [] },
    candidate_story_memory: memoryFor(candidateContent, { repaid: options.repaid === true })
  };
}

function documentHash(version) {
  return crypto.createHash('sha256').update(`${version.title}\n${version.content}`).digest('hex');
}

async function generate(env, workId, brief, source = null) {
  const created = await api(env, '/api/generate', { body: {
    work_id: workId,
    ...(source ? { source_hash: documentHash(source) } : {}),
    model_selection: { provider_id: 'controlled', writer_model_id: 'writer-a' },
    brief
  } });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const written = await api(env, `/api/tasks/${created.payload.task.id}/write`);
  assert.equal(written.status, 201, JSON.stringify(written.payload));
  return { task: created.payload.task, candidate: written.payload.candidate };
}

test('adopted story memory drives the next Writer, evolves after CONTINUE, and restore cannot see future memory', async (t) => {
  const db = await database(t);
  const env = environment(db);
  const originalFetch = globalThis.fetch;
  const writerPrompts = [];
  let providerCalls = 0;
  const opening = '阿洛向阿坤借款20万元。两人约定一年内偿还。\n\n阿洛离开原公司，开始寻找新的工作。';
  const repayment = '三个月后，阿洛用工作收入还清了阿坤的20万元借款。';
  globalThis.fetch = async (_url, options) => {
    providerCalls += 1;
    const request = JSON.parse(options.body);
    const system = request.messages[0].content;
    const user = JSON.parse(request.messages[1].content);
    if (system.includes('独立于 Writer 的内容一致性校验器')) {
      const content = user.candidate.content;
      return providerResponse(validation(content, { repaid: content.includes(repayment), sourceMemory: user.source_story_memory }), request.model);
    }
    writerPrompts.push(user);
    if (user.creative_brief.operation === 'CREATE') {
      return providerResponse({ output_kind: 'full', title: '借款之后', content: opening,
        change_summary: '建立借款与工作线', model_warnings: [] }, request.model);
    }
    const hasResolvedDebt = JSON.stringify(user.story_memory_context || {}).includes('还清了阿坤的20万元借款');
    return providerResponse({ output_kind: 'continuation', title: '借款之后',
      content: hasResolvedDebt ? '次日，阿洛开始处理新的生活目标。' : repayment,
      change_summary: '追加后续事件', model_warnings: [] }, request.model);
  };
  try {
    const first = await generate(env, 'memory-work', {
      operation: 'CREATE', target_scope: { type: 'full' }, user_instruction: '写一个承担债务的故事。'
    });
    const validatedFirst = await api(env, `/api/tasks/${first.task.id}/validate`);
    assert.equal(validatedFirst.status, 200, JSON.stringify(validatedFirst.payload));

    const candidateMemoryBeforeAdopt = await db.prepare('SELECT * FROM story_memory_snapshots WHERE version_id = ?')
      .bind(first.candidate.id).first();
    assert.equal(candidateMemoryBeforeAdopt, null, 'unadopted candidate must not become formal memory');
    const proposedFacts = await db.prepare('SELECT * FROM story_facts_snapshots WHERE version_id = ?')
      .bind(first.candidate.id).first();
    assert.equal(proposedFacts.extraction_status, 'proposed');

    const adoptedFirst = await api(env, '/api/versions/adopt', { body: { work_id: 'memory-work', version_id: first.candidate.id } });
    assert.equal(adoptedFirst.status, 200, JSON.stringify(adoptedFirst.payload));
    const v1 = adoptedFirst.payload.version;
    const v1MemoryRow = await db.prepare('SELECT * FROM story_memory_snapshots WHERE version_id = ?').bind(v1.id).first();
    const v1Memory = JSON.parse(v1MemoryRow.memory_json);
    assert.equal(v1MemoryRow.memory_status, 'available');
    assert.equal(v1Memory.persistent_facts[0].fact, '阿洛向阿坤借款20万元');
    assert.equal(v1Memory.persistent_facts[0].evidence[0].version_id, v1.id);
    assert.equal((await db.prepare('SELECT * FROM story_facts_snapshots WHERE version_id = ?').bind(v1.id).first()).extraction_status, 'available');

    const second = await generate(env, 'memory-work', {
      operation: 'CONTINUE', source_version_id: v1.id, target_scope: { type: 'next_segment' },
      user_instruction: '推进三个月后的生活，让债务状态发生合理变化。'
    }, v1);
    const secondWriterContext = writerPrompts.at(-1).story_memory_context;
    assert.equal(secondWriterContext.memory_completeness, 'available');
    assert.equal(secondWriterContext.confirmed_objective.persistent_facts[0].fact, '阿洛向阿坤借款20万元');
    assert.equal(second.candidate.content, `${v1.content}\n\n${repayment}`);
    const validatedSecond = await api(env, `/api/tasks/${second.task.id}/validate`);
    assert.equal(validatedSecond.status, 200, JSON.stringify(validatedSecond.payload));
    const adoptedSecond = await api(env, '/api/versions/adopt', { body: { work_id: 'memory-work', version_id: second.candidate.id } });
    assert.equal(adoptedSecond.status, 200, JSON.stringify(adoptedSecond.payload));
    const v2 = adoptedSecond.payload.version;
    const v2Memory = JSON.parse((await db.prepare('SELECT * FROM story_memory_snapshots WHERE version_id = ?').bind(v2.id).first()).memory_json);
    assert.equal(v2Memory.persistent_facts[0].status, 'resolved');
    assert.equal(JSON.parse((await db.prepare('SELECT * FROM story_memory_snapshots WHERE version_id = ?').bind(v1.id).first()).memory_json)
      .persistent_facts[0].status, 'active', 'earlier snapshot remains immutable history');

    const restored = await api(env, '/api/versions/restore', { body: {
      work_id: 'memory-work', source_version_id: v1.id, expected_current_version_id: v2.id
    } });
    assert.equal(restored.status, 201, JSON.stringify(restored.payload));
    const restoredVersion = restored.payload.version;
    const restoredMemory = JSON.parse((await db.prepare('SELECT * FROM story_memory_snapshots WHERE version_id = ?')
      .bind(restoredVersion.id).first()).memory_json);
    assert.equal(restoredMemory.persistent_facts[0].fact, '阿洛向阿坤借款20万元');
    assert.equal(restoredMemory.persistent_facts[0].evidence[0].version_id, restoredVersion.id);
    assert.equal(JSON.stringify(restoredMemory).includes('还清了阿坤的20万元借款'), false);

    const afterRestore = await generate(env, 'memory-work', {
      operation: 'CONTINUE', source_version_id: restoredVersion.id, target_scope: { type: 'next_segment' },
      user_instruction: '继续处理尚未解决的问题。'
    }, restoredVersion);
    const restoredWriterContext = writerPrompts.at(-1).story_memory_context;
    assert.equal(JSON.stringify(restoredWriterContext).includes('还清了阿坤的20万元借款'), false);
    assert.equal(afterRestore.candidate.generated_segment, repayment);
    assert.equal(providerCalls, 5, 'CREATE/validate + CONTINUE/validate + final Writer only; adopt/restore add no calls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('memory evidence verification prevents claims and guesses from becoming confirmed objective facts', () => {
  const content = '阿洛说：“我早就还清了。”但账本仍显示欠款20万元。';
  const memory = normalizeStoryMemory({
    completeness: 'available',
    characters: [], events: [], open_threads: [],
    persistent_facts: [
      { id: 'claim_paid', fact: '阿洛已经还清借款', status: 'active', truth_status: 'character_claim', certainty: 'confirmed',
        evidence: evidence(content, '我早就还清了') },
      { id: 'guess_rich', fact: '阿洛拥有大量存款', status: 'active', truth_status: 'objective', certainty: 'confirmed',
        evidence: [{ quote: '正文中不存在的证据', start: 0, end: 9 }] },
      { id: 'ledger_debt', fact: '账本仍显示欠款20万元', status: 'active', truth_status: 'objective', certainty: 'confirmed',
        evidence: evidence(content, '账本仍显示欠款20万元') }
    ]
  }, { content, versionId: 'v-claim' });
  assert.equal(memory.completeness, 'available');
  assert.equal(memory.persistent_facts.find((item) => item.id === 'claim_paid').certainty, 'pending');
  assert.equal(memory.persistent_facts.find((item) => item.id === 'guess_rich').certainty, 'pending');
  assert.equal(memory.persistent_facts.find((item) => item.id === 'ledger_debt').certainty, 'confirmed');
  const writerMemory = storyMemoryForWriter(memory);
  assert.deepEqual(writerMemory.confirmed_objective.persistent_facts.map((item) => item.id), ['ledger_debt']);
  assert.equal(writerMemory.character_claims_and_uncertain.some((item) => item.id === 'claim_paid'), true);
});

test('Validator blocks confirmed objective contradictions but not lies, misunderstandings, or explained state changes', () => {
  const source = { id: 'v1', title: '合成故事', content: '阿洛向阿坤借款20万元。两人约定一年内偿还。账本显示阿洛仍欠阿坤20万元。' };
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: 'v1', target_scope: { type: 'next_segment' },
    user_instruction: '继续故事。' });
  const sourceMemory = normalizeStoryMemory({ completeness: 'available', characters: [], events: [], open_threads: [],
    persistent_facts: [{ id: 'fact_debt', fact: '阿洛仍欠阿坤20万元', status: 'active', truth_status: 'objective',
      certainty: 'confirmed', evidence: evidence(source.content, '阿洛仍欠阿坤20万元') }] }, { content: source.content, versionId: source.id });

  const lieSegment = '阿洛对朋友撒谎：“我从来没有借过钱。”';
  const lieCandidate = { content: `${source.content}\n\n${lieSegment}`, generated_segment: lieSegment, output_kind: 'continuation', title: source.title };
  const lieFinding = {
    finding_type: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: 0.99, source_priority: 'source_version_fact',
    fact_basis: 'character_claim', memory_fact_ids: ['fact_debt'], evidence: ['阿洛仍欠阿坤20万元', '我从来没有借过钱'],
    evidence_scope: 'cross_scope', evidence_locations: [
      { source: 'source_content', quote: '阿洛仍欠阿坤20万元', start: 4, end: 15 },
      { source: 'generated_segment', quote: '我从来没有借过钱', start: 10, end: 18 }
    ], reason: '人物说法与账本不同。'
  };
  const lieValidation = parseSemanticValidationJson(JSON.stringify(validation(lieCandidate.content, { findings: [lieFinding] })));
  assert.equal(semanticValidationBlocks(lieValidation, brief, { source, candidate: lieCandidate, sourceMemory }), false);

  const contradictionSegment = '旁白确认：阿洛从未向阿坤借过钱。';
  const contradictionCandidate = { content: `${source.content}\n\n${contradictionSegment}`, generated_segment: contradictionSegment,
    output_kind: 'continuation', title: source.title };
  const contradictionFinding = {
    ...lieFinding, fact_basis: 'confirmed_objective', evidence: ['阿洛仍欠阿坤20万元', '阿洛从未向阿坤借过钱'],
    evidence_locations: [
      { source: 'source_content', quote: '阿洛仍欠阿坤20万元', start: 4, end: 15 },
      { source: 'generated_segment', quote: '阿洛从未向阿坤借过钱', start: 5, end: 16 }
    ], reason: '新增客观旁白无解释地推翻已确认借款事实。'
  };
  const contradictionValidation = parseSemanticValidationJson(JSON.stringify(validation(contradictionCandidate.content,
    { findings: [contradictionFinding] })));
  assert.equal(semanticValidationBlocks(contradictionValidation, brief,
    { source, candidate: contradictionCandidate, sourceMemory }), true);

  const growthSegment = '三个月后，阿洛用工作收入还清了阿坤的20万元借款。';
  const growthCandidate = { content: `${source.content}\n\n${growthSegment}`, generated_segment: growthSegment,
    output_kind: 'continuation', title: source.title };
  const growthValidation = parseSemanticValidationJson(JSON.stringify(validation(growthCandidate.content, { repaid: true })));
  assert.equal(semanticValidationBlocks(growthValidation, brief, { source, candidate: growthCandidate, sourceMemory }), false);
});

test('Writer context adds continuity facts without style templates and incomplete memory keeps source as fallback', () => {
  const source = { id: 'v1', title: '合成故事', content: '阿洛仍欠阿坤20万元。' };
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: source.id,
    target_scope: { type: 'next_segment' }, user_instruction: '用你擅长的风格继续故事。' });
  const complete = normalizeStoryMemory({ completeness: 'available', characters: [], events: [], open_threads: [],
    persistent_facts: [{ id: 'debt', fact: '阿洛仍欠阿坤20万元', status: 'active', truth_status: 'objective', certainty: 'confirmed',
      evidence: evidence(source.content, '阿洛仍欠阿坤20万元') }] }, { content: source.content, versionId: source.id });
  const before = buildProviderMessages({ brief, context: '', source });
  const after = buildProviderMessages({ brief, context: '', source, storyMemory: complete });
  const afterUser = JSON.parse(after.user);
  assert.equal(JSON.parse(before.user).story_memory_context, undefined);
  assert.equal(afterUser.story_memory_context.confirmed_objective.persistent_facts[0].fact, '阿洛仍欠阿坤20万元');
  assert.equal(after.system.includes('不规定文风、修辞、对白方式或剧情模板'), true);
  assert.equal(JSON.stringify(afterUser.story_memory_context).includes('固定文风'), false);

  const incomplete = buildProviderMessages({ brief, context: '', source,
    storyMemory: normalizeStoryMemory(null, { content: source.content, versionId: source.id }) });
  assert.equal(JSON.parse(incomplete.user).story_memory_context.memory_completeness, 'incomplete');
  assert.equal(JSON.parse(incomplete.user).source_version.content, source.content);

  const validator = buildSemanticValidatorMessages({ brief, source,
    candidate: { ...source, generated_segment: '第二天继续。', output_kind: 'continuation' },
    sourceFacts: null, sourceMemory: complete });
  assert.equal(validator.system.includes('人物对白、谎言、误解'), true);
  assert.equal(JSON.parse(validator.user).source_story_memory.completeness, 'available');
});

test('migration 0006 is additive, rollback-safe, and preserves a V1.1-shaped database', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dramago-story-memory-migration-'));
  const oldMigrations = path.join(directory, 'old-migrations');
  await mkdir(oldMigrations, { recursive: true });
  for (const name of ['0000_low_the_fallen.sql', '0001_kind_the_spike.sql', '0002_conscious_oracle.sql',
    '0003_transport_attempts_and_version_restores.sql', '0004_multi_provider_and_task_control.sql',
    '0005_candidate_validation_runs.sql']) {
    await writeFile(path.join(oldMigrations, name), await readFile(path.join(migrations, name)));
  }
  const db = new SQLiteD1(path.join(directory, 'legacy.sqlite'));
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  await applyMigrations(db, oldMigrations);
  await db.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind('legacy-work', '旧作品', 'legacy-v1', 't1', 't1').run();
  await db.prepare(`INSERT INTO versions
    (id, work_id, operation, status, title, content, creative_brief_json, checks_json, content_hash, can_auto_apply, adopted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind('legacy-v1', 'legacy-work', 'MANUAL_EDIT', 'adopted', '旧作品', '旧正文', '{}', '[]', 'legacy-hash', 0, 't1', 't1').run();
  const migrationResult = await applyMigrations(db, migrations);
  assert.equal(migrationResult.executed.includes('0006_story_memory_snapshots.sql'), true);
  assert.equal((await db.prepare('SELECT content FROM versions WHERE id = ?').bind('legacy-v1').first()).content, '旧正文');
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'story_memory_snapshots'").first()).count, 1);

  const brokenDirectory = path.join(directory, 'broken');
  await mkdir(brokenDirectory, { recursive: true });
  await writeFile(path.join(brokenDirectory, '0007_broken_story_memory.sql'),
    'CREATE TABLE should_rollback (id TEXT); THIS IS INVALID SQL;');
  await assert.rejects(() => applyMigrations(db, brokenDirectory), /Migration 0007_broken_story_memory\.sql failed/u);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").first()).count, 0);
  assert.equal((await db.prepare('SELECT content FROM versions WHERE id = ?').bind('legacy-v1').first()).content, '旧正文');
});
