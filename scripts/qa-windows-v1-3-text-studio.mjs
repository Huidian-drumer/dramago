import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { defaultProviderConfiguration, WindowsDpapiProviderSecretStore, writeProviderConfiguration } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const archive = process.env.DRAMAGO_ACCEPTANCE_ZIP
  || path.join(root, 'artifacts', 'windows', 'DramaGo-v1.4-windows-x64-internal-stability-creative-intelligence.zip');
const runRoot = path.join(root, '.cache', `windows-v1-4-stability-${Date.now()}`);
const extractRoot = path.join(runRoot, 'package');
const dataRoot = path.join(runRoot, 'data');
const electronUserData = path.join(runRoot, 'electron-user-data');
const exportRoot = path.join(runRoot, 'exports');
const statusFile = path.join(runRoot, 'packaged-status.json');
const reportDir = process.env.DRAMAGO_ACCEPTANCE_REPORT_DIR
  ? path.resolve(process.env.DRAMAGO_ACCEPTANCE_REPORT_DIR)
  : path.join(root, 'reports', 'windows-v1-4-stability-creative-intelligence');
const screenshotDir = path.join(reportDir, 'screenshots');
const evidenceFile = path.join(reportDir, 'PACKAGED_EXE_ACCEPTANCE.json');
const cacheRoot = path.join(root, '.cache');
if (!path.resolve(runRoot).startsWith(`${path.resolve(cacheRoot)}${path.sep}`)) throw new Error('Unsafe QA run directory.');
await Promise.all([mkdir(extractRoot, { recursive: true }), mkdir(exportRoot, { recursive: true }), mkdir(screenshotDir, { recursive: true })]);

const unpack = spawnSync('tar.exe', ['-xf', archive, '-C', extractRoot], { encoding: 'utf8', windowsHide: true });
if (unpack.status !== 0) throw new Error(`Unable to extract final package: ${unpack.stderr || unpack.stdout}`);
const packageRoot = path.join(extractRoot, 'DramaGo-win32-x64');
const executable = path.join(packageRoot, 'DramaGo.exe');
const packagedWorker = path.join(packageRoot, 'resources', 'app.asar.unpacked', 'dist', 'server', 'index.js');
const packagedCore = path.join(packageRoot, 'resources', 'app.asar.unpacked', 'dist', 'server', 'core.mjs');
const packagedMigrations = path.join(packageRoot, 'resources', 'app.asar.unpacked', 'drizzle');
const sourceWorker = path.join(root, 'dist', 'server', 'index.js');
const sourceCore = path.join(root, 'dist', 'server', 'core.mjs');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fileHash = async (filename) => sha256(await readFile(filename));
const packageEvidence = {
  source_worker_sha256: await fileHash(sourceWorker),
  packaged_worker_sha256: await fileHash(packagedWorker),
  exact_worker_match: (await fileHash(sourceWorker)) === (await fileHash(packagedWorker)),
  source_core_sha256: await fileHash(sourceCore),
  packaged_core_sha256: await fileHash(packagedCore),
  exact_core_match: (await fileHash(sourceCore)) === (await fileHash(packagedCore)),
  contains_text_studio_overview: (await readFile(packagedWorker, 'utf8')).includes('work_story_plans'),
  contains_blank_work_creation: (await readFile(packagedWorker, 'utf8')).includes('createBlankWork'),
  contains_memory_feedback: (await readFile(packagedWorker, 'utf8')).includes('story_memory_annotations'),
  contains_language_quality: (await readFile(packagedCore, 'utf8')).includes('language_quality'),
  contains_explicit_completion: (await readFile(packagedWorker, 'utf8')).includes('completed_version_id'),
  contains_exact_final_sentence: (await readFile(packagedCore, 'utf8')).includes('EXACT_FINAL_SENTENCE')
};
if (!Object.values(packageEvidence).every(Boolean)) throw new Error(`Packaged worker mismatch: ${JSON.stringify(packageEvidence)}`);

const calls = [];
function memoryFor(content, versionId = null) {
  const text = String(content || '');
  const ownershipQuote = text.includes('外公留下的土地已登记在自己名下')
    ? text.slice(0, text.indexOf('。') + 1) : null;
  const quote = ownershipQuote || text.slice(0, Math.min(8, text.length));
  const start = Math.max(0, text.indexOf(quote));
  return {
    completeness: quote ? 'available' : 'incomplete',
    characters: [{ id: 'linchuan', name: '林川', identity: '主角，负债后的年轻人', relationships: [], state: '主动承担债务',
      status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '',
      evidence: quote ? [{ quote, start, end: start + quote.length, version_id: versionId }] : [] },
      ...(text.includes('阿坤') ? [{ id: 'akun', name: '阿坤', identity: '债权人与旧友', relationships: ['林川向阿坤借款'], state: '等待还款',
        status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '',
        evidence: [{ quote: '阿坤', start: text.indexOf('阿坤'), end: text.indexOf('阿坤') + 2, version_id: versionId }] }] : []),
      ...(text.includes('周磊') ? [{ id: 'zhoulei', name: '周磊', identity: '同事', relationships: ['林川的同事'], state: '协助工作交接',
        status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '',
        evidence: [{ quote: '周磊', start: text.indexOf('周磊'), end: text.indexOf('周磊') + 2, version_id: versionId }] }] : [])],
    events: [],
    persistent_facts: ownershipQuote ? [{ id: 'land_title', fact: '外公留下的土地已登记在自己名下', state: 'active',
      status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '',
      evidence: [{ quote: ownershipQuote, start: text.indexOf(ownershipQuote), end: text.indexOf(ownershipQuote) + ownershipQuote.length, version_id: versionId }] }] : [],
    open_threads: text.includes('债务') ? [{ id: 'debt', thread: '债务仍需持续偿还', status: 'open', truth_status: 'objective',
      certainty: 'confirmed', time_context: '', evidence: [{ quote: '债务', start: text.indexOf('债务'), end: text.indexOf('债务') + 2, version_id: versionId }] }] : []
  };
}

function validatorResult(user) {
  const candidate = String(user.candidate?.content || '');
  const source = String(user.source_version?.content || '');
  const segment = String(user.candidate?.generated_segment || user.generated_segment || '');
  const conflict = segment.includes('土地仍在外公名下');
  const sourceQuote = source.includes('土地权属已经核验清楚') ? '土地权属已经核验清楚' : '产权清晰';
  const sourceIndex = Math.max(0, source.indexOf(sourceQuote));
  const segmentIndex = Math.max(0, segment.indexOf('土地仍在外公名下'));
  const finding = conflict ? [{ finding_type: 'STORY_FACT_CONFLICT', severity: 'blocking', confidence: 0.99,
    source_priority: 'source_version_confirmed_fact', fact_basis: 'confirmed_objective',
    memory_fact_ids: ['land_title'], evidence: [sourceQuote, '土地仍在外公名下'], reason: '新增正文无解释地推翻了已确认的土地权属。',
    evidence_scope: 'cross_scope', evidence_locations: [
      { source: 'source', quote: sourceQuote, start: sourceIndex, end: sourceIndex + sourceQuote.length },
      { source: 'generated_segment', quote: '土地仍在外公名下', start: segmentIndex, end: segmentIndex + '土地仍在外公名下'.length }
    ] }] : [];
  const languageFindings = ['你拿外公留给你的地去想。', '这是你外公留给你我的。', '行业里传开了5开了。']
    .filter((quote) => candidate.includes(quote)).map((quote, index) => ({
      category: index === 0 ? 'readability' : 'explicit_language_error',
      issue_type: index === 0 ? 'awkward_collocation' : index === 1 ? 'pronoun_ambiguity' : 'typo',
      severity: index === 0 ? 'warning' : 'error', confidence: index === 0 ? .78 : .99, evidence: quote,
      location: { source: 'candidate_content', quote, start: candidate.indexOf(quote), end: candidate.indexOf(quote) + quote.length },
      explanation: index === 0 ? '搭配可能生硬，需结合人物口语判断。' : index === 1 ? '归属关系存在歧义。' : '句内出现明显重复残片。',
      suggestion: '由作者决定是否局部修改。', needs_human_judgment: index !== 2
    }));
  return {
    findings: finding, blocking_conflicts: finding, warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
    language_quality: { findings: languageFindings },
    source_story_facts: { characters: ['林川'], relationships: [], irreversible_facts: sourceQuote && source.includes(sourceQuote) ? ['土地产权清晰'] : [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: ['林川'], relationships: [], irreversible_facts: sourceQuote && candidate.includes(sourceQuote) ? ['土地产权清晰'] : [], major_events: [], time_anchors: ['第二天'] },
    source_story_memory: memoryFor(source, user.source_version?.id || null),
    candidate_story_memory: memoryFor(candidate, user.candidate?.id || null)
  };
}

function writerResult(user) {
  const brief = user.creative_brief || {};
  const instruction = String(brief.user_instruction || '');
  if (brief.operation === 'CREATE') return { output_kind: 'full', title: instruction.includes('作品B') ? '第二部测试作品' : '边界上的灯',
    content: instruction.includes('QA_LANGUAGE') ? '你拿外公留给你的地去想。\n\n这是你外公留给你我的。\n\n行业里传开了5开了。'
      : instruction.includes('作品B') ? '周遥在雨夜收好最后一封信。' : '林川确认外公留下的土地已登记在自己名下，产权清晰。林川向债权人阿坤借款，林川与同事周磊完成了工作交接。他没有卖地，而是开始逐笔记录债务。',
    change_summary: '建立合成初稿', model_warnings: [] };
  if (brief.operation === 'REWRITE') return { output_kind: 'segment', title: '不应覆盖主标题',
    content: '土地权属已经核验清楚', change_summary: '改写权属表述', model_warnings: [] };
  if (brief.operation === 'EXPAND') return { output_kind: 'segment', title: '不应覆盖主标题',
    content: '他没有回避债务，而是把每一笔金额、期限和承诺写进旧账本。', change_summary: '扩写承担过程', model_warnings: [] };
  if (instruction.includes('QA_FACT_CONFLICT')) return { output_kind: 'continuation', title: '冲突片段',
    content: '第二天，他却说土地仍在外公名下，继承手续从未办理。', change_summary: '受控事实冲突', model_warnings: [] };
  if (instruction.includes('QA_VALIDATOR_429')) return { output_kind: 'continuation', title: '连接失败候选',
    content: '夜里，他重新整理了账本，等待下一次审核。', change_summary: '保留候选用于失败验收', model_warnings: [] };
  const ending = brief.ending_intent || {};
  if (ending.mode === 'specified_ending') return { output_kind: 'continuation', title: '尾声：灯亮以后',
    content: `三个月后，他与债权人签下分期方案，也保住了自己的选择。${ending.exact_final_sentence || '灯亮了，他继续向前走。'}`,
    change_summary: '按指定结局收束', model_warnings: [] };
  return { output_kind: 'continuation', title: '第二集：清晨', content: '第二天，林川主动约见债权人，提出第一份可执行的还款安排。',
    change_summary: '追加次日剧情', model_warnings: [] };
}

function openAi(content, model) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 43, completion_tokens: 67, total_tokens: 110 } });
}

const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const system = String(body.messages?.[0]?.content || '');
  let user = {};
  try { user = JSON.parse(String(body.messages?.[1]?.content || '{}')); } catch {}
  const role = system.includes('独立于 Writer') ? 'validator' : system.includes('ContentPlan') ? 'planner' : 'writer';
  calls.push({ role, model: body.model, operation: user.creative_brief?.operation || null,
    provider: request.headers.authorization === 'Bearer z-key' ? 'zhipu' : request.headers.authorization === 'Bearer d-key' ? 'deepseek' : 'unexpected',
    has_story_memory: Boolean(user.story_memory_context), at: new Date().toISOString() });
  if (role === 'validator' && String(user.creative_brief?.user_instruction || '').includes('QA_VALIDATOR_429')) {
    response.writeHead(429, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'controlled rate limit' } }));
    return;
  }
  const content = role === 'validator' ? validatorResult(user)
    : role === 'planner' ? { identity_fantasy: '承担债务的年轻人', core_conflict: '责任与选择', audience_expectation: '看见成长',
      primary_agency: '主动协商', main_payoff: '获得选择权', ending_mode: '阶段收束', negative_constraints: [], selected_mechanisms: [],
      opening_promises: [], required_payoffs: [] } : writerResult(user);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(openAi(content, body.model));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));

const paths = localPaths(dataRoot);
await ensureLocalDirectories(paths);
const config = structuredClone(defaultProviderConfiguration);
for (const id of ['zhipu', 'deepseek']) config.providers[id].disclosure_confirmed_at = new Date().toISOString();
config.selected_writer = { provider_id: 'zhipu', model_id: 'glm-4.7' };
config.selected_validator = { provider_id: 'deepseek', model_id: 'deepseek-flash' };
await writeProviderConfiguration(paths.providerConfig, config);
const secrets = new WindowsDpapiProviderSecretStore(paths.providerSecrets);
await secrets.set('zhipu', 'z-key');
await secrets.set('deepseek', 'd-key');

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const cdpPort = await freePort();
let desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
  cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore', env: { ...process.env,
    DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: electronUserData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_DESKTOP_QA_EXPORT_DIR: exportRoot,
    DRAMAGO_INTERNAL_QA: '1', DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions` }
});

let browser;
const checks = {};
const screenshots = {};
function check(name, value, details = null) {
  checks[name] = { passed: Boolean(value), details };
  if (!value) throw new Error(`${name}: ${JSON.stringify(details)}`);
}
async function capture(page, name, fullPage = false) {
  const filename = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filename, fullPage });
  screenshots[name] = { path: filename, sha256: await fileHash(filename), bytes: (await stat(filename)).size };
}

try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  let page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check('packaged_window_ready', Boolean(page));
  const request = (pathname, body = null, method = 'POST') => page.evaluate(async ({ pathname, body, method }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch(pathname, { method, headers: { 'x-dramago-local-token': token,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
    return { status: response.status, payload: await response.json() };
  }, { pathname, body, method });
  await page.locator('[data-action="new-work"]').first().click();
  await page.locator('#newWorkName').fill('空白作品验收');
  await page.locator('[data-action="confirm-new-work"]').click();
  await page.locator('#bodyEditor').waitFor();
  const blankWorkId = new URL(page.url()).searchParams.get('work_id');
  const blankBootstrap = await request(`/api/bootstrap?work_id=${encodeURIComponent(blankWorkId)}`, null, 'GET');
  check('blank_work_created_without_version', blankBootstrap.payload.work?.title === '空白作品验收'
    && blankBootstrap.payload.current_version === null && blankBootstrap.payload.versions.length === 0, blankBootstrap.payload);
  await page.locator('#bodyEditor').fill('未保存的本地正文草稿。');
  if (await page.locator('#composerInput').count() === 0) await page.locator('.composer-expand').click();
  await page.locator('#composerInput').fill('从第二天开始续写，保留前文。');
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1366, height: 900 });
  await capture(page, 'blank-work-draft-saved-1366', true);
  const draftRows = new SQLiteD1(paths.database);
  const persistedDraft = await draftRows.prepare('SELECT * FROM work_operation_drafts WHERE work_id = ? AND operation = ?')
    .bind(blankWorkId, 'CREATE').first();
  const persistedEdit = await draftRows.prepare('SELECT * FROM work_edit_drafts WHERE work_id = ?').bind(blankWorkId).first();
  check('draft_persisted_to_sqlite', persistedDraft?.instruction === '从第二天开始续写，保留前文。'
    && persistedEdit?.body === '未保存的本地正文草稿。', { persistedDraft, persistedEdit });
  draftRows.close();
  await browser.close();
  browser = null;
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await rm(statusFile, { force: true });
  desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
    cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore', env: { ...process.env,
      DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: electronUserData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_DESKTOP_QA_EXPORT_DIR: exportRoot,
      DRAMAGO_INTERNAL_QA: '1', DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions` }
  });
  const restartDeadline = Date.now() + 30000;
  while (Date.now() < restartDeadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(blankWorkId)}`);
  await page.locator('#bodyEditor').waitFor();
  if (await page.locator('#composerInput').count() === 0) await page.locator('.composer-expand').click();
  check('packaged_electron_restart_restores_body_and_instruction',
    (await page.locator('#bodyEditor').inputValue()) === '未保存的本地正文草稿。'
      && (await page.locator('#composerInput').inputValue()) === '从第二天开始续写，保留前文。',
    { body: await page.locator('#bodyEditor').inputValue(), instruction: await page.locator('#composerInput').inputValue() });
  const execute = async ({ workId = null, source = null, operation, instruction, targetScope, endingIntent = null,
    writerProvider = 'zhipu', writerModel = 'glm-4.7', validatorProvider = 'deepseek', validatorModel = 'deepseek-flash', adopt = true }) => {
    const brief = { operation, source_version_id: source?.id || null, target_scope: targetScope,
      user_instruction: instruction, ending_intent: endingIntent,
      hard_preserve: [], soft_preserve: [], output_preferences: { target_length: 200, person: '第三人称', tone: '克制' } };
    const created = await request('/api/generate', { work_id: workId, context: '', brief,
      source_hash: source ? sha256(`${source.title}\n${source.content}`) : null,
      model_selection: { writer_provider_id: writerProvider, writer_model_id: writerModel,
        validator_provider_id: validatorProvider, validator_model_id: validatorModel } });
    check(`task_created_${operation}_${Object.keys(checks).length}`, created.status === 201, created.payload.error);
    const written = await request(`/api/tasks/${created.payload.task.id}/write`, {});
    check(`writer_saved_${operation}_${Object.keys(checks).length}`, written.status === 201, written.payload.error);
    const validated = await request(`/api/tasks/${created.payload.task.id}/validate`, {});
    if (validated.status !== 200) return { created, written, validated, candidate: written.payload.candidate };
    if (!adopt || validated.payload.candidate.validation_status !== 'passed') return { created, written, validated, candidate: validated.payload.candidate };
    const adopted = await request('/api/versions/adopt', { work_id: created.payload.work_id, version_id: validated.payload.candidate.id });
    check(`adopted_${operation}_${Object.keys(checks).length}`, adopted.status === 200, adopted.payload.error);
    return { created, written, validated, adopted, workId: created.payload.work_id, version: adopted.payload.version };
  };

  const initial = await execute({ operation: 'CREATE', instruction: '创建作品A：承担债务并保留土地。', targetScope: { type: 'full' } });
  const language = await execute({ operation: 'CREATE', instruction: 'QA_LANGUAGE', targetScope: { type: 'full' }, adopt: false });
  const languageChecks = language.validated.payload.candidate?.checks?.filter((item) => item.finding_type === 'language_quality') || [];
  check('language_quality_reuses_validator_and_never_blocks', language.validated.status === 200
    && language.validated.payload.candidate.validation_status === 'passed' && languageChecks.length === 3
    && languageChecks.every((item) => item.status === 'warning'), languageChecks);
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(language.created.payload.work_id)}`);
  await page.locator('[data-action="open-checks"]').click();
  await page.getByText('LANGUAGE_EXPLICIT_LANGUAGE_ERROR', { exact: true }).first().waitFor();
  await capture(page, 'language-quality-review-1366', true);
  await page.locator('[data-action="close-overlay"]').click();
  const rewriteStart = initial.version.content.indexOf('产权清晰');
  const rewritten = await execute({ workId: initial.workId, source: initial.version, operation: 'REWRITE', instruction: '把产权表述改得更明确。',
    targetScope: { type: 'selection', start: rewriteStart, end: rewriteStart + 4, selected_text: '产权清晰' } });
  const expandText = '他没有卖地，而是开始逐笔记录债务。';
  const expandStart = rewritten.version.content.indexOf(expandText);
  const expanded = await execute({ workId: initial.workId, source: rewritten.version, operation: 'EXPAND', instruction: '扩写他承担债务的具体行动。',
    targetScope: { type: 'selection', start: expandStart, end: expandStart + expandText.length, selected_text: expandText } });
  const continued = await execute({ workId: initial.workId, source: expanded.version, operation: 'CONTINUE', instruction: '从第二天继续，推动债务协商。',
    targetScope: { type: 'next_segment' }, writerProvider: 'deepseek', writerModel: 'deepseek-v4-pro', validatorProvider: 'zhipu', validatorModel: 'glm-4.7-flash' });
  check('continue_preserves_full_source', continued.version.content.startsWith(expanded.version.content));
  check('continue_protects_work_title', continued.version.title === initial.version.title && continued.version.segment_title === '第二集：清晨', continued.version);
  check('cross_provider_memory_injected', calls.some((item) => item.role === 'writer' && item.operation === 'CONTINUE' && item.has_story_memory));
  const finalSentence = '灯亮了，他继续向前走。';
  const ended = await execute({ workId: initial.workId, source: continued.version, operation: 'CONTINUE', instruction: '处理债务并按指定结局自然收束。',
    targetScope: { type: 'next_segment' }, endingIntent: { mode: 'specified_ending', requirements: '保住选择权并处理债务。', exact_final_sentence: finalSentence } });
  check('specified_final_sentence_exact', ended.version.content.endsWith(finalSentence));
  check('exact_final_sentence_check_bound', ended.version.checks.some((item) => item.check === 'EXACT_FINAL_SENTENCE' && item.status === 'pass'));

  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(initial.workId)}`);
  await page.locator('[data-action="show-overview"]').first().click();
  await page.getByText('正式剧情 · 已采用', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await capture(page, 'story-overview-1600', true);
  await page.locator('#futurePlotPlan').fill('继续完成分期还款');
  await page.locator('#endingPlan').fill('保留人物最终选择权');
  await page.locator('#foreshadowingPlan').fill('旧账本在结尾被重新翻开');
  await page.locator('[data-action="save-story-plan"]').click();
  const plannedOverview = await request(`/api/works/${initial.workId}/overview`, null, 'GET');
  check('future_plan_is_separate_from_formal_story', plannedOverview.payload.future_planning.future_plot[0] === '继续完成分期还款'
    && plannedOverview.payload.formal_story.version_id === ended.version.id);
  check('relationship_tree_uses_adopted_memory_only', plannedOverview.payload.relationship_tree.protagonist?.name === '林川'
    && plannedOverview.payload.relationship_tree.groups.interest_debt.some((item) => item.name === '阿坤')
    && plannedOverview.payload.relationship_tree.groups.work.some((item) => item.name === '周磊'));
  await page.locator('[data-action="request-complete-work"]').first().click();
  await page.locator('[data-action="confirm-work-status"]').click();
  const completedOverview = await request(`/api/works/${initial.workId}/overview`, null, 'GET');
  check('completion_requires_explicit_user_action', completedOverview.payload.work.story_status === 'completed');
  await page.locator('[data-action="request-reopen-work"]').first().click();
  await page.locator('[data-action="confirm-work-status"]').click();
  const reopenedOverview = await request(`/api/works/${initial.workId}/overview`, null, 'GET');
  check('completed_work_can_reopen', reopenedOverview.payload.work.story_status === 'active');

  await page.locator('[data-action="show-editor"]').first().click();
  if (await page.locator('[data-operation="CONTINUE"]').count() === 0) await page.locator('.composer-expand').click();
  await page.locator('[data-operation="CONTINUE"]').click();
  await page.locator('#endingMode').selectOption('specified_ending');
  await page.locator('#endingRequirements').fill('处理未解决冲突并保留人物选择权');
  await page.locator('#exactFinalSentence').fill(finalSentence);
  await page.setViewportSize({ width: 1366, height: 900 });
  await capture(page, 'ending-intent-specified-1366', true);

  const conflict = await execute({ workId: initial.workId, source: ended.version, operation: 'CONTINUE', instruction: 'QA_FACT_CONFLICT',
    targetScope: { type: 'next_segment' }, adopt: false });
  check('story_fact_conflict_blocks', conflict.validated.status === 200 && conflict.validated.payload.candidate?.validation_status === 'blocked', conflict.validated);
  check('story_fact_conflict_has_two_scope_evidence', conflict.validated.payload.candidate.checks.some((item) =>
    item.check === 'STORY_FACT_CONFLICT' && item.evidence_locations?.some((e) => e.source === 'source_content')
      && item.evidence_locations?.some((e) => e.source === 'generated_segment')));

  const writerCallsBeforeFailure = calls.filter((item) => item.role === 'writer').length;
  const failed = await execute({ workId: initial.workId, source: ended.version, operation: 'CONTINUE', instruction: 'QA_VALIDATOR_429',
    targetScope: { type: 'next_segment' }, adopt: false });
  check('validator_429_keeps_candidate', [429, 502, 503].includes(failed.validated.status) && Boolean(failed.candidate?.id), failed.validated);
  check('validator_429_is_precise', failed.validated.payload.error?.code === 'PROVIDER_RATE_LIMITED', failed.validated.payload.error);
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(initial.workId)}`);
  await page.locator('[data-action="request-candidate-revalidation"]').waitFor();
  check('consumed_prompt_kept_read_only_on_candidate', await page.locator('details.consumed-prompt').count() === 1);
  await page.locator('[data-action="show-editor"]').first().click();
  if (await page.locator('#composerInput').count() === 0) await page.locator('.composer-expand').click();
  check('consumed_prompt_cleared_after_writer_save', await page.locator('#composerInput').inputValue() === '');
  await page.locator('[data-action="show-candidate"]').first().click();
  await page.locator('[data-action="request-candidate-revalidation"]').click();
  check('retry_validation_opens_cost_provider_confirmation', await page.getByText('重新检查这份候选？', { exact: true }).isVisible()
    && await page.locator('#revalidationDisclosure').isVisible()
    && await page.getByText('本次重新检查可能产生 Validator API 费用。', { exact: false }).isVisible());
  check('opening_retry_modal_does_not_repeat_writer', calls.filter((item) => item.role === 'writer').length === writerCallsBeforeFailure + 1);
  await page.locator('[data-action="close-modal"]').first().click();

  const second = await execute({ operation: 'CREATE', instruction: '创建作品B，用于作品切换隔离。作品B', targetScope: { type: 'full' } });
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(initial.workId)}`);
  await page.locator('[data-action="open-work-switcher"]').first().click();
  await page.locator('#workSearchInput').fill('第二部测试作品');
  await page.locator('#workSearchInput').dispatchEvent('input');
  check('work_search_isolated_result', await page.locator(`[data-work-id="${second.workId}"]`).count() === 1);
  await page.locator(`[data-work-id="${second.workId}"]`).click();
  await page.waitForFunction((workId) => new URL(location.href).searchParams.get('work_id') === workId, second.workId);
  await page.getByText('第二部测试作品', { exact: true }).first().waitFor();
  check('work_switch_does_not_cross_content', (await page.locator('#headerWorkTitle').textContent())?.trim() === '第二部测试作品');

  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(initial.workId)}`);
  const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
  await page.locator('[data-action="export-current"]').first().click();
  const download = await downloadPromise;
  const downloadPath = download ? await download.path().catch(() => null) : null;
  const exportedFiles = await readdir(exportRoot).catch(() => []);
  const exportedPath = exportedFiles.length ? path.join(exportRoot, exportedFiles[0]) : downloadPath;
  check('markdown_export_created', Boolean(download) && Boolean(exportedPath),
    { download_event: Boolean(download), suggested_filename: download?.suggestedFilename() || null,
      qa_save_path_files: exportedFiles, playwright_download_path: Boolean(downloadPath) });
  const exported = await readFile(exportedPath, 'utf8');
  check('markdown_export_preserves_full_text_and_tail', exported.includes(ended.version.content) && exported.includes(finalSentence));

  const responsive = {};
  for (const width of [1600, 1366, 1200, 1024, 768, 480]) {
    await page.setViewportSize({ width, height: width <= 480 ? 844 : 900 });
    await page.locator('[data-action="show-overview"]').first().click();
    const metrics = await page.evaluate(() => ({ innerWidth, scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth, horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    responsive[String(width)] = metrics;
    check(`responsive_no_horizontal_overflow_${width}`, !metrics.horizontalOverflow, metrics);
    await capture(page, `responsive-overview-${width}`, false);
  }

  const migrationChecks = await Promise.all(['0000_low_the_fallen.sql', '0001_kind_the_spike.sql', '0002_conscious_oracle.sql',
    '0003_transport_attempts_and_version_restores.sql', '0004_multi_provider_and_task_control.sql',
    '0005_candidate_validation_runs.sql', '0006_story_memory_snapshots.sql', '0007_open_model_api_routes.sql',
    '0008_text_studio_completion_and_planning.sql', '0009_stability_and_creative_intelligence.sql'].map((name) => stat(path.join(packagedMigrations, name)).then(() => true).catch(() => false)));
  check('all_migrations_0000_through_0009_packaged', migrationChecks.every(Boolean), migrationChecks);
  check('no_real_provider_was_called', calls.every((item) => ['zhipu', 'deepseek'].includes(item.provider)));

  const db = new SQLiteD1(paths.database);
  const database = {
    works: (await db.prepare('SELECT COUNT(*) AS count FROM works').first()).count,
    versions: (await db.prepare('SELECT COUNT(*) AS count FROM versions').first()).count,
    story_memory_snapshots: (await db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots').first()).count,
    work_story_plans: (await db.prepare('SELECT COUNT(*) AS count FROM work_story_plans').first()).count,
    validation_runs: (await db.prepare('SELECT COUNT(*) AS count FROM candidate_validation_runs').first()).count
  };
  db.close();
  const status = JSON.parse(await readFile(statusFile, 'utf8'));
  const evidence = { completed_at: new Date().toISOString(), archive, executable, data_root: dataRoot,
    environment: 'ZIP-extracted packaged Electron + isolated SQLite + controlled Provider (no paid API)',
    package: packageEvidence, process_versions: status.process_versions, startup_ms: status.startup_ms,
    metrics: status.metrics, checks, calls, database, screenshots, responsive };
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ evidence_file: evidenceFile, checks: Object.keys(checks).length,
    screenshots: Object.keys(screenshots).length, database, startup_ms: status.startup_ms }, null, 2));
} finally {
  await browser?.close().catch(() => {});
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}
