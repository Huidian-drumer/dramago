import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const reportDirectory = path.join(root, 'reports', 'windows-desktop-packaging-v1');
const qa = JSON.parse(await readFile(path.join(reportDirectory, 'ui-control-qa-results.json'), 'utf8'));
const v11ControlIds = new Set([
  'provider_settings_visible',
  'provider_key_can_be_safely_updated',
  'provider_key_can_be_cleared',
  'provider_connection_test_real_http',
  'zhipu_key_can_be_configured_independently',
  'switching_back_keeps_deepseek_configured',
  'new_provider_disclosure_is_required_and_confirmed',
  'both_provider_keys_remain_configured_after_restart',
  'task_model_selector_lists_whitelisted_models',
  'per_task_model_selection_is_persisted',
  'cross_provider_chain_returns_to_glm_for_continue',
  'cancel_stop_keeps_generation_running',
  'stop_generation_marks_task_and_requires_manual_retry',
  'late_response_after_ui_stop_does_not_create_candidate',
  'stopped_generation_preserves_instruction'
]);

const rows = Object.entries(qa.checks).map(([id, result]) => ({
  id,
  scope: v11ControlIds.has(id) ? 'windows_v1_1' : 'baseline_ui_and_runtime',
  control_or_behavior: id,
  method: 'packaged_electron_automated',
  status: result.passed ? 'PASS' : 'FAIL',
  evidence: 'ui-control-qa-results.json',
  provider: 'controlled_qa_provider_or_local_runtime'
}));

rows.push(
  { id: 'p1_history_read_only', scope: 'desktop_p1', control_or_behavior: '打开历史版本只读查看，不改变当前版本', method: 'packaged_electron_automated', status: 'PASS', evidence: '../windows-portable-p1-reliability/P1_RELIABILITY_EVIDENCE.json + 01-history-read-only.png', provider: 'not_applicable' },
  { id: 'p1_history_restore', scope: 'desktop_p1', control_or_behavior: '确认后复制历史正文为新版本并通过 CAS 更新当前版本', method: 'packaged_electron_automated', status: 'PASS', evidence: '../windows-portable-p1-reliability/P1_RELIABILITY_EVIDENCE.json + 02/03 screenshots', provider: 'not_applicable' },
  { id: 'p1_writer_unknown_retry', scope: 'desktop_p1', control_or_behavior: 'Writer 未决结果提示、禁止自动重发、确认后新建任务', method: 'packaged_electron_process_kill', status: 'PASS', evidence: '../windows-portable-p1-reliability/P1_RELIABILITY_EVIDENCE.json + 04-writer-outcome-unknown.png', provider: 'controlled_qa_provider' },
  { id: 'p1_validator_unknown_retry', scope: 'desktop_p1', control_or_behavior: 'Validator 未决结果提示、确认后复用候选重试', method: 'packaged_electron_process_kill', status: 'PASS', evidence: '../windows-portable-p1-reliability/P1_RELIABILITY_EVIDENCE.json + 05-validator-outcome-unknown-candidate-preserved.png', provider: 'controlled_qa_provider' },
  { id: 'desktop_window_open_close', scope: 'desktop', control_or_behavior: '窗口打开、关闭与服务退出', method: 'packaged_electron_automated', status: 'PASS', evidence: 'desktop-qa-status.json + safe_shutdown_closes_local_http_service', provider: 'local_runtime' },
  { id: 'desktop_second_launch', scope: 'desktop', control_or_behavior: '二次启动激活既有实例且不重复启动服务', method: 'process_and_single_instance_check', status: 'PASS', evidence: 'second process exited 0; process count unchanged', provider: 'not_applicable' },
  { id: 'desktop_packaged_utility_runtime', scope: 'desktop', control_or_behavior: 'utilityProcess 本地服务、Node/SQLite/DPAPI/ESM', method: 'packaged_compatibility_probe', status: 'PASS', evidence: 'packaged-compatibility.json', provider: 'not_applicable' },
  { id: 'desktop_runtime_integrity', scope: 'security', control_or_behavior: '解包服务文件篡改时拒绝运行', method: 'controlled_integrity_fault', status: 'PASS', evidence: 'integrity-tamper-compatibility.json', provider: 'not_applicable' },
  { id: 'desktop_real_provider_create', scope: 'real_provider', control_or_behavior: '真实 DeepSeek CREATE → Validator → Adopt', method: 'packaged_electron_real_provider', status: 'PASS', evidence: 'real-provider-qa.json', provider: 'deepseek' },
  { id: 'desktop_real_provider_expand', scope: 'real_provider', control_or_behavior: '真实 DeepSeek EXPAND → Validator', method: 'packaged_electron_real_provider', status: 'PASS_BLOCKED_AS_DESIGNED', evidence: 'real-provider-qa.json', provider: 'deepseek' },
  { id: 'desktop_real_provider_rewrite', scope: 'real_provider', control_or_behavior: '真实 DeepSeek REWRITE → Validator → Adopt', method: 'packaged_electron_real_provider', status: 'PASS', evidence: 'real-provider-qa.json', provider: 'deepseek' },
  { id: 'desktop_real_provider_continue', scope: 'real_provider', control_or_behavior: '真实 DeepSeek CONTINUE → Validator', method: 'packaged_electron_real_provider', status: 'PASS_BLOCKED_AS_DESIGNED', evidence: 'real-provider-qa.json', provider: 'deepseek' },
  { id: 'desktop_minimize', scope: 'desktop_manual', control_or_behavior: '窗口最小化', method: 'manual_observed', status: 'PASS', evidence: '../windows-portable-final-acceptance/NINE_ITEM_ACCEPTANCE.csv', provider: 'not_applicable' },
  { id: 'desktop_maximize_restore', scope: 'desktop_manual', control_or_behavior: '窗口最大化与还原', method: 'manual_observed', status: 'PASS', evidence: '../windows-portable-final-acceptance/NINE_ITEM_ACCEPTANCE.csv', provider: 'not_applicable' },
  { id: 'desktop_native_import_dialog', scope: 'desktop_manual', control_or_behavior: '原生导入文件对话框', method: 'manual_required', status: 'NOT_RUN', evidence: 'import logic passed via setInputFiles; native dialog not exercised', provider: 'not_applicable' },
  { id: 'desktop_native_save_dialog', scope: 'desktop_manual', control_or_behavior: '原生导出保存对话框', method: 'manual_required', status: 'NOT_RUN', evidence: 'export bytes passed with QA save path; native dialog not exercised', provider: 'not_applicable' },
  { id: 'desktop_microsoft_pinyin', scope: 'desktop_manual', control_or_behavior: '真实微软拼音中文输入', method: 'manual_required', status: 'NOT_RUN', evidence: 'composition event passed; OS-level UI automation stopped by user', provider: 'not_applicable' },
  { id: 'desktop_clipboard', scope: 'desktop_manual', control_or_behavior: '系统剪贴板复制粘贴', method: 'manual_required', status: 'NOT_RUN', evidence: 'text selection logic passed; system clipboard not exercised', provider: 'not_applicable' },
  { id: 'desktop_sleep_wake', scope: 'desktop_manual', control_or_behavior: 'Windows 休眠与唤醒恢复', method: 'external_manual_required', status: 'NOT_RUN', evidence: 'not safe to automate in current session', provider: 'not_applicable' },
  { id: 'desktop_clean_windows_10', scope: 'external_environment', control_or_behavior: '干净 Windows 10 启动', method: 'external_machine_required', status: 'NOT_RUN', evidence: 'current Windows 10 host is not a clean VM', provider: 'not_applicable' },
  { id: 'desktop_clean_windows_11', scope: 'external_environment', control_or_behavior: '干净 Windows 11 启动', method: 'external_machine_required', status: 'NOT_RUN', evidence: 'Windows 11 VM not available', provider: 'not_applicable' }
);

function csv(value) {
  const text = String(value ?? '');
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const columns = ['id', 'scope', 'control_or_behavior', 'method', 'status', 'evidence', 'provider'];
const output = [columns.join(','), ...rows.map((row) => columns.map((column) => csv(row[column])).join(','))].join('\n');
await writeFile(path.join(reportDirectory, 'DESKTOP_UI_CONTROL_INVENTORY.csv'), `${output}\n`);
console.log(JSON.stringify({ rows: rows.length, automated_pass: rows.filter((row) => row.status.startsWith('PASS')).length, not_run: rows.filter((row) => row.status === 'NOT_RUN').length }, null, 2));
