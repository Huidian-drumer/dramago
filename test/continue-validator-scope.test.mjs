import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSemanticValidatorMessages,
  createCreativeBrief,
  parseSemanticValidationJson,
  semanticValidationBlocks,
  semanticValidationFindings
} from '../worker/core.mjs';

function validationResult(findings = [], overrides = {}) {
  return parseSemanticValidationJson(JSON.stringify({
    findings,
    blocking_conflicts: [],
    warnings: [],
    required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: findings.length === 0, severity: findings.length ? 'blocking' : 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] },
    operation_completed: true,
    source_story_facts: {},
    candidate_story_facts: {},
    ...overrides
  }));
}

function continueFixture(segment = '第二天清晨，她整理好资料，准备面对新的问题。') {
  const source = {
    id: 'synthetic_source',
    title: '合成故事',
    content: '昨晚，她在办公室签完合同，并把钥匙放进抽屉。\n\n回家后，她没有再向任何人解释。'
  };
  const brief = createCreativeBrief({
    operation: 'CONTINUE',
    source_version_id: source.id,
    target_scope: { type: 'next_segment' },
    user_instruction: '从第二天开始续写。不得复述上一集，也不得重新描写昨晚签合同。',
    negative_constraints: ['不得复述上一集', '不得重新描写昨晚签合同'],
    hard_preserve: ['保留既有事实']
  });
  const candidate = {
    title: source.title,
    content: `${source.content}\n\n${segment}`,
    generated_segment: segment,
    output_kind: 'continuation'
  };
  return { source, brief, candidate };
}

function hardFinding({ evidence, source = 'generated_segment', reason = '新增内容直接违反作者禁止项。' }) {
  return {
    finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION',
    severity: 'blocking',
    confidence: 0.98,
    source_priority: 'explicit_user_hard_constraint',
    evidence: [evidence],
    evidence_scope: source,
    evidence_locations: [{ source, quote: evidence, start: 0, end: evidence.length }],
    reason
  };
}

test('CONTINUE Validator 消息保留 source、generated_segment 与 merged candidate 三个明确范围', () => {
  const fixture = continueFixture();
  const messages = buildSemanticValidatorMessages(fixture);
  const payload = JSON.parse(messages.user);
  assert.equal(payload.candidate.generated_segment, fixture.candidate.generated_segment);
  assert.equal(payload.candidate.output_kind, 'continuation');
  assert.equal(payload.source_version.content, fixture.source.content);
  assert.equal(payload.candidate.content, fixture.candidate.content);
  assert.equal(payload.validation_scope.source_content_role, 'immutable_prior_text_not_generated_in_this_attempt');
  assert.equal(payload.validation_scope.generated_segment_role, 'primary_scope_for_this_turn_generation_constraints');
  assert.match(messages.system, /旧正文.*不能仅因.*source_version\.content/u);
});

test('正常追加保留旧正文时，source-only 重复证据不能误阻断', () => {
  const fixture = continueFixture();
  const oldQuote = '昨晚，她在办公室签完合同';
  const validation = validationResult([
    hardFinding({ evidence: oldQuote, source: 'generated_segment', reason: '候选复述了上一集。' })
  ]);
  const context = { source: fixture.source, candidate: fixture.candidate };
  assert.equal(semanticValidationBlocks(validation, fixture.brief, context), false);
  const finding = semanticValidationFindings(validation, {}, fixture.brief, context)
    .find((item) => item.check === 'EXPLICIT_HARD_CONSTRAINT_VIOLATION');
  assert.equal(finding.status, 'warning');
  assert.deepEqual(finding.evidence_scope.sort(), ['candidate_content', 'source_content']);
  assert.match(finding.message, /未定位到本次 generated_segment/u);
});

test('新增 segment 完整复述上一集时仍然阻断', () => {
  const repeated = '昨晚，她在办公室签完合同，并把钥匙放进抽屉。回家后，她没有再向任何人解释。';
  const fixture = continueFixture(repeated);
  const validation = validationResult([
    hardFinding({ evidence: repeated, reason: '新增段落完整复述了上一集。' })
  ]);
  const context = { source: fixture.source, candidate: fixture.candidate };
  assert.equal(semanticValidationBlocks(validation, fixture.brief, context), true);
  const finding = semanticValidationFindings(validation, {}, fixture.brief, context)
    .find((item) => item.check === 'EXPLICIT_HARD_CONSTRAINT_VIOLATION');
  assert.equal(finding.status, 'fail');
  assert.deepEqual(finding.evidence_locations[0], {
    source: 'generated_segment', quote: repeated, start: 0, end: repeated.length
  });
});

test('新增 segment 重新描写昨天签合同时仍然阻断', () => {
  const segment = '镜头再次回到昨晚，她拿起笔，在合同末页签下自己的名字，然后把钥匙收进抽屉。';
  const fixture = continueFixture(segment);
  const quote = '她拿起笔，在合同末页签下自己的名字';
  const validation = validationResult([
    hardFinding({ evidence: quote, reason: '新增内容重新描写了已发生的签约过程。' })
  ]);
  assert.equal(semanticValidationBlocks(validation, fixture.brief, { source: fixture.source, candidate: fixture.candidate }), true);
});

test('新增 segment 对旧借款作必要简短回指时不因重复约束而阻断', () => {
  const fixture = continueFixture('第二天，她看了一眼昨天留下的借款记录，随即把注意力转向今天的面试。');
  const validation = validationResult([{
    finding_type: 'SOFT_REVIEW', severity: 'warning', confidence: 0.72,
    source_priority: 'explicit_user_requirement', evidence: ['昨天留下的借款记录'],
    evidence_scope: 'generated_segment',
    evidence_locations: [{ source: 'generated_segment', quote: '昨天留下的借款记录', start: 8, end: 18 }],
    reason: '这是理解当下行动所需的简短回指，不是重新叙述旧事件。'
  }], { negative_constraint_status: { met: true, severity: 'pass', violations: [] } });
  assert.equal(semanticValidationBlocks(validation, fixture.brief, { source: fixture.source, candidate: fixture.candidate }), false);
});

test('CONTINUE 中真正的人物或时间事实冲突仍然阻断', () => {
  const fixture = continueFixture('第二天，已经去世五年的父亲推门走了进来。');
  fixture.source.content += '\n\n父亲已经去世五年。';
  fixture.candidate.content = `${fixture.source.content}\n\n${fixture.candidate.generated_segment}`;
  const validation = validationResult([{
    finding_type: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: 0.99,
    source_priority: 'source_version_fact',
    fact_basis: 'confirmed_objective',
    evidence: ['父亲已经去世五年', '父亲推门走了进来'],
    evidence_scope: 'cross_scope',
    evidence_locations: [
      { source: 'source_content', quote: '父亲已经去世五年', start: 0, end: 8 },
      { source: 'generated_segment', quote: '父亲推门走了进来', start: 0, end: 9 }
    ],
    reason: '新增段落与来源版本中的不可逆人物事实直接冲突。'
  }], { candidate_internal_consistency: { consistent: false, conflicts: [] } });
  const context = { source: fixture.source, candidate: fixture.candidate };
  assert.equal(semanticValidationBlocks(validation, fixture.brief, context), true);
  assert.equal(semanticValidationFindings(validation, {}, fixture.brief, context)
    .find((item) => item.check === 'STORY_FACT_CONFLICT').status, 'fail');
});

test('CREATE、REWRITE、EXPAND 的既有 hard constraint 阻断规则不回退', () => {
  for (const operation of ['CREATE', 'REWRITE', 'EXPAND']) {
    const source = operation === 'CREATE' ? null : { id: `source_${operation}`, title: '合成来源', content: '原正文保持稳定。' };
    const targetScope = operation === 'CREATE' ? { type: 'full' }
      : operation === 'REWRITE' ? { type: 'full' }
        : { type: 'selection', start: 0, end: 3, selected_text: '原正文' };
    const brief = createCreativeBrief({
      operation,
      source_version_id: source?.id || null,
      target_scope: targetScope,
      user_instruction: '不能让未经批准的外援解决问题。',
      negative_constraints: ['不能让未经批准的外援解决问题']
    });
    const candidate = { content: '最后，陌生权贵出面解决了全部问题。', generated_segment: '最后，陌生权贵出面解决了全部问题。' };
    const validation = validationResult([
      hardFinding({ evidence: '陌生权贵出面解决了全部问题', source: 'candidate_content' })
    ]);
    assert.equal(semanticValidationBlocks(validation, brief, { source, candidate }), true, operation);
  }
});
