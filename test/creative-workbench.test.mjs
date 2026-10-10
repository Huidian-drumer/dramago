import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSourceVersionHash,
  buildContentPlanMessages,
  buildProviderMessages,
  createCreativeBrief,
  deriveNegativeConstraints,
  getProviderStatus,
  mergeModelResult,
  parseContentPlanJson,
  parseSemanticValidationJson,
  providerTimeoutMs,
  qualifyingBlockingFindings,
  runDeterministicChecks,
  semanticValidationBlocks,
  semanticValidationFindings,
  sha256,
  validatorConstraintProfile
} from '../worker/core.mjs';
import { CONTENT_MECHANISMS_V01, mechanismsForWriter, resolveContentMechanisms } from '../worker/content-mechanisms.mjs';

const source = {
  id: 'ver_source',
  title: '婚礼前夜',
  content: '她看见手机上的照片。\n\n相同句子。中间没有变化。相同句子。\n\n她决定取消婚礼，独自离开。'
};

test('重复句子的选区按源版本字符区间合并，不搜索第一处', () => {
  const selectedText = '相同句子。';
  const start = source.content.lastIndexOf(selectedText);
  const brief = createCreativeBrief({
    operation: 'REWRITE', source_version_id: source.id,
    target_scope: { type: 'selection', start, end: start + selectedText.length, selected_text: selectedText },
    user_instruction: '只改写第二处重复句子。'
  });
  const merged = mergeModelResult({ brief, source, modelResult: { outputKind: 'segment', title: source.title, content: '第二处已经改写。' } });
  assert.equal(merged.content, '她看见手机上的照片。\n\n相同句子。中间没有变化。第二处已经改写。\n\n她决定取消婚礼，独自离开。');
  const checks = runDeterministicChecks({ brief, source, candidate: merged });
  assert.equal(checks.find((item) => item.check === 'SELECTION_SCOPE').status, 'pass');
});

test('请求期间源文被编辑会报告 SOURCE_VERSION_CONFLICT', async () => {
  const oldHash = await sha256(`${source.title}\n${source.content}`);
  const newer = { ...source, content: `${source.content}\n新增编辑。` };
  await assert.rejects(() => assertSourceVersionHash(newer, oldHash), (error) => error.code === 'SOURCE_VERSION_CONFLICT');
});

test('作者明确改变旧结局时，新要求位于最高优先级且不被旧设定拒绝', () => {
  const brief = createCreativeBrief({
    operation: 'REWRITE', source_version_id: source.id,
    user_instruction: '把旧结局改成在婚礼现场曝光新郎，最后仍取消婚礼独自离开。'
  });
  const messages = buildProviderMessages({ brief, context: '旧大纲写的是安静离开。', source });
  assert.match(messages.system, /新要求可以更新旧设定/);
  assert.match(messages.user, /婚礼现场曝光新郎/);
  assert.ok(messages.user.indexOf('本次明确要求') < messages.user.indexOf('当前已采用版本'));
});

test('未配置 Provider 时明确列出服务端缺失项', () => {
  assert.deepEqual(getProviderStatus({}).missing, ['OPENAI_API_KEY', 'OPENAI_MODEL']);
  assert.equal(getProviderStatus({}).configured, false);
});

test('生成或请求失败不会原地修改源稿对象', () => {
  const before = structuredClone(source);
  const brief = createCreativeBrief({ operation: 'EXPAND', source_version_id: source.id, user_instruction: '丰富中间段。' });
  assert.throws(() => mergeModelResult({ brief, source, modelResult: { outputKind: 'full', content: '' } }), (error) => error.code === 'OUTPUT_TOO_SHORT');
  assert.deepEqual(source, before);
});

test('作者要求家人帮助主角不会被通用外援禁令拒绝', () => {
  const brief = createCreativeBrief({ operation: 'CREATE', user_instruction: '让姐姐调动家族资源帮助主角完成反击。' });
  const messages = buildProviderMessages({ brief, context: '', source: null });
  assert.match(messages.user, /家族资源帮助主角/);
  assert.doesNotMatch(messages.system, /禁止外援|必须自力更生/);
});

test('续写追加为独立新段且不覆盖前文', () => {
  const brief = createCreativeBrief({ operation: 'CONTINUE', source_version_id: source.id, user_instruction: '从第二天开始续写，不要复述婚礼。' });
  const candidate = mergeModelResult({ brief, source, modelResult: { outputKind: 'continuation', title: source.title, content: '第二天清晨，她关掉所有祝福消息。' } });
  assert.ok(candidate.content.startsWith(source.content));
  assert.equal(candidate.generatedSegment, '第二天清晨，她关掉所有祝福消息。');
  const checks = runDeterministicChecks({ brief, source, candidate });
  assert.equal(checks.find((item) => item.check === 'CONTINUATION_PRESERVES_SOURCE').status, 'pass');
});

test('必须保留项缺失交给独立语义校验，不把同义改写机械判失败', () => {
  const brief = createCreativeBrief({ operation: 'REWRITE', source_version_id: source.id, user_instruction: '调整表达。', preserve: '结尾取消婚礼' });
  const candidate = mergeModelResult({ brief, source, modelResult: { outputKind: 'full', title: source.title, content: '新的完整正文。' } });
  const checks = runDeterministicChecks({ brief, source, candidate });
  assert.equal(checks.find((item) => item.check === 'HARD_PRESERVE_LITERAL').status, 'unassessed');
});

test('selection 操作拒绝 full 冒充 segment', () => {
  const selectedText = '相同句子。';
  const start = source.content.lastIndexOf(selectedText);
  const brief = createCreativeBrief({
    operation: 'EXPAND', source_version_id: source.id,
    target_scope: { type: 'selection', start, end: start + selectedText.length, selected_text: selectedText },
    user_instruction: '扩写选区。'
  });
  assert.throws(
    () => mergeModelResult({ brief, source, modelResult: { outputKind: 'full', content: source.content } }),
    (error) => error.code === 'OUTPUT_KIND_MISMATCH'
  );
});

test('异常超长 segment 被绝对上限拒绝', () => {
  const selectedText = '相同句子。';
  const start = source.content.lastIndexOf(selectedText);
  const brief = createCreativeBrief({
    operation: 'REWRITE', source_version_id: source.id,
    target_scope: { type: 'selection', start, end: start + selectedText.length, selected_text: selectedText },
    user_instruction: '改写选区。'
  });
  assert.throws(
    () => mergeModelResult({ brief, source, modelResult: { outputKind: 'segment', content: '异常内容'.repeat(10000) } }),
    (error) => error.code === 'OUTPUT_TOO_LARGE'
  );
});

test('CreativeBrief 提取成组 negative constraints，但不直接判正文失败', () => {
  const instruction = '保留身份信息差。\n\n但不要照搬：\n大客户突然上门、\n亲戚轮流救场、\n所有人集体道歉。\n\n结尾完整收束。';
  const constraints = deriveNegativeConstraints(instruction);
  assert.deepEqual(constraints, ['但不要照搬：大客户突然上门、亲戚轮流救场、所有人集体道歉。']);
  const brief = createCreativeBrief({ operation: 'CREATE', user_instruction: instruction });
  assert.deepEqual(brief.negative_constraints, constraints);
  assert.ok(!runDeterministicChecks({ brief, source: null, candidate: { content: '任意候选', softLimit: 4000 } })
    .some((item) => item.check === 'NEGATIVE_CONSTRAINTS'));
});

test('ContentPlan 仅用于 CREATE，机制召回过滤未知值并限制最多五条', () => {
  const brief = createCreativeBrief({ operation: 'CREATE', user_instruction: '今天体验的身份是低调进入公司的豪门继承人。' });
  const messages = buildContentPlanMessages({ brief, context: '' });
  assert.match(messages.system, /0 到 5 条/);
  const ids = [...CONTENT_MECHANISMS_V01.map((item) => item.id), 'unknown_mechanism'];
  const plan = parseContentPlanJson(JSON.stringify({
    identity_fantasy: '隐藏身份的继承人',
    core_conflict: '同事不知情',
    audience_expectation: '身份兑现',
    primary_agency: '主角自己解决问题',
    main_payoff: '能力与身份同时兑现',
    ending_mode: '完整收束',
    negative_constraints: [],
    opening_promises: ['观众知道主角有底牌'],
    required_payoffs: ['底牌公开并改变关系'],
    selected_mechanisms: ids
  }), brief);
  assert.equal(plan.selected_mechanisms.length, 5);
  assert.ok(plan.selected_mechanisms.every((id) => CONTENT_MECHANISMS_V01.some((item) => item.id === id)));
  const rewriteBrief = createCreativeBrief({ operation: 'REWRITE', source_version_id: 'ver_1', user_instruction: '改写。' });
  assert.throws(() => buildContentPlanMessages({ brief: rewriteBrief }), (error) => error.code === 'CONTENT_PLAN_CREATE_ONLY');
});

test('A 路径保持 creative-writer-v2 输入形态，B 路径才注入 ContentPlan 和脱敏机制', () => {
  const brief = createCreativeBrief({ operation: 'CREATE', user_instruction: '不要安排亲戚救场。' });
  const direct = buildProviderMessages({ brief, context: '', source: null });
  assert.doesNotMatch(direct.user, /negative_constraints|content_plan|selected_mechanisms/);
  const plan = {
    identity_fantasy: '普通身份下的真实底牌', core_conflict: '环境不知情', audience_expectation: '后续兑现',
    primary_agency: '主角主动处理问题', main_payoff: '身份改变选择', ending_mode: '完整收束',
    negative_constraints: brief.negative_constraints, opening_promises: ['身份底牌'], required_payoffs: ['身份实际兑现'],
    selected_mechanisms: ['promise_payoff']
  };
  const selected = resolveContentMechanisms(plan.selected_mechanisms);
  const planned = buildProviderMessages({ brief, context: '', source: null, contentPlan: plan, selectedMechanisms: mechanismsForWriter(selected) });
  assert.match(planned.user, /content_plan/);
  assert.match(planned.user, /promise_payoff/);
  assert.doesNotMatch(planned.user, /source_reference_id|manual-curation/);
});

test('Provider timeout 默认 45 秒且实验配置集中限制在 180 秒', () => {
  assert.equal(providerTimeoutMs({}), 45000);
  assert.equal(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '180000' }), 180000);
  assert.equal(providerTimeoutMs({ PROVIDER_TIMEOUT_MS: '999999' }), 180000);
});

test('Validator 约束来源按显式 hard、显式要求、推断与机制分层', () => {
  const profile = validatorConstraintProfile({
    hard_preserve: ['必须保留旧信'],
    soft_preserve: ['尽量保留语气'],
    required_outcomes: ['婚礼最终取消'],
    negative_constraints: ['不能让父母救场', '减少专业步骤', '不要写成调查报告'],
    content_plan: { opening_promises: ['观众期待身份曝光'], required_payoffs: ['身份改变关系'] },
    selected_mechanisms: [{ id: 'promise_payoff' }]
  });
  assert.deepEqual(profile.explicit_hard_constraints, ['必须保留旧信', '不能让父母救场']);
  assert.deepEqual(profile.explicit_soft_constraints, ['尽量保留语气', '减少专业步骤', '不要写成调查报告']);
  assert.deepEqual(profile.explicit_required_outcomes, ['婚礼最终取消']);
  assert.deepEqual(profile.hard_event_outcomes, ['婚礼最终取消']);
  assert.deepEqual(profile.soft_review_requirements, []);
  assert.deepEqual(profile.inferred_promises, ['观众期待身份曝光', '身份改变关系']);
});

test('Validator V2 只有满足类型、置信度和证据契约的明确冲突才阻断', () => {
  const parsed = parseSemanticValidationJson(JSON.stringify({
    findings: [
      { finding_type: 'REQUIRED_OUTCOME_MISSING', severity: 'blocking', confidence: 0.96, source_priority: 'explicit_user_requirement', evidence: ['“公司里仍没有任何人知道”'], reason: '用户明确要求身份兑现，但正文完全没有发生。' },
      { finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', severity: 'blocking', confidence: 0.98, source_priority: 'explicit_user_hard_constraint', evidence: ['“叔叔替他摆平全部问题”'], reason: '直接违反不能靠亲戚救场。' },
      { finding_type: 'INTERNAL_FACT_CONFLICT', severity: 'blocking', confidence: 0.99, source_priority: 'source_version_fact', evidence: ['“她没有告诉任何人”', '“妈，我试过回家说”'], reason: '同一候选对是否告知家人给出无法同时成立的陈述。' }
    ],
    blocking_conflicts: [],
    warnings: [],
    required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: false, missing_payoffs: ['隐藏身份没有实际公开'], notes: [] },
    negative_constraint_status: {
      met: false,
      severity: 'blocking',
      violations: [{ constraint: '不能靠亲戚救场', message: '结局由亲戚直接解决', evidence: '叔叔替他摆平全部问题' }]
    },
    candidate_internal_consistency: {
      consistent: false,
      conflicts: [{ code: 'INTERNAL_FACT_CONFLICT', message: '是否告知家人前后矛盾', evidence: '“她没有告诉任何人” / “妈，我试过回家说”' }]
    },
    operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
  }));
  assert.equal(semanticValidationBlocks(parsed), true);
  assert.equal(qualifyingBlockingFindings(parsed).length, 3);
  const findings = semanticValidationFindings(parsed);
  assert.equal(findings.find((item) => item.check === 'PROMISE_PAYOFF').status, 'warning');
  assert.equal(findings.find((item) => item.check === 'REQUIRED_OUTCOMES').status, 'warning');
  assert.equal(findings.find((item) => item.check === 'NEGATIVE_CONSTRAINTS').status, 'warning');
  assert.equal(findings.find((item) => item.check === 'INTERNAL_FACT_CONFLICT').status, 'fail');
  assert.equal(findings.filter((item) => item.status === 'fail').every((item) => (
    item.severity === 'blocking'
      && item.confidence >= 0.85
      && item.evidence.length > 0
      && item.reason
  )), true);
});

test('Validator V2 对较轻 negative constraint 偏差只给 warning，不把文艺偏好变成阻断', () => {
  const parsed = parseSemanticValidationJson(JSON.stringify({
    findings: [{
      finding_type: 'SOFT_REVIEW', severity: 'blocking', confidence: 0.99,
      source_priority: 'explicit_user_requirement', evidence: ['连续三段操作过程'], reason: '专业操作描述略多。'
    }],
    blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: {
      met: false, severity: 'warning',
      violations: [{ constraint: '减少专业步骤', message: '操作描述略多', evidence: '连续三段操作过程' }]
    },
    candidate_internal_consistency: { consistent: true, conflicts: [] },
    operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
  }));
  assert.equal(semanticValidationBlocks(parsed), false);
  const findings = semanticValidationFindings(parsed);
  assert.equal(findings.find((item) => item.check === 'NEGATIVE_CONSTRAINTS').status, 'warning');
  assert.ok(!findings.some((item) => item.status === 'fail'));
});

test('Validator V2 对低置信度或无证据的阻断主张自动降级 warning', () => {
  const parsed = parseSemanticValidationJson(JSON.stringify({
    findings: [
      { finding_type: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: 0.6, source_priority: 'source_version_fact', evidence: ['候选片段'], reason: '置信度不足。' },
      { finding_type: 'TIMELINE_CONFLICT', severity: 'blocking', confidence: 0.99, source_priority: 'source_version_fact', evidence: [], reason: '没有具体证据。' }
    ],
    blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] },
    operation_completed: true,
    source_story_facts: {}, candidate_story_facts: {}
  }));
  assert.equal(semanticValidationBlocks(parsed), false);
  const findings = semanticValidationFindings(parsed);
  assert.equal(findings.filter((item) => ['STORY_FACT_CONFLICT', 'TIMELINE_CONFLICT'].includes(item.check)).every((item) => item.status === 'warning'), true);
});

test('Validator V2 不允许用 required outcome finding 绕过表达方式软约束', () => {
  const brief = {
    required_outcomes: ['写出负责人和主角之间的现场压力'],
    negative_constraints: ['减少专业原理和操作步骤', '不要写成事故调查报告']
  };
  const parsed = parseSemanticValidationJson(JSON.stringify({
    findings: [{
      finding_type: 'REQUIRED_OUTCOME_MISSING', severity: 'blocking', confidence: 0.96,
      source_priority: 'explicit_user_requirement', evidence: ['人物只说了“收到”'],
      reason: 'required_outcome“写出负责人和主角之间的现场压力”没有充分呈现。'
    }],
    blocking_conflicts: [], warnings: [], required_outcomes_met: false,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: false, severity: 'warning', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] },
    operation_completed: true,
    source_story_facts: {}, candidate_story_facts: {}
  }));
  assert.deepEqual(validatorConstraintProfile(brief).soft_review_requirements, ['写出负责人和主角之间的现场压力']);
  assert.equal(semanticValidationBlocks(parsed, brief), false);
  assert.equal(semanticValidationFindings(parsed, {}, brief).find((item) => item.check === 'REQUIRED_OUTCOME_MISSING').status, 'warning');
});
