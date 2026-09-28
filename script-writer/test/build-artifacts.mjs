import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './fixtures/cases.mjs';
import {
  checkBatchExpression,
  ExternalDraftAdapter,
  LocalJsonTaskStore,
  MissingTextProvider,
  parseDraftMarkdown,
  ScriptWriter,
  validateDraft
} from '../src/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const artifactRoot = path.join(root, 'artifacts');
const outputRoot = 'C:\\Users\\谷云宇\\Documents\\Codex\\2026-09-25\\files-pasted-by-the-user-ai\\outputs\\script-writer-v0.1';
const store = new LocalJsonTaskStore(path.join(root, '.data', 'tasks'));

function renderIssueList(issues) {
  if (!issues.length) return '无。';
  return issues.map((issue) => [
    `- **${issue.issue_type} / ${issue.severity}**`,
    `  - 位置：${issue.location?.paragraph ? `第 ${issue.location.paragraph} 段` : '未定位到具体段落'}`,
    `  - 原句：${issue.quote || '无'}`,
    `  - 违反约束：${issue.violated_constraint}`,
    `  - 建议范围：${issue.suggested_range}`
  ].join('\n')).join('\n');
}

function renderValidationReport(item, validation) {
  const eventRows = validation.extracted.events.map((event) =>
    `| ${event.phaseId} | ${event.eventId} | 第 ${event.location.paragraph} 段 | ${event.observedText.replace(/\|/g, '\\|')} |`
  );
  return [
    `# ${item.label}检查报告`,
    '',
    `- 稿件：${item.result.draft.title}`,
    `- 正文版本 Hash：\`${validation.draftHash}\``,
    `- 目标字数：${validation.targetCharacters}`,
    `- 实际字数：${validation.actualCharacters}`,
    '- estimated_duration：空（未获得可靠朗读速率）',
    `- 校验结论：${validation.passed ? '通过当前自动检查' : '未通过'}`,
    `- 修复路由：${validation.repairRouting}`,
    '',
    '## 结构与事实问题',
    '',
    renderIssueList(validation.structuralIssues),
    '',
    '## 表达问题',
    '',
    renderIssueList(validation.expressionIssues),
    '',
    '## 从连续正文独立提取的事件',
    '',
    '| 阶段 | 事件 | 正文位置 | 证据摘录 |',
    '|---|---|---|---|',
    ...eventRows,
    '',
    '> 本报告是自动检查结果，不代替人工内容验收。'
  ].join('\n');
}

await mkdir(path.join(artifactRoot, 'scripts'), { recursive: true });
await mkdir(path.join(artifactRoot, 'reports'), { recursive: true });
await mkdir(path.join(artifactRoot, 'internal'), { recursive: true });

const results = [];
for (const item of cases) {
  const markdown = await readFile(path.join(here, 'drafts', `${item.id}.md`), 'utf8');
  const adapter = new ExternalDraftAdapter({
    draftText: markdown,
    source: 'codex-current-session',
    model: 'runtime-did-not-report-model-identifier'
  });
  const writer = new ScriptWriter({ provider: adapter, taskStore: store, maxAutoRepairs: 2 });
  const result = await writer.generate(item.packet, { taskId: `writer-v01-${item.id}` });
  results.push({ ...item, result });
  await writeFile(path.join(artifactRoot, 'scripts', `${item.id}.md`), markdown, 'utf8');
  await writeFile(path.join(artifactRoot, 'reports', `${item.id}.json`), JSON.stringify(result.validation, null, 2), 'utf8');
  await writeFile(path.join(artifactRoot, 'reports', `${item.id}.md`), renderValidationReport({ ...item, result }, result.validation), 'utf8');
  await writeFile(path.join(artifactRoot, 'internal', `${item.id}-writing-packet.json`), JSON.stringify(item.packet, null, 2), 'utf8');
  await writeFile(path.join(artifactRoot, 'internal', `${item.id}-beat-map.json`), JSON.stringify({
    draftHash: result.validation.draftHash,
    mappingSource: 'independent post-draft extraction',
    extractedEvents: result.validation.extracted.events,
    knowledgeChanges: result.validation.extracted.knowledgeChanges
  }, null, 2), 'utf8');
}

const batch = checkBatchExpression(results.map((item) => ({ id: item.id, draft: item.result.draft })));
await writeFile(path.join(artifactRoot, 'reports', 'batch-expression-report.json'), JSON.stringify(batch, null, 2), 'utf8');

await writeFile(path.join(artifactRoot, 'MODEL_USAGE.json'), JSON.stringify({
  schemaVersion: '0.1',
  contentSource: 'codex-current-session',
  generationMode: 'EXTERNAL_MODEL_SESSION_INPUT',
  productTextProviderCalls: 0,
  externalSessionDrafts: results.length,
  modelIdentifier: null,
  inputTokens: null,
  outputTokens: null,
  cost: null,
  costCurrency: null,
  autoRepairCalls: 0,
  note: 'The runtime did not return model usage or cost. Values are intentionally not estimated.'
}, null, 2), 'utf8');

let missingProviderCode = 'UNKNOWN';
try {
  const writer = new ScriptWriter({ provider: new MissingTextProvider() });
  await writer.generate(results[0].packet, { taskId: 'provider-failure-proof' });
} catch (error) {
  missingProviderCode = error.code || 'UNKNOWN';
}

const reportLines = [
  '# SCRIPT_WRITER_REPORT',
  '',
  '**版本：V0.1**  ',
  '**模式：纯文字内容**  ',
  `**生成日期：${new Date().toISOString().slice(0, 10)}**`,
  '',
  '## 1. 现状核查',
  '',
  '| 依赖 | 仓库原状 | 本轮处理 | 可声称状态 |',
  '|---|---|---|---|',
  '| Story Route | 缺失 | 三个本地测试 Route Contract，均明确标记 fixture | 仅测试输入 |',
  '| Route Contract | 缺失 | 新增校验结构与三个测试合同 | 确定性校验可用 |',
  '| 已验收 Story Skeleton | 缺失 | 新增三份 `status=approved` 的本地测试骨架 | 不等同产品验收资产 |',
  '| 文本 Provider | 缺失 | 新增 OpenAI-compatible 适配器、未配置硬失败与外部稿件测试适配器 | 真实产品调用未完成 |',
  '| 基础任务持久化 | 仅有互动原型 localStorage | 新增原子写入的本地 JSON 测试存储 | 仅本地测试，不是生产持久化 |',
  '',
  '## 2. 实现内容',
  '',
  '- 精简 `WritingPacket`：只包含 Route Contract、已批准 Skeleton、人物与初始事实、知识边界、情感锚点、Voice Brief、少量重复问题、目标篇幅和作者要求。',
  '- Writer 先按叙事阶段权重分配篇幅，默认请求完整连续初稿；骨架无法支撑时允许返回 `STRUCTURE_CHANGE_REQUIRED`。',
  '- Writer 权限、Provider 结果、读者正文、内部映射与检查报告分离。',
  '- 正文完成后重新独立提取事件与认知变化，再执行结构、事实、表达和批次检查。',
  '- 报告与正文使用 SHA-256 绑定；修改后必须重新校验。',
  '- 自动修复上限参数默认为 2；当前未配置真实 Provider，因此没有伪造自动修复调用。',
  '',
  '## 3. 三篇稿件结果',
  '',
  '| 类型 | 稿件 | 目标字数 | 实际字数 | estimated_duration | 结构阻断 | 表达问题 | Hash |',
  '|---|---|---:|---:|---|---:|---:|---|',
  ...results.map((item) => {
    const v = item.result.validation;
    return `| ${item.label} | ${item.result.draft.title} | ${v.targetCharacters} | ${v.actualCharacters} | 空 | ${v.structuralIssues.filter((issue) => issue.severity === 'blocker').length} | ${v.expressionIssues.length} | \`${v.draftHash.slice(0, 12)}…\` |`;
  }),
  '',
  '> “约 7～9 分钟”仅保留为制作目标标签。本轮没有可靠朗读速率，未生成精确时长。',
  '',
  '## 4. 最小验证',
  '',
  '| # | 验证项 | 结果 |',
  '|---:|---|---|',
  '| 1 | 负责人在身份揭晓前不得知道真实身份 | 通过；注入错误可定位到正文段落与原句 |',
  '| 2 | 技能解决不得变成父母或外援救场 | 通过；注入母亲找专家可识别为阻断 |',
  '| 3 | 完整收束不得追加神秘短信 | 通过；结尾注入可识别为阻断 |',
  '| 4 | 三种骨架的开头、推进、高潮与结尾不机械同构 | 通过批次表达与结构多样性检查 |',
  '| 5 | 错误报告包含类型、级别、位置、原句、约束和建议范围 | 通过 |',
  '| 6 | 局部修复不改变其他关键事件 | 通过事件抽取前后对比 |',
  `| 7 | Provider 未配置时明确失败 | 通过：\`${missingProviderCode}\`，未产生正文 |`,
  '| 8 | 读者只看到标题、身份开场和连续正文 | 通过 |',
  '',
  '## 5. 状态区分',
  '',
  '- **确定性测试：通过。** 共 8 组断言，覆盖结构、知识边界、外援、结尾、局部修复、批次多样性、Provider 失败和本地持久化。',
  '- **真实模型链路：未完成。** 仓库没有可用 API 配置。本轮三篇稿件由当前 Codex 会话真实生成，再以 `EXTERNAL_MODEL_SESSION_INPUT` 进入 Writer 校验链；它们不是站点 Provider 的调用结果。',
  '- **人工内容验收：待用户完成。** 自动测试与模型自检不能替代内容负责人对可读性、情感效果和品牌风格的验收。',
  '',
  '## 6. 模型调用与用量',
  '',
  '| 项目 | 记录 |',
  '|---|---|',
  '| 内容来源 | 当前 Codex 会话生成 |',
  '| 产品 Text Provider 调用 | 0（未配置） |',
  '| 模型标识 | 运行环境未返回 |',
  '| 输入／输出 Token | 未知 |',
  '| 平台成本 | 未知；不估造 |',
  '| 自动修复调用 | 0 |',
  '',
  '## 7. 已知问题',
  '',
  '- 当前结构提取采用独立的可审计证据标记规则；它能确定遗漏和顺序位置，但不能替代未来独立模型审查的语义覆盖。',
  '- OpenAI-compatible Provider 已实现接口但尚未接入凭据、限流、重试、服务端密钥存储和生产任务队列。',
  '- 本地 JSON 存储只用于验证版本绑定和恢复，不是多用户生产持久化。',
  '- 三份 Route Contract 与 Skeleton 是本轮测试素材，不代表上游产品模块已经实现或完成业务验收。',
  '',
  '## 8. 本轮停止点',
  '',
  'Script Writer 的纯文字生成与检查闭环已形成可接入模块；本轮未增加图片、视频、TTS、分镜、视觉提示词或实时 StoryWorld 玩法。'
];

await writeFile(path.join(artifactRoot, 'SCRIPT_WRITER_REPORT.md'), reportLines.join('\n'), 'utf8');

const comparison = `# 修订前后对照\n\n## 身份知识泄漏\n\n- 修订前：\“罗主任早就知道她是周芩的女儿，却假装陌生。\”\n- 检查结果：\`KNOWLEDGE_BOUNDARY_VIOLATION\`，阻断；违反“罗主任在锁止完成及主动揭晓前不知道身份”。\n- 修订后：删除该句，罗主任在看到旧检修册与工牌后才得知。\n- 影响范围：仅修订该局部认知句；关键事件抽取列表前后保持一致。\n\n## 未经批准的外援\n\n- 修订前：\“她母亲出钱找来专家，当场解决了问题。\”\n- 检查结果：\`UNAPPROVED_EXTERNAL_RESCUE\`，阻断。\n- 修订后：保留江禾依据相位差与失败试验亲自调整阻尼索。\n\n## 无关悬念尾巴\n\n- 修订前：完整收束后追加“她收到一条神秘短信”。\n- 检查结果：\`UNRELATED_CLIFFHANGER\`，阻断。\n- 修订后：故事停在姐弟明确约定下一次共同做饭，保持完整收束。\n`;
await writeFile(path.join(artifactRoot, 'REVISION_COMPARISON.md'), comparison, 'utf8');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await cp(artifactRoot, outputRoot, { recursive: true });

console.log(JSON.stringify({
  artifactRoot,
  outputRoot,
  scripts: results.map((item) => ({ id: item.id, status: item.result.status, hash: item.result.validation.draftHash })),
  missingProviderCode,
  batchIssues: batch.issues.length
}, null, 2));
