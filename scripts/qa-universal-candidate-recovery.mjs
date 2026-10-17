import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { applyMigrations } from '../local/migrations.mjs';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import { defaultProviderConfiguration, WindowsDpapiProviderSecretStore, writeProviderConfiguration } from '../local/secure-config.mjs';
import { SQLiteD1 } from '../local/sqlite-d1.mjs';

const root = process.cwd();
const runRoot = await mkdtemp(path.join(root, '.cache', 'candidate-recovery-electron-'));
const archive = process.env.DRAMAGO_RECOVERY_QA_ZIP ? path.resolve(process.env.DRAMAGO_RECOVERY_QA_ZIP) : null;
const extracted = path.join(runRoot, 'extracted');
if (archive) {
  await stat(archive);
  await mkdir(extracted, { recursive: true });
  const unpack = spawnSync('tar.exe', ['-xf', archive, '-C', extracted], { encoding: 'utf8', windowsHide: true });
  if (unpack.status !== 0) throw new Error(`Portable ZIP extraction failed: ${unpack.stderr || unpack.stdout}`);
}
const executable = archive
  ? path.join(extracted, 'DramaGo-win32-x64', 'DramaGo.exe')
  : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
await stat(executable);
const paths = localPaths(path.join(runRoot, 'data'));
const electronUserData = path.join(runRoot, 'electron-user-data');
const statusFile = path.join(runRoot, 'status.json');
const reportDir = process.env.DRAMAGO_RECOVERY_QA_REPORT_DIR
  ? path.resolve(process.env.DRAMAGO_RECOVERY_QA_REPORT_DIR)
  : path.join(root, 'reports', 'windows-v1-4-universal-candidate-recovery');
await mkdir(reportDir, { recursive: true });
await ensureLocalDirectories(paths);
const db = new SQLiteD1(paths.database);
await applyMigrations(db, path.join(root, 'drizzle'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const timestamp = (minute) => `2026-10-15T01:${String(minute).padStart(2, '0')}:00.000Z`;
const quote = '第二天，林宁带着记录核实证词';
const sourceContent = '林宁在档案室整理完旧案。她决定第二天继续核实线索。';
const segment = `${quote}，决定公开更正档案。`;
const content = `${sourceContent}\n\n${segment}`;
const sourceHash = hash(sourceContent);
const candidateHash = hash(content);
const workIds = { compatible: 'qa_compatible_work', recover: 'qa_recovery_work', damaged: 'qa_damaged_work',
  sourceDamaged: 'qa_source_damaged_work', stale: 'qa_stale_work',
  newerBlocked: 'qa_newer_blocked_work', newerUnknown: 'qa_newer_unknown_work',
  providerError: 'qa_provider_error_work' };
const candidateIds = {};
const briefFor = (sourceId) => ({ operation: 'CONTINUE', source_version_id: sourceId,
  target_scope: { type: 'next_segment' }, user_instruction: '从第二天开始续写，不复述前文。',
  hard_preserve: [], soft_preserve: [], required_outcomes: [] });
const oldSemantic = {
  findings: [], blockingConflicts: [], warnings: [], requiredOutcomesMet: true,
  preserveStatus: { hardMet: true, softMet: true, notes: [] },
  promisePayoffStatus: { met: true, missingPayoffs: [], notes: [] },
  negativeConstraintStatus: { met: true, severity: 'pass', violations: [] },
  candidateInternalConsistency: { consistent: true, conflicts: [] }, operationCompleted: true,
  sourceStoryFacts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidateStoryFacts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidateStoryMemory: { completeness: 'available',
    characters: [{ id: 'lin', name: '林宁', identity: '档案整理员', relationships: [], state: '核实旧案',
      status: 'active', truth_status: 'objective', certainty: 'confirmed', evidence: [{ quote }] }],
    events: [{ id: 'event', event: '核实证词', sequence: 1, status: 'active', truth_status: 'objective',
      certainty: 'confirmed', time_context: '第二天', evidence: [{ quote }] }], persistent_facts: [], open_threads: [] }
};
for (const [index, [kind, workId]] of Object.entries(workIds).entries()) {
  const sourceId = `qa_${kind}_source`;
  const candidateId = `qa_${kind}_candidate`;
  const taskId = `qa_${kind}_task`;
  const runId = `qa_${kind}_passed_run`;
  const legacyValidatorVersion = kind === 'compatible' || kind.startsWith('newer')
    ? 'content-semantic-v2.1-scope' : 'content-semantic-v2';
  const title = `候选恢复合成验收 · ${kind}`;
  const brief = briefFor(sourceId);
  candidateIds[kind] = candidateId;
  const originalChecks = [{ finding_type: 'deterministic', check: 'CONTINUATION_PRESERVES_SOURCE', status: 'pass',
    message: '前文已保留。', candidate_version_id: candidateId, content_hash: candidateHash,
    validator_version: legacyValidatorVersion }];
  await db.batch([
    db.prepare('INSERT INTO works (id, title, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(workId, title, sourceId, timestamp(index), timestamp(12)),
    db.prepare(`INSERT INTO versions (id, work_id, parent_version_id, operation, status, title, content,
      creative_brief_json, checks_json, content_hash, validation_status, can_auto_apply, adopted_at, created_at)
      VALUES (?, ?, NULL, 'CREATE', 'adopted', ?, ?, '{}', '[]', ?, 'pending', 0, ?, ?)`)
      .bind(sourceId, workId, title, sourceContent, sourceHash, timestamp(index), timestamp(index)),
    db.prepare(`INSERT INTO versions (id, work_id, parent_version_id, operation, status, title, content,
      generated_segment, creative_brief_json, checks_json, model_name, content_hash, validator_version,
      validation_status, can_auto_apply, validated_at, writer_provider_id, writer_model_id,
      validator_provider_id, validator_model_id, current_validation_run_id, created_at)
      VALUES (?, ?, ?, 'CONTINUE', 'candidate', ?, ?, ?, ?, ?, 'glm-4.7', ?,
      ?, 'passed', 0, ?, 'zhipu', 'glm-4.7', 'deepseek', 'deepseek-flash', ?, ?)`)
      .bind(candidateId, workId, sourceId, title, content, segment, JSON.stringify(brief),
        JSON.stringify(originalChecks), candidateHash, legacyValidatorVersion, timestamp(10), runId, timestamp(5)),
    db.prepare(`INSERT INTO generation_tasks (id, work_id, source_version_id, creative_brief_json, source_hash,
      status, provider, model_name, result_version_id, created_at, completed_at, prompt_template_id,
      merge_strategy, output_kind, candidate_content_hash, validator_version, validation_status,
      source_is_current, execution_input_json, stage, updated_at, writer_provider_id, writer_model_id,
      validator_provider_id, validator_model_id)
      VALUES (?, ?, ?, ?, ?, 'completed', 'zhipu', 'glm-4.7', ?, ?, ?, 'creative-writer-v2',
      'PROGRAM_APPEND', 'continuation', ?, ?, 'passed', 1, ?, 'completed', ?,
      'zhipu', 'glm-4.7', 'deepseek', 'deepseek-flash')`)
      .bind(taskId, workId, sourceId, JSON.stringify(brief), hash(`${title}\n${sourceContent}`), candidateId,
        timestamp(5), timestamp(10), candidateHash, legacyValidatorVersion, JSON.stringify({ brief, context: '' }), timestamp(10)),
    db.prepare(`INSERT INTO candidate_validation_runs (id, task_id, work_id, candidate_version_id,
      candidate_content_hash, source_version_id, source_content_hash, operation, trigger,
      validator_version, provider_id, model_name, status, checks_json, semantic_validation_json,
      confirmed_cost_risk, outcome_unknown, retry_confirmation_required, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'user_revalidation', ?,
      'deepseek', 'deepseek-flash', 'passed', ?, ?, 1, 0, 0, ?, ?)`)
      .bind(runId, taskId, workId, candidateId, candidateHash, sourceId, sourceHash, legacyValidatorVersion,
        JSON.stringify(originalChecks), JSON.stringify(oldSemantic), timestamp(9), timestamp(10))
  ]);
  if (kind.startsWith('newer')) {
    const supersedingStatus = kind === 'newerBlocked' ? 'blocked' : 'outcome_unknown';
    await db.prepare(`INSERT INTO candidate_validation_runs (id, task_id, work_id, candidate_version_id,
      candidate_content_hash, source_version_id, source_content_hash, operation, trigger,
      validator_version, provider_id, model_name, status, checks_json, semantic_validation_json,
      confirmed_cost_risk, outcome_unknown, retry_confirmation_required, error_code, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CONTINUE', 'user_revalidation', 'content-semantic-v2.2-language',
      'deepseek', 'deepseek-flash', ?, '[]', NULL, 1, ?, 1, ?, ?, ?)`)
      .bind(`qa_${kind}_newer_run`, taskId, workId, candidateId, candidateHash, sourceId, sourceHash,
        supersedingStatus, supersedingStatus === 'outcome_unknown' ? 1 : 0,
        supersedingStatus === 'outcome_unknown' ? 'PROVIDER_TIMEOUT' : null, timestamp(11), timestamp(12)).run();
  }
  if (kind === 'damaged') await db.prepare('UPDATE versions SET content = ? WHERE id = ?')
    .bind('合成数据损坏：仅用于检查门禁。', candidateId).run();
  if (kind === 'sourceDamaged') await db.prepare('UPDATE versions SET content = ? WHERE id = ?')
    .bind('合成来源损坏：仅用于检查门禁。', sourceId).run();
  if (kind === 'stale') {
    const newerId = `qa_${kind}_newer`;
    await db.batch([
      db.prepare(`INSERT INTO versions (id, work_id, parent_version_id, operation, status, title, content,
        creative_brief_json, checks_json, content_hash, validation_status, can_auto_apply, adopted_at, created_at)
        VALUES (?, ?, ?, 'MANUAL_EDIT', 'adopted', ?, ?, '{}', '[]', ?, 'pending', 0, ?, ?)`)
        .bind(newerId, workId, sourceId, title, '更新的合成正式正文。', hash('更新的合成正式正文。'), timestamp(11), timestamp(11)),
      db.prepare('UPDATE works SET current_version_id = ? WHERE id = ?').bind(newerId, workId)
    ]);
  }
}
db.close();

const config = structuredClone(defaultProviderConfiguration);
config.provider_timeout_ms = 5000;
config.providers.deepseek.timeout_ms = 5000;
config.providers.deepseek.disclosure_confirmed_at = timestamp(12);
config.selected_writer = { provider_id: 'deepseek', model_id: 'deepseek-v4-pro' };
config.selected_validator = { provider_id: 'deepseek', model_id: 'deepseek-flash' };
await writeProviderConfiguration(paths.providerConfig, config);
await new WindowsDpapiProviderSecretStore(paths.providerSecrets).set('deepseek', 'controlled-local-only-key');
const providerCalls = [];
let providerMode = 'success';
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  providerCalls.push({ model: payload.model, mode: providerMode, time: new Date().toISOString() });
  if (providerMode === 'timeout') return;
  const injectedStatus = ({ auth: 401, permission: 403, rate_limit: 429 })[providerMode];
  if (injectedStatus) {
    response.writeHead(injectedStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `controlled ${injectedStatus}` } }));
    return;
  }
  const result = { findings: [], blocking_conflicts: [], warnings: [], required_outcomes_met: true,
    preserve_status: { hard_met: true, soft_met: true, notes: [] },
    promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
    negative_constraint_status: { met: true, severity: 'pass', violations: [] },
    candidate_internal_consistency: { consistent: true, conflicts: [] }, operation_completed: true,
    source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
    candidate_story_memory: { ...oldSemantic.candidateStoryMemory, characters: oldSemantic.candidateStoryMemory.characters,
      events: oldSemantic.candidateStoryMemory.events } };
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }], model: payload.model,
    usage: { prompt_tokens: 11, completion_tokens: 13, total_tokens: 24 } }));
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, '127.0.0.1', resolve));
const cdpPort = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const electron = spawn(executable,
  [...(archive ? [] : ['.']), `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${electronUserData}`], {
    cwd: archive ? path.dirname(executable) : root, windowsHide: true, stdio: 'ignore', env: { ...process.env,
      DRAMAGO_DATA_DIR: paths.root, DRAMAGO_ELECTRON_USER_DATA: electronUserData,
      DRAMAGO_DESKTOP_QA_STATUS: statusFile, DRAMAGO_INTERNAL_QA: '1',
      DRAMAGO_INTERNAL_QA_PROVIDER_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions` }
  });
const checks = [];
const screenshots = [];
function check(name, condition, details = null) {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`);
}
async function capture(page, name) {
  const file = path.join(reportDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  screenshots.push({ file, sha256: hash(await readFile(file)), bytes: (await stat(file)).size });
}
let browser;
try {
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const status = JSON.parse(await readFile(statusFile, 'utf8'));
      if (status.window_ready && (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  check('electron_ready', ready);
  if (archive) {
    const packagedWorker = path.join(extracted, 'DramaGo-win32-x64', 'resources', 'app.asar.unpacked', 'dist', 'server', 'index.js');
    check('zip_worker_matches_current_build', hash(await readFile(packagedWorker)) === hash(await readFile(path.join(root, 'dist', 'server', 'index.js'))));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const page = browser.contexts()[0].pages().find((item) => item.url().startsWith('http://127.0.0.1:'));
  check('workbench_window_loaded', Boolean(page));
  await page.setViewportSize({ width: 1366, height: 900 });
  const origin = new URL(page.url()).origin;
  async function openCandidate(kind) {
    await page.goto(`${origin}/?work_id=${workIds[kind]}`);
    await page.locator('[data-action="open-history"]').first().click();
    await page.locator(`[data-version-id="${candidateIds[kind]}"]`).click();
  }
  await openCandidate('compatible');
  await page.locator('[data-action="adopt-candidate"]').waitFor();
  check('trusted_v21_passed_is_historical_and_adoptable_without_provider',
    await page.getByText('历史审核通过', { exact: true }).count() > 0 && providerCalls.length === 0);
  await capture(page, '00-v21-historical-passed-adoptable');
  await page.locator('[data-action="adopt-candidate"]').click();
  await page.getByText('已采用', { exact: true }).first().waitFor({ timeout: 10000 });
  check('trusted_v21_adopt_zero_provider_calls', providerCalls.length === 0);
  await capture(page, '00b-v21-manual-adopt-no-provider');
  await openCandidate('recover');
  await page.locator('[data-action="request-candidate-revalidation"]').waitFor();
  check('legacy_passed_incompatible_has_revalidation_action',
    await page.locator('[data-action="request-candidate-revalidation"]').count() === 1);
  check('no_automatic_provider_request', providerCalls.length === 0);
  await capture(page, '01-old-passed-recovery-path');
  await page.locator('[data-action="request-candidate-revalidation"]').click();
  await page.locator('#revalidationDisclosure').waitFor();
  await capture(page, '02-cost-and-disclosure-confirmation');
  check('still_no_provider_request_before_consent', providerCalls.length === 0);
  await page.locator('#revalidationDisclosure').check();
  await page.locator('[data-action="confirm-candidate-revalidation"]').click();
  await page.locator('[data-action="adopt-candidate"]').waitFor({ timeout: 30000 });
  check('one_validator_call_only', providerCalls.length === 1 && providerCalls[0].model === 'deepseek-flash', providerCalls);
  await capture(page, '03-new-review-adoptable');
  await page.locator('[data-action="open-checks"]').first().click();
  check('memory_summary_visible', await page.locator('.candidate-memory-summary').isVisible());
  await page.locator('[data-action="open-candidate-memory"]').click();
  check('memory_preview_visible', await page.getByText('候选剧情记忆预览', { exact: true }).isVisible());
  await capture(page, '04-history-and-memory-preview');
  await page.locator('.candidate-memory-preview details summary').first().click();
  await page.locator('.candidate-memory-preview details summary').nth(1).click();
  await page.locator('.candidate-memory-preview').scrollIntoViewIfNeeded();
  await capture(page, '04b-memory-preview-detail');
  const beforeAdoptDb = new SQLiteD1(paths.database);
  const beforeAdoptMemory = await beforeAdoptDb.prepare('SELECT COUNT(*) AS count FROM story_memory_snapshots WHERE version_id = ?')
    .bind(candidateIds.recover).first();
  beforeAdoptDb.close();
  check('candidate_memory_preview_is_not_formal_memory_before_adopt', beforeAdoptMemory.count === 0);
  await page.locator('[data-action="close-overlay"]').click();
  check('memory_detail_returns_to_checks', await page.locator('.validation-history-item').count() >= 2);
  check('history_preserved_in_ui', await page.locator('.validation-history-item').count() >= 2);
  await page.locator('[data-action="close-overlay"]').click();
  await page.locator('[data-action="adopt-candidate"]').click();
  await page.getByText('已采用', { exact: true }).first().waitFor({ timeout: 10000 });
  await capture(page, '05-manual-adopt');
  await openCandidate('damaged');
  check('hash_damage_no_revalidation_action', await page.locator('[data-action="request-candidate-revalidation"]').count() === 0);
  check('hash_damage_has_explanation', await page.getByText(/Hash|完整性/u).count() > 0);
  await capture(page, '06-hash-damage-read-only');
  await openCandidate('sourceDamaged');
  check('source_hash_damage_no_revalidation_action', await page.locator('[data-action="request-candidate-revalidation"]').count() === 0);
  check('source_hash_damage_has_explanation', await page.getByText(/Hash|完整性/u).count() > 0);
  await capture(page, '06b-source-hash-damage-read-only');
  await openCandidate('stale');
  check('source_conflict_no_revalidation_action', await page.locator('[data-action="request-candidate-revalidation"]').count() === 0);
  check('source_conflict_explained', await page.getByText(/来源版本冲突/u).count() > 0);
  await capture(page, '07-source-conflict-read-only');
  for (const kind of ['newerBlocked', 'newerUnknown']) {
    await openCandidate(kind);
    check(`${kind}_does_not_inherit_older_passed`,
      await page.locator('[data-action="adopt-candidate"]').count() === 0 && providerCalls.length === 1);
    await capture(page, `08-${kind}-supersedes-passed`);
  }
  await openCandidate('providerError');
  for (const [mode, expectedCode, expectedStatus] of [
    ['auth', 'PROVIDER_AUTH_FAILED', 'unavailable'],
    ['permission', 'PROVIDER_MODEL_ACCESS_DENIED', 'unavailable'],
    ['rate_limit', 'PROVIDER_RATE_LIMITED', 'unavailable'],
    ['timeout', 'PROVIDER_TIMEOUT', 'outcome_unknown']
  ]) {
    providerMode = mode;
    const before = providerCalls.length;
    await page.locator('[data-action="request-candidate-revalidation"]').click();
    await page.locator('#revalidationDisclosure').check();
    await page.locator('[data-action="confirm-candidate-revalidation"]').click();
    await page.locator('[data-action="request-candidate-revalidation"]').waitFor({ timeout: 15000 }).catch(async (error) => {
      const actions = await page.locator('[data-action]').evaluateAll((nodes) => nodes.map((node) => node.dataset.action).filter(Boolean));
      throw new Error(`${mode}: recovery action not visible; actions=${JSON.stringify(actions)}; ${error.message}`);
    });
    const readDb = new SQLiteD1(paths.database);
    const latest = await readDb.prepare(`SELECT status, error_code FROM candidate_validation_runs
      WHERE candidate_version_id = ? ORDER BY created_at DESC LIMIT 1`).bind(candidateIds.providerError).first();
    readDb.close();
    check(`${mode}_one_request_and_distinct_safe_state`, providerCalls.length === before + 1
      && latest?.error_code === expectedCode && latest?.status === expectedStatus,
    { provider_calls: providerCalls.length - before, latest });
    check(`${mode}_candidate_not_adoptable`, await page.locator('[data-action="adopt-candidate"]').count() === 0);
    await capture(page, `09-provider-${mode}-failure`);
  }
} finally {
  await browser?.close().catch(() => {});
  if (electron.pid) await promisify(execFile)('taskkill.exe', ['/PID', String(electron.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await new Promise((resolve) => provider.close(resolve));
}
let finalDb;
for (let attempt = 0; attempt < 20 && !finalDb; attempt += 1) {
  try { finalDb = new SQLiteD1(paths.database); }
  catch (error) {
    if (attempt === 19) throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
const recovered = await finalDb.prepare('SELECT current_version_id FROM works WHERE id = ?').bind(workIds.recover).first();
const compatible = await finalDb.prepare('SELECT current_version_id FROM works WHERE id = ?').bind(workIds.compatible).first();
const compatibleMemory = await finalDb.prepare('SELECT version_id FROM story_memory_snapshots WHERE version_id = ?')
  .bind(candidateIds.compatible).first();
const memory = await finalDb.prepare('SELECT version_id, content_hash FROM story_memory_snapshots WHERE version_id = ?')
  .bind(candidateIds.recover).first();
const runs = await finalDb.prepare('SELECT status, validator_version FROM candidate_validation_runs WHERE candidate_version_id = ? ORDER BY created_at')
  .bind(candidateIds.recover).all();
const attempts = await finalDb.prepare("SELECT COUNT(*) AS count FROM provider_transport_attempts WHERE stage = 'revalidate'").first();
finalDb.close();
check('cas_adopted_recovered_candidate', recovered.current_version_id === candidateIds.recover);
check('compatible_v21_adopt_and_memory_after_explicit_action', compatible.current_version_id === candidateIds.compatible
  && compatibleMemory?.version_id === candidateIds.compatible);
check('story_memory_only_after_manual_adopt', memory?.version_id === candidateIds.recover && memory?.content_hash === candidateHash);
check('old_and_new_validation_runs_preserved', runs.results.length >= 2
  && runs.results.some((run) => run.validator_version === 'content-semantic-v2' && run.status === 'passed')
  && runs.results.some((run) => run.validator_version === 'content-semantic-v2.2-language' && run.status === 'passed'));
check('transport_attempts_match_explicit_confirmed_calls', attempts.count === providerCalls.length
  && providerCalls.length === 5);
const evidence = { completed_at: new Date().toISOString(), environment: archive
  ? 'ZIP-extracted Electron EXE + isolated SQLite + controlled loopback Validator'
  : 'development Electron + isolated SQLite + controlled loopback Validator',
  archive, executable, run_root: runRoot, data_root: paths.root, checks, screenshots, provider_calls: providerCalls.length,
  transport_attempts: attempts.count, model: providerCalls[0]?.model || null };
await writeFile(path.join(reportDir, 'ELECTRON_ACCEPTANCE.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ checks: checks.length, passed: checks.filter((item) => item.passed).length,
  screenshots: screenshots.length, provider_calls: providerCalls.length, evidence: path.join(reportDir, 'ELECTRON_ACCEPTANCE.json') }));
