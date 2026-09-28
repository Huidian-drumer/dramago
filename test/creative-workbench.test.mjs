import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSourceVersionHash,
  buildProviderMessages,
  createCreativeBrief,
  getProviderStatus,
  mergeModelResult,
  runDeterministicChecks,
  sha256
} from '../worker/core.mjs';

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
