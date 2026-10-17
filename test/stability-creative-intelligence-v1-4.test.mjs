import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import worker from '../dist/server/index.js';
import { FakeD1 } from '../audit/fake-d1.mjs';
import { createLocalRuntime } from '../local/server.mjs';
import { MemorySecretStore } from '../local/secure-config.mjs';
import { normalizeStoryMemory, parseSemanticValidationJson, semanticValidationBlocks, semanticValidationFindings, sha256 } from '../worker/core.mjs';

async function fakeApi(db, route, body = null) {
  const response = await worker.fetch(new Request(`https://workbench.test${route}`, {
    method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  }), { DB: db });
  return { status: response.status, payload: await response.json() };
}

function validatorPayload(languageFindings = [], findings = []) {
  return JSON.stringify({
    findings, blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] },
    operation_completed: true,
    language_quality: { findings: languageFindings },
    source_story_facts: {}, candidate_story_facts: {},
    source_story_memory: { completeness: 'incomplete', characters: [], events: [], persistent_facts: [], open_threads: [] },
    candidate_story_memory: { completeness: 'incomplete', characters: [], events: [], persistent_facts: [], open_threads: [] }
  });
}

test('blank work is named and persisted without a fake version, validation or story memory', async () => {
  const db = new FakeD1();
  const created = await fakeApi(db, '/api/works', { title: '空白新作' });
  assert.equal(created.status, 201);
  assert.equal(created.payload.work.title, '空白新作');
  assert.equal(created.payload.work.current_version_id, null);
  assert.equal(db.versions.length, 0);
  assert.equal(db.validationRuns.length, 0);
  assert.equal(db.storyMemory.length, 0);
  const renamed = await fakeApi(db, `/api/works/${created.payload.work.id}/rename`, { title: '后来改名' });
  assert.equal(renamed.status, 200);
  assert.equal(db.works[0].title, '后来改名');
});

test('SQLite draft binds work, operation, source and identity and rejects an older write after restart', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dramago-v14-draft-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let runtime = await createLocalRuntime({ port: 0, dataRoot: root, disableLock: true, secretStore: new MemorySecretStore() });
  let info = await runtime.listen();
  const headers = { 'content-type': 'application/json', origin: info.url.replace(/\/$/u, ''), 'x-dramago-local-token': info.token };
  const post = (route, value) => fetch(`${info.url.replace(/\/$/u, '')}${route}`, { method: 'POST', headers, body: JSON.stringify(value) });
  const blank = await (await post('/api/works', { title: '草稿隔离测试' })).json();
  const workId = blank.work.id;
  const first = await post('/api/local/draft', { work_id: workId, operation: 'CONTINUE', draft_id: 'draft-fixed',
    source_version_id: 'V5', title: '草稿隔离测试', body: '正式正文尚未保存的修改', instruction: '从第二天开始续写',
    form: { targetLength: '2000' }, revision: 2 });
  assert.equal(first.status, 200);
  await runtime.close();

  runtime = await createLocalRuntime({ port: 0, dataRoot: root, disableLock: true, secretStore: new MemorySecretStore() });
  info = await runtime.listen();
  const nextHeaders = { 'content-type': 'application/json', origin: info.url.replace(/\/$/u, ''), 'x-dramago-local-token': info.token };
  const loaded = await (await fetch(`${info.url}api/local/draft?work_id=${workId}&operation=CONTINUE`, { headers: nextHeaders })).json();
  assert.equal(loaded.operation_draft.instruction, '从第二天开始续写');
  assert.equal(loaded.operation_draft.source_version_id, 'V5');
  assert.equal(loaded.operation_draft.draft_id, 'draft-fixed');
  assert.equal(loaded.edit_draft.body, '正式正文尚未保存的修改');
  const stale = await fetch(`${info.url}api/local/draft`, { method: 'POST', headers: nextHeaders, body: JSON.stringify({
    work_id: workId, operation: 'CONTINUE', source_version_id: 'V5', title: '旧写入', body: '旧内容', instruction: '旧指令', revision: 1
  }) });
  assert.equal(stale.status, 409);
  const rewrite = await (await fetch(`${info.url}api/local/draft?work_id=${workId}&operation=REWRITE`, { headers: nextHeaders })).json();
  assert.equal(rewrite.operation_draft, null);
  await runtime.close();
});

test('language quality distinguishes explicit errors, ambiguous phrases and style suggestions without blocking', () => {
  const candidate = '你拿外公留给你的地去想。\n这是你外公留给你我的。\n行业里传开了5开了。';
  const cases = [
    ['readability', 'awkward_collocation', '你拿外公留给你的地去想。', true],
    ['explicit_language_error', 'pronoun_ambiguity', '这是你外公留给你我的。', true],
    ['explicit_language_error', 'typo', '行业里传开了5开了。', false],
    ['literary_style_suggestion', 'rhythm', '你拿外公留给你的地去想。', true]
  ].map(([category, issue_type, evidence, needs_human_judgment]) => ({
    category, issue_type, severity: category === 'explicit_language_error' ? 'error' : category === 'readability' ? 'warning' : 'suggestion',
    confidence: issue_type === 'typo' ? .99 : .76, evidence,
    location: { source: 'candidate_content', quote: evidence, start: candidate.indexOf(evidence), end: candidate.indexOf(evidence) + evidence.length },
    explanation: `受控测试：${issue_type}`, suggestion: '请作者结合上下文复核', needs_human_judgment
  }));
  const validation = parseSemanticValidationJson(validatorPayload(cases));
  assert.equal(validation.languageQuality.length, 4);
  assert.equal(validation.languageQuality[2].issueType, 'typo');
  assert.equal(semanticValidationBlocks(validation, null, { candidate: { content: candidate } }), false);
  const checks = semanticValidationFindings(validation, {}, null, { candidate: { content: candidate } });
  assert.equal(checks.filter((item) => item.finding_type === 'language_quality').length, 4);
  assert.equal(checks.filter((item) => item.finding_type === 'language_quality').every((item) => item.status === 'warning'), true);
});

test('normal rhetoric control does not require a language finding and fact conflicts stay semantic', () => {
  const factConflict = { finding_type: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: .98,
    source_priority: 'source_version_fact', fact_basis: 'confirmed_objective', memory_fact_ids: [],
    evidence: ['土地已登记在林川名下', '土地其实仍在外公名下'], evidence_scope: 'cross_scope',
    evidence_locations: [{ source: 'source_content', quote: '土地已登记在林川名下', start: 0, end: 11 },
      { source: 'candidate_content', quote: '土地其实仍在外公名下', start: 13, end: 24 }], reason: '无解释地推翻产权事实' };
  const validation = parseSemanticValidationJson(validatorPayload([], [factConflict]));
  assert.equal(validation.languageQuality.length, 0);
  assert.equal(validation.findings[0].findingType, 'STORY_FACT_CONFLICT');
});

test('memory feedback overlays current adopted snapshot, preserves source snapshot and builds evidence-only relationship tree', async () => {
  const db = new FakeD1();
  const content = '林川向阿坤借了二十万元。周磊是林川的同事。';
  const hash = await sha256(content);
  db.works.push({ id: 'memory-work', title: '合成故事', current_version_id: 'V3', story_status: 'active', created_at: 't', updated_at: 't' });
  db.versions.push({ id: 'V3', work_id: 'memory-work', status: 'adopted', operation: 'CREATE', title: '合成故事', content,
    content_hash: hash, creative_brief_json: '{}', created_at: '2026-10-15T00:00:00.000Z' });
  db.storyMemory.push({ id: 'M3', work_id: 'memory-work', version_id: 'V3', content_hash: hash, memory_status: 'available',
    extraction_source: 'semantic_validator', memory_json: JSON.stringify(normalizeStoryMemory({ completeness: 'available', characters: [
      { id: 'lin', name: '林川', identity: '主角', relationships: [], state: '', truth_status: 'objective', certainty: 'confirmed', evidence: [{ quote: '林川', start: 0, end: 2, version_id: 'V3' }] },
      { id: 'akun', name: '阿坤', identity: '债权人', relationships: ['林川向阿坤借款'], state: '', truth_status: 'objective', certainty: 'confirmed', evidence: [{ quote: '阿坤', start: 3, end: 5, version_id: 'V3' }] },
      { id: 'zhou', name: '周磊', identity: '同事', relationships: ['林川的同事'], state: '', truth_status: 'objective', certainty: 'confirmed', evidence: [{ quote: '周磊', start: 14, end: 16, version_id: 'V3' }] }
    ], events: [], persistent_facts: [], open_threads: [] }, { content, versionId: 'V3' })), created_at: '2026-10-15T00:00:00.000Z', updated_at: '2026-10-15T00:00:00.000Z' });
  const feedback = await fakeApi(db, '/api/works/memory-work/memory-feedback', { version_id: 'V3', memory_item_id: 'akun', action: 'mark_uncertain' });
  assert.equal(feedback.status, 201);
  const overview = await fakeApi(db, '/api/works/memory-work/overview');
  assert.equal(overview.payload.formal_story.characters.find((item) => item.id === 'akun').certainty, 'pending');
  assert.equal(overview.payload.relationship_tree.groups.unconfirmed[0].name, '阿坤');
  assert.equal(overview.payload.relationship_tree.groups.unconfirmed[0].relationship_edges[0].certainty, 'pending');
  assert.equal(overview.payload.relationship_tree.groups.work[0].name, '周磊');
  assert.equal(JSON.parse(db.storyMemory[0].memory_json).characters.find((item) => item.id === 'akun').certainty, 'confirmed');
});

test('synthetic 一日倾覆-equivalent relationship tree uses only adopted memory and does not invent friendship', async () => {
  const db = new FakeD1();
  const content = '林舒的母亲林月来接她。陈建国是林舒的父亲。林舒向阿坤借了二十万元。刘哥是林舒的工作搭档。周磊是林舒多年的朋友。小孟在公司见到林舒，但两人关系尚未说明。';
  const hash = await sha256(content);
  const evidence = (quote, version_id = 'V3') => [{ quote, start: content.indexOf(quote), end: content.indexOf(quote) + quote.length, version_id }];
  db.works.push({ id: 'synthetic-fall', title: '一日倾覆·合成等价案例', current_version_id: 'V3', story_status: 'active' });
  db.versions.push({ id: 'V3', work_id: 'synthetic-fall', status: 'adopted', operation: 'CREATE', title: '合成等价案例', content,
    content_hash: hash, created_at: '2026-10-15T00:00:00.000Z' });
  db.versions.push({ id: 'V6', work_id: 'synthetic-fall', parent_version_id: 'V3', status: 'candidate', operation: 'CONTINUE',
    title: '未采用候选', content: `${content}刘哥成了家人。`, content_hash: await sha256(`${content}刘哥成了家人。`), created_at: '2026-10-15T01:00:00.000Z' });
  const characters = [
    { id: 'lin', name: '林舒', identity: '主角', relationships: [], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('林舒') },
    { id: 'liu', name: '刘哥', identity: '债权人', relationships: ['林舒向刘哥借款二十万元'], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('刘哥') },
    { id: 'zhou', name: '周磊', identity: '同事', relationships: ['林舒的同事'], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('周磊') },
    { id: 'mother', name: '林月', identity: '母亲', relationships: ['林舒的母亲'], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('林月') },
    { id: 'father', name: '陈建国', identity: '父亲', relationships: ['林舒的父亲'], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('陈建国') },
    { id: 'akun', name: '阿坤', identity: '借款对象', relationships: ['林舒向阿坤借钱'], certainty: 'confirmed', truth_status: 'objective', evidence: evidence('阿坤') },
    { id: 'meng', name: '小孟', identity: '身份待确认', relationships: [], certainty: 'pending', truth_status: 'interpretation', evidence: evidence('小孟') }
  ];
  db.storyMemory.push({ id: 'M3', work_id: 'synthetic-fall', version_id: 'V3', content_hash: hash, memory_status: 'available',
    extraction_source: 'semantic_validator', memory_json: JSON.stringify(normalizeStoryMemory({ completeness: 'available', characters,
      events: [], persistent_facts: [], open_threads: [] }, { content, versionId: 'V3' })), created_at: '2026-10-15T00:00:00.000Z' });
  const result = await fakeApi(db, '/api/works/synthetic-fall/overview');
  assert.equal(result.status, 200);
  const tree = result.payload.relationship_tree;
  assert.equal(tree.protagonist.name, '林舒');
  assert.deepEqual(tree.groups.interest_debt.map((item) => item.name), ['阿坤']);
  assert.deepEqual(tree.groups.work.map((item) => item.name), ['刘哥']);
  assert.deepEqual(tree.groups.friends.map((item) => item.name), ['周磊']);
  assert.deepEqual(tree.groups.family.map((item) => item.name), ['林月', '陈建国']);
  assert.deepEqual(tree.groups.unconfirmed.map((item) => item.name), ['小孟']);
  assert.equal(tree.source_version_id, 'V3');
  assert.equal(tree.groups.work[0].primary_relationship.relationship_type, 'work');
  assert.equal(tree.groups.friends[0].primary_relationship.relationship_type, 'friends');
  assert.equal(tree.groups.work[0].primary_relationship.evidence.quote.includes('工作搭档'), true);
});

test('migration 0009 is additive and contains no destructive data operations', async () => {
  const sql = await readFile(new URL('../drizzle/0009_stability_and_creative_intelligence.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table `work_edit_drafts`/iu);
  assert.match(sql, /create table `story_memory_annotations`/iu);
  assert.doesNotMatch(sql, /drop table|delete from|update works|update versions/iu);
});
