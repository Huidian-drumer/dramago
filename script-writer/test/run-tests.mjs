import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { cases } from './fixtures/cases.mjs';
import {
  checkBatchExpression,
  LocalJsonTaskStore,
  MissingTextProvider,
  parseDraftMarkdown,
  ScriptWriter,
  validateDraft
} from '../src/index.mjs';

const drafts = [];
for (const item of cases) {
  const markdown = await readFile(new URL(`./drafts/${item.id}.md`, import.meta.url), 'utf8');
  const draft = parseDraftMarkdown(markdown);
  const report = validateDraft(draft, item.packet);
  drafts.push({ id: item.id, draft, report, packet: item.packet });
  assert.equal(report.structuralIssues.filter((issue) => issue.severity === 'blocker').length, 0, `${item.id} has structural blockers`);
  assert.ok(report.actualCharacters > 1200, `${item.id} must be a complete script rather than an outline`);
  assert.equal(report.estimatedDuration, null, 'Estimated duration must remain null without a reliable reading rate.');
}

const identity = drafts.find((item) => item.id === 'identity-fulfillment');
const identityBad = structuredClone(identity.draft);
identityBad.body = identityBad.body.replace('今晚不能停机。', '今晚不能停机。罗主任早就知道她是周芩的女儿，却假装陌生。');
const identityBadReport = validateDraft(identityBad, identity.packet);
const knowledgeIssue = identityBadReport.structuralIssues.find((issue) => issue.issue_type === 'KNOWLEDGE_BOUNDARY_VIOLATION');
assert.ok(knowledgeIssue?.location?.paragraph, 'Knowledge leak must include a precise paragraph location.');
assert.match(knowledgeIssue.quote, /罗主任早就知道/u);

const growth = drafts.find((item) => item.id === 'long-term-growth');
const growthBad = structuredClone(growth.draft);
growthBad.body = growthBad.body.replace('维修材料还在县城，等不到天亮。', '维修材料还在县城，等不到天亮。她母亲出钱找来专家，当场解决了问题。');
const growthBadReport = validateDraft(growthBad, growth.packet);
assert.ok(growthBadReport.structuralIssues.some((issue) => issue.issue_type === 'UNAPPROVED_EXTERNAL_RESCUE'), 'External rescue must be detected.');

const relation = drafts.find((item) => item.id === 'relationship-closure');
const relationBad = structuredClone(relation.draft);
relationBad.body += '\n\n就在这时，她收到一条神秘短信：父亲的秘密才刚刚开始。';
const relationBadReport = validateDraft(relationBad, relation.packet);
assert.ok(relationBadReport.structuralIssues.some((issue) => issue.issue_type === 'UNRELATED_CLIFFHANGER'), 'Unrelated cliffhanger must be detected.');

const repairedIdentity = structuredClone(identityBad);
repairedIdentity.body = repairedIdentity.body.replace('罗主任早就知道她是周芩的女儿，却假装陌生。', '');
const repairedReport = validateDraft(repairedIdentity, identity.packet);
assert.equal(repairedReport.structuralIssues.some((issue) => issue.issue_type === 'KNOWLEDGE_BOUNDARY_VIOLATION'), false);
assert.deepEqual(
  repairedReport.extracted.events.map((event) => event.eventId),
  identity.report.extracted.events.map((event) => event.eventId),
  'A local repair must not alter other required events.'
);

const batch = checkBatchExpression(drafts);
assert.equal(batch.issues.length, 0, 'Structurally different drafts must not be flagged as mechanically identical.');

for (const item of drafts) {
  const readerText = [item.draft.title, item.draft.identityOpening, item.draft.body].join('\n\n');
  assert.doesNotMatch(readerText, /\b(Beat|Gate|Schema|Reader Reward)\b|审核结论|规划说明/iu);
}

let providerFailure;
try {
  const writer = new ScriptWriter({ provider: new MissingTextProvider() });
  await writer.generate(identity.packet, { taskId: 'missing-provider' });
} catch (error) {
  providerFailure = error;
}
assert.equal(providerFailure?.code, 'PROVIDER_NOT_CONFIGURED');

const storeRoot = await mkdtemp(path.join(os.tmpdir(), 'dramaworld-writer-'));
const store = new LocalJsonTaskStore(storeRoot);
await store.save({ taskId: 'persistence-smoke', status: 'VALIDATED', draftHash: identity.report.draftHash });
const loaded = await store.load('persistence-smoke');
assert.equal(loaded.draftHash, identity.report.draftHash);
assert.equal(loaded.persistenceScope, 'LOCAL_TEST_ONLY');

console.log(JSON.stringify({
  passed: 8,
  scripts: drafts.map((item) => ({ id: item.id, hash: item.report.draftHash, actualCharacters: item.report.actualCharacters })),
  injectedIssues: [knowledgeIssue.issue_type, 'UNAPPROVED_EXTERNAL_RESCUE', 'UNRELATED_CLIFFHANGER'],
  providerFailure: providerFailure.code,
  batchComparisons: batch.comparisons
}, null, 2));
