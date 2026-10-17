import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProviderMessages, conservativeStoryMemoryView, createCreativeBrief,
  normalizeStoryMemory, storyMemoryForWriter
} from '../dist/server/core.mjs';

const sourceVersion = 'synthetic-adopted-v1';

function proposal(content, fact, status, { truth = 'objective', time = '', quote = fact } = {}) {
  const start = content.indexOf(quote);
  assert.ok(start >= 0, 'synthetic evidence must be in the adopted source');
  return { id: 'state_under_test', fact, status, truth_status: truth,
    certainty: 'confirmed', time_context: time,
    evidence: [{ quote, start, end: start + quote.length }] };
}

function evaluate(content, entries, versionId = sourceVersion) {
  const memory = normalizeStoryMemory({ completeness: 'available', characters: [], events: [],
    persistent_facts: entries, open_threads: [] }, { content, versionId });
  const writer = storyMemoryForWriter(memory);
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: versionId,
    target_scope: { type: 'next_segment' }, user_instruction: '继续故事。' });
  const prompt = buildProviderMessages({ brief, context: {}, source: { id: versionId, title: '合成故事', content },
    storyMemory: memory });
  const actualWriter = JSON.parse(prompt.user).story_memory_context;
  assert.deepEqual(actualWriter, writer, 'actual Writer message must receive the checked memory view');
  for (const item of memory.persistent_facts) {
    assert.equal(item.evidence[0]?.version_id, versionId);
    assert.ok(item.evidence[0]?.quote);
    assert.equal(content.slice(item.evidence[0].start, item.evidence[0].end), item.evidence[0].quote);
  }
  return { memory, writer: actualWriter };
}

test('A: a model-reported resolution cannot settle an objectively outstanding debt', () => {
  const content = '林川仍欠阿坤20万元。';
  const { memory, writer } = evaluate(content, [proposal(content, '林川仍欠阿坤20万元', 'resolved')]);
  assert.equal(memory.persistent_facts[0].certainty, 'confirmed');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts[0].fact, '林川仍欠阿坤20万元');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'unknown');
});

test('B: an objectively narrated complete repayment can establish resolution', () => {
  const content = '三个月后，林川还清了阿坤的20万元借款。';
  const { memory, writer } = evaluate(content, [proposal(content, '林川还清了阿坤的20万元借款', 'resolved',
    { time: '三个月后', quote: content })]);
  assert.equal(memory.persistent_facts[0].status_support, 'verified');
  assert.equal(memory.persistent_facts[0].status, 'resolved');
  assert.equal(memory.persistent_facts[0].time_context, '三个月后');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'resolved');
});

test('C: partial repayment does not establish complete settlement', () => {
  const content = '林川只偿还部分借款，剩余欠款仍在。';
  const { memory, writer } = evaluate(content, [proposal(content, '林川只偿还部分借款', 'resolved', { quote: content })]);
  assert.equal(memory.persistent_facts[0].certainty, 'confirmed');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'unknown');
});

test('D: character speech cannot become objective resolution', () => {
  const content = '林川说：“我已还清全部借款。”账本没有确认这笔款项。';
  const { memory, writer } = evaluate(content, [proposal(content, '我已还清全部借款', 'resolved',
    { truth: 'character_claim', quote: '我已还清全部借款' })]);
  assert.equal(memory.persistent_facts[0].certainty, 'pending');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts.length, 0);
  const attributed = '林川说自己已经还清了借款，但账本没有确认。';
  const reported = evaluate(attributed, [proposal(attributed, '林川说自己已经还清了借款', 'resolved')]);
  assert.equal(reported.memory.persistent_facts[0].status, 'unknown');
});

test('negated completion cannot be verified as resolved', () => {
  const content = '林川并非还清了这笔借款。';
  const { memory, writer } = evaluate(content, [proposal(content, '林川并非还清了这笔借款', 'resolved')]);
  assert.equal(memory.persistent_facts[0].certainty, 'confirmed');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'unknown');
});

test('E: past debt and later full repayment remain distinct time-bound facts', () => {
  const content = '过去，林川欠阿坤20万元。三个月后，林川还清了阿坤的20万元借款。';
  const entries = [proposal(content, '过去林川欠阿坤20万元', 'historical', { quote: '过去，林川欠阿坤20万元' }),
    proposal(content, '林川还清了阿坤的20万元借款', 'resolved', { time: '三个月后', quote: '三个月后，林川还清了阿坤的20万元借款' })];
  const { memory, writer } = evaluate(content, entries);
  assert.deepEqual(memory.persistent_facts.map((item) => item.status), ['historical', 'resolved']);
  assert.deepEqual(writer.confirmed_objective.persistent_facts.map((item) => item.status), ['historical', 'resolved']);
});

test('F: settlement of an old debt cannot assert that no new debt exists', () => {
  const content = '林川还清了旧借款。后来，林川又向周磊借款5万元。';
  const entries = [proposal(content, '林川还清了旧借款', 'resolved'),
    proposal(content, '林川又向周磊借款5万元', 'active')];
  const { memory, writer } = evaluate(content, entries);
  assert.equal(memory.persistent_facts[0].status, 'unknown', 'later debt makes an unqualified current-state inference unsafe');
  assert.equal(memory.persistent_facts[1].certainty, 'confirmed');
  assert.equal(writer.confirmed_objective.persistent_facts[1].fact, '林川又向周磊借款5万元');
  assert.notEqual(writer.confirmed_objective.persistent_facts[1].status, 'resolved');
});

test('G: estranged friends are not proven to have ended their relationship', () => {
  const content = '林川和周磊渐渐疏远。';
  const { memory, writer } = evaluate(content, [proposal(content, '林川和周磊渐渐疏远', 'resolved')]);
  assert.equal(memory.persistent_facts[0].certainty, 'confirmed');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'unknown');
});

test('H: old snapshots lose unsupported state only in the read view', () => {
  const content = '林川仍欠阿坤20万元。';
  const { memory } = evaluate(content, [proposal(content, '林川仍欠阿坤20万元', 'active')]);
  const legacy = structuredClone(memory);
  legacy.persistent_facts[0].status = 'resolved';
  delete legacy.persistent_facts[0].status_policy_version;
  delete legacy.persistent_facts[0].status_support;
  const original = JSON.stringify(legacy);
  const readView = conservativeStoryMemoryView(legacy);
  assert.equal(JSON.stringify(legacy), original, 'history is immutable');
  assert.equal(readView.persistent_facts[0].certainty, 'confirmed', 'verified fact survives');
  assert.equal(readView.persistent_facts[0].status, 'unknown');
  assert.equal(storyMemoryForWriter(legacy).confirmed_objective.persistent_facts[0].status, 'unknown');
});

test('an explicit author state correction remains separate from objective evidence', () => {
  const content = '林川仍欠阿坤20万元。';
  const { memory } = evaluate(content, [proposal(content, '林川仍欠阿坤20万元', 'resolved')]);
  const correctedView = conservativeStoryMemoryView(memory);
  correctedView.persistent_facts[0].status = 'resolved';
  correctedView.persistent_facts[0].status_provenance = 'author_corrected';
  correctedView.persistent_facts[0].author_review = 'author_corrected';
  correctedView.persistent_facts[0].annotation_id = 'synthetic-annotation';
  const writer = storyMemoryForWriter(correctedView);
  assert.equal(writer.confirmed_objective.persistent_facts.length, 0);
  assert.equal(writer.author_confirmed_corrections[0].status, 'resolved');
  assert.equal(writer.author_confirmed_corrections[0].status_provenance, 'author_corrected');
  assert.equal(memory.persistent_facts[0].status, 'unknown', 'source snapshot remains unchanged');
});

test('I: an unadopted proposal is not passed to the next Writer', () => {
  const adopted = '林川仍欠阿坤20万元。';
  const candidate = `${adopted}后来，林川还清了阿坤的20万元借款。`;
  const adoptedMemory = evaluate(adopted, [proposal(adopted, '林川仍欠阿坤20万元', 'active')], 'adopted-v1').memory;
  const candidateMemory = evaluate(candidate, [proposal(candidate, '林川还清了阿坤的20万元借款', 'resolved')], 'candidate-v2').memory;
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: 'adopted-v1',
    target_scope: { type: 'next_segment' }, user_instruction: '继续故事。' });
  const actual = JSON.parse(buildProviderMessages({ brief, context: {},
    source: { id: 'adopted-v1', title: '合成故事', content: adopted }, storyMemory: adoptedMemory }).user).story_memory_context;
  assert.equal(JSON.stringify(actual).includes('还清'), false);
  assert.equal(candidateMemory.persistent_facts[0].status, 'resolved', 'candidate proposal can exist without becoming formal memory');
});

test('J: complex unresolved expressions remain unknown rather than invented', () => {
  const content = '林川说债务似乎告一段落，账本却仍留有未核清的一笔。';
  const { memory, writer } = evaluate(content, [proposal(content, '账本却仍留有未核清的一笔', 'resolved')]);
  assert.equal(memory.persistent_facts[0].certainty, 'confirmed');
  assert.equal(memory.persistent_facts[0].status, 'unknown');
  assert.equal(writer.confirmed_objective.persistent_facts[0].status, 'unknown');
});
