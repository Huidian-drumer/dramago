import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { defaultProviderConfiguration, WindowsDpapiProviderSecretStore, writeProviderConfiguration } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const archive = process.env.DRAMAGO_ACCEPTANCE_ZIP
  || path.join(root, 'artifacts', 'windows', 'DramaGo-0.5.0-windows-x64-portable-internal-v1-2-g2-open-model-api.zip');
const runRoot = path.join(root, '.cache', `windows-v1-2-g2-extracted-${Date.now()}`);
const extractRoot = path.join(runRoot, 'package');
const dataRoot = path.join(runRoot, 'data');
const electronUserData = path.join(runRoot, 'electron-user-data');
const reportDir = path.join(root, 'reports', 'windows-v1-2-open-model-api');
const statusFile = path.join(reportDir, 'packaged-status.json');
const reportFile = path.join(reportDir, 'PACKAGED_EXE_EVIDENCE.json');
await mkdir(extractRoot, { recursive: true });
await mkdir(reportDir, { recursive: true });
const unpack = spawnSync('tar.exe', ['-xf', archive, '-C', extractRoot], { encoding: 'utf8', windowsHide: true });
if (unpack.status !== 0) throw new Error(`Unable to extract package: ${unpack.stderr || unpack.stdout}`);
const executable = path.join(extractRoot, 'DramaGo-win32-x64', 'DramaGo.exe');
const packagedMigrations = path.join(extractRoot, 'DramaGo-win32-x64', 'resources', 'app.asar.unpacked', 'drizzle');

const calls = [];
const passValidation = {
  findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林宁'], relationships: [], irreversible_facts: [], major_events: ['完成抉择'], time_anchors: ['次日'] },
  source_story_memory: { completeness: 'incomplete', characters: [], events: [], persistent_facts: [], open_threads: [] },
  candidate_story_memory: { completeness: 'available',
    characters: [{ id: 'linning', name: '林宁', identity: '档案管理员', relationships: [], state: '继续调查', status: 'active',
      truth_status: 'objective', certainty: 'confirmed', time_context: '当前', evidence: [{ quote: '林宁', start: 0, end: 2 }] }],
    events: [], persistent_facts: [], open_threads: [] }
};

function openAi(content, model) {
  return JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], model,
    usage: { prompt_tokens: 31, completion_tokens: 47, total_tokens: 78 } });
}

const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const system = String(body.messages?.[0]?.content || '');
  const userRaw = String(body.messages?.[1]?.content || '');
  let user = {};
  try { user = JSON.parse(userRaw); } catch {}
  const kind = system.includes('独立于 Writer 的内容一致性校验器') ? 'validator'
    : system.includes('ContentPlan') ? 'planner' : 'writer';
  calls.push({ kind, model: body.model, authorization: request.headers.authorization === 'Bearer z-key' ? 'zhipu-key'
    : request.headers.authorization === 'Bearer d-key' ? 'deepseek-key' : 'unexpected',
  has_story_memory: Boolean(user.story_memory_context), response_format_sent: Boolean(body.response_format) });
  let content;
  if (kind === 'validator') {
    const shouldBlock = user.creative_brief?.user_instruction?.includes('QA_BLOCK_FOR_REVALIDATION')
      && body.model === 'glm-4.7-flash';
    content = shouldBlock ? { ...passValidation, findings: [{ finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION',
      severity: 'blocking', confidence: 0.99, source_priority: 'explicit_user_hard_constraint',
      fact_basis: 'confirmed_objective', evidence: ['林宁'], evidence_scope: 'generated_segment',
      evidence_locations: [{ source: 'generated_segment', quote: '林宁', start: 3, end: 5 }], reason: '受控阻断。' }] } : passValidation;
  } else if (kind === 'planner') {
    content = { identity_fantasy: '档案管理员', core_conflict: '旧档案留下未解问题', audience_expectation: '看见选择后果',
      primary_agency: '林宁主动调查', main_payoff: '完成抉择', ending_mode: '阶段收束', negative_constraints: [],
      opening_promises: [], required_payoffs: [], selected_mechanisms: [] };
  } else if (user.creative_brief?.operation === 'CONTINUE') {
    content = { output_kind: 'continuation', title: '档案室之后', content: '次日，林宁整理完新线索，决定先核实再行动。',
      change_summary: '受控续写', model_warnings: [] };
  } else {
    content = { output_kind: 'full', title: '档案室之后', content: `林宁打开旧档案，决定亲自核实记录。${'她没有把猜测当成事实。'.repeat(30)}`,
      change_summary: '受控生成', model_warnings: [] };
  }
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
await rm(statusFile, { force: true });
const desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
  cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore', env: { ...process.env,
    DRAMAGO_DATA_DIR: dataRoot, DRAMAGO_ELECTRON_USER_DATA: electronUserData, DRAMAGO_DESKTOP_QA_STATUS: statusFile,
    DRAMAGO_INTERNAL_QA: '1', DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions` }
});

let browser;
const checks = {};
function check(name, value, details = null) { checks[name] = { passed: Boolean(value), details }; if (!value) throw new Error(`${name}: ${JSON.stringify(details)}`); }
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
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check('packaged_window_ready', Boolean(page));
  await page.locator('[data-action="open-settings"]').first().click();
  check('packaged_provider_settings_visible', await page.locator('#providerPlatformSetting').isVisible());
  check('packaged_independent_role_settings_visible', await page.locator('#defaultWriterProviderSetting').isVisible()
    && await page.locator('#defaultValidatorProviderSetting').isVisible());
  check('packaged_provider_settings_hide_key', await page.locator('#providerKeySetting').getAttribute('type') === 'password');
  await page.locator('[data-action="close-overlay"]').click();
  check('packaged_task_role_selectors_visible', await page.locator('#taskModelSelection').isVisible()
    && await page.locator('#taskValidatorSelection').isVisible());
  const request = (pathname, body = null, method = 'POST') => page.evaluate(async ({ pathname, body, method }) => {
    const token = document.querySelector('meta[name="dramago-local-token"]').content;
    const response = await fetch(pathname, { method, headers: { 'x-dramago-local-token': token,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}) });
    return { status: response.status, payload: await response.json() };
  }, { pathname, body, method });

  const created = await request('/api/generate', { work_id: 'packaged-g2', context: '',
    model_selection: { writer_provider_id: 'zhipu', writer_model_id: 'glm-4.7',
      validator_provider_id: 'deepseek', validator_model_id: 'deepseek-flash' },
    brief: { operation: 'CREATE', user_instruction: '生成受控故事。', output_preferences: { target_length: 300 } } });
  check('cross_provider_task_created', created.status === 201, created.payload.error);
  const write = await request(`/api/tasks/${created.payload.task.id}/write`);
  const validate = await request(`/api/tasks/${created.payload.task.id}/validate`);
  const adopt = await request('/api/versions/adopt', { work_id: 'packaged-g2', version_id: write.payload.candidate.id });
  check('glm_writer_deepseek_validator', write.status === 201 && validate.status === 200
    && created.payload.task.writer_provider_id === 'zhipu' && created.payload.task.validator_provider_id === 'deepseek');
  check('candidate_adopt_cas', adopt.status === 200, adopt.payload.error);

  const source = adopt.payload.version;
  const sourceHash = createHash('sha256').update(`${source.title}\n${source.content}`).digest('hex');
  const cont = await request('/api/generate', { work_id: 'packaged-g2', source_hash: sourceHash,
    model_selection: { writer_provider_id: 'zhipu', writer_model_id: 'glm-4.7',
      validator_provider_id: 'zhipu', validator_model_id: 'glm-4.7-flash' },
    brief: { operation: 'CONTINUE', source_version_id: source.id, target_scope: { type: 'next_segment' },
      user_instruction: 'QA_BLOCK_FOR_REVALIDATION 从次日续写，不复述前文。' } });
  const contWrite = await request(`/api/tasks/${cont.payload.task.id}/write`);
  const contValidate = await request(`/api/tasks/${cont.payload.task.id}/validate`);
  check('story_memory_reaches_cross_provider_writer', calls.some((item) => item.kind === 'writer' && item.has_story_memory));
  check('controlled_candidate_blocked', contValidate.payload.candidate.validation_status === 'blocked');
  const hashBefore = contWrite.payload.candidate.content_hash;
  const contentBefore = contWrite.payload.candidate.content;
  const revalidated = await request(`/api/versions/${contWrite.payload.candidate.id}/revalidate`, {
    work_id: 'packaged-g2', candidate_content_hash: hashBefore, confirm_validator_cost: true,
    confirm_third_party_disclosure: true,
    validator_selection: { provider_id: 'deepseek', validator_model_id: 'deepseek-flash' }
  });
  check('revalidation_only_deepseek_validator', revalidated.status === 200
    && revalidated.payload.validation_runs[0].provider_id === 'deepseek' && revalidated.payload.writer_called === false);
  check('revalidation_preserves_candidate_hash', revalidated.payload.candidate.content_hash === hashBefore
    && revalidated.payload.candidate.content === contentBefore);
  check('old_validation_history_retained', revalidated.payload.validation_runs.length === 2
    && revalidated.payload.validation_runs[1].provider_id === 'zhipu');
  const migrationChecks = await Promise.all(['0005_candidate_validation_runs.sql', '0006_story_memory_snapshots.sql',
    '0007_open_model_api_routes.sql'].map((name) => stat(path.join(packagedMigrations, name)).then(() => true).catch(() => false)));
  check('required_migrations_packaged', migrationChecks.every(Boolean), migrationChecks);
} finally {
  await browser?.close().catch(() => {});
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}

const db = new SQLiteD1(paths.database);
const dbEvidence = {
  tasks: (await db.prepare('SELECT COUNT(*) AS count FROM generation_tasks').first()).count,
  validation_runs: (await db.prepare('SELECT COUNT(*) AS count FROM candidate_validation_runs').first()).count,
  memory_snapshots: (await db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots').first()).count
};
db.close();
const evidence = { completed_at: new Date().toISOString(), archive, executable, data_root: dataRoot,
  environment: 'ZIP-extracted packaged Electron + isolated SQLite + controlled Provider', checks, calls, database: dbEvidence };
await writeFile(reportFile, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ report_file: reportFile, checks, database: dbEvidence }, null, 2));
