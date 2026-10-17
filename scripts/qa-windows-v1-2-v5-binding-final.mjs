import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { applyMigrations } from '../local/migrations.mjs';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { defaultProviderConfiguration, WindowsDpapiProviderSecretStore, writeProviderConfiguration } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const archive = process.env.DRAMAGO_ACCEPTANCE_ZIP
  || path.join(root, 'artifacts', 'windows', 'DramaGo-v1.2-windows-x64-internal-v5-binding-final.zip');
const runRoot = path.join(root, '.cache', `windows-v1-2-v5-binding-final-${Date.now()}`);
const cacheRoot = path.join(root, '.cache');
if (!path.resolve(runRoot).startsWith(`${path.resolve(cacheRoot)}${path.sep}`)) throw new Error('Unsafe QA run directory.');
const extractRoot = path.join(runRoot, 'package');
const dataRoot = path.join(runRoot, 'data');
const electronUserData = path.join(runRoot, 'electron-user-data');
const reportDir = process.env.DRAMAGO_ACCEPTANCE_REPORT_DIR
  ? path.resolve(process.env.DRAMAGO_ACCEPTANCE_REPORT_DIR)
  : path.join(root, 'reports', 'windows-v1-2-v5-binding-final');
const screenshotDir = path.join(reportDir, 'screenshots');
const statusFile = path.join(runRoot, 'packaged-status.json');
const evidenceFile = path.join(reportDir, 'PACKAGED_EXE_ACCEPTANCE.json');
await mkdir(extractRoot, { recursive: true });
await mkdir(screenshotDir, { recursive: true });

const unpack = spawnSync('tar.exe', ['-xf', archive, '-C', extractRoot], { encoding: 'utf8', windowsHide: true });
if (unpack.status !== 0) throw new Error(`Unable to extract final package: ${unpack.stderr || unpack.stdout}`);
const packageRoot = path.join(extractRoot, 'DramaGo-win32-x64');
const executable = path.join(packageRoot, 'DramaGo.exe');
const packagedWorker = path.join(packageRoot, 'resources', 'app.asar.unpacked', 'dist', 'server', 'index.js');
const sourceWorker = path.join(root, 'dist', 'server', 'index.js');

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
async function fileHash(filename) { return sha256(await readFile(filename)); }

const sourceWorkerHash = await fileHash(sourceWorker);
const packagedWorkerHash = await fileHash(packagedWorker);
const packagedWorkerSource = await readFile(packagedWorker, 'utf8');
const packageEvidence = {
  source_worker_sha256: sourceWorkerHash,
  packaged_worker_sha256: packagedWorkerHash,
  exact_worker_match: sourceWorkerHash === packagedWorkerHash,
  contains_compatibility_rebuild: packagedWorkerSource.includes('recomputed_from_candidate_source_and_contract'),
  contains_program_append_guard: packagedWorkerSource.includes('DETERMINISTIC_REBUILD_MERGE_MISMATCH'),
  contains_binding_diagnostics: packagedWorkerSource.includes('binding_diagnostics')
};
if (!Object.values(packageEvidence).every(Boolean)) throw new Error(`Packaged worker mismatch: ${JSON.stringify(packageEvidence)}`);

const paths = localPaths(dataRoot);
await ensureLocalDirectories(paths);
const db = new SQLiteD1(paths.database);
await applyMigrations(db, path.join(root, 'drizzle'));

const workId = 'qa_v5_binding_work';
const versionIds = { V1: 'qa_version_v1', V2: 'qa_version_v2', V3: 'qa_version_v3', V4: 'qa_version_v4', V5: 'qa_version_v5' };
const taskId = 'qa_task_v5_continue';
const runIds = { blocked: 'qa_run_glm_blocked', unknown: 'qa_run_glm_unknown', passed: 'qa_run_deepseek_passed' };
const title = 'V5 绑定修复合成验收';
const sourceContent = '林宁在档案室整理完旧案。她决定第二天继续核实线索。';
const generatedSegment = '第二天，林宁带着记录来到社区，确认了关键证词，并决定公开更正档案。';
const candidateContent = `${sourceContent}\n\n${generatedSegment}`;
const sourceContentHash = sha256(sourceContent);
const sourceDocumentHash = sha256(`${title}\n${sourceContent}`);
const candidateHash = sha256(candidateContent);
const generatedSegmentHash = sha256(generatedSegment);
const validatorV2 = 'content-semantic-v2';
const validatorV21 = 'content-semantic-v2.1-scope';
const brief = {
  operation: 'CONTINUE', source_version_id: versionIds.V3,
  target_scope: { type: 'next_segment' }, user_instruction: '从第二天继续，不复述前文。',
  hard_preserve: [], soft_preserve: [], required_outcomes: []
};
const oldBaseChecks = [
  { finding_type: 'deterministic', check: 'CONTINUATION_PRESERVES_SOURCE', status: 'pass',
    message: '续写内容追加保存，前文未被覆盖。', candidate_version_id: versionIds.V5,
    content_hash: candidateHash, validator_version: validatorV2 },
  { finding_type: 'manual_pending', check: 'AUTHOR_INTENT_AND_QUALITY', status: 'unassessed',
    message: '作者要求的完成度仍需人工验收。', candidate_version_id: versionIds.V5,
    content_hash: candidateHash, validator_version: validatorV2 }
];
const staleLegacyBlocking = { finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION',
  check: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION', status: 'fail',
  message: '旧版将来源正文误归因于新增内容。', candidate_version_id: versionIds.V5,
  content_hash: candidateHash, validator_version: validatorV2 };
const candidateQuoteStart = candidateContent.indexOf('林宁');
const passedSemantic = {
  findings: [], blockingConflicts: [], warnings: [], requiredOutcomesMet: true,
  preserveStatus: { hardMet: true, softMet: true, notes: [] },
  promisePayoffStatus: { met: true, missingPayoffs: [], notes: [] },
  negativeConstraintStatus: { met: true, severity: 'pass', violations: [] },
  candidateInternalConsistency: { consistent: true, conflicts: [] }, operationCompleted: true,
  sourceStoryFacts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidateStoryFacts: { characters: ['林宁'], relationships: [], irreversible_facts: [], major_events: ['核实证词'], time_anchors: ['第二天'] },
  sourceStoryMemory: null,
  candidateStoryMemory: {
    completeness: 'available',
    characters: [{ id: 'linning', name: '林宁', identity: '档案整理员', relationships: [], state: '继续核实旧案',
      status: 'active', truth_status: 'objective', certainty: 'confirmed', time_context: '第二天',
      evidence: [{ quote: '林宁', start: candidateQuoteStart, end: candidateQuoteStart + 2 }] }],
    events: [], persistent_facts: [], open_threads: []
  }
};
const blockedChecks = [...oldBaseChecks, staleLegacyBlocking];
const created = {
  V1: '2026-10-15T01:00:00.000Z', V2: '2026-10-15T01:01:00.000Z', V3: '2026-10-15T01:02:00.000Z',
  V4: '2026-10-15T01:03:00.000Z', V5: '2026-10-15T01:04:00.000Z',
  blocked: '2026-10-15T01:05:00.000Z', unknown: '2026-10-15T01:06:00.000Z', passed: '2026-10-15T01:07:00.000Z'
};

await db.batch([
  db.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(workId, title, versionIds.V3, created.V1, created.passed),
  db.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, creative_brief_json, checks_json,
      content_hash, validation_status, can_auto_apply, adopted_at, created_at)
    VALUES (?, ?, NULL, 'CREATE', 'adopted', ?, ?, '{}', '[]', ?, 'pending', 0, ?, ?)`)
    .bind(versionIds.V1, workId, title, '合成历史一。', sha256('合成历史一。'), created.V1, created.V1),
  db.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, creative_brief_json, checks_json,
      content_hash, validation_status, can_auto_apply, adopted_at, created_at)
    VALUES (?, ?, ?, 'REWRITE', 'adopted', ?, ?, '{}', '[]', ?, 'pending', 0, ?, ?)`)
    .bind(versionIds.V2, workId, versionIds.V1, title, '合成历史二。', sha256('合成历史二。'), created.V2, created.V2),
  db.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, creative_brief_json, checks_json,
      content_hash, validation_status, can_auto_apply, adopted_at, created_at)
    VALUES (?, ?, ?, 'REWRITE', 'adopted', ?, ?, '{}', '[]', ?, 'pending', 0, ?, ?)`)
    .bind(versionIds.V3, workId, versionIds.V2, title, sourceContent, sourceContentHash, created.V3, created.V3),
  db.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, creative_brief_json, checks_json,
      content_hash, validation_status, can_auto_apply, created_at)
    VALUES (?, ?, ?, 'CREATE', 'candidate', ?, ?, '{}', '[]', ?, 'blocked', 0, ?)`)
    .bind(versionIds.V4, workId, versionIds.V3, title, '保留的旧错误候选。', sha256('保留的旧错误候选。'), created.V4),
  db.prepare(`INSERT INTO versions
    (id, work_id, parent_version_id, operation, status, title, content, generated_segment, creative_brief_json,
      change_summary, checks_json, model_name, content_hash, validator_version, validation_status, can_auto_apply,
      validated_at, writer_provider_id, writer_model_id, validator_provider_id, validator_model_id,
      provider_config_version, writer_provider_config_version, validator_provider_config_version,
      current_validation_run_id, created_at)
    VALUES (?, ?, ?, 'CONTINUE', 'candidate', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'passed', 0, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`)
    .bind(versionIds.V5, workId, versionIds.V3, title, candidateContent, generatedSegment, JSON.stringify(brief),
      '合成续写', JSON.stringify(blockedChecks), 'glm-4.7', candidateHash, validatorV21, created.passed,
      'zhipu', 'glm-4.7', 'deepseek', 'deepseek-flash', runIds.passed, created.V5),
  db.prepare(`INSERT INTO generation_tasks
    (id, work_id, source_version_id, creative_brief_json, source_hash, status, provider, model_name,
      result_version_id, created_at, completed_at, prompt_template_id, merge_strategy, output_kind,
      candidate_content_hash, validator_version, validation_status, source_is_current, execution_input_json,
      stage, updated_at, validator_model_name, semantic_validation_json, writer_provider_id, writer_model_id,
      validator_provider_id, validator_model_id, provider_config_version, writer_provider_config_version,
      validator_provider_config_version)
    VALUES (?, ?, ?, ?, ?, 'completed', 'zhipu', 'glm-4.7', ?, ?, ?, 'creative-writer-v2',
      'PROGRAM_APPEND', 'continuation', ?, ?, 'blocked', 1, ?, 'completed', ?, 'glm-4.7-flash', ?,
      'zhipu', 'glm-4.7', 'zhipu', 'glm-4.7-flash', 1, 1, 1)`)
    .bind(taskId, workId, versionIds.V3, JSON.stringify(brief), sourceDocumentHash, versionIds.V5,
      created.V5, created.blocked, candidateHash, validatorV2, JSON.stringify({ brief, context: '' }),
      created.blocked, JSON.stringify({ unavailable: false })),
  db.prepare(`INSERT INTO candidate_validation_runs
    (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id, source_content_hash,
      operation, trigger, validator_version, provider_id, model_name, status, checks_json, semantic_validation_json,
      confirmed_cost_risk, outcome_unknown, retry_confirmation_required, created_at, completed_at,
      provider_config_version, credential_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'legacy_snapshot', ?, 'zhipu', 'glm-4.7-flash', 'blocked', ?, ?,
      0, 0, 0, ?, ?, 1, 'qa:zhipu')`)
    .bind(runIds.blocked, taskId, workId, versionIds.V5, candidateHash, versionIds.V3, sourceContentHash,
      validatorV2, JSON.stringify(blockedChecks), JSON.stringify({ unavailable: false }), created.blocked, created.blocked),
  db.prepare(`INSERT INTO candidate_validation_runs
    (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id, source_content_hash,
      operation, trigger, validator_version, provider_id, model_name, status, confirmed_cost_risk,
      outcome_unknown, retry_confirmation_required, error_code, created_at, completed_at,
      provider_config_version, credential_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'user_revalidation', ?, 'zhipu', 'glm-4.7-flash', 'outcome_unknown',
      1, 1, 1, 'PROVIDER_TIMEOUT', ?, ?, 1, 'qa:zhipu')`)
    .bind(runIds.unknown, taskId, workId, versionIds.V5, candidateHash, versionIds.V3, sourceContentHash,
      validatorV21, created.unknown, created.unknown),
  db.prepare(`INSERT INTO candidate_validation_runs
    (id, task_id, work_id, candidate_version_id, candidate_content_hash, source_version_id, source_content_hash,
      operation, trigger, validator_version, provider_id, model_name, status, checks_json, semantic_validation_json,
      confirmed_cost_risk, outcome_unknown, retry_confirmation_required, created_at, completed_at,
      provider_config_version, credential_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'user_revalidation', ?, 'deepseek', 'deepseek-flash', 'passed', ?, ?,
      1, 0, 0, ?, ?, 1, 'qa:deepseek')`)
    .bind(runIds.passed, taskId, workId, versionIds.V5, candidateHash, versionIds.V3, sourceContentHash,
      validatorV21, JSON.stringify(blockedChecks), JSON.stringify(passedSemantic), created.passed, created.passed)
]);
const preAdoptMemory = await db.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
  .bind(versionIds.V5).first();
db.close();

const config = structuredClone(defaultProviderConfiguration);
for (const providerId of ['zhipu', 'deepseek']) config.providers[providerId].disclosure_confirmed_at = created.V5;
config.selected_writer = { provider_id: 'zhipu', model_id: 'glm-4.7' };
config.selected_validator = { provider_id: 'deepseek', model_id: 'deepseek-flash' };
await writeProviderConfiguration(paths.providerConfig, config);
const secrets = new WindowsDpapiProviderSecretStore(paths.providerSecrets);
await secrets.set('zhipu', 'controlled-zhipu-key');
await secrets.set('deepseek', 'controlled-deepseek-key');

const providerCalls = [];
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  providerCalls.push({ method: request.method, bytes: Buffer.concat(chunks).length });
  response.writeHead(500, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { message: 'No model call is permitted in V5 binding acceptance.' } }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const cdpPort = await freePort();
const desktop = spawn(executable, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
  cwd: path.dirname(executable), windowsHide: false, stdio: 'ignore', env: {
    ...process.env,
    DRAMAGO_DATA_DIR: dataRoot,
    DRAMAGO_ELECTRON_USER_DATA: electronUserData,
    DRAMAGO_DESKTOP_QA_STATUS: statusFile,
    DRAMAGO_INTERNAL_QA: '1',
    DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`
  }
});

let browser;
const checks = {};
const screenshots = {};
function check(name, value, details = null) {
  checks[name] = { passed: Boolean(value), details };
  if (!value) throw new Error(`${name}: ${JSON.stringify(details)}`);
}
async function capture(page, name) {
  const filename = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: false });
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
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check('packaged_window_ready', Boolean(page));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${new URL(page.url()).origin}/?work_id=${encodeURIComponent(workId)}`);
  await page.locator('[data-action="open-history"]').first().click();
  await page.locator(`[data-version-id="${versionIds.V5}"]`).click();
  await page.getByText('历史审核通过', { exact: true }).first().waitFor({ timeout: 30000 });

  const adoptButton = page.locator('[data-action="adopt-candidate"]').last();
  check('v5_equivalent_displayed', await page.getByText(/候选 V5/u).count() > 0);
  check('historical_validation_clearly_labeled', await page.getByText('历史审核通过', { exact: true }).count() > 0);
  check('candidate_adopt_button_enabled', await adoptButton.isEnabled());
  await capture(page, '01-current-effective-validation-passed');

  await page.locator('[data-action="open-checks"]').first().click();
  await page.getByText('当前有效检查', { exact: true }).waitFor();
  check('compatibility_notice_visible', await page.getByText('已从既有检查记录重建当前视图', { exact: true }).isVisible());
  check('validation_history_count_three', await page.locator('.validation-history-item').count() === 3);
  check('history_blocked_preserved', await page.getByText(/原检查记录 · 检查阻断/u).count() === 1);
  check('history_outcome_unknown_preserved', await page.getByText(/用户主动重新检查 · 远端结果未知/u).count() === 1);
  check('history_passed_preserved', await page.getByText(/用户主动重新检查 · 检查通过/u).count() === 1);
  await capture(page, '02-validation-history-preserved');
  await page.locator('[data-action="close-overlay"]').click();

  check('provider_calls_before_adopt_zero', providerCalls.length === 0, providerCalls);
  await page.locator('[data-action="show-compare"]').last().click();
  check('program_append_compare_mode', await page.getByText('前文完整保留', { exact: true }).isVisible());
  check('compare_adopt_enabled', await page.locator('[data-action="adopt-candidate"]').last().isEnabled());
  await capture(page, '03-candidate-adoptable-program-append');

  await page.locator('[data-action="adopt-candidate"]').last().click();
  await page.getByText('已采用', { exact: true }).first().waitFor({ timeout: 30000 });
  check('manual_adopt_confirmed_in_ui', await page.getByText('已采用', { exact: true }).count() > 0);
  await capture(page, '04-after-manual-adopt-current-version');
  await page.locator('[data-action="open-history"]').first().click();
  await page.getByText('当前 · 只读查看', { exact: true }).first().waitFor();
  await capture(page, '05-adopted-version-history');
  check('provider_calls_after_adopt_zero', providerCalls.length === 0, providerCalls);
} finally {
  await browser?.close().catch(() => {});
  if (desktop.pid) await execFileAsync('taskkill.exe', ['/PID', String(desktop.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}

const evidenceDb = new SQLiteD1(paths.database);
const workAfter = await evidenceDb.prepare('SELECT current_version_id FROM works WHERE id = ?').bind(workId).first();
const candidateAfter = await evidenceDb.prepare('SELECT status, adopted_at, content_hash FROM versions WHERE id = ?')
  .bind(versionIds.V5).first();
const memoryAfter = await evidenceDb.prepare(`SELECT version_id, content_hash, memory_status, extraction_source,
  source_version_id, validation_run_id, provider, model_name, validator_version
  FROM story_memory_snapshots WHERE version_id = ?`).bind(versionIds.V5).first();
const historyAfter = await evidenceDb.prepare(`SELECT id, status, trigger, validator_version, provider_id, model_name,
  outcome_unknown, error_code FROM candidate_validation_runs WHERE candidate_version_id = ? ORDER BY created_at ASC`)
  .bind(versionIds.V5).all();
const adoption = await evidenceDb.prepare(`SELECT previous_current_version_id, new_current_version_id, result
  FROM adoption_events WHERE candidate_version_id = ? ORDER BY created_at DESC LIMIT 1`).bind(versionIds.V5).first();
evidenceDb.close();

check('pre_adopt_story_memory_absent', Number(preAdoptMemory.count) === 0, preAdoptMemory);
check('cas_promoted_v5', workAfter.current_version_id === versionIds.V5, workAfter);
check('candidate_marked_adopted', candidateAfter.status === 'adopted' && Boolean(candidateAfter.adopted_at), candidateAfter);
check('adoption_event_records_v3_to_v5', adoption?.previous_current_version_id === versionIds.V3
  && adoption?.new_current_version_id === versionIds.V5 && adoption?.result === 'adopted', adoption);
check('story_memory_created_only_after_adopt', memoryAfter?.version_id === versionIds.V5
  && memoryAfter?.content_hash === candidateHash && memoryAfter?.source_version_id === versionIds.V3
  && memoryAfter?.validation_run_id === runIds.passed && memoryAfter?.provider === 'deepseek'
  && memoryAfter?.model_name === 'deepseek-flash' && memoryAfter?.validator_version === validatorV21, memoryAfter);
check('all_validation_history_preserved', historyAfter.results.length === 3
  && historyAfter.results.map((row) => row.status).join(',') === 'blocked,outcome_unknown,passed', historyAfter.results);
check('no_writer_or_validator_call', providerCalls.length === 0, providerCalls);

const evidence = {
  completed_at: new Date().toISOString(),
  environment: 'ZIP-extracted packaged Electron + isolated SQLite + controlled loopback Provider',
  archive, package_root: packageRoot, executable, data_root: dataRoot,
  fixture: { work_id: workId, source_version_id: versionIds.V3, candidate_version_id: versionIds.V5,
    source_content_hash: sourceContentHash, source_document_hash: sourceDocumentHash,
    candidate_content_hash: candidateHash, generated_segment_length: generatedSegment.length,
    generated_segment_hash: generatedSegmentHash, old_validator_version: validatorV2,
    current_validator_version: validatorV21 },
  package_evidence: packageEvidence,
  checks, screenshots, provider_calls: providerCalls,
  database_after_adopt: { work: workAfter, candidate: candidateAfter, memory: memoryAfter,
    validation_history: historyAfter.results, adoption_event: adoption }
};
await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ evidence_file: evidenceFile, screenshots, package_evidence: packageEvidence,
  checks, provider_calls: providerCalls.length }, null, 2));
