import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRelationshipTree } from '../worker/relationship-classifier.mjs';

function tree(content, people, options = {}) {
  const protagonistName = options.protagonistName || '林舒';
  const characters = [
    { id: 'root', name: protagonistName, identity: '主角', certainty: 'confirmed', truth_status: 'objective' },
    ...people.map((person, index) => ({ id: `person-${index}`, certainty: 'confirmed',
      truth_status: 'objective', ...person }))
  ];
  return buildRelationshipTree({ characters, events: [], provenance: {
    version_id: 'adopted-V3', content_hash: 'synthetic-hash', ...options
  } }, content);
}

test('adopted synthetic story classifies five roles from explicit relation evidence, not stale memory labels', () => {
  const result = tree('林舒的母亲林月来接她。陈建国是林舒的父亲。林舒向阿坤借了二十万元。刘哥是林舒的工作搭档。周磊是林舒多年的朋友。', [
    { name: '林月' }, { name: '陈建国' }, { name: '阿坤', identity: '工作伙伴' },
    { name: '刘哥', identity: '债权人', relationships: ['债务关系'] },
    { name: '周磊', identity: '同事', relationships: ['工作关系'] }
  ]);
  assert.deepEqual(result.groups.family.map((item) => item.name), ['林月', '陈建国']);
  assert.deepEqual(result.groups.interest_debt.map((item) => item.name), ['阿坤']);
  assert.deepEqual(result.groups.work.map((item) => item.name), ['刘哥']);
  assert.deepEqual(result.groups.friends.map((item) => item.name), ['周磊']);
  for (const group of ['family', 'friends', 'work', 'interest_debt']) for (const item of result.groups[group]) {
    assert.equal(item.primary_relationship.subject_name, '林舒');
    assert.equal(item.primary_relationship.object_name, item.name);
    assert.equal(item.primary_relationship.source_version_id, 'adopted-V3');
    assert.ok(item.primary_relationship.evidence.quote);
    assert.equal(item.primary_relationship.certainty, 'confirmed');
  }
});

test('same workplace scene does not imply a work relationship', () => {
  const result = tree('林舒在公司门口见到了小孟。', [{ name: '小孟' }]);
  assert.deepEqual(result.groups.work, []);
  assert.equal(result.groups.unconfirmed[0].name, '小孟');
});

test('a loan is a debt association but does not invent a professional lender occupation', () => {
  const result = tree('林舒向阿坤借了二十万元。', [{ name: '阿坤', identity: '职业待确认' }]);
  const edge = result.groups.interest_debt[0].primary_relationship;
  assert.equal(edge.relationship_type, 'interest_debt');
  assert.equal(edge.label, '债务／利益关联');
  assert.doesNotMatch(edge.label, /职业|放贷|债权人/u);
});

test('a character claim and negated kinship are not objective family facts', () => {
  const result = tree('阿坤谎称自己是林舒的哥哥。林舒说阿坤不是她的哥哥。', [{ name: '阿坤' }]);
  assert.deepEqual(result.groups.family, []);
  assert.equal(result.groups.unconfirmed[0].name, '阿坤');
});

test('multiple relations keep explicit primary and secondary roles', () => {
  const result = tree('刘哥主要是林舒的工作搭档，也是林舒多年的朋友。', [{ name: '刘哥' }]);
  const item = result.groups.work[0];
  assert.equal(item.primary_relationship.relationship_type, 'work');
  assert.deepEqual(item.secondary_relationships.map((edge) => edge.relationship_type), ['friends']);
});

test('an alias may identify the person, but absent evidence remains unconfirmed', () => {
  const positive = tree('老刘是林舒的工作搭档。', [{ name: '刘哥', aliases: ['老刘'] }]);
  assert.equal(positive.groups.work[0].name, '刘哥');
  const negative = tree('林舒在门口等人。', [{ name: '小孟', identity: '同事' }]);
  assert.equal(negative.groups.unconfirmed[0].name, '小孟');
});

test('a relation in another clause is not attributed to a bystander', () => {
  const result = tree('林舒和刘哥在公司见到了周磊，周磊是林舒多年的朋友。', [
    { name: '刘哥' }, { name: '周磊' }
  ]);
  assert.equal(result.groups.unconfirmed[0].name, '刘哥');
  assert.equal(result.groups.friends[0].name, '周磊');
});

test('an explicitly named relative in the same clause does not make a bystander family', () => {
  const result = tree('林舒的母亲林月与阿坤谈话。', [{ name: '林月' }, { name: '阿坤' }]);
  assert.equal(result.groups.family[0].name, '林月');
  assert.equal(result.groups.unconfirmed[0].name, '阿坤');
});

test('a relation links to an event only when its evidence belongs to the same adopted text span', () => {
  const content = '刘哥是林舒的工作搭档。';
  const result = buildRelationshipTree({ characters: [
    { id: 'root', name: '林舒', identity: '主角', certainty: 'confirmed', truth_status: 'objective' },
    { id: 'liu', name: '刘哥', certainty: 'confirmed', truth_status: 'objective' }
  ], events: [
    { id: 'work-event', evidence: [{ quote: '刘哥是林舒的工作搭档。' }] },
    { id: 'unrelated-event', evidence: [{ quote: '另一件未发生的事件' }] }
  ], provenance: { version_id: 'adopted-V3', content_hash: 'synthetic-hash' } }, content);
  assert.deepEqual(result.groups.work[0].primary_relationship.event_ids, ['work-event']);
});

test('narrative prose distinguishes family, lender, friend company, job request and an unknown person', () => {
  const content = [
    '天还没亮，母亲许岚把饭盒放进程予手里，催他路上吃。',
    '程明是程予的父亲，话到了嘴边却只问了一句几点回来。',
    '程予从阿正手里借了二十万，约好慢慢还，没人说阿正以放贷为业。',
    '程予去了朋友江霖开的公司求助；江霖不是程予的同事，只给他介绍了一个面试机会。',
    '傍晚，程予向酒吧负责人梁川申请工作，梁川让他第二天再来。',
    '小郭把门打开，程予点头道谢，两人是什么关系仍未说明。'
  ].join('\n');
  const result = tree(content, [
    { name: '许岚' }, { name: '程明' }, { name: '阿正' },
    { name: '江霖' }, { name: '梁川' }, { name: '小郭' }
  ], { protagonistName: '程予' });
  assert.deepEqual(result.groups.family.map((item) => item.name), ['许岚', '程明']);
  assert.deepEqual(result.groups.interest_debt.map((item) => item.name), ['阿正']);
  assert.deepEqual(result.groups.friends.map((item) => item.name), ['江霖']);
  assert.deepEqual(result.groups.work.map((item) => item.name), ['梁川']);
  assert.deepEqual(result.groups.unconfirmed.map((item) => item.name), ['小郭']);
  assert.doesNotMatch(result.groups.interest_debt[0].primary_relationship.label, /职业放贷/u);
});
