import assert from 'node:assert/strict';
import test from 'node:test';
import { conservativeStoryMemoryView, normalizeStoryMemory, storyMemoryForWriter } from '../worker/core.mjs';
import { buildRelationshipTree } from '../worker/relationship-classifier.mjs';

function evidence(content, quote) {
  const start = content.indexOf(quote);
  assert.notEqual(start, -1);
  return [{ quote, start, end: start + quote.length }];
}

function fact(content, claim, quotes) {
  return normalizeStoryMemory({ completeness: 'available', persistent_facts: [{ id: 'f', fact: claim,
    truth_status: 'objective', certainty: 'confirmed', evidence: quotes.flatMap((quote) => evidence(content, quote)) }] },
  { content, versionId: 'synthetic-v1' }).persistent_facts[0];
}

test('principal, total repayment, negation and spoken claims require full objective evidence', () => {
  const money = '借款本金20万元，本息合计21.8万元。';
  assert.equal(fact(money, '本金21.8万元', ['本息合计21.8万元']).certainty, 'pending');
  assert.equal(fact(money, '借款本金20万元', ['借款本金20万元']).certainty, 'confirmed');
  assert.equal(fact(money, '本息合计21.8万元', ['本息合计21.8万元']).certainty, 'confirmed');
  assert.equal(fact('他没有借钱。', '他借钱', ['他没有借钱']).certainty, 'pending');
  assert.equal(fact('他没有借钱。', '借钱', ['借钱']).certainty, 'pending');
  assert.equal(fact('他没有借钱。', '他没有借钱', ['他没有借钱']).certainty, 'confirmed');
  assert.equal(fact('他说：“我没有借钱。”', '我没有借钱', ['我没有借钱']).certainty, 'pending');
});

test('complex event needs evidence for every clause, including time qualification', () => {
  const content = '林舒借款20万元。林舒签订合同。母亲三天后才知道借款。';
  const base = (event, quotes) => normalizeStoryMemory({ completeness: 'available', events: [{ id: 'e', event,
    truth_status: 'objective', certainty: 'confirmed', evidence: quotes.flatMap((quote) => evidence(content, quote)) }] },
  { content, versionId: 'synthetic-v1' }).events[0];
  assert.equal(base('林舒借款20万元、林舒签订合同', ['林舒借款20万元', '林舒签订合同']).certainty, 'confirmed');
  assert.equal(base('林舒借款20万元、林舒签订合同', ['林舒签订合同']).certainty, 'pending');
  assert.equal(base('林舒借款20万元、母亲当天知道借款', ['林舒借款20万元', '母亲三天后才知道借款']).certainty, 'pending');
  assert.equal(base('母亲三天后才知道借款', ['母亲三天后才知道借款']).certainty, 'confirmed');
  const unsupportedContext = normalizeStoryMemory({ completeness: 'available', events: [{ id: 'timed',
    event: '林舒签订合同', time_context: '当天', causes: ['因为母亲已经知情'], results: ['合同生效'],
    truth_status: 'objective', certainty: 'confirmed', evidence: evidence(content, '林舒签订合同') }] },
  { content, versionId: 'synthetic-v1' }).events[0];
  assert.equal(unsupportedContext.certainty, 'pending');
  assert.equal(unsupportedContext.time_context, '');
  assert.deepEqual(unsupportedContext.causes, []);
  assert.deepEqual(unsupportedContext.results, []);
});

test('legacy confirmed memory is read conservatively and never becomes unconditional Writer fact', () => {
  const legacy = { schema_version: 'story-memory-v1', completeness: 'available', characters: [], events: [],
    persistent_facts: [{ id: 'f', fact: '本金21.8万元', truth_status: 'objective', certainty: 'confirmed', evidence: [] }],
    open_threads: [] };
  const view = conservativeStoryMemoryView(legacy);
  assert.equal(view.persistent_facts[0].certainty, 'pending');
  assert.equal(view.completeness, 'incomplete');
  assert.equal(storyMemoryForWriter(legacy).confirmed_objective.persistent_facts.length, 0);
  assert.equal(storyMemoryForWriter(view).character_claims_and_uncertain[0].fact, '本金21.8万元');
});

function tree(content, characters) {
  return buildRelationshipTree({ provenance: { version_id: 'synthetic-v1', content_hash: 'synthetic-hash' },
    characters: [{ id: 'p', name: '林舒', identity: '主角', truth_status: 'objective', certainty: 'confirmed' },
      ...characters.map((item, index) => ({ id: `c${index}`, truth_status: 'objective', certainty: 'confirmed', ...item }))],
    events: [] }, content);
}

test('second-person and third-person family relations are classified without name-specific rules', () => {
  const second = tree('你的母亲林月来接你。你的父亲陈建国在门口等你。',
    [{ name: '林月' }, { name: '陈建国' }]);
  assert.deepEqual(second.groups.family.map((item) => item.name), ['林月', '陈建国']);
  const third = tree('林舒的母亲林月来接她。林舒的父亲陈建国在门口等她。',
    [{ name: '林月' }, { name: '陈建国' }]);
  assert.deepEqual(third.groups.family.map((item) => item.name), ['林月', '陈建国']);
});

test('dialogue, negation, changed relations, aliases and ambiguous names remain conservative', () => {
  assert.equal(tree('林月说：“你的父亲陈建国来接你。”', [{ name: '陈建国' }]).groups.family.length, 0);
  assert.equal(tree('林舒不是陈建国的女儿。', [{ name: '陈建国' }]).groups.family.length, 0);
  assert.equal(tree('陈建国曾是你的父亲。', [{ name: '陈建国' }]).groups.family.length, 0);
  assert.equal(tree('你的父亲陈建国来接你。', [{ name: '陈建国', aliases: ['老陈'] }]).groups.family.length, 1);
  assert.equal(tree('你的父亲老陈来接你。', [{ name: '陈建国', aliases: ['老陈'] }, { name: '陈明', aliases: ['老陈'] }]).groups.family.length, 0);
  assert.equal(tree('陈建国站在门口。', [{ name: '陈建国' }]).groups.family.length, 0);
});
