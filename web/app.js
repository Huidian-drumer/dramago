const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const WORK_KEY = 'dramago-workbench-current-work-v2';
const RECENT_WORKS_KEY = 'dramago-workbench-recent-works-v2';
const DRAFT_PREFIX = 'dramago-workbench-draft-v2:';
const MODEL_SELECTION_KEY = 'dramago-model-selection-v1';
const ROUTING_DIAGNOSTIC_KEY = 'dramago-operation-routing-events-v1';
const OPERATION_STATE_VERSION = 1;
const ROUTING_DIAGNOSTIC_MAX_EVENTS = 80;
const ROUTING_DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
// Short coalescing window for local SQLite persistence. Browser localStorage
// alone is not guaranteed durable immediately before a forced process kill.
const DRAFT_SAVE_DEBOUNCE_MS = 40;
const localTokenMeta = document.querySelector('meta[name="dramago-local-token"]')?.content || '';
const LOCAL_TOKEN = localTokenMeta === '__DRAMAGO_LOCAL_TOKEN__' ? '' : localTokenMeta;
const operationLabels = { CREATE: '整篇生成', EXPAND: '扩写', REWRITE: '改写', CONTINUE: '续写', MANUAL_EDIT: '手动保存', RESTORE: '历史恢复' };
const operationActions = { CREATE: '生成完整短剧', EXPAND: '生成扩写候选', REWRITE: '生成改写候选', CONTINUE: '生成续写候选' };
const authoringOperations = new Set(['CREATE', 'EXPAND', 'REWRITE', 'CONTINUE']);

const emptyForm = () => ({
  context: '',
  instruction: '',
  preserve: '',
  targetLength: '2000',
  person: '第二人称',
  tone: '克制、有张力',
  seriesOpening: false,
  endingMode: 'continue',
  endingRequirements: '',
  exactFinalSentence: ''
});

const state = {
  view: 'loading',
  operation: 'CREATE',
  operationSelectedAt: null,
  operationNotice: null,
  work: null,
  currentVersion: null,
  versions: [],
  candidate: null,
  candidateTask: null,
  validationRuns: [],
  latestValidationRun: null,
  currentValidationRun: null,
  adoptionReadiness: null,
  revalidationReadiness: null,
  availableCandidateActions: [],
  candidateRecoveryGuidance: null,
  candidateMemoryPreview: null,
  candidateMeta: { stale: false, canApply: false, historical: false },
  selection: null,
  dirty: false,
  busy: false,
  editorRevision: 0,
  editorTitle: '未命名短剧',
  editorBody: '',
  form: emptyForm(),
  progressStage: 'write',
  lastError: null,
  compareSide: 'candidate',
  compareMode: 'changes',
  compareBaseId: null,
  compareTargetId: null,
  savingVersion: false,
  toastTimer: null,
  taskPollTimer: null,
  localRuntime: null,
  localWorks: [],
  modelSelection: null,
  providerSettingsView: { mode: 'list', providerId: null },
  stopping: false,
  composerCollapsed: true,
  overview: null,
  workSearch: '',
  draftId: null,
  draftRevision: 0,
  draftSaveState: 'idle',
  draftSaveTimer: null,
  operationDraftConsumed: false,
  overlayStack: [],
  memoryDisclosureState: {}
};
let saveCurrentPromise = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/\r?\n/gu, '&#10;');
}

function nowVersionNumber(version) {
  const index = state.versions.findIndex((item) => item.id === version?.id);
  return index < 0 ? '—' : `V${state.versions.length - index}`;
}

function displayVersion(version) {
  if (!version) return '尚未建立版本';
  return nowVersionNumber(version);
}

function versionLabelById(versionId) {
  return displayVersion(state.versions.find((version) => version.id === versionId));
}

function compactText(value, max = 120) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function splitParagraphs(content) {
  const paragraphs = String(content || '').split(/\n\s*\n/gu).map((item) => item.trim()).filter(Boolean);
  return paragraphs.length ? paragraphs : (String(content || '').trim() ? [String(content).trim()] : []);
}

function storyHtml(content) {
  return splitParagraphs(content).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('');
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function setSync(kind, text) {
  const sync = $('#syncState');
  sync.className = `sync-state ${kind || ''}`;
  sync.querySelector('span').textContent = text;
}

function setProvider(provider) {
  const pill = $('#providerPill');
  pill.classList.remove('checking', 'ready', 'missing');
  if (provider?.configured) {
    pill.classList.add('ready');
    pill.querySelector('span').textContent = 'AI 服务已配置';
    pill.title = '这里只表示本机已保存服务配置；本次 Writer / Validator 以提交摘要为准';
  } else {
    pill.classList.add('missing');
    pill.querySelector('span').textContent = '模型待配置';
    pill.title = `缺少：${provider?.missing?.join('、') || '服务端配置'}`;
  }
}

function availableWriterModels() {
  return (state.localRuntime?.provider?.providers || []).map((provider) => ({
    providerId: provider.provider_id, providerName: provider.provider_name, configured: provider.configured,
    modelId: provider.writer_model_id, displayName: provider.writer_model_id
  })).filter((item) => item.modelId);
}

function availableValidatorModels() {
  return (state.localRuntime?.provider?.providers || []).map((provider) => ({
    providerId: provider.provider_id, providerName: provider.provider_name, configured: provider.configured,
    modelId: provider.validator_model_id, displayName: provider.validator_model_id
  })).filter((item) => item.modelId);
}

function normalizeModelSelection(selection) {
  const writers = availableWriterModels();
  const validators = availableValidatorModels();
  const provider = state.localRuntime?.provider;
  const writer = writers.find((item) => item.providerId === (selection?.writer_provider_id || selection?.provider_id)
    && item.modelId === selection?.writer_model_id)
    || writers.find((item) => item.providerId === provider?.writer_provider_id && item.modelId === provider?.writer_model_id)
    || writers[0];
  const validator = validators.find((item) => item.providerId === selection?.validator_provider_id
    && item.modelId === selection?.validator_model_id)
    || validators.find((item) => item.providerId === provider?.validator_provider_id && item.modelId === provider?.validator_model_id)
    || validators[0];
  return writer && validator ? {
    provider_id: writer.providerId,
    writer_provider_id: writer.providerId, writer_model_id: writer.modelId,
    validator_provider_id: validator.providerId, validator_model_id: validator.modelId
  } : null;
}

function rememberModelSelection(selection) {
  state.modelSelection = normalizeModelSelection(selection);
  if (state.modelSelection) localStorage.setItem(MODEL_SELECTION_KEY, JSON.stringify(state.modelSelection));
}

function modelSelectionHtml() {
  if (!state.localRuntime) return '';
  const selected = normalizeModelSelection(state.modelSelection);
  const writerOptions = availableWriterModels().map((item) => `<option value="${escapeAttribute(`${item.providerId}|${item.modelId}`)}"
    ${selected?.writer_provider_id === item.providerId && selected?.writer_model_id === item.modelId ? 'selected' : ''}>
    ${escapeHtml(item.providerName)} · ${escapeHtml(item.displayName)}${item.configured ? '' : '（未配置 Key）'}</option>`).join('');
  const validatorOptions = availableValidatorModels().map((item) => `<option value="${escapeAttribute(`${item.providerId}|${item.modelId}`)}"
    ${selected?.validator_provider_id === item.providerId && selected?.validator_model_id === item.modelId ? 'selected' : ''}>
    ${escapeHtml(item.providerName)} · ${escapeHtml(item.displayName)}${item.configured ? '' : '（未配置 Key）'}</option>`).join('');
  const writerTitle = selectedWriterLabel();
  const validatorTitle = selectedValidatorLabel();
  return `<label class="task-model-picker"><span>Writer</span><select id="taskModelSelection" aria-label="本次 Writer 模型" title="${escapeAttribute(writerTitle)}">${writerOptions}</select></label>
    <label class="task-model-picker"><span>Validator</span><select id="taskValidatorSelection" aria-label="本次 Validator 模型" title="${escapeAttribute(validatorTitle)}">${validatorOptions}</select></label>`;
}

function operationMergeStrategy(operation = state.operation, hasSelection = Boolean(state.selection)) {
  if (operation === 'CONTINUE') return 'PROGRAM_APPEND';
  if (hasSelection && ['EXPAND', 'REWRITE'].includes(operation)) return 'PROGRAM_REPLACE_RANGE';
  return 'MODEL_FULL_REPLACE';
}

function expectedOutputKind(operation = state.operation, hasSelection = Boolean(state.selection)) {
  if (operation === 'CONTINUE') return 'continuation';
  if (hasSelection && ['EXPAND', 'REWRITE'].includes(operation)) return 'segment';
  return 'full';
}

function mergeStrategyLabel(strategy) {
  return {
    PROGRAM_APPEND: '程序追加，不重写前文',
    PROGRAM_REPLACE_RANGE: '程序只替换绑定选区',
    MODEL_FULL_REPLACE: '整篇候选，与当前正文隔离'
  }[strategy] || '待确认';
}

function selectedWriterLabel() {
  const selected = normalizeModelSelection(state.modelSelection);
  const model = availableWriterModels().find((item) => item.providerId === selected?.writer_provider_id
    && item.modelId === selected?.writer_model_id);
  if (model) return `${model.providerName} · ${model.displayName}`;
  return selected ? `${selected.provider_id} · ${selected.writer_model_id}` : '由服务端配置';
}

function selectedValidatorLabel() {
  const selected = normalizeModelSelection(state.modelSelection);
  const model = availableValidatorModels().find((item) => item.providerId === selected?.validator_provider_id
    && item.modelId === selected?.validator_model_id);
  return model ? `${model.providerName} · ${model.displayName}` : '由服务端配置';
}

function operationSummaryHtml() {
  const operation = state.operation;
  const scope = !operation ? '待选择' : state.selection && ['EXPAND', 'REWRITE'].includes(operation)
    ? `局部选区 · ${[...state.selection.text].length} 字`
    : operation === 'CONTINUE' ? '下一段，仅追加' : '整篇';
  const strategy = operation ? operationMergeStrategy(operation, Boolean(state.selection)) : null;
  return `
    <div class="operation-summary compact ${operation ? '' : 'needs-selection'}" role="status" aria-live="polite">
      <span><small>本次操作</small><strong>${escapeHtml(operation ? operationLabels[operation] : '请重新选择')}</strong></span>
      <span><small>来源版本</small><strong>${escapeHtml(state.currentVersion ? displayVersion(state.currentVersion) : '新作品')}</strong></span>
    </div>
    <details class="task-contract-details"><summary>来源版本与高级操作契约</summary><div>
      <span><small>修改范围</small><strong>${escapeHtml(scope)}</strong></span>
      <span><small>合并方式</small><strong>${escapeHtml(mergeStrategyLabel(strategy))}</strong></span>
      <span><small>输出类型</small><strong>${escapeHtml(expectedOutputKind(operation, Boolean(state.selection)))}</strong></span>
      <span><small>来源绑定</small><strong>${escapeHtml(state.currentVersion?.content_hash ? state.currentVersion.content_hash.slice(0, 12) : '新作品')}</strong></span>
    </div></details>
    ${state.operationNotice ? `<p class="operation-notice" role="alert">${escapeHtml(state.operationNotice)}</p>` : ''}`;
}

function providerFailureExplanation(code) {
  return ({
    PROVIDER_AUTH_FAILED: 'Validator 鉴权失败：请检查该 AI 服务保存的 API Key。',
    PROVIDER_MODEL_ACCESS_DENIED: '当前 Key 没有访问所选 Validator 模型的权限，请检查服务商授权或选择其他模型。',
    PROVIDER_QUOTA_EXHAUSTED: 'Validator 额度或余额不足：请在服务商后台核对账户。',
    PROVIDER_RATE_LIMITED: 'Validator 被限流：候选已保留，请稍后手动重试。',
    PROVIDER_DNS_FAILED: '无法解析 Validator 服务域名，请检查 DNS 或网络。',
    PROVIDER_NETWORK_UNREACHABLE: '当前网络无法到达 Validator 服务。',
    PROVIDER_PROXY_FAILED: '代理连接失败，请检查系统或网络代理。',
    PROVIDER_PROXY_AUTH_REQUIRED: '代理要求鉴权，请检查代理设置。',
    PROVIDER_TIMEOUT: 'Validator 请求超时，远端结果可能无法确认。',
    PROVIDER_UPSTREAM_TIMEOUT: 'Validator 上游超时，远端结果可能无法确认。',
    VALIDATOR_FORMAT_INVALID: 'Validator 返回的结构无法安全解析，不能据此采用。',
    PROVIDER_REQUEST_INCOMPATIBLE: 'Validator 不兼容当前请求参数或结构化输出格式。'
  })[code] || 'Validator 没有返回可核验结果；候选正文与当前正式版本均已保留。';
}

function comparableScope(scope) {
  if (!scope || typeof scope !== 'object') return null;
  return scope.type === 'selection'
    ? { type: 'selection', start: Number(scope.start), end: Number(scope.end) }
    : { type: scope.type || null };
}

function expectedTaskContract(brief, sourceVersion, modelSelection) {
  return {
    operation: brief.operation,
    source_version_id: sourceVersion?.id || null,
    target_scope: comparableScope(brief.target_scope),
    merge_strategy: operationMergeStrategy(brief.operation, brief.target_scope?.type === 'selection'),
    expected_output_kind: expectedOutputKind(brief.operation, brief.target_scope?.type === 'selection'),
    writer_provider_id: modelSelection?.writer_provider_id || modelSelection?.provider_id || null,
    writer_model_id: modelSelection?.writer_model_id || null,
    validator_provider_id: modelSelection?.validator_provider_id || null,
    validator_model_id: modelSelection?.validator_model_id || null
  };
}

function assertTaskContract(task, expected) {
  const actual = task?.contract || {
    operation: task?.operation,
    source_version_id: task?.source_version_id,
    target_scope: task?.target_scope,
    merge_strategy: task?.merge_strategy,
    expected_output_kind: task?.output_kind,
    writer_provider_id: task?.writer_provider_id,
    writer_model_id: task?.writer_model_id
  };
  const mismatches = [];
  for (const key of ['operation', 'source_version_id', 'merge_strategy', 'expected_output_kind']) {
    if ((actual?.[key] ?? null) !== (expected?.[key] ?? null)) mismatches.push(key);
  }
  if (JSON.stringify(comparableScope(actual?.target_scope)) !== JSON.stringify(comparableScope(expected?.target_scope))) mismatches.push('target_scope');
  for (const key of ['writer_provider_id', 'writer_model_id', 'validator_provider_id', 'validator_model_id']) {
    if (expected?.[key] && actual?.[key] !== expected[key]) mismatches.push(key);
  }
  if (mismatches.length) {
    const error = new Error(`任务操作契约不一致（${mismatches.join('、')}），Writer 未启动。`);
    error.code = 'TASK_CONTRACT_MISMATCH';
    error.details = { mismatches };
    throw error;
  }
  return actual;
}

function updateHeader() {
  $('#headerWorkTitle').textContent = state.editorTitle || state.work?.title || '新作品';
  const draftText = state.draftSaveState === 'saving' ? '正在保存草稿'
    : state.draftSaveState === 'saved' && state.dirty ? '草稿已保存' : null;
  setSync(state.lastError ? 'error' : state.draftSaveState === 'saving' || state.dirty ? 'unsaved' : '',
    state.lastError ? '操作未完成' : draftText || (state.dirty ? '有未保存修改' : state.currentVersion ? '已保存' : state.work ? '空白作品' : '新作品'));
  const checks = state.candidate?.checks || [];
  $('#checkNotification').hidden = !checks.some((item) => ['warning', 'fail', 'unavailable'].includes(item.status));
  const saveButton = $('[data-action="save-version"]');
  if (saveButton) {
    saveButton.textContent = state.savingVersion ? '正在保存…' : state.dirty || !state.currentVersion ? '保存新版本' : '已保存';
    saveButton.disabled = state.savingVersion || Boolean(state.currentVersion && !state.dirty);
  }
  const formalStatus = $('[data-editor-version-status]');
  if (formalStatus) {
    formalStatus.textContent = state.savingVersion ? '正在提交新版本' : state.dirty ? '修改尚未提交为正式版本' : state.currentVersion ? '已保存为正式版本' : '新作品';
    formalStatus.classList.toggle('warning', state.dirty);
    formalStatus.classList.toggle('success', !state.dirty);
  }
}

function syncBusyControls() {
  $$('[data-action="generate"], #composerInput, #ideaInput').forEach((element) => {
    element.disabled = state.busy;
  });
}

function draftKey(workId = state.work?.id) {
  return `${DRAFT_PREFIX}${workId || 'new'}`;
}

function persistDraft({ remote = true } = {}) {
  state.draftRevision += 1;
  localStorage.setItem(draftKey(), JSON.stringify({
    workId: state.work?.id || null,
    title: state.editorTitle,
    body: state.editorBody,
    dirty: state.dirty,
    basedOnVersionId: state.currentVersion?.id ?? null,
    operation: state.operation,
    operationStateVersion: OPERATION_STATE_VERSION,
    operationSelectedAt: state.operationSelectedAt,
    draftRevision: state.draftRevision,
    draftId: state.draftId,
    operationDraftConsumed: state.operationDraftConsumed,
    form: state.form
  }));
  if (remote) schedulePersistentDraft();
}

function schedulePersistentDraft() {
  if (!LOCAL_TOKEN || !state.work?.id || !isAuthoringOperation(state.operation)) return;
  clearTimeout(state.draftSaveTimer);
  state.draftSaveState = 'saving';
  updateHeader();
  state.draftSaveTimer = setTimeout(() => flushPersistentDraft().catch(() => {}), DRAFT_SAVE_DEBOUNCE_MS);
}

async function flushPersistentDraft() {
  if (!LOCAL_TOKEN || !state.work?.id || !isAuthoringOperation(state.operation)) return null;
  const revision = state.draftRevision;
  const snapshot = {
    work_id: state.work.id,
    operation: state.operation,
    draft_id: state.draftId,
    source_version_id: state.currentVersion?.id || null,
    title: state.editorTitle,
    body: state.editorBody,
    instruction: state.form.instruction,
    form: state.form,
    status: state.operationDraftConsumed && !state.form.instruction.trim() ? 'consumed' : 'active',
    revision
  };
  try {
    const saved = await api('/api/local/draft', { method: 'POST', body: JSON.stringify(snapshot) });
    if (revision === state.draftRevision) {
      state.draftId = saved.draft_id;
      state.draftSaveState = 'saved';
      updateHeader();
    }
    return saved;
  } catch (error) {
    if (error.code !== 'DRAFT_REVISION_CONFLICT') {
      state.draftSaveState = 'error';
      updateHeader();
    }
    return null;
  }
}

async function loadPersistentDraft(workId, operation) {
  if (!LOCAL_TOKEN || !workId || !isAuthoringOperation(operation)) return null;
  try {
    const payload = await api(`/api/local/draft?work_id=${encodeURIComponent(workId)}&operation=${encodeURIComponent(operation)}`);
    const edit = payload.edit_draft;
    const op = payload.operation_draft;
    if (!edit && !op) return null;
    return {
      workId,
      title: edit?.title,
      body: edit?.body || '',
      dirty: Boolean(edit && (edit.based_on_version_id || null) === (state.currentVersion?.id || null)
        && ((edit.body || '') !== (state.currentVersion?.content || '') || (edit.title || '') !== (state.currentVersion?.title || ''))),
      basedOnVersionId: edit?.based_on_version_id || null,
      operation,
      operationStateVersion: OPERATION_STATE_VERSION,
      draftId: op?.draft_id || edit?.draft_id || null,
      draftRevision: Math.max(Number(edit?.revision || 0), Number(op?.revision || 0)),
      operationDraftConsumed: op?.status === 'consumed',
      form: { ...emptyForm(), ...(op?.form || {}), instruction: op?.status === 'active' ? op.instruction || '' : '' },
      operationSelectedAt: op?.updated_at || null
    };
  } catch {
    return null;
  }
}

async function consumePersistentDraft() {
  if (!LOCAL_TOKEN || !state.work?.id || !state.draftId || !isAuthoringOperation(state.operation)) return;
  await api('/api/local/draft/consume', { method: 'POST', body: JSON.stringify({
    work_id: state.work.id, operation: state.operation, draft_id: state.draftId
  }) }).catch(() => {});
  state.operationDraftConsumed = true;
}

function loadDraft(workId) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(workId)) || 'null');
  } catch {
    return null;
  }
}

async function loadLocalAuthoringOperation(workId) {
  if (!LOCAL_TOKEN || !workId) return null;
  try {
    const payload = await api(`/api/local/authoring-state?work_id=${encodeURIComponent(workId)}`);
    return isAuthoringOperation(payload.operation_state?.operation) ? payload.operation_state : null;
  } catch {
    return null;
  }
}

async function persistLocalAuthoringOperation() {
  if (!LOCAL_TOKEN || !state.work?.id || !isAuthoringOperation(state.operation)) return !LOCAL_TOKEN || !state.work?.id;
  try {
    await api('/api/local/authoring-state', {
      method: 'POST',
      body: JSON.stringify({
        work_id: state.work.id,
        operation: state.operation,
        selected_at: state.operationSelectedAt || new Date().toISOString()
      })
    });
    return true;
  } catch {
    return false;
  }
}

function isAuthoringOperation(operation) {
  return authoringOperations.has(operation);
}

function recordRoutingEvent(eventType, details = {}) {
  try {
    const now = Date.now();
    const previous = JSON.parse(localStorage.getItem(ROUTING_DIAGNOSTIC_KEY) || '[]');
    const allowed = {
      event_type: String(eventType || '').slice(0, 48),
      timestamp: new Date(now).toISOString(),
      work_id: details.work_id || state.work?.id || null,
      task_id: details.task_id || null,
      client_operation: isAuthoringOperation(details.client_operation) ? details.client_operation : null,
      server_operation: isAuthoringOperation(details.server_operation) ? details.server_operation : null,
      source_version_id: details.source_version_id || null,
      writer_provider_id: details.writer_provider_id || null,
      writer_model_id: details.writer_model_id || null,
      merge_strategy: details.merge_strategy || null,
      result: String(details.result || 'recorded').slice(0, 48),
      reason_code: details.reason_code ? String(details.reason_code).slice(0, 80) : null
    };
    const retained = (Array.isArray(previous) ? previous : [])
      .filter((item) => Number.isFinite(Date.parse(item?.timestamp)) && now - Date.parse(item.timestamp) <= ROUTING_DIAGNOSTIC_RETENTION_MS);
    localStorage.setItem(ROUTING_DIAGNOSTIC_KEY, JSON.stringify([...retained, allowed].slice(-ROUTING_DIAGNOSTIC_MAX_EVENTS)));
  } catch {}
}

function recentWorks() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_WORKS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function rememberWork(work) {
  if (!work?.id) return;
  if (state.localRuntime) {
    state.localWorks = [{ ...work, updated_at: new Date().toISOString() }, ...state.localWorks.filter((item) => item.id !== work.id)];
  }
  const next = [{ id: work.id, title: work.title || state.editorTitle || '未命名短剧', updatedAt: new Date().toISOString() },
    ...recentWorks().filter((item) => item.id !== work.id)].slice(0, 12);
  localStorage.setItem(RECENT_WORKS_KEY, JSON.stringify(next));
  localStorage.setItem(WORK_KEY, work.id);
  const url = new URL(location.href);
  url.searchParams.set('work_id', work.id);
  history.replaceState({}, '', url);
}

function forgetCurrentPointer() {
  localStorage.removeItem(WORK_KEY);
  const url = new URL(location.href);
  url.searchParams.delete('work_id');
  history.replaceState({}, '', url);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(LOCAL_TOKEN ? { 'x-dramago-local-token': LOCAL_TOKEN } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({ error: { code: 'INVALID_RESPONSE', message: '服务返回了无法读取的结果。' } }));
  if (!response.ok) {
    const error = new Error(payload.error?.message || '请求失败');
    error.code = payload.error?.code || 'REQUEST_FAILED';
    error.details = payload.error?.details || {};
    error.payload = payload;
    error.httpStatus = response.status;
    throw error;
  }
  return payload;
}

async function refreshLocalRuntime() {
  if (!LOCAL_TOKEN) return null;
  try {
    const [status, works] = await Promise.all([api('/api/local/status'), api('/api/local/works')]);
    state.localRuntime = status;
    state.localWorks = works.works || [];
    let remembered = null;
    try { remembered = JSON.parse(localStorage.getItem(MODEL_SELECTION_KEY) || 'null'); } catch {}
    rememberModelSelection(state.modelSelection || remembered || {
      provider_id: status.provider?.writer_provider_id || status.provider?.provider_id,
      writer_provider_id: status.provider?.writer_provider_id || status.provider?.provider_id,
      writer_model_id: status.provider?.writer_model_id,
      validator_provider_id: status.provider?.validator_provider_id,
      validator_model_id: status.provider?.validator_model_id
    });
    return status;
  } catch {
    state.localRuntime = null;
    state.localWorks = [];
    return null;
  }
}

async function hashDocument(title, body) {
  const bytes = new TextEncoder().encode(`${title}\n${body}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function topDocumentBar(active = 'story', options = {}) {
  return `
    <div class="document-header">
      <div class="document-tabs" role="tablist" aria-label="作品视图">
        <button class="document-tab ${active === 'story' ? 'active' : ''}" type="button" data-action="show-editor">正文</button>
        <button class="document-tab ${active === 'candidate' ? 'active' : ''}" type="button" data-action="show-candidate" ${state.candidate ? '' : 'disabled'}>候选</button>
        <button class="document-tab ${active === 'compare' ? 'active' : ''}" type="button" data-action="show-compare" ${state.versions.length >= 2 ? '' : 'disabled'}>比较</button>
        <button class="document-tab ${active === 'overview' ? 'active' : ''}" type="button" data-action="show-overview" ${state.work ? '' : 'disabled'}>作品全貌</button>
      </div>
      <div class="header-context">
        <span class="version-badge">${escapeHtml(options.version || displayVersion(state.currentVersion))}</span>
        ${options.status || `<span class="status-badge ${state.dirty ? 'warning' : 'success'}">${state.dirty ? '未保存' : '已保存'}</span>`}
        <button class="text-button" type="button" data-action="open-settings">篇幅与风格</button>
      </div>
    </div>`;
}

function memoryEvidenceButton(item) {
  const evidence = item?.evidence?.[0];
  if (!evidence?.version_id || !Number.isInteger(evidence.start)) return '';
  return `<button class="evidence-link" type="button" data-evidence-version="${escapeAttribute(evidence.version_id)}" data-evidence-start="${evidence.start}" data-evidence-end="${evidence.end}">定位正文证据</button>`;
}

function overviewList(items, key, emptyText) {
  if (!items?.length) return `<p class="overview-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="overview-list">${items.map((item) => `<li><div><strong>${escapeHtml(item[key] || item.name || '未命名')}</strong><small>${escapeHtml(item.time_context || item.state || item.status || '时间未确认')} · ${escapeHtml(item.truth_status === 'character_claim' ? '人物说法' : item.truth_status === 'interpretation' ? '解释/推断' : item.certainty === 'confirmed' ? '客观事实 · 有证据' : '待确认')}</small>${item.author_review ? `<small>作者标记：${escapeHtml(item.author_review)}</small>` : ''}</div><div class="memory-item-actions">${memoryEvidenceButton(item)}${item.id ? `<button class="text-button" type="button" data-memory-action="mark_uncertain" data-memory-item-id="${escapeAttribute(item.id)}">标为存疑</button><button class="text-button" type="button" data-memory-action="confirm" data-memory-item-id="${escapeAttribute(item.id)}">确认</button><button class="text-button" type="button" data-memory-action="flag_incorrect" data-memory-item-id="${escapeAttribute(item.id)}">反馈错误</button><button class="text-button" type="button" data-memory-action="correct" data-memory-kind="${escapeAttribute(key)}" data-memory-item-id="${escapeAttribute(item.id)}">更正</button>` : ''}</div></li>`).join('')}</ul>`;
}

function renderOverview() {
  state.view = 'overview';
  const overview = state.overview;
  if (!overview) return `<section class="view-shell">${topDocumentBar('overview')}<div class="loading-view">正在整理当前作品全貌…</div></section>`;
  const formal = overview.formal_story || {};
  const planning = overview.future_planning || {};
  const completed = overview.work?.story_status === 'completed';
  return `<section class="view-shell overview-view">
    ${topDocumentBar('overview', { status: `<span class="status-badge ${completed ? 'success' : ''}">${completed ? '已完结' : '创作中'}</span>` })}
    <main class="overview-canvas">
      <header class="overview-hero"><div><span class="eyebrow">作品 → 剧集 → 场景 → 分镜（后三级为结构预留）</span><h1>${escapeHtml(overview.work?.title || state.editorTitle)}</h1><p>${escapeHtml(formal.evidence_notice || '')}</p></div><button class="secondary-button" type="button" data-action="${completed ? 'request-reopen-work' : 'request-complete-work'}">${completed ? '重新开启创作' : '标记作品完结'}</button></header>
      <div class="story-layer-legend"><span class="formal">正式剧情 · 已采用</span><span class="candidate">候选剧情 · 未采用</span><span class="planning">未来规划 · 尚未写入正文</span></div>
      ${overview.candidate_story ? `<section class="candidate-boundary"><strong>当前候选 ${escapeHtml(versionLabelById(overview.candidate_story.version_id))}</strong><span>${escapeHtml(overview.candidate_story.notice)}</span></section>` : ''}
      ${overview.candidate_story ? `<section class="overview-card candidate-event-card"><h2>候选新增剧情 · 尚未采用</h2><p class="overview-note">${overview.candidate_story.event_scope === 'generated_segment' ? '仅列出证据落在本次续写新增片段内的事件提案。' : '这是候选事件提案，不与正式时间线混合；非续写操作不声称每条都属于新增事件。'}</p>${overviewList(overview.candidate_story.new_events || [], 'event', '当前没有可定位的候选事件提案；请以候选正文为准。')}</section>` : ''}
      <div class="overview-grid">
        <section class="overview-card wide"><h2>故事主线与因果节点</h2>${overviewList(formal.mainline, 'event', '当前事件尚无足够的因果信息可形成主线节点；请以正式正文为准。')}</section>
        <section class="overview-card"><h2>人物记忆</h2><p class="overview-note">保留版本绑定的角色记录与作者纠错；证据不足的身份和关系仍待确认。</p>${overviewList(formal.characters, 'name', '尚无可核验的人物记忆。')}</section>
        <section class="overview-card"><h2>重要剧情事实</h2>${overviewList(formal.important_facts, 'fact', '尚无可核验的重要事实。')}</section>
        <section class="overview-card"><h2>事件时间线</h2><p class="overview-note">按已记录顺序展示；时间未明确的事件不补造日期。</p>${overviewList(formal.timeline, 'event', '尚无可核验的时间线。')}</section>
        <section class="overview-card"><h2>未解决冲突</h2>${overviewList(formal.unresolved_conflicts, 'thread', '当前记忆中没有已确认的未解决冲突。')}</section>
        <section class="overview-card"><h2>伏笔与回收状态</h2>${overviewList(formal.foreshadowing, 'thread', '正式 Story Memory 中暂无可核验的伏笔；作者计划不会冒充正式剧情。')}</section>
      </div>
      <details class="memory-history"><summary>查看故事记忆版本轨迹 <span>${overview.memory_history?.length || 0} 个快照</span></summary>
        ${(overview.memory_history || []).map((snapshot) => `<article><strong>${escapeHtml(versionLabelById(snapshot.version_id))}</strong><span>${escapeHtml(snapshot.memory_status)} · ${escapeHtml(new Date(snapshot.created_at).toLocaleString('zh-CN'))}</span><small>人物 ${snapshot.items?.characters?.length || 0} · 事件 ${snapshot.items?.events?.length || 0} · 事实 ${snapshot.items?.persistent_facts?.length || 0} · 冲突 ${snapshot.items?.open_threads?.length || 0}</small></article>`).join('') || '<p>尚无正式记忆快照。</p>'}
      </details>
      <section class="planning-editor"><div><h2>未来剧情与结局规划</h2><p>这里只保存作者计划，不会修改已采用正文，也不会自动变成正式 Story Memory。</p></div>
        <label><span>未来剧情规划（每行一项）</span><textarea id="futurePlotPlan">${escapeHtml((planning.future_plot || []).join('\n'))}</textarea></label>
        <label><span>结局规划（每行一项）</span><textarea id="endingPlan">${escapeHtml((planning.ending_plan || []).join('\n'))}</textarea></label>
        <label><span>伏笔与计划回收（每行一项）</span><textarea id="foreshadowingPlan">${escapeHtml((planning.foreshadowing || []).join('\n'))}</textarea></label>
        <button class="primary-button" type="button" data-action="save-story-plan">保存作者规划</button>
      </section>
    </main>
  </section>`;
}

async function showOverview() {
  if (!state.work?.id) return toast('请先建立作品');
  state.overview = null;
  renderView('overview');
  try {
    state.overview = await api(`/api/works/${encodeURIComponent(state.work.id)}/overview`);
    renderView('overview');
  } catch (error) {
    state.lastError = error;
    toast(error.message);
    renderView('editor');
  }
}

async function saveMemoryFeedback(action, memoryItemId, value = null, note = '') {
  if (!state.work?.id || !state.currentVersion?.id) return toast('当前没有可校正的正式故事记忆');
  await api(`/api/works/${encodeURIComponent(state.work.id)}/memory-feedback`, {
    method: 'POST', body: JSON.stringify({ version_id: state.currentVersion.id,
      memory_item_id: memoryItemId, action, value, note })
  });
  await showOverview();
  toast('作者反馈已保存；正文未修改，历史记忆证据仍保留');
}

function openMemoryCorrectionModal(button) {
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="memoryCorrectionTitle">
    <div class="modal-top"><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button><h2 id="memoryCorrectionTitle">更正故事记忆</h2><p>更正只影响记忆视图和后续创作上下文，不会修改已采用正文；来源版本和历史反馈继续保留。</p></div>
    <div class="modal-form"><label class="settings-field"><span>更正内容</span><textarea id="memoryCorrectionValue" rows="4" placeholder="输入正确的事实、关系或状态"></textarea></label>
    <label class="settings-field"><span>说明（可选）</span><input id="memoryCorrectionNote" maxlength="500" placeholder="为什么需要更正"></label><p class="modal-error" role="alert" hidden></p></div>
    <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-memory-correction" data-memory-item-id="${escapeAttribute(button.dataset.memoryItemId)}" data-memory-kind="${escapeAttribute(button.dataset.memoryKind)}">保存更正</button></footer>
  </section>`;
  requestAnimationFrame(() => $('#memoryCorrectionValue')?.focus());
}

async function confirmMemoryCorrection(button) {
  const text = String($('#memoryCorrectionValue')?.value || '').trim();
  if (!text) return showModalFormError('请输入更正内容');
  const kind = button.dataset.memoryKind;
  const value = kind === 'name' ? { relationships: text.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean) }
    : kind === 'event' ? { event: text } : kind === 'thread' ? { thread: text } : { fact: text };
  $('#modalLayer').hidden = true;
  await saveMemoryFeedback('correct', button.dataset.memoryItemId, value, String($('#memoryCorrectionNote')?.value || ''));
}

function openAddRelationshipModal() {
  if (!state.currentVersion) return toast('请先建立正式正文版本');
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="addRelationshipTitle">
    <div class="modal-top"><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button><h2 id="addRelationshipTitle">补充缺失关系</h2><p>这是作者手动确认的记忆，不会改写正文；会记录来源版本与编辑时间。</p></div>
    <div class="modal-form"><label class="settings-field"><span>人物名</span><input id="memoryPersonName" maxlength="80"></label>
    <label class="settings-field"><span>身份或关系</span><input id="memoryRelationship" maxlength="240" placeholder="例如：阿坤，主角的债权人和旧友"></label><p class="modal-error" role="alert" hidden></p></div>
    <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-add-memory-relationship">保存关系</button></footer>
  </section>`;
}

async function addMemoryRelationship() {
  const name = String($('#memoryPersonName')?.value || '').trim();
  const relationship = String($('#memoryRelationship')?.value || '').trim();
  if (!name || !relationship) return showModalFormError('请填写人物名和关系');
  const itemId = `author_character_${Date.now().toString(36)}`;
  $('#modalLayer').hidden = true;
  await saveMemoryFeedback('add_missing', itemId, { kind: 'characters', item: {
    name, identity: relationship, relationships: [relationship], state: '作者补充', status: 'active',
    time_context: `正式版本 ${displayVersion(state.currentVersion)}`
  } }, '作者手动补充缺失关系');
}

function selectionBindingHtml() {
  if (!state.selection) return '';
  const codePointCount = [...state.selection.text].length;
  return `
    <section class="selection-binding" aria-label="当前修改范围">
      <div class="scope-segment" role="group" aria-label="修改范围">
        <button type="button" data-action="clear-selection">整篇</button>
        <button class="active" type="button" aria-pressed="true">局部选区</button>
      </div>
      <div class="binding-details">
        <div><span>当前作品版本</span><strong>${escapeHtml(displayVersion(state.currentVersion))}</strong></div>
        <div data-range-start="${state.selection.start}" data-range-end="${state.selection.end}"><span>选区范围</span><strong>${codePointCount} 字 · 已绑定当前版本</strong></div>
        <div class="binding-preview"><span>所选段落预览</span><strong>“${escapeHtml(compactText(state.selection.text, 88))}”</strong></div>
      </div>
      <button class="clear-selection" type="button" data-action="clear-selection">清除选区</button>
    </section>`;
}

function composerHtml() {
  const placeholder = {
    CREATE: '描述你想生成的完整短剧、身份冲突和结尾……',
    EXPAND: state.selection ? '说明选区需要增加的动作、对白或情绪……' : '说明需要丰富的过程、对白或情绪……',
    REWRITE: state.selection ? '说明如何改写选区，以及必须保持什么……' : '说明要改变的事件、人物选择或表达……',
    CONTINUE: '说明下一段从哪里开始、承接哪些后果……'
  }[state.operation] || '请先选择本次要执行的创作操作……';
  if (state.composerCollapsed) return `
    <section class="composer composer-collapsed" aria-label="创作面板已收起">
      <button type="button" class="composer-expand" data-action="toggle-composer">展开创作</button>
      <span>阅读中 · ${escapeHtml(operationLabels[state.operation] || '请选择操作')} · 草稿已保留</span>
    </section>`;
  const endingControls = state.operation === 'CONTINUE' ? `
    <div class="ending-intent" aria-label="续写目标">
      <label><span>续写目标</span><select id="endingMode">
        <option value="continue" ${state.form.endingMode === 'continue' ? 'selected' : ''}>普通续写</option>
        <option value="natural_ending" ${state.form.endingMode === 'natural_ending' ? 'selected' : ''}>自然收尾</option>
        <option value="specified_ending" ${state.form.endingMode === 'specified_ending' ? 'selected' : ''}>指定结局</option>
      </select></label>
      ${state.form.endingMode === 'continue' ? '' : `<label class="ending-requirements"><span>结局要求</span><input id="endingRequirements" value="${escapeAttribute(state.form.endingRequirements)}" placeholder="要处理的冲突、人物落点或伏笔"></label>`}
      ${state.form.endingMode === 'specified_ending' ? `<label class="ending-final-sentence"><span>逐字尾句（可选）</span><input id="exactFinalSentence" value="${escapeAttribute(state.form.exactFinalSentence)}" placeholder="候选新增正文必须以这句话结束"></label>` : ''}
    </div>` : '';
  return `
    <section class="composer ${state.busy ? 'busy' : ''}" aria-label="AI 创作助手">
      <div class="composer-heading"><div><strong>AI 创作助手</strong><small>当前正文不会被候选直接覆盖</small></div><button class="composer-collapse" type="button" data-action="toggle-composer">收起创作区</button></div>
      ${operationSummaryHtml()}
      <div class="composer-instruction-row">
        <label class="instruction-label" for="composerInput">本次给 AI 的创作要求</label>
        <textarea id="composerInput" rows="1" aria-describedby="instructionHelp" placeholder="${escapeAttribute(placeholder)}" ${state.busy ? 'disabled' : ''}>${escapeHtml(state.form.instruction)}</textarea>
        <small id="instructionHelp">描述希望怎样创作；这里的输入不会直接改动上方正文。</small>
      </div>
      ${endingControls}
      ${state.lastError ? `<div class="composer-error" role="alert">${escapeHtml(state.lastError.message || '上次操作未完成，当前正文和输入均已保留。')}${state.candidateTask?.retry_confirmation_required && state.candidateTask?.unknown_stage !== 'validate' ? '<button class="text-button" type="button" data-action="request-generation-retry">确认后重新生成</button>' : ''}</div>` : ''}
      <div class="composer-options-row">
        <div class="operation-picker" role="tablist" aria-label="创作操作">
          ${['CREATE', 'EXPAND', 'REWRITE', 'CONTINUE'].map((item) => `<button type="button" class="${item === state.operation ? 'active' : ''}" data-operation="${item}" aria-selected="${item === state.operation}">${operationLabels[item]}</button>`).join('')}
        </div>
        <div class="composer-quick-settings"><button class="subtle-chip" type="button" data-action="open-settings" data-length-hint>${escapeHtml(creativeLengthLabel())}</button><button class="subtle-chip" type="button" data-action="open-settings">${escapeHtml(state.form.person)}</button></div>
      </div>
      <div class="composer-model-row">${modelSelectionHtml()}</div>
      <div class="composer-submit-row">
        <span class="composer-note">生成后先审核候选，再决定是否采用</span>
        <button class="send-button" type="button" data-action="generate" aria-label="提交生成" ${state.busy || !state.operation ? 'disabled' : ''} title="${state.operation ? escapeAttribute(operationActions[state.operation]) : '请先选择创作操作'}">${escapeHtml(state.operation ? operationActions[state.operation] : '生成候选稿')}</button>
      </div>
    </section>`;
}

function renderEmpty() {
  state.view = 'empty';
  return `
    <section class="empty-view">
      <div class="empty-content">
        <div class="empty-mark">D</div>
        <h1>从一个身份，<br>一场冲突开始。</h1>
        <p>生成完整短剧，或在建立正文后进行局部扩写、改写、续写和候选审核。</p>
        <div class="idea-box">
          <textarea id="ideaInput" placeholder="例如：今天体验的身份是一个20岁的富二代。父亲的公司突然破产……">${escapeHtml(state.form.instruction)}</textarea>
          <div class="idea-config-row"><button class="subtle-chip" type="button" data-action="open-settings">约 ${escapeHtml(state.form.targetLength)} 字</button><button class="subtle-chip" type="button" data-action="open-settings">${escapeHtml(state.form.person)}</button></div>
          <div class="idea-model-row">${modelSelectionHtml()}</div>
          <div class="idea-submit-row"><span>正文先保存为候选，通过检查后由你决定是否采用。</span><button class="primary-button" type="button" data-action="generate" ${state.busy ? 'disabled' : ''}>生成候选稿</button></div>
        </div>
        <div class="sample-prompts" aria-label="示例创作方向">
          <button class="sample-prompt" type="button" data-prompt="17岁刚登基的皇帝，第一天就必须在两种都不完美的选择中做决定。">17岁刚登基的皇帝</button>
          <button class="sample-prompt" type="button" data-prompt="普通大学生突然能看见别人即将后悔的选择，但无法看见自己的。">能看见别人即将后悔的选择</button>
          <button class="sample-prompt" type="button" data-prompt="从婚礼取消后的第二天开始，写亲友如何面对后果。">婚礼取消后的第二天</button>
        </div>
      </div>
    </section>`;
}

function renderEditor() {
  state.dirty = editorHasChanges();
  state.view = state.lastError ? 'failure' : 'editor';
  const count = [...state.editorBody.replace(/\s/gu, '')].length;
  return `
    <section class="view-shell">
      ${topDocumentBar('story', {
        status: state.lastError
          ? '<span class="status-badge danger">上次操作未完成</span>'
          : `<span data-editor-version-status class="status-badge ${state.dirty ? 'warning' : 'success'}">${state.dirty ? '修改尚未提交为正式版本' : state.currentVersion ? '已保存为正式版本' : '新作品'}</span>`
      })}
      ${selectionBindingHtml()}
      <div class="editor-layout">
        <article class="document-canvas">
          <div class="eyebrow">身份短剧 · 第 01 集 · 当前正文 ${escapeHtml(displayVersion(state.currentVersion))}</div>
          <input class="document-title" id="titleEditor" value="${escapeAttribute(state.editorTitle)}" aria-label="短剧标题" autocomplete="off">
          <div class="document-meta"><span id="characterCount">${count.toLocaleString('zh-CN')} 字</span><span class="divider"></span><span>${escapeHtml(state.form.person)}</span><span class="divider"></span><button class="text-button" type="button" data-action="save-version">${state.dirty || !state.currentVersion ? '保存版本' : '已保存'}</button>${state.currentVersion ? '<span class="divider"></span><button class="text-button" type="button" data-action="export-current">导出当前版本</button>' : ''}</div>
          <textarea class="story-editor" id="bodyEditor" spellcheck="false" placeholder="完整正文会出现在这里。你也可以先粘贴已有内容并保存为版本。">${escapeHtml(state.editorBody)}</textarea>
          <div class="raw-selection-toolbar" id="selectionToolbar" hidden>
            <span class="selection-toolbar-copy"><strong id="selectionCount">已选 0 字</strong><small id="selectionPreview"></small></span>
            <button type="button" data-selection-action="EXPAND">扩写这段</button>
            <button type="button" data-selection-action="REWRITE">改写这段</button>
          </div>
        </article>
      </div>
      ${composerHtml()}
    </section>`;
}

function renderGenerating() {
  state.view = 'generating';
  const activeOperation = state.candidateTask?.operation || state.operation;
  const order = ['plan', 'write', 'validate'];
  const activeIndex = order.indexOf(state.progressStage);
  const labels = [
    ['理解创作意图', 'plan'],
    ['生成连续正文', 'write'],
    ['独立内容检查', 'validate']
  ];
  return `
    <section class="progress-view">
      <div class="progress-card">
        <div class="progress-orbit"><span>D</span></div>
        <h1>${state.progressStage === 'validate' ? '正在检查候选稿' : state.progressStage === 'plan' ? '正在理解创作意图' : `正在${operationLabels[activeOperation] || '执行创作任务'}`}</h1>
        <p>当前正文和输入不会被覆盖。Writer 完成后先保存候选，再进行独立检查。</p>
        <div class="progress-list">
          ${labels.map(([label, key], index) => {
            const done = index < activeIndex || (state.progressStage === 'write' && key === 'plan');
            const active = index === activeIndex;
            return `<div class="progress-step ${done ? 'done' : active ? 'active' : ''}"><span class="step-icon">${done ? '✓' : index + 1}</span><strong>${label}</strong><small>${done ? '已完成' : active ? '进行中' : '等待中'}</small></div>`;
          }).join('')}
        </div>
        <p class="progress-safety">真实任务 · ${escapeHtml(operationLabels[activeOperation] || activeOperation || '操作待确认')} · ${escapeHtml(displayVersion(state.currentVersion))} 保持不变 · ${escapeHtml(mergeStrategyLabel(state.candidateTask?.merge_strategy || operationMergeStrategy(activeOperation, Boolean(state.selection))))}</p>
        <button class="secondary-button stop-generation-button" type="button" data-action="stop-generation" ${state.stopping ? 'disabled' : ''}>${state.stopping ? '正在停止…' : '停止生成'}</button>
        <p class="progress-stop-note">停止只结束本机等待；如果请求已经发出，远端是否完成和是否计费可能无法确认。</p>
      </div>
    </section>`;
}

function candidateStatus() {
  const candidate = state.candidate;
  const task = state.candidateTask;
  const readinessReason = state.adoptionReadiness?.reasons?.[0]?.message || null;
  const canRevalidate = state.revalidationReadiness?.can_revalidate === true;
  const canAdopt = state.adoptionReadiness?.can_adopt === true;
  const recovery = state.candidateRecoveryGuidance;
  if (!candidate) return { key: 'none', canAdopt: false };
  if (state.candidateMeta.historical) {
    const current = candidate.id === state.currentVersion?.id;
    return {
      key: 'historical', view: 'candidate', banner: 'historical', badge: current ? '当前版本 · 只读' : '历史版本 · 只读', badgeClass: '',
      title: current ? '正在只读查看当前版本' : '正在查看历史记录，当前正文未改变',
      detail: current
        ? `${displayVersion(candidate)} 仅供查看。只有明确选择“进入创作”后才会返回编辑器。`
        : `${displayVersion(candidate)} 仅供查看。若要以它继续创作，必须先明确确认恢复为一个新的当前版本。`,
      reason: current
        ? '查看不会改变当前创作操作；进入编辑器后仍需核对操作与修改范围。'
        : `当前正式版本是 ${displayVersion(state.currentVersion)}；不能绕过版本保护直接把历史版本作为来源。`,
      button: current ? '基于当前版本创作' : '从此历史版本创作',
      canAdopt: false, canStartHistoricalAuthoring: true
    };
  }
  if (candidate.id === state.currentVersion?.id) {
    return {
      key: 'adopted', view: 'adopted', banner: 'adopted', badge: '已采用', badgeClass: 'success',
      title: '候选已经采用为当前正文',
      detail: `${displayVersion(candidate)} 现在是当前正文，采用前版本仍保留在历史记录中。`,
      reason: '采用操作已由服务端确认完成。', button: '查看检查记录', canAdopt: false
    };
  }
  if (state.adoptionReadiness?.reasons?.some((reason) => reason.code === 'SOURCE_VERSION_CONFLICT')) {
    return {
      key: 'conflict', view: 'conflict', banner: 'conflict', badge: '来源版本冲突', badgeClass: 'warning',
      title: '候选已保留，但当前不可采用',
      detail: `候选基于 ${displayVersion(state.versions.find((item) => item.id === candidate.parent_version_id))}，当前正文已是 ${displayVersion(state.currentVersion)}。系统不会用旧候选覆盖新版本。`,
      reason: recovery || '不能采用：来源版本已变化。请基于当前正文重新生成。', button: '查看检查原因', canAdopt: false
    };
  }
  if (candidate.validation_status === 'pending') {
    const canValidate = Boolean(task?.id);
    return {
      key: 'pending', view: 'candidate', banner: 'pending', badge: '正在检查', badgeClass: '',
      title: '候选正文已经保存',
      detail: '独立内容检查尚未完成；检查完成前不能采用。',
      reason: recovery || '不能采用：候选仍在等待内容检查。', button: canValidate ? '继续检查' : '查看检查原因',
      canAdopt: false, canValidate
    };
  }
  if (candidate.validation_status === 'unavailable') {
    const unknown = state.latestValidationRun?.status === 'outcome_unknown'
      || (task?.outcome_unknown && task?.unknown_stage === 'validate');
    const failureDetail = providerFailureExplanation(state.latestValidationRun?.error_code || task?.error_code || task?.last_error_code);
    return {
      key: 'unavailable', view: 'candidate-unavailable', banner: 'unavailable', badge: '检查不可用', badgeClass: 'warning',
      title: '候选已保存，检查暂未完成',
      detail: unknown
        ? '上次 AI 请求可能已经发送并产生费用，但本地未收到最终结果。候选正文已保留，系统没有自动重发。'
        : `${failureDetail} 这不是正文丢失，但在检查恢复前不能采用。`,
      reason: recovery || '不能采用：当前没有可核验的检查结果。', button: canRevalidate ? '重新检查' : '查看检查原因',
      canAdopt: false, canRevalidate
    };
  }
  if (state.latestValidationRun?.status === 'running') {
    return {
      key: 'revalidating', view: 'candidate', banner: 'pending', badge: '正在重新检查', badgeClass: '',
      title: '候选正文和旧检查均已保留',
      detail: 'Validator 正在重新审核这份候选；不会重新调用 Writer，也不会在完成前改变可采用状态。',
      reason: '不能采用：重新检查尚未形成最终结果。', button: '查看检查进度', canAdopt: false
    };
  }
  if (candidate.validation_status === 'blocked') {
    const latestRun = state.latestValidationRun;
    const retryUnavailable = ['unavailable', 'outcome_unknown'].includes(latestRun?.status);
    return {
      key: 'blocked', view: 'candidate-blocked', banner: 'blocked', badge: '检查阻断', badgeClass: 'danger',
      title: '内容检查发现阻断项',
      detail: retryUnavailable
        ? latestRun.outcome_unknown
          ? '上次重新检查的远端结果无法确认。候选正文和旧检查均已保留，系统没有自动重发。'
          : `${providerFailureExplanation(latestRun.error_code)} 候选正文和旧检查均已保留。`
        : '候选仍可阅读全文，但存在事实、时间线或作者硬约束冲突；处理前不能采用。',
      reason: retryUnavailable
        ? '不能采用：重新检查没有形成可核验的新结果。'
        : '不能采用：请查看内容检查中的阻断证据。',
      button: canRevalidate ? '重新检查' : '查看检查原因', canAdopt: false, canRevalidate
    };
  }
  if (candidate.can_auto_apply === false || state.candidateMeta.canApply === false
    || state.adoptionReadiness?.can_adopt === false) {
    return {
      key: 'not-adoptable', view: 'candidate-blocked', banner: 'unavailable', badge: '暂不可采用', badgeClass: 'warning',
      title: '当前检查结果不能直接采用',
      detail: `${readinessReason || '当前审核结果与安全门禁尚未形成有效绑定。'} ${recovery || ''}`,
      reason: recovery || `不能采用：${readinessReason || '请打开内容检查查看当前门禁原因。'}`,
      button: canRevalidate ? '重新检查' : '查看检查原因', canAdopt: false, canRevalidate
    };
  }
  return {
    key: 'passed', view: 'candidate', banner: '',
    badge: candidate.validation_legacy_compatible ? '历史审核通过' : '检查通过', badgeClass: 'success',
    title: '这是候选稿，尚未成为当前正文',
    detail: candidate.validation_legacy_compatible
      ? '可信的旧版审核仍满足事实与作者约束门禁；V1.4 新增语言提醒未补做，不能视作新版审核。请阅读全文后决定。'
      : '事实与作者约束检查通过；这不代表内容质量优秀，请阅读全文后决定。',
    reason: recovery || '采用后，当前版本仍会保留在历史记录中。', button: '采用此版本', canAdopt
  };
}

function renderCandidate() {
  if (!state.candidate) return renderEditor();
  const status = candidateStatus();
  state.view = status.view;
  const candidate = state.candidate;
  const parent = state.versions.find((item) => item.id === candidate.parent_version_id);
  const sourceLabel = candidate.parent_version_id ? displayVersion(parent) : '新作品';
  const consumedInstruction = candidate.creative_brief?.user_instruction || '';
  const endingCandidate = candidate.operation === 'CONTINUE'
    && ['natural_ending', 'specified_ending'].includes(candidate.creative_brief?.ending_intent?.mode);
  return `
    <section class="view-shell">
      ${topDocumentBar('candidate', {
        version: candidate.id === state.currentVersion?.id ? `当前 ${displayVersion(candidate)}`
          : status.key === 'historical' ? `只读 ${displayVersion(candidate)}` : `候选 ${displayVersion(candidate)}`,
        status: `<span class="status-badge ${status.badgeClass}">${status.badge}</span>`
      })}
      <div class="candidate-layout">
        <article class="candidate-document">
          <div class="candidate-banner ${status.banner}">
            <div><strong>${escapeHtml(status.title)}</strong><p>${escapeHtml(status.detail)}</p></div>
            <span class="status-badge ${status.badgeClass}">${escapeHtml(status.badge)}</span>
          </div>
          <div class="candidate-story">
            <div class="eyebrow">身份短剧 · 第 01 集 · 候选审核 · ${escapeHtml(operationLabels[candidate.operation] || candidate.operation)}</div>
            <h1>${escapeHtml(candidate.title)}</h1>
            ${candidate.segment_title ? `<p class="segment-title">本次段落标题：${escapeHtml(candidate.segment_title)}</p>` : ''}
            <div class="document-meta"><span>${[...candidate.content.replace(/\s/gu, '')].length.toLocaleString('zh-CN')} 字</span><span class="divider"></span><span>基于 ${escapeHtml(sourceLabel)}</span><span class="divider"></span><span>${escapeHtml(candidate.model_name || '模型未记录')}</span></div>
            ${consumedInstruction ? `<details class="consumed-prompt"><summary>查看本次已消费的创作指令</summary><p>${escapeHtml(consumedInstruction)}</p><button class="text-button" type="button" data-action="reuse-candidate-instruction">明确复用此指令</button></details>` : ''}
            <div class="story-body">${storyHtml(candidate.content)}</div>
          </div>
        </article>
      </div>
      <section class="review-actions" aria-label="候选审核操作">
        <div class="review-state"><strong>${escapeHtml(candidate.title)} · ${escapeHtml(status.badge)}</strong><span id="adoptReason" class="adopt-reason">${escapeHtml(status.reason)}</span></div>
        <div class="review-buttons">
          <button class="secondary-button mobile-hide" type="button" data-action="show-editor">返回正文</button>
          <button class="secondary-button" type="button" data-action="export-candidate">${candidate.status === 'candidate' ? '导出候选稿' : candidate.id === state.currentVersion?.id ? '导出当前版本' : '导出历史版本'}</button>
          <button class="secondary-button" type="button" data-action="show-compare">比较改动</button>
          ${status.key === 'adopted' && endingCandidate && state.work?.story_status !== 'completed'
            ? '<button class="secondary-button" type="button" data-action="request-complete-work">标记作品完结</button>' : ''}
          <button class="primary-button" type="button" data-action="${status.canStartHistoricalAuthoring ? 'request-history-authoring' : status.canRevalidate ? 'request-candidate-revalidation' : status.canValidate ? 'retry-validation' : status.canAdopt ? 'adopt-candidate' : 'open-checks'}" aria-describedby="adoptReason">${escapeHtml(status.button)}</button>
        </div>
      </section>
    </section>`;
}

function paragraphDiffRows(before, after) {
  const left = splitParagraphs(before);
  const right = splitParagraphs(after);
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      dp[i][j] = left[i] === right[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matches = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  matches.push([left.length, right.length]);
  const rows = [];
  let previousLeft = 0;
  let previousRight = 0;
  let changeNumber = 0;
  for (const [matchLeft, matchRight] of matches) {
    const gapLeft = left.slice(previousLeft, matchLeft);
    const gapRight = right.slice(previousRight, matchRight);
    const gapLength = Math.max(gapLeft.length, gapRight.length);
    for (let gap = 0; gap < gapLength; gap += 1) {
      changeNumber += 1;
      const type = !gapLeft[gap] ? 'added' : !gapRight[gap] ? 'removed' : 'changed';
      rows.push({ original: gapLeft[gap] || '', candidate: gapRight[gap] || '', type,
        label: `${type === 'added' ? '新增' : type === 'removed' ? '删除' : '修改'} ${changeNumber}` });
    }
    if (matchLeft < left.length && matchRight < right.length) {
      rows.push({ original: left[matchLeft], candidate: right[matchRight], type: 'unchanged', label: '未修改' });
    }
    previousLeft = matchLeft + 1;
    previousRight = matchRight + 1;
  }
  return { rows, changes: changeNumber };
}

function candidateDiffRows(source, candidate) {
  const sourceContent = String(source?.content || '');
  const generated = String(candidate?.generated_segment || '');
  const normalizedSource = sourceContent.replace(/\s+$/u, '');
  const expectedContinuation = generated ? `${normalizedSource}\n\n${generated}` : null;
  if (candidate?.operation === 'CONTINUE' && candidate.parent_version_id === source?.id && expectedContinuation === candidate.content) {
    const retained = splitParagraphs(sourceContent).map((paragraph) => ({
      original: paragraph, candidate: paragraph, type: 'unchanged', label: '前文保留'
    }));
    const added = splitParagraphs(generated).map((paragraph, index) => ({
      original: '', candidate: paragraph, type: 'added', label: `追加 ${index + 1}`
    }));
    return { rows: [...retained, ...added], changes: added.length, continuation: true };
  }
  return { ...paragraphDiffRows(sourceContent, candidate?.content || ''), continuation: false };
}

function versionKind(version) {
  return version?.status === 'candidate' ? '候选稿' : version?.id === state.currentVersion?.id ? '正式稿' : '历史稿';
}

function readableVersions() {
  return state.versions.filter((version) => version.work_id === state.work?.id && typeof version.content === 'string');
}

function openCompare() {
  const versions = readableVersions();
  if (versions.length < 2) return toast('至少需要同一作品的两个已保存版本才能比较');
  const target = versions.find((v) => v.id === state.candidate?.id) || state.currentVersion || versions[0];
  const base = versions.find((v) => v.id === target.parent_version_id)
    || versions.find((v) => v.id === state.currentVersion?.id && v.id !== target.id)
    || versions.find((v) => v.id !== target.id);
  state.compareBaseId = base.id;
  state.compareTargetId = target.id;
  state.compareMode = 'changes';
  renderView('compare');
}

function renderCompare() {
  const versions = readableVersions();
  const candidate = versions.find((v) => v.id === state.compareTargetId);
  const source = versions.find((v) => v.id === state.compareBaseId);
  if (!candidate || !source || candidate.id === source.id) return renderEditor();
  state.view = 'compare';
  const diff = candidateDiffRows(source, candidate);
  const focusContinuation = diff.continuation && state.compareMode !== 'full';
  const titleChanged = (source?.title || '') !== candidate.title;
  const rows = [{
    original: source?.title || '尚无正文',
    candidate: candidate.title,
    type: titleChanged ? 'changed' : 'unchanged',
    label: titleChanged ? '标题已修改' : '标题未修改',
    title: true
  }, ...diff.rows];
  const options = (selectedId, otherId) => versions.map((version) => `<option value="${escapeAttribute(version.id)}" ${version.id === selectedId ? 'selected' : ''} ${version.id === otherId ? 'disabled' : ''}>${escapeHtml(`${displayVersion(version)} · ${version.title} · ${versionKind(version)} · ${[...version.content.replace(/\s/gu, '')].length} 字`)}</option>`).join('');
  return `
    <section class="view-shell">
      ${topDocumentBar('compare', {
        version: `${source ? displayVersion(source) : '空白'} → ${displayVersion(candidate)}`,
        status: '<span class="status-badge">只读比较</span>'
      })}
      <div class="compare-layout">
        <div class="compare-selectors" aria-label="选择比较版本"><label for="compareBaseVersion">基准版本<select id="compareBaseVersion">${options(source.id, candidate.id)}</select></label><button type="button" class="secondary-button" data-action="swap-compare">交换方向</button><label for="compareTargetVersion">目标版本<select id="compareTargetVersion">${options(candidate.id, source.id)}</select></label></div>
        <div class="compare-head">
          <div><h1>${focusContinuation ? '查看新增续写' : '版本比较'}</h1><p>${focusContinuation ? '聚焦目标版本相对其来源新增的内容。' : '从基准版本到目标版本逐段对齐；选择和交换方向不会更改作品。'}</p>
            <div class="diff-legend">${diff.continuation ? '<span><i class="legend-mark added"></i>新增续写：紫色“追加”标签</span>' : '<span><i class="legend-mark changed"></i>已修改：编号、标签与侧边标记</span>'}<span><i class="legend-mark unchanged"></i>前文保留：灰色标签</span></div>
          </div>
          <div class="compare-head-actions">
            ${diff.continuation ? `<div class="compare-mode-toggle" aria-label="续写比较范围"><button class="${focusContinuation ? 'active' : ''}" data-compare-mode="changes">仅看新增</button><button class="${!focusContinuation ? 'active' : ''}" data-compare-mode="full">完整双栏</button></div>` : ''}
            <div class="compare-toggle"><button class="${state.compareSide === 'original' ? 'active' : ''}" data-compare-side="original">基准</button><button class="${state.compareSide === 'candidate' ? 'active' : ''}" data-compare-side="candidate">目标</button></div>
          </div>
        </div>
        ${focusContinuation ? `
          <section class="continuation-focus" aria-label="续写新增内容">
            <div class="continuation-retained"><strong>前文完整保留</strong><span>${splitParagraphs(source?.content || '').length} 段 · ${[...String(source?.content || '').replace(/\s/gu, '')].length.toLocaleString('zh-CN')} 字</span><small>PROGRAM_APPEND 已将来源正文原样保留；切换“完整双栏”可逐段复核。</small></div>
            <div class="continuation-added-list">${splitParagraphs(candidate.generated_segment || '').map((paragraph, index) => `<article class="continuation-added"><span>追加 ${index + 1}</span><p>${escapeHtml(paragraph)}</p></article>`).join('')}</div>
          </section>
        ` : `<div class="compare-surface" data-mobile-side="${state.compareSide}">
          <div class="compare-columns-head"><div class="original"><strong>基准 · ${displayVersion(source)} · ${versionKind(source)}</strong><span>${[...source.content.replace(/\s/gu, '')].length.toLocaleString('zh-CN')} 字</span></div><div class="candidate"><strong>目标 · ${displayVersion(candidate)} · ${versionKind(candidate)}</strong><span>${[...candidate.content.replace(/\s/gu, '')].length.toLocaleString('zh-CN')} 字</span></div></div>
          <div class="compare-body">
            ${rows.map((row) => {
              const original = row.original ? (row.title ? `<h2>${escapeHtml(row.original)}</h2>` : `<p>${escapeHtml(row.original)}</p>`) : '<span class="empty-diff">此处无对应段落</span>';
              const next = row.candidate ? (row.title ? `<h2>${escapeHtml(row.candidate)}</h2>` : `<p>${escapeHtml(row.candidate)}</p>`) : '<span class="empty-diff">目标版本已删除此段</span>';
              const originalRole = row.type === 'added' ? '来源无对应段落' : '修改前';
              const candidateRole = row.type === 'added' ? '目标新增' : '修改后';
              return `<div class="diff-row"><div class="diff-cell original ${row.type}${row.title ? ' diff-title' : ''}" data-change-label="${escapeAttribute(row.label)} · ${originalRole}">${original}</div><div class="diff-cell candidate ${row.type}${row.title ? ' diff-title' : ''}" data-change-label="${escapeAttribute(row.label)} · ${candidateRole}">${next}</div></div>`;
            }).join('')}
          </div>
        </div>`}
      </div>
      <section class="review-actions">
        <div class="review-state"><strong>${diff.changes + (titleChanged ? 1 : 0)} 组内容变化</strong><span>只读比较 · 不调用 AI，不采用或恢复版本</span></div>
        <div class="review-buttons"><button class="secondary-button" type="button" data-action="show-editor">返回正文</button></div>
      </section>
    </section>`;
}

function renderView(view = state.view) {
  clearTimeout(state.taskPollTimer);
  closeOverlay({ all: true });
  const root = $('#viewRoot');
  let html;
  if (view === 'empty') html = renderEmpty();
  else if (view === 'generating') html = renderGenerating();
  else if (view === 'candidate') html = renderCandidate();
  else if (view === 'compare') html = renderCompare();
  else if (view === 'overview') html = renderOverview();
  else if (view === 'loading') html = '<div class="loading-view">正在读取作品与版本…</div>';
  else html = renderEditor();
  root.innerHTML = html;
  document.body.dataset.view = state.view;
  updateHeader();
  window.scrollTo({ top: 0, behavior: 'instant' });
  requestAnimationFrame(resizeEditor);
}

function resizeEditor() {
  const editor = $('#bodyEditor');
  if (!editor) return;
  editor.style.height = 'auto';
  editor.style.height = `${Math.max(520, editor.scrollHeight + 4)}px`;
}

async function setOperation(operation, { keepSelection = false } = {}) {
  if (!isAuthoringOperation(operation)) return;
  const previousOperation = state.operation;
  state.operation = operation;
  state.operationSelectedAt = new Date().toISOString();
  state.operationNotice = null;
  if (!keepSelection && !['EXPAND', 'REWRITE'].includes(operation)) state.selection = null;
  state.lastError = null;
  persistDraft();
  recordRoutingEvent('operation_selected', {
    client_operation: operation,
    source_version_id: state.currentVersion?.id || null,
    writer_provider_id: state.modelSelection?.provider_id || null,
    writer_model_id: state.modelSelection?.writer_model_id || null,
    merge_strategy: operationMergeStrategy(operation, Boolean(state.selection)),
    result: previousOperation === operation ? 'reconfirmed' : 'changed'
  });
  if (state.view === 'editor' || state.view === 'failure') renderView('editor');
  else if (state.view === 'empty' && operation !== 'CREATE') renderView('editor');
  const persisted = await persistLocalAuthoringOperation();
  if (!persisted) {
    state.operationNotice = '本次操作已选择，但未能写入本机恢复状态；重启后需要重新选择。';
    if (state.view === 'editor' || state.view === 'failure') renderView('editor');
  }
}

function clearSelection() {
  state.selection = null;
  persistDraft();
  if (state.view === 'editor' || state.view === 'failure') renderView('editor');
  toast('已清除选区，本次操作恢复为整篇修改');
}

function positionSelectionToolbar(editor, toolbar, start, end) {
  const rect = editor.getBoundingClientRect();
  const computed = getComputedStyle(editor);
  const mirror = document.createElement('div');
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', pointerEvents: 'none', zIndex: '-1',
    left: `${rect.left}px`, top: `${rect.top}px`, width: `${editor.clientWidth}px`,
    boxSizing: computed.boxSizing, padding: computed.padding, border: computed.border,
    font: computed.font, fontFamily: computed.fontFamily, fontSize: computed.fontSize,
    fontWeight: computed.fontWeight, lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: computed.wordBreak
  });
  mirror.textContent = editor.value.slice(0, start);
  const marker = document.createElement('span');
  marker.textContent = editor.value.slice(start, end) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  const lines = [...marker.getClientRects()].map((line) => ({
    left: line.left - editor.scrollLeft, top: line.top - editor.scrollTop,
    bottom: line.bottom - editor.scrollTop
  }));
  mirror.remove();
  const viewportWidth = window.visualViewport?.width || window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const viewportOffsetTop = window.visualViewport?.offsetTop || 0;
  const readingTop = Math.max(viewportOffsetTop, $('.document-header')?.getBoundingClientRect().bottom || 0);
  const readingBottom = Math.min(viewportOffsetTop + viewportHeight, $('.composer, .composer-collapsed')?.getBoundingClientRect().top || Infinity);
  const visibleLines = lines.filter((line) => line.bottom > Math.max(readingTop, rect.top) && line.top < Math.min(readingBottom, rect.bottom));
  if (!visibleLines.length) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  const toolbarRect = toolbar.getBoundingClientRect();
  const markerRect = visibleLines[0];
  const left = Math.max(10, Math.min(markerRect.left, viewportWidth - toolbarRect.width - 10));
  const above = markerRect.top - toolbarRect.height - 10;
  const top = above >= readingTop + 8
    ? above
    : visibleLines.at(-1).bottom + 10;
  // Do not pin a toolbar over selected text when there is no unobstructed space.
  if (top + toolbarRect.height > readingBottom - 8) { toolbar.hidden = true; return; }
  toolbar.style.left = `${left}px`;
  toolbar.style.top = `${Math.max(viewportOffsetTop + 8, top)}px`;
}

function watchTextSelection() {
  const editor = $('#bodyEditor');
  const toolbar = $('#selectionToolbar');
  if (!editor || !toolbar) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = end > start ? editor.value.slice(start, end) : '';
  toolbar.hidden = selected.trim().length < 2;
  if (toolbar.hidden) {
    toolbar.dataset.selectedText = '';
    return;
  }
  toolbar.dataset.start = String(start);
  toolbar.dataset.end = String(end);
  toolbar.dataset.selectedText = selected;
  $('#selectionCount').textContent = `已选 ${[...selected].length} 字`;
  $('#selectionPreview').textContent = `“${compactText(selected, 30)}”`;
  positionSelectionToolbar(editor, toolbar, start, end);
}

function captureEditorValues() {
  if ($('#titleEditor')) state.editorTitle = $('#titleEditor').value.trim() || '未命名短剧';
  if ($('#bodyEditor')) state.editorBody = $('#bodyEditor').value;
  if ($('#composerInput')) state.form.instruction = $('#composerInput').value;
  if ($('#ideaInput')) state.form.instruction = $('#ideaInput').value;
}

function markEditorDirty() {
  captureEditorValues();
  if (state.selection) {
    state.selection = null;
    toast('正文已经变化，原选区绑定已清除');
  }
  state.dirty = editorHasChanges();
  state.editorRevision += 1;
  state.lastError = null;
  updateHeader();
  const count = $('#characterCount');
  if (count) count.textContent = `${[...state.editorBody.replace(/\s/gu, '')].length.toLocaleString('zh-CN')} 字`;
  persistDraft();
  resizeEditor();
}

function editorHasChanges() {
  return state.currentVersion
    ? state.editorBody !== state.currentVersion.content || state.editorTitle !== state.currentVersion.title
    : Boolean(state.editorBody.trim());
}

function creativeTargetLength() {
  if (state.selection && ['REWRITE', 'EXPAND'].includes(state.operation)) {
    const length = [...state.selection.text.replace(/\s/gu, '')].length;
    return Math.max(1, state.operation === 'EXPAND' ? length * 2 : length);
  }
  return Number(state.form.targetLength) || 2000;
}

function creativeLengthLabel() {
  const length = creativeTargetLength();
  if (state.selection && state.operation === 'REWRITE') return `局部改写约 ${length} 字 · 参考原长度`;
  if (state.selection && state.operation === 'EXPAND') return `扩写片段约 ${length} 字 · 可增加篇幅`;
  return `${state.operation === 'CONTINUE' ? '新增' : '整篇'}约 ${length} 字`;
}

function upsertVersion(version) {
  if (!version) return;
  state.versions = [version, ...state.versions.filter((item) => item.id !== version.id)]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function loadVersionIntoEditor(version) {
  state.currentVersion = version || null;
  state.editorTitle = version?.title || state.editorTitle || '未命名短剧';
  state.editorBody = version?.content || '';
  state.dirty = false;
  state.editorRevision += 1;
  state.selection = null;
  state.lastError = null;
  if (version) {
    state.work = { ...(state.work || {}), id: version.work_id, title: version.title, current_version_id: version.id };
    rememberWork(state.work);
  }
  persistDraft();
}

function saveCurrent(options = {}) {
  if (saveCurrentPromise) return saveCurrentPromise;
  saveCurrentPromise = saveCurrentOnce(options).finally(() => {
    saveCurrentPromise = null;
    state.savingVersion = false;
    updateHeader();
  });
  return saveCurrentPromise;
}

async function saveCurrentOnce({ quiet = false } = {}) {
  captureEditorValues();
  if (!state.editorBody.trim()) {
    if (!quiet) toast('请先输入或粘贴正文');
    return null;
  }
  state.dirty = editorHasChanges();
  if (state.currentVersion && !state.dirty) return state.currentVersion;
  const submitted = { workId: state.work?.id || null, title: state.editorTitle, content: state.editorBody,
    sourceVersionId: state.currentVersion?.id || null };
  state.savingVersion = true;
  updateHeader();
  setSync('', '正在保存');
  try {
    const payload = await api('/api/versions/save', {
      method: 'POST',
      body: JSON.stringify({
        work_id: submitted.workId,
        source_version_id: submitted.sourceVersionId,
        title: submitted.title,
        content: submitted.content
      })
    });
    if (submitted.workId && state.work?.id !== submitted.workId) return payload.version;
    captureEditorValues();
    const newerInput = state.editorTitle !== submitted.title || state.editorBody !== submitted.content;
    state.work = { ...(state.work || {}), id: payload.work_id, title: payload.version.title, current_version_id: payload.version.id };
    upsertVersion(payload.version);
    if (newerInput) {
      state.currentVersion = payload.version;
      state.lastError = null;
      state.dirty = editorHasChanges();
      state.selection = null;
      persistDraft();
    } else loadVersionIntoEditor(payload.version);
    rememberWork(state.work);
    if (state.candidate && state.candidate.id !== payload.version.id) state.candidateMeta.stale = true;
    if (!quiet) toast('版本已保存');
    renderView('editor');
    return payload.version;
  } catch (error) {
    if (submitted.workId && state.work?.id !== submitted.workId) return null;
    captureEditorValues();
    state.lastError = error;
    setSync('error', '保存失败');
    persistDraft();
    if (!quiet) toast(error.message);
    renderView('editor');
    return null;
  }
}

async function ensureSaved() {
  captureEditorValues();
  if (!state.editorBody.trim()) return null;
  if (!state.currentVersion || state.dirty) return saveCurrent({ quiet: true });
  return state.currentVersion;
}

async function bindSelection(operation) {
  const editor = $('#bodyEditor');
  if (!editor) return;
  const toolbar = $('#selectionToolbar');
  const start = Number(toolbar.dataset.start);
  const end = Number(toolbar.dataset.end);
  const selectedText = toolbar.dataset.selectedText || '';
  if (!selectedText.trim()) return;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start
    || editor.value.slice(start, end) !== selectedText) {
    toast('选区已经变化，请重新选择要修改的文字');
    toolbar.hidden = true;
    return;
  }
  state.editorTitle = $('#titleEditor').value.trim() || '未命名短剧';
  state.editorBody = editor.value;
  const saved = await ensureSaved();
  if (!saved) return;
  if (saved.content.slice(start, end) !== selectedText) {
    toast('保存后选区内容发生变化，请重新选择');
    return;
  }
  state.operation = operation;
  state.operationSelectedAt = new Date().toISOString();
  state.operationNotice = null;
  state.selection = { start, end, text: selectedText, sourceVersionId: saved.id };
  state.composerCollapsed = false;
  state.lastError = null;
  persistDraft();
  const persisted = await persistLocalAuthoringOperation();
  if (!persisted) state.operationNotice = '本次操作已选择，但未能写入本机恢复状态；重启后需要重新选择。';
  recordRoutingEvent('operation_selected', {
    client_operation: operation,
    source_version_id: saved.id,
    writer_provider_id: state.modelSelection?.provider_id || null,
    writer_model_id: state.modelSelection?.writer_model_id || null,
    merge_strategy: operationMergeStrategy(operation, true),
    result: 'selection_bound'
  });
  renderView('editor');
  requestAnimationFrame(() => $('#composerInput')?.focus());
}

function buildBrief(sourceVersion) {
  const targetScope = state.selection && ['EXPAND', 'REWRITE'].includes(state.operation)
    ? { type: 'selection', start: state.selection.start, end: state.selection.end, selected_text: state.selection.text }
    : { type: state.operation === 'CONTINUE' ? 'next_segment' : 'full' };
  return {
    operation: state.operation,
    source_version_id: sourceVersion?.id || null,
    target_scope: targetScope,
    user_instruction: state.form.instruction.trim(),
    ending_intent: state.operation === 'CONTINUE' ? {
      mode: state.form.endingMode,
      requirements: state.form.endingRequirements,
      exact_final_sentence: state.form.exactFinalSentence
    } : { mode: 'continue', requirements: '', exact_final_sentence: '' },
    hard_preserve: state.form.preserve,
    soft_preserve: [],
    freedom: '可补充必要人物、矛盾、动机、对白与前后衔接；作者未授权的范围保持原样。',
    output_preferences: {
      target_length: creativeTargetLength(),
      person: state.form.person,
      tone: state.form.tone.trim(),
      series_opening: state.form.seriesOpening
    }
  };
}

function setCandidateFromPayload(payload, meta = {}) {
  const previousCandidateId = state.candidate?.id || null;
  state.candidate = payload.candidate;
  if (previousCandidateId !== payload.candidate?.id) state.compareMode = 'changes';
  state.candidateTask = payload.task || state.candidateTask;
  state.candidateMeta = {
    stale: Boolean(meta.stale || payload.source_is_current === false),
    canApply: Boolean(payload.can_auto_apply),
    historical: Boolean(meta.historical)
  };
  upsertVersion(payload.candidate);
  if (Array.isArray(payload.validation_runs)) state.validationRuns = payload.validation_runs;
  else if (previousCandidateId !== payload.candidate?.id) state.validationRuns = [];
  if (payload.validation_run) state.latestValidationRun = payload.validation_run;
  else if (previousCandidateId !== payload.candidate?.id) state.latestValidationRun = null;
  if (payload.current_validation_run) state.currentValidationRun = payload.current_validation_run;
  else if (previousCandidateId !== payload.candidate?.id) state.currentValidationRun = null;
  state.adoptionReadiness = payload.adoption_readiness || null;
  state.revalidationReadiness = payload.revalidation_readiness || null;
  state.availableCandidateActions = payload.available_actions || [];
  state.candidateRecoveryGuidance = payload.recovery_guidance || null;
  state.candidateMemoryPreview = payload.memory_preview || null;
}

async function runValidation(taskId, { stale = false, confirmUnknownOutcome = false } = {}) {
  state.progressStage = 'validate';
  renderView('generating');
  try {
    const validated = await api(`/api/tasks/${encodeURIComponent(taskId)}/validate`, {
      method: 'POST', body: JSON.stringify({ confirm_unknown_outcome: confirmUnknownOutcome })
    });
    setCandidateFromPayload(validated, { stale });
    state.lastError = null;
    state.form.instruction = '';
    await consumePersistentDraft();
    persistDraft({ remote: false });
    renderView('candidate');
    toast(validated.task.validation_status === 'blocked' ? '候选已保存，内容检查存在阻断项' : '候选已完成检查');
    return validated;
  } catch (error) {
    const savedCandidate = error.payload?.candidate || state.candidate;
    if (savedCandidate) {
      state.candidate = savedCandidate;
      state.candidateTask = error.payload?.task || state.candidateTask;
      state.candidateMeta = { stale, canApply: false, historical: false };
      upsertVersion(savedCandidate);
      state.lastError = null;
      persistDraft();
      renderView('candidate');
      toast('候选已保存，内容检查暂未完成');
      return null;
    }
    state.lastError = error;
    renderView('editor');
    toast(error.message);
    return null;
  }
}

async function generate({ confirmFullReplacement = false } = {}) {
  if (state.busy) return;
  captureEditorValues();
  if (!isAuthoringOperation(state.operation)) {
    state.operationNotice = '当前作品没有可恢复的有效操作类型，请先明确选择整篇生成、扩写、改写或续写。';
    recordRoutingEvent('operation_rejected', {
      source_version_id: state.currentVersion?.id || null,
      result: 'client_rejected',
      reason_code: 'OPERATION_SELECTION_REQUIRED'
    });
    renderView(state.editorBody.trim() || state.currentVersion ? 'editor' : 'empty');
    toast('请先选择本次创作操作');
    return;
  }
  if (!state.form.instruction.trim()) {
    ($('#composerInput') || $('#ideaInput'))?.focus();
    toast('请先填写本次创作要求');
    return;
  }
  if (state.currentVersion && state.operation === 'CREATE' && !confirmFullReplacement) {
    openFullReplacementConfirmModal();
    return;
  }
  let sourceVersion = state.currentVersion;
  if (state.editorBody.trim() && (state.operation !== 'CREATE' || state.dirty)) {
    sourceVersion = await ensureSaved();
    if (!sourceVersion) return;
  }
  if (state.operation !== 'CREATE' && !sourceVersion) {
    toast('扩写、改写或续写前，请先建立并保存正文版本');
    renderView('editor');
    return;
  }
  if (state.selection && state.selection.sourceVersionId !== sourceVersion?.id) {
    state.selection = null;
    toast('正文版本已变化，请重新选择目标段落');
    renderView('editor');
    return;
  }
  if (state.selection && sourceVersion?.content.slice(state.selection.start, state.selection.end) !== state.selection.text) {
    state.selection = null;
    persistDraft();
    toast('选区与当前来源版本不一致，请重新选择；本次没有调用 Writer');
    renderView('editor');
    return;
  }

  state.busy = true;
  state.lastError = null;
  state.progressStage = 'write';
  const brief = buildBrief(sourceVersion);
  const modelSelection = normalizeModelSelection(state.modelSelection);
  const expectedContract = expectedTaskContract(brief, sourceVersion, modelSelection);
  const sourceHash = sourceVersion ? await hashDocument(sourceVersion.title, sourceVersion.content) : null;
  const requestSnapshot = {
    revision: state.editorRevision,
    sourceVersionId: sourceVersion?.id ?? null,
    operation: brief.operation,
    contract: expectedContract
  };
  let writtenPayload = null;
  recordRoutingEvent('operation_submitted', {
    client_operation: brief.operation,
    source_version_id: sourceVersion?.id || null,
    writer_provider_id: modelSelection?.provider_id || null,
    writer_model_id: modelSelection?.writer_model_id || null,
    merge_strategy: expectedContract.merge_strategy,
    result: confirmFullReplacement ? 'confirmed_full_replacement' : 'submitted'
  });
  renderView('generating');

  try {
    const created = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        work_id: state.work?.id || null,
        context: state.form.context,
        brief,
        source_hash: sourceHash,
        confirm_full_replacement: confirmFullReplacement,
        ...(modelSelection ? { model_selection: modelSelection } : {})
      })
    });
    state.work = { ...(state.work || {}), id: created.work_id, title: state.editorTitle };
    rememberWork(state.work);
    await persistLocalAuthoringOperation();
    state.candidateTask = created.task;
    state.candidate = null;
    state.candidateMeta = { stale: false, canApply: false, historical: false };
    const taskId = created.task.id;
    try {
      const serverContract = assertTaskContract(created.task, expectedContract);
      recordRoutingEvent('task_created', {
        task_id: taskId,
        client_operation: brief.operation,
        server_operation: serverContract.operation,
        source_version_id: serverContract.source_version_id,
        writer_provider_id: serverContract.writer_provider_id,
        writer_model_id: serverContract.writer_model_id,
        merge_strategy: serverContract.merge_strategy,
        result: 'contract_matched'
      });
    } catch (contractError) {
      recordRoutingEvent('task_rejected', {
        task_id: taskId,
        client_operation: brief.operation,
        server_operation: created.task?.contract?.operation || created.task?.operation || null,
        source_version_id: created.task?.source_version_id || null,
        writer_provider_id: created.task?.writer_provider_id || null,
        writer_model_id: created.task?.writer_model_id || null,
        merge_strategy: created.task?.merge_strategy || null,
        result: 'contract_mismatch',
        reason_code: contractError.code
      });
      try {
        const stopped = await api(`/api/tasks/${encodeURIComponent(taskId)}/stop`, {
          method: 'POST', body: JSON.stringify({ reason: 'client_contract_mismatch' })
        });
        state.candidateTask = stopped.task || created.task;
      } catch {}
      throw contractError;
    }

    if (created.next_stage === 'plan') {
      state.progressStage = 'plan';
      renderView('generating');
      await api(`/api/tasks/${encodeURIComponent(taskId)}/plan`, { method: 'POST', body: '{}' });
    }

    state.progressStage = 'write';
    renderView('generating');
    writtenPayload = await api(`/api/tasks/${encodeURIComponent(taskId)}/write`, { method: 'POST', body: '{}' });
    const stale = requestSnapshot.revision !== state.editorRevision
      || requestSnapshot.sourceVersionId !== (state.currentVersion?.id ?? null)
      || writtenPayload.source_is_current === false;
    setCandidateFromPayload(writtenPayload, { stale });
    // The instruction has been consumed once Writer persisted a candidate.
    // Validator failure must never leave it looking like an unsent draft.
    state.form.instruction = '';
    await consumePersistentDraft();
    persistDraft({ remote: false });
    await runValidation(taskId, { stale });
  } catch (error) {
    recordRoutingEvent('operation_failed', {
      task_id: state.candidateTask?.id || null,
      client_operation: requestSnapshot.operation,
      server_operation: state.candidateTask?.operation || null,
      source_version_id: requestSnapshot.sourceVersionId,
      writer_provider_id: modelSelection?.provider_id || null,
      writer_model_id: modelSelection?.writer_model_id || null,
      merge_strategy: expectedContract.merge_strategy,
      result: 'failed',
      reason_code: error.code || 'REQUEST_FAILED'
    });
    if (writtenPayload?.candidate) setCandidateFromPayload(writtenPayload, {
      stale: requestSnapshot.sourceVersionId !== (state.currentVersion?.id ?? null)
    });
    state.lastError = error;
    if (error.code === 'PROVIDER_NOT_CONFIGURED') setProvider({ configured: false, missing: error.details?.missing || ['OPENAI_API_KEY', 'OPENAI_MODEL'] });
    persistDraft();
    if (state.candidate) renderView('candidate');
    else renderView(state.editorBody.trim() ? 'editor' : 'empty');
    toast(error.message);
  } finally {
    state.busy = false;
    updateHeader();
    syncBusyControls();
  }
}

async function stopGeneration() {
  const taskId = state.candidateTask?.id;
  if (!taskId || state.stopping) return;
  state.stopping = true;
  renderView('generating');
  try {
    const payload = await api(`/api/tasks/${encodeURIComponent(taskId)}/stop`, {
      method: 'POST', body: JSON.stringify({ reason: 'user_requested' })
    });
    state.candidateTask = payload.task;
    if (payload.candidate) setCandidateFromPayload(payload, { stale: payload.source_is_current === false });
    state.busy = false;
    state.lastError = new Error(payload.remote_outcome_unknown
      ? '任务已停止。上次 AI 请求可能已发送并产生费用，但本地未收到最终结果；系统不会自动重发。'
      : '任务已停止，当前正文和已保存候选均已保留。');
    state.lastError.code = 'TASK_STOPPED';
    persistDraft();
    renderView(state.candidate ? 'candidate' : state.editorBody.trim() ? 'editor' : 'empty');
    toast(state.lastError.message);
  } catch (error) {
    if (error.code === 'STOP_RACE_LOST' || error.code === 'TASK_NOT_RUNNING') {
      toast(error.message);
      await bootstrap(state.work?.id || null);
    } else {
      state.lastError = error;
      toast(error.message);
    }
  } finally {
    state.stopping = false;
    updateHeader();
    syncBusyControls();
  }
}

async function retryValidation({ confirmed = false } = {}) {
  if (!state.candidateTask?.id) return toast('该候选缺少可追踪的原审核任务，不能安全重试');
  if (state.busy || state.latestValidationRun?.status === 'running') return toast('检查正在进行，请勿重复提交');
  if (!confirmed) return openValidatorRetryModal();
  state.busy = true;
  const stale = state.candidateMeta.stale || state.candidateTask.source_is_current === false;
  try {
    await runValidation(state.candidateTask.id, { stale, confirmUnknownOutcome: confirmed });
  } finally {
    state.busy = false;
    syncBusyControls();
  }
}

function openValidatorRetryModal() {
  if (!state.candidate || !state.candidateTask?.id) return toast('当前候选没有可安全重试的审核任务');
  if (state.busy || state.latestValidationRun?.status === 'running') return toast('检查正在进行，请等待完成');
  if (!['pending', 'unavailable'].includes(state.candidate.validation_status)) {
    return toast(state.candidate.validation_status === 'blocked'
      ? '此候选应使用“重新检查”，以保留旧检查历史并新增审核记录'
      : '当前候选不需要重试检查');
  }
  const layer = $('#modalLayer');
  layer.hidden = false;
  const unknown = state.candidateTask.outcome_unknown && state.candidateTask.unknown_stage === 'validate';
  layer.innerHTML = `
    <section class="modal revalidation-modal" role="dialog" aria-modal="true" aria-labelledby="validatorRetryTitle">
      <div class="modal-top"><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button><div class="modal-icon">!</div><h2 id="validatorRetryTitle">重新调用 Validator？</h2>
        <p>候选正文已经保存。本次只重新审核，不调用 Writer，也不会修改当前正式正文。</p></div>
      <div class="modal-form">
        <div class="revalidation-facts"><div><span>Validator</span><strong>${escapeHtml(state.candidateTask.validator_provider_id || '原服务')} · ${escapeHtml(state.candidateTask.validator_model_id || state.candidateTask.validator_model || '原模型')}</strong></div><div><span>当前原因</span><strong>${escapeHtml(providerFailureExplanation(state.candidateTask.error_code || state.candidateTask.last_error_code))}</strong></div></div>
        ${unknown ? '<div class="modal-note">上次远端结果无法确认，可能已经产生费用。系统不会自动重发。</div>' : ''}
        <label class="settings-check revalidation-consent"><input id="validatorRetryDisclosure" type="checkbox"><span>我确认本次只调用 Validator，可能产生 API 费用。</span></label>
      </div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-validator-retry-v13">确认并重新检查</button></footer>
    </section>`;
}

async function confirmValidatorRetry() {
  if ($('#validatorRetryDisclosure')?.checked !== true) return toast('请先确认可能产生的 Validator 费用');
  $('#modalLayer').hidden = true;
  await retryValidation({ confirmed: true });
}

function openCandidateRevalidationModal() {
  if (!state.candidate) return toast('当前没有可重新检查的候选');
  if (state.revalidationReadiness?.can_revalidate !== true) {
    return toast(state.revalidationReadiness?.reasons?.[0]?.message || '当前不能安全重新检查，请先查看具体门禁原因。');
  }
  const selected = normalizeModelSelection(state.modelSelection);
  const validatorOptions = availableValidatorModels().map((item) => `<option value="${escapeAttribute(`${item.providerId}|${item.modelId}`)}"
    ${selected?.validator_provider_id === item.providerId && selected?.validator_model_id === item.modelId ? 'selected' : ''}>
    ${escapeHtml(item.providerName)} · ${escapeHtml(item.displayName)}${item.configured ? '' : '（未配置 Key）'}</option>`).join('');
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal revalidation-modal" role="dialog" aria-modal="true" aria-labelledby="revalidationTitle">
      <div class="modal-top">
        <button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button>
        <div class="modal-icon" aria-hidden="true">!</div>
        <h2 id="revalidationTitle">重新检查这份候选？</h2>
        <p>只会重新调用 Validator。不会重新调用 Writer，不会修改候选正文、来源版本或旧检查历史。</p>
      </div>
      <div class="modal-form">
        <label class="settings-field"><span>本次 Validator</span><select id="revalidationValidatorSelection">${validatorOptions}</select><small>只审核现有候选，不重新生成或改写正文。</small></label>
        <div class="revalidation-facts"><div><span>候选与来源</span><strong>${escapeHtml(displayVersion(state.candidate))} · 基于 ${escapeHtml(displayVersion(state.versions.find((item) => item.id === state.candidate.parent_version_id)))}</strong></div><div><span>历史记录</span><strong>旧检查完整保留，本次结果新增记录</strong></div></div>
        <div class="revalidation-consent-group"><label class="settings-check revalidation-consent"><input id="revalidationDisclosure" type="checkbox" aria-describedby="revalidationDisclosureError"><span>我确认候选、来源正文与创作要求将发送给所选第三方 AI 服务商。</span></label><p id="revalidationDisclosureError" class="modal-inline-error" role="alert" hidden>请先确认第三方内容发送及可能产生的费用。</p></div>
        <div class="modal-note">本次重新检查可能产生 Validator API 费用。若请求超时或程序中断，远端结果可能无法确认；系统不会自动重发。</div>
      </div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><div class="right"><button class="primary-button" type="button" data-action="confirm-candidate-revalidation">确认费用并重新检查</button></div></footer>
    </section>`;
  layer.querySelector('#revalidationDisclosure')?.addEventListener('change', (event) => {
    if (event.target.checked) {
      event.target.removeAttribute('aria-invalid');
      layer.querySelector('#revalidationDisclosureError').hidden = true;
    }
  });
}

async function revalidateCandidate() {
  if (!state.candidate || state.busy || state.candidateMeta.stale) return;
  const selectionValue = $('#revalidationValidatorSelection')?.value || '';
  const [validatorProviderId, validatorModelId] = selectionValue.split('|');
  if ($('#revalidationDisclosure')?.checked !== true) {
    $('#revalidationDisclosureError').hidden = false;
    $('#revalidationDisclosure').setAttribute('aria-invalid', 'true');
    $('#revalidationDisclosure').focus();
    return;
  }
  if (!validatorProviderId || !validatorModelId) {
    $('#revalidationValidatorSelection')?.focus();
    return;
  }
  $('#modalLayer').hidden = true;
  state.busy = true;
  state.progressStage = 'validate';
  renderView('generating');
  try {
    const payload = await api(`/api/versions/${encodeURIComponent(state.candidate.id)}/revalidate`, {
      method: 'POST', body: JSON.stringify({
        work_id: state.candidate.work_id,
        candidate_content_hash: state.candidate.content_hash,
        confirm_validator_cost: true,
        confirm_third_party_disclosure: true,
        validator_selection: { provider_id: validatorProviderId, validator_model_id: validatorModelId }
      })
    });
    state.candidate = payload.candidate;
    state.validationRuns = payload.validation_runs || [];
    state.latestValidationRun = payload.validation_run || state.validationRuns[0] || null;
    state.currentValidationRun = payload.current_validation_run || payload.validation_run || null;
    state.adoptionReadiness = payload.adoption_readiness || null;
    state.revalidationReadiness = payload.revalidation_readiness || null;
    state.availableCandidateActions = payload.available_actions || [];
    state.candidateRecoveryGuidance = payload.recovery_guidance || null;
    state.candidateMemoryPreview = payload.memory_preview || null;
    state.candidateMeta = {
      stale: payload.source_is_current === false,
      canApply: Boolean(payload.can_auto_apply),
      historical: false
    };
    upsertVersion(payload.candidate);
    persistDraft();
    renderView('candidate');
    toast(payload.candidate.validation_status === 'passed'
      ? '重新检查已完成；请阅读全文后决定是否采用'
      : '重新检查仍发现阻断项，候选和旧记录均已保留');
  } catch (error) {
    if (error.payload?.candidate) {
      state.candidate = error.payload.candidate;
      upsertVersion(error.payload.candidate);
    }
    state.validationRuns = error.payload?.validation_runs || state.validationRuns;
    state.latestValidationRun = error.payload?.validation_run || state.latestValidationRun;
    if (error.payload?.validation_run?.id === state.candidate?.current_validation_run_id) {
      state.currentValidationRun = error.payload.validation_run;
    }
    state.candidateMeta.canApply = false;
    try {
      const refreshed = await api(`/api/versions/${encodeURIComponent(state.candidate.id)}/validations?work_id=${encodeURIComponent(state.candidate.work_id)}`);
      state.adoptionReadiness = refreshed.adoption_readiness || null;
      state.revalidationReadiness = refreshed.revalidation_readiness || null;
      state.availableCandidateActions = refreshed.available_actions || [];
      state.candidateRecoveryGuidance = refreshed.recovery_guidance || null;
      state.candidateMemoryPreview = refreshed.memory_preview || null;
    } catch { /* Keep the candidate readable even if a local status refresh fails. */ }
    state.lastError = null;
    persistDraft();
    renderView('candidate');
    toast(error.message);
  } finally {
    state.busy = false;
    syncBusyControls();
  }
}

async function adoptCandidate() {
  const status = candidateStatus();
  if (!state.candidate || !status.canAdopt || state.busy) return;
  state.busy = true;
  setSync('', '正在采用');
  try {
    const payload = await api('/api/versions/adopt', {
      method: 'POST',
      body: JSON.stringify({ work_id: state.candidate.work_id, version_id: state.candidate.id })
    });
    state.work = { ...(state.work || {}), id: payload.work_id, title: payload.version.title, current_version_id: payload.version.id };
    upsertVersion(payload.version);
    loadVersionIntoEditor(payload.version);
    state.operationNotice = isAuthoringOperation(state.operation)
      ? `新版本已经采用；本次“${operationLabels[state.operation]}”选择保持不变，后续任务将以新版本为来源。`
      : '新版本已经采用。开始下一次创作前，请明确选择扩写、改写、续写或整篇生成。';
    state.candidate = payload.version;
    state.candidateMeta = { stale: false, canApply: false, historical: false };
    rememberWork(state.work);
    persistDraft();
    renderView('candidate');
    toast('服务端已确认采用，新版本成为当前正文');
  } catch (error) {
    if (error.code === 'SOURCE_VERSION_CONFLICT') {
      state.candidateMeta.stale = true;
      state.lastError = null;
      renderView('candidate');
      openConflictModal();
    } else {
      state.lastError = error;
      renderView('candidate');
    }
    toast(error.message);
  } finally {
    state.busy = false;
    syncBusyControls();
  }
}

async function candidateForVersion(version, { historical = true } = {}) {
  state.candidate = version;
  const latestTask = version.id === state.candidateTask?.result_version_id ? state.candidateTask : null;
  state.candidateTask = latestTask;
  state.validationRuns = [];
  state.latestValidationRun = null;
  state.currentValidationRun = null;
  state.adoptionReadiness = null;
  state.revalidationReadiness = null;
  state.availableCandidateActions = [];
  state.candidateRecoveryGuidance = null;
  state.candidateMemoryPreview = null;
  if (version.status === 'candidate') {
    try {
      const payload = await api(`/api/versions/${encodeURIComponent(version.id)}/validations?work_id=${encodeURIComponent(version.work_id)}`);
      if (payload.candidate) {
        version = payload.candidate;
        state.candidate = version;
        upsertVersion(version);
      }
      state.validationRuns = payload.validation_runs || [];
      state.latestValidationRun = state.validationRuns[0] || null;
      state.currentValidationRun = payload.current_validation_run
        || state.validationRuns.find((run) => run.id === version.current_validation_run_id) || null;
      state.adoptionReadiness = payload.adoption_readiness || null;
      state.revalidationReadiness = payload.revalidation_readiness || null;
      state.availableCandidateActions = payload.available_actions || [];
      state.candidateRecoveryGuidance = payload.recovery_guidance || null;
      state.candidateMemoryPreview = payload.memory_preview || null;
    } catch {
      state.candidateRecoveryGuidance = '暂时无法读取候选的服务端安全状态；请检查本地服务并刷新。正文仍可只读查看或导出。';
    }
  }
  state.candidateMeta = {
    stale: Boolean(latestTask?.source_is_current === false
      || (version.status === 'candidate' && (version.parent_version_id || null) !== (state.currentVersion?.id || null))),
    canApply: Boolean(version.can_auto_apply && version.validation_status === 'passed'
      && latestTask?.source_is_current !== false && state.adoptionReadiness?.can_adopt !== false),
    historical: historical && version.status !== 'candidate'
  };
  renderView('candidate');
}

function openOverlay(content, { nested = false } = {}) {
  $('#scrim').hidden = false;
  const sheet = $('#sideSheet');
  if (nested && !sheet.hidden) {
    const buttons = [...sheet.querySelectorAll('button')];
    state.overlayStack.push({ html: sheet.innerHTML, scrollTop: sheet.scrollTop,
      focusIndex: buttons.indexOf(document.activeElement), label: sheet.getAttribute('aria-label') });
  } else if (!nested) state.overlayStack = [];
  sheet.innerHTML = content;
  sheet.scrollTop = 0;
  sheet.hidden = false;
}

function closeOverlay({ all = false } = {}) {
  if (!all && state.overlayStack.length) {
    const previous = state.overlayStack.pop();
    const sheet = $('#sideSheet');
    sheet.innerHTML = previous.html;
    sheet.setAttribute('aria-label', previous.label || '辅助面板');
    sheet.hidden = false;
    requestAnimationFrame(() => {
      sheet.scrollTop = previous.scrollTop;
      const buttons = [...sheet.querySelectorAll('button')];
      (buttons[previous.focusIndex] || sheet.querySelector('.close-button'))?.focus();
    });
    return;
  }
  state.overlayStack = [];
  $('#scrim').hidden = true;
  $('#sideSheet').hidden = true;
  $('#modalLayer').hidden = true;
}

function openRelationshipPerson(personId) {
  const tree = state.overview?.relationship_tree;
  const item = Object.values(tree?.groups || {}).flat().find((person) => person.id === personId);
  if (!item || state.view !== 'overview') return;
  const primary = item.primary_relationship;
  const secondary = item.secondary_relationships || [];
  const evidence = primary?.evidence || item.evidence?.[0];
  const trusted = Boolean(primary && primary.certainty === 'confirmed'
    && item.certainty === 'confirmed' && item.truth_status === 'objective');
  openOverlay(`<header class="sheet-header"><div><small>正式剧情 · 人物详情</small><h2>${escapeHtml(item.name || '未命名人物')}</h2><p>只读查看；不会改变当前正文或创作模式</p></div><button class="close-button" type="button" data-action="close-overlay" aria-label="关闭人物详情">×</button></header>
    <div class="sheet-body relationship-sheet-body"><dl class="relationship-facts">
      <div><dt>人物身份</dt><dd>${escapeHtml(item.identity || '身份待确认')}</dd></div>
      <div><dt>主要关系</dt><dd>${escapeHtml(primary?.label || '关系待确认')}</dd></div>
      ${secondary.length ? `<div><dt>次要关系</dt><dd>${escapeHtml(secondary.map((edge) => edge.label).join('、'))}</dd></div>` : ''}
      <div><dt>可信状态</dt><dd><span class="relationship-trust ${trusted ? 'confirmed' : 'pending'}">${trusted ? '正文证据已核对' : '关系待确认'}</span></dd></div>
      <div><dt>来源版本</dt><dd>${escapeHtml(versionLabelById(primary?.source_version_id || tree.source_version_id))}</dd></div>
    </dl><section class="relationship-evidence"><h3>正文证据</h3><p>${evidence?.quote ? `“${escapeHtml(compactText(evidence.quote, 240))}”` : '暂无可确认关系的正文证据。'}</p>${!primary && evidence?.quote ? '<small>仅证明人物出现，不证明具体关系。</small>' : ''}${evidence ? memoryEvidenceButton({ evidence: [evidence] }) : ''}</section>
    <p class="relationship-sheet-note">人物身份来自当前正式 Story Memory；关系分类以已采用正文中的明确证据为准。未确认关系不会补写为事实。</p></div>`);
  $('#sideSheet').setAttribute('aria-label', `${item.name || '人物'}关系详情`);
  $('#sideSheet .close-button')?.focus();
}

function openEvidenceReadOnly(versionId, start, end) {
  const version = state.versions.find((item) => item.id === versionId);
  if (!version || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > String(version.content || '').length) {
    return toast('该证据无法在已加载版本中安全定位');
  }
  const content = version.content;
  const before = content.slice(Math.max(0, start - 100), start);
  const quote = content.slice(start, end);
  const after = content.slice(end, Math.min(content.length, end + 100));
  openOverlay(`<header class="sheet-header"><div><small>只读证据</small><h2>${escapeHtml(displayVersion(version))} · 正文定位</h2><p>当前创作操作和选区不变</p></div><button class="close-button sheet-back-button" type="button" data-action="close-overlay" aria-label="返回上一级">返回</button></header>
    <div class="sheet-body relationship-sheet-body"><p class="relationship-evidence-context">${escapeHtml(before)}<mark>${escapeHtml(quote)}</mark>${escapeHtml(after)}</p><p class="relationship-sheet-note">这是已保存版本中的原文片段，仅供核对；没有进入改写或修改当前正文。</p></div>`, { nested: true });
  $('#sideSheet').setAttribute('aria-label', '正文证据只读视图');
  $('#sideSheet .close-button')?.focus();
}

function validationStatusLabel(status) {
  return ({ passed: '检查通过', blocked: '检查阻断', unavailable: '检查不可用',
    outcome_unknown: '远端结果未知', running: '检查进行中', pending: '等待检查' })[status] || status || '未记录';
}

function checkItemsHtml(checks, emptyText = '当前没有可显示的检查记录。') {
  return checks?.length ? checks.map((check, index) => {
    const language = check.finding_type === 'language_quality' || String(check.check || '').startsWith('LANGUAGE_');
    const quote = check.evidence_locations?.[0]?.quote || check.evidence?.[0] || '';
    return `<div class="check-item ${escapeAttribute(check.status || 'unassessed')}"><span class="check-icon ${check.status === 'pass' ? 'pass' : check.status === 'warning' ? 'warning' : 'block'}">${check.status === 'pass' ? '✓' : '!'}</span><div><strong>${escapeHtml(check.check || check.finding_type || '检查项')}</strong><p>${escapeHtml(check.message || '未提供说明')}</p>${Array.isArray(check.evidence) && check.evidence.length ? `<span class="evidence">证据：${escapeHtml(check.evidence.join(' / '))}</span>` : ''}${language ? `<div class="finding-actions"><button class="text-button" type="button" data-language-locate="${escapeAttribute(quote)}">定位证据</button><button class="text-button" type="button" data-language-keep="${index}">保留此表达</button>${state.currentVersion?.content?.includes(quote) ? `<button class="text-button" type="button" data-language-rewrite="${escapeAttribute(quote)}">选择局部修改</button>` : ''}</div><small>语言提醒只供人工复核，不会自动改写或阻断采用。</small>` : ''}</div></div>`;
  }).join('') : `<p class="muted">${escapeHtml(emptyText)}</p>`;
}

function candidateMemoryPreviewHtml(preview) {
  if (!preview || preview.status !== 'proposed') {
    return `<section class="check-group"><div class="check-group-title"><span>候选剧情记忆预览</span></div><p class="muted">${escapeHtml(preview?.reason || '暂无可信的候选记忆提案。')}</p></section>`;
  }
  const groups = [
    ['人物与关系', preview.memory?.characters || [], (item) => `${item.name}${item.identity ? ` · ${item.identity}` : ''}${item.relationships?.length ? ` · ${item.relationships.join('、')}` : ''}`],
    ['重要事件与时间线', preview.memory?.events || [], (item) => `${item.event}${item.time_context ? ` · ${item.time_context}` : ''}`],
    ['关键事实变化', preview.memory?.persistent_facts || [], (item) => item.fact],
    ['未解决冲突', preview.memory?.open_threads || [], (item) => item.thread]
  ];
  return `<section class="check-group candidate-memory-preview"><div class="check-group-title"><span>候选剧情记忆预览</span><span>仅为提案，尚非正式记忆</span></div>
    <p class="check-caveat">仅在手动采用且通过安全门禁后，可信提案才可能进入正式故事记忆；证据不足的条目仍待确认。</p>
    ${groups.map(([label, items, describe], index) => `<details data-memory-group="${index}" data-memory-candidate="${escapeAttribute(state.candidate?.id || '')}" ${state.memoryDisclosureState[state.candidate?.id]?.[index] ? 'open' : ''}><summary>${escapeHtml(label)} · ${items.length}</summary>
      ${items.length ? `<ul class="overview-list">${items.map((item) => `<li><div><strong>${escapeHtml(describe(item))}</strong><small>${item.certainty === 'confirmed' ? '正文证据已核对' : '待确认'}${item.time_context ? ` · ${escapeHtml(item.time_context)}` : ''}</small>${item.evidence?.[0]?.quote ? `<small>证据：“${escapeHtml(item.evidence[0].quote)}”</small>` : ''}</div>${memoryEvidenceButton(item)}</li>`).join('')}</ul>` : '<p class="muted">暂无可核验条目。</p>'}</details>`).join('')}
  </section>`;
}

function candidateMemorySummaryHtml(preview) {
  if (!preview || preview.status !== 'proposed') return `<section class="check-group"><div class="check-group-title"><span>候选剧情记忆</span></div><p class="muted">${escapeHtml(preview?.reason || '暂无可核验的候选记忆提案。')}</p></section>`;
  const memory = preview.memory || {};
  const uncertainRelations = (memory.characters || []).filter((item) => item.certainty !== 'confirmed').length;
  return `<section class="check-group candidate-memory-summary"><div class="check-group-title"><span>候选剧情记忆</span><span>仅供审核，不属于正式剧情</span></div>
    <p>人物 ${memory.characters?.length || 0} · 事件 ${memory.events?.length || 0} · 事实 ${memory.persistent_facts?.length || 0} · 待确认人物 ${uncertainRelations}</p>
    <button class="text-button" type="button" data-action="open-candidate-memory">查看完整提案与正文证据</button></section>`;
}

function openCandidateMemory() {
  openOverlay(`<header class="sheet-header"><div><small>候选剧情 · 未采用</small><h2>剧情记忆提案</h2><p>这不是正式 Story Memory；请核对证据后决定是否采用候选。</p></div><button class="close-button sheet-back-button" type="button" data-action="close-overlay" aria-label="返回内容检查">返回检查</button></header>
    <div class="sheet-body">${candidateMemoryPreviewHtml(state.candidateMemoryPreview)}</div>`, { nested: true });
  $('#sideSheet').setAttribute('aria-label', '候选剧情记忆预览');
  $('#sideSheet .close-button')?.focus();
}

function openChecks() {
  const version = state.candidate || state.currentVersion;
  const validationRuns = version?.id === state.candidate?.id ? state.validationRuns : [];
  const currentRun = state.currentValidationRun
    || validationRuns.find((run) => run.id === version?.current_validation_run_id) || null;
  const checks = currentRun?.checks?.length ? currentRun.checks : (version?.checks || []);
  const status = version?.id === state.candidate?.id ? candidateStatus() : null;
  const totals = {
    pass: checks.filter((item) => item.status === 'pass').length,
    warning: checks.filter((item) => ['warning', 'unassessed'].includes(item.status)).length,
    block: checks.filter((item) => ['fail', 'unavailable'].includes(item.status)).length
  };
  const currentProvider = currentRun?.provider_id || version?.validator_provider_id || '未记录服务商';
  const currentModel = currentRun?.model_name || version?.validator_model_id || '未记录模型';
  const currentTime = currentRun?.completed_at || version?.validated_at || null;
  const currentValidatorVersion = currentRun?.validator_version || version?.validator_version || '未记录';
  const compatibilityReconstructed = Boolean(version?.validation_compatibility_reconstructed
    || currentRun?.compatibility_reconstructed || state.adoptionReadiness?.compatibility_reconstructed);
  const legacyCompatible = version?.validation_legacy_compatible === true
    || state.adoptionReadiness?.legacy_validator_compatible === true;
  openOverlay(`
    <header class="sheet-header"><div><h2>内容检查</h2><p>${version ? `${escapeHtml(version.title)} · 当前有效结果与历史记录分开展示` : '尚无候选'}</p></div><button class="close-button" type="button" data-action="close-overlay" aria-label="关闭">×</button></header>
    <div class="sheet-body">
      ${version ? `
        <section class="current-validation-card ${escapeAttribute(version.validation_status || 'pending')}">
          <div class="check-group-title"><span>当前有效检查</span><span>${legacyCompatible ? '历史审核通过' : escapeHtml(validationStatusLabel(version.validation_status))}</span></div>
          <div class="current-validation-meta"><span>Provider<strong>${escapeHtml(currentProvider)}</strong></span><span>模型<strong>${escapeHtml(currentModel)}</strong></span><span>检查时间<strong>${currentTime ? escapeHtml(new Date(currentTime).toLocaleString('zh-CN')) : '未完成'}</strong></span><span>Validator 版本<strong>${escapeHtml(currentValidatorVersion)}</strong></span></div>
          ${legacyCompatible ? '<div class="compatibility-notice"><strong>历史审核通过，不是 V1.4 新版审核</strong><span>原审核的事实与作者约束阻断规则仍有效；V1.4 新增的建议性语言提醒未补做。本次采用不会调用 AI，旧审核记录和版本号保持原样。</span></div>' : ''}
          ${compatibilityReconstructed ? '<div class="compatibility-notice"><strong>已从既有检查记录重建当前视图</strong><span>系统重新核对了候选、来源版本、内容 Hash、原任务契约和当前校验规则；本次查看没有调用 AI，也没有删除旧 findings。</span></div>' : ''}
          <div class="adoption-gate ${status?.canAdopt ? 'ready' : 'locked'}"><strong>${status?.canAdopt ? '满足当前采用条件' : '当前不能采用'}</strong><span>${escapeHtml(status?.reason || '这是已采用正文或历史版本。')}</span></div>
          ${version.status === 'candidate' ? `<div class="check-caveat"><strong>下一步：</strong>${escapeHtml(state.candidateRecoveryGuidance || '请核对下方检查与来源版本。')}<br><strong>重新检查：</strong>${state.revalidationReadiness?.can_revalidate ? '可在确认费用与第三方发送范围后手动发起。' : escapeHtml(state.revalidationReadiness?.reasons?.[0]?.message || '当前不可安全发起。')}</div>` : ''}
        </section>
        <div class="check-summary"><div class="check-metric"><b>${totals.pass}</b><span>通过</span></div><div class="check-metric"><b>${totals.warning}</b><span>提醒 / 待人工</span></div><div class="check-metric"><b>${totals.block}</b><span>当前阻断 / 不可用</span></div></div>
        <section class="check-group"><div class="check-group-title"><span>当前 findings</span><span>${checks.length} 项</span></div>${checkItemsHtml(checks)}</section>
        ${version.status === 'candidate' ? candidateMemorySummaryHtml(state.candidateMemoryPreview) : ''}
        ${validationRuns.length ? `<section class="check-group validation-history"><div class="check-group-title"><span>历史检查</span><span>${validationRuns.length} 次 · 旧结果不参与当前门禁</span></div>
          ${validationRuns.map((run) => {
            const current = run.id === version.current_validation_run_id;
            const runChecks = run.checks || [];
            const currentLabel = current
              ? legacyCompatible ? ' · 历史审核（当前采用依据）'
                : compatibilityReconstructed ? ' · 当前视图来源（原始审计记录）' : ' · 当前有效'
              : '';
            return `<details class="validation-history-item ${escapeAttribute(run.status)}" ${current ? 'open' : ''}><summary><span class="check-icon ${run.status === 'passed' ? 'pass' : run.status === 'blocked' ? 'block' : 'warning'}">${run.status === 'passed' ? '✓' : '!'}</span><span><strong>${run.trigger === 'legacy_snapshot' ? '原检查记录' : '用户主动重新检查'} · ${escapeHtml(validationStatusLabel(run.status))}${currentLabel}</strong><small>${escapeHtml(run.provider_id || 'Provider 未记录')} · ${escapeHtml(run.model_name || '模型未记录')} · ${escapeHtml(run.validator_version || '校验版本未记录')}<br>${new Date(run.completed_at || run.created_at).toLocaleString('zh-CN')}</small></span></summary><div class="validation-history-details">${run.outcome_unknown ? '<p class="history-warning">远端结果无法确认；系统未自动重试。</p>' : ''}${compatibilityReconstructed && current ? '<p class="history-warning">此处保留当时保存的原始 findings 供审计；上方“当前 findings”才是重新核对绑定后参与采用门禁的视图。</p>' : ''}${checkItemsHtml(runChecks, '该历史记录没有可展示的 findings。')}</div></details>`;
          }).join('')}
        </section>` : ''}
        <div class="check-caveat">历史 blocked、unavailable 或 outcome_unknown 会保留用于审计，但只有与候选 Hash、来源版本和 Validator provenance 正确绑定的当前有效检查参与采用门禁。检查通过不等于内容质量优秀。</div>
      ` : '<div class="sheet-empty">生成候选后，这里会显示真实的检查结果。</div>'}
    </div>`);
}

function openHistory() {
  const rows = state.versions.map((version) => {
    const current = version.id === state.currentVersion?.id;
    const parent = version.parent_version_id
      ? state.versions.find((item) => item.id === version.parent_version_id) : null;
    const source = parent ? displayVersion(parent) : '新作品';
    const model = version.model_name || version.writer_model_id || '模型未记录';
    return `<button class="version-row ${current ? 'current' : ''}" type="button" data-version-id="${escapeAttribute(version.id)}"><span class="version-node">${escapeHtml(nowVersionNumber(version))}</span><span><strong>${escapeHtml(version.title)}</strong><p>${escapeHtml(operationLabels[version.operation] || version.operation)} · 来源 ${escapeHtml(source)} · ${escapeHtml(model)}</p><small>${escapeHtml(new Date(version.created_at).toLocaleString('zh-CN'))}</small></span><em>${current ? '当前 · 只读查看' : version.status === 'candidate' ? '候选审核' : '历史 · 只读查看'}</em></button>`;
  }).join('');
  const workSource = state.localRuntime ? state.localWorks : recentWorks();
  const works = workSource.filter((item) => item.id !== state.work?.id).map((work) =>
    `<button class="version-row" type="button" data-work-id="${escapeAttribute(work.id)}"><span class="version-node">剧</span><span><strong>${escapeHtml(work.title)}</strong><p>${state.localRuntime ? '保存在本机 SQLite' : '保存在此浏览器的作品入口'}</p></span><em>打开</em></button>`).join('');
  openOverlay(`
    <header class="sheet-header"><div><h2>版本与作品</h2><p>${state.localRuntime ? '作品和历史版本保存在本机 SQLite' : '当前作品的版本由服务端保存；作品入口保存在本机'}</p></div><button class="close-button" type="button" data-action="close-overlay" aria-label="关闭">×</button></header>
    <div class="sheet-body">
      <div class="history-view-notice"><strong>默认只读查看</strong><span>打开历史不会进入整篇改写，也不会改变当前创作操作。候选进入审核；已采用版本进入只读阅读。</span></div>
      <div class="version-timeline">${rows || '<p class="muted">当前作品还没有版本。</p>'}</div>
      ${works ? `<section class="check-group"><div class="check-group-title"><span>最近作品</span><span>本机</span></div><div class="version-timeline">${works}</div></section>` : ''}
      <div class="check-caveat">候选不会因打开历史记录而变成当前正文；采用仍需通过内容检查、Hash 与服务端 CAS。若要从历史版本继续创作，必须明确恢复为新版本，并在提交前再次确认操作和修改范围。</div>
    </div>`);
}

function openSettings() {
  const local = state.localRuntime;
  const provider = local?.provider || {};
  const providerChoices = provider.providers || [];
  const presets = provider.presets || [];
  const roleOptions = providerChoices.map((item) => `<option value="${escapeAttribute(item.provider_id)}">${escapeHtml(item.provider_name)}${item.configured ? '' : '（未配置 Key）'}</option>`).join('');
  const backupOptions = (local?.backups || []).map((backup) => `<option value="${escapeAttribute(backup.id)}">${escapeHtml(new Date(backup.created_at).toLocaleString('zh-CN'))} · ${(Number(backup.bytes || 0) / 1024).toFixed(1)} KB</option>`).join('');
  const settingsView = state.providerSettingsView || { mode: 'list', providerId: null };
  const selectedProvider = settingsView.mode === 'edit'
    ? providerChoices.find((item) => item.provider_id === settingsView.providerId)
    : null;
  const defaultPreset = presets[0] || {};
  const editorProvider = settingsView.mode === 'add' ? {
    provider_id: '', preset_id: defaultPreset.provider_id, provider_name: defaultPreset.provider_name,
    endpoint: defaultPreset.endpoint, writer_model_id: defaultPreset.default_writer_model,
    validator_model_id: defaultPreset.default_validator_model || defaultPreset.default_writer_model,
    timeout_ms: 180000, configured: false, disclosure_confirmed: false,
    request_capabilities: defaultPreset.default_request_capabilities || { temperature: true, response_format_json_object: true }
  } : selectedProvider;
  const providerCards = providerChoices.map((item) => `
    <article class="provider-card">
      <div><strong>${escapeHtml(item.provider_name)}</strong><span class="local-status ${item.configured ? 'ready' : 'missing'}">${item.configured ? 'Key 已配置' : '未配置 Key'}</span><p>${escapeHtml(item.endpoint || '未设置地址')}</p><small>Writer ${escapeHtml(item.writer_model_id || '未设置')} · Validator ${escapeHtml(item.validator_model_id || '未设置')}</small></div>
      <div class="provider-card-actions"><button class="secondary-button" type="button" data-action="edit-provider" data-provider-id="${escapeAttribute(item.provider_id)}">编辑</button><button class="text-button danger-text" type="button" data-action="request-delete-provider" data-provider-id="${escapeAttribute(item.provider_id)}">删除</button></div>
    </article>`).join('');
  const providerEditor = editorProvider ? `
    <section class="provider-editor" data-provider-id="${escapeAttribute(editorProvider.provider_id || '')}" data-preset-id="${escapeAttribute(editorProvider.preset_id || 'custom')}">
      <div class="check-group-title"><span>${settingsView.mode === 'add' ? '添加 AI 服务' : `编辑 ${escapeHtml(editorProvider.provider_name)}`}</span><button class="text-button" type="button" data-action="cancel-provider-editor">返回服务列表</button></div>
      ${settingsView.mode === 'add' ? `<div class="settings-field"><label for="providerPresetSetting">平台预设</label><select id="providerPresetSetting">${presets.map((item) => `<option value="${escapeAttribute(item.provider_id)}" ${item.provider_id === editorProvider.preset_id ? 'selected' : ''}>${escapeHtml(item.provider_name)}</option>`).join('')}</select><small>预设只用于新建服务；编辑已有服务不会切换平台身份。</small></div>` : `<div class="settings-field"><label>平台类型</label><p class="settings-readonly">${escapeHtml(presets.find((item) => item.provider_id === editorProvider.preset_id)?.provider_name || editorProvider.preset_id || '自定义兼容接口')}</p></div>`}
      <div class="settings-field"><label for="providerNameSetting">服务名称</label><input id="providerNameSetting" value="${escapeAttribute(editorProvider.provider_name || '')}" maxlength="80"></div>
      <div class="settings-field"><label for="providerEndpointSetting">API 请求地址</label><input id="providerEndpointSetting" value="${escapeAttribute(editorProvider.endpoint || '')}" spellcheck="false"><small>远端默认必须 HTTPS；请求禁止跟随重定向，避免 Key 被转发到其他主机。</small></div>
      <div class="provider-model-fields"><div class="settings-field"><label for="writerModelSetting">Writer 模型 ID</label><input id="writerModelSetting" value="${escapeAttribute(editorProvider.writer_model_id || '')}" spellcheck="false"></div><div class="settings-field"><label for="validatorModelSetting">Validator 模型 ID</label><input id="validatorModelSetting" value="${escapeAttribute(editorProvider.validator_model_id || '')}" spellcheck="false"></div></div>
      <div class="settings-field"><label for="providerKeySetting">API Key</label><input id="providerKeySetting" type="password" value="" placeholder="${editorProvider.configured ? '已配置；留空表示不更改' : '仅发送到本机服务安全保存'}" autocomplete="new-password" spellcheck="false"><small>每个平台独立使用 Windows DPAPI 加密；不会写入作品数据库、日志或导出文件。</small></div>
      <details class="settings-advanced"><summary>高级兼容设置</summary><label class="settings-check"><input id="providerJsonFormatSetting" type="checkbox" ${editorProvider.request_capabilities?.response_format_json_object ? 'checked' : ''}><span>该模型支持 response_format=json_object</span></label><label class="settings-check"><input id="providerTemperatureSetting" type="checkbox" ${editorProvider.request_capabilities?.temperature !== false ? 'checked' : ''}><span>该模型支持 temperature</span></label><div class="settings-field"><label for="providerTimeoutSetting">单次超时（毫秒）</label><input id="providerTimeoutSetting" type="number" min="5000" max="300000" value="${escapeAttribute(editorProvider.timeout_ms || 180000)}"></div><label class="settings-check"><input id="providerLocalHttpSetting" type="checkbox" ${editorProvider.allow_insecure_local_http ? 'checked' : ''}><span>允许仅限 127.0.0.1 / localhost 的 HTTP（了解本机明文传输风险）</span></label></details>
      <label class="settings-check provider-disclosure" ${editorProvider.disclosure_confirmed ? 'hidden' : ''}><input id="providerDisclosureSetting" type="checkbox" ${editorProvider.disclosure_confirmed ? 'checked' : ''}><span>我知道作品内容与创作要求会发送给所选第三方 AI 服务商。</span></label>
      <div class="settings-actions"><button class="primary-button" type="button" data-action="save-provider-settings">${settingsView.mode === 'add' ? '添加并安全保存' : '保存修改'}</button>${settingsView.mode === 'edit' ? '<button class="secondary-button" type="button" data-action="test-provider">测试连接（可能计费）</button><button class="text-button danger-text" type="button" data-action="clear-provider-key">清除 Key</button>' : ''}</div>
      <p class="inline-result" id="providerTestResult" role="status">${settingsView.mode === 'add' ? '请先安全保存；新服务保存后才可测试连接。' : '连接测试只验证当前接口与模型可访问，不等于完整创作能力通过。'}</p>
    </section>` : '';
  openOverlay(`
    <header class="sheet-header"><div><h2>${local ? '模型、数据与创作设置' : '创作设置'}</h2><p>${local ? 'API Key 由 Windows 当前用户加密保管，不进入作品数据库' : '背景与约束只在提交任务时发送'}</p></div><button class="close-button" type="button" data-action="close-overlay" aria-label="关闭">×</button></header>
    <div class="sheet-body settings-grid">
      ${local ? `
        <section class="local-settings-section" aria-labelledby="providerSettingsTitle">
          <div class="check-group-title"><span id="providerSettingsTitle">我的 AI 服务</span><button class="secondary-button" type="button" data-action="start-add-provider">添加 AI 服务</button></div>
          <div class="provider-card-list">${providerCards || '<p class="muted">还没有添加 AI 服务。</p>'}</div>
          ${providerEditor}
          <div class="check-caveat">当前只支持 OpenAI-compatible Chat Completions；原生 Anthropic / Gemini 协议未接入。平台预设只在添加新服务时出现。</div>
          <div class="settings-field"><label for="defaultWriterProviderSetting">默认 Writer 服务</label><select id="defaultWriterProviderSetting">${roleOptions}</select></div>
          <div class="settings-field"><label for="defaultValidatorProviderSetting">默认 Validator 服务</label><select id="defaultValidatorProviderSetting">${roleOptions}</select><small>Validator 可与 Writer 来自不同平台；切换审核服务不会重写候选正文。</small></div>
          <div class="settings-actions"><button class="secondary-button" type="button" data-action="save-provider-roles">保存默认角色</button></div>
        </section>
        <section class="local-settings-section" aria-labelledby="localDataTitle">
          <div class="check-group-title"><span id="localDataTitle">本地数据</span><span>SQLite</span></div>
          <p class="local-path"><strong>数据库</strong><span>${escapeHtml(local.storage?.database || '')}</span></p>
          <div class="settings-actions"><button class="secondary-button" type="button" data-action="create-backup">立即备份</button><button class="text-button" type="button" data-action="import-document">导入 Markdown / 文本</button><button class="text-button" type="button" data-action="export-current" ${state.currentVersion ? '' : 'disabled title="当前没有可导出的版本"'}>导出当前版本</button><input id="importDocumentInput" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden></div>
          <div class="settings-field"><label for="backupSetting">恢复点</label><select id="backupSetting" ${backupOptions ? '' : 'disabled'}>${backupOptions || '<option value="">尚无备份</option>'}</select></div>
          <div class="settings-actions"><button class="secondary-button" type="button" data-action="request-restore" ${backupOptions ? '' : 'disabled title="请先创建备份"'}>从所选备份恢复</button><button class="text-button danger-text" type="button" data-action="shutdown-local">安全退出本地服务</button></div>
        </section>
      ` : ''}
      <div class="check-group-title"><span>本篇创作</span><span>随任务发送</span></div>
      <div class="settings-field"><label for="contextSetting">背景、人物与已有素材</label><textarea id="contextSetting" rows="6">${escapeHtml(state.form.context)}</textarea></div>
      <div class="settings-field"><label for="preserveSetting">必须保留（每行一项）</label><textarea id="preserveSetting" rows="4">${escapeHtml(state.form.preserve)}</textarea></div>
      <div class="settings-field"><label for="lengthSetting">整篇 / 续写新增的目标篇幅</label><select id="lengthSetting">${['1200','2000','3000','5000'].map((value) => `<option value="${value}" ${state.form.targetLength === value ? 'selected' : ''}>约 ${value} 字</option>`).join('')}</select><small>局部改写按选区长度参考，扩写默认参考选区的两倍；不是字数硬限制。当前：${escapeHtml(creativeLengthLabel())}。</small></div>
      <div class="settings-field"><label for="personSetting">叙述人称</label><select id="personSetting">${['第一人称','第二人称','第三人称'].map((value) => `<option ${state.form.person === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
      <div class="settings-field"><label for="toneSetting">内容气质</label><input id="toneSetting" value="${escapeAttribute(state.form.tone)}"></div>
      <label class="settings-check"><input id="seriesOpeningSetting" type="checkbox" ${state.form.seriesOpening ? 'checked' : ''}><span>使用“今天体验的身份是……”系列开场</span></label>
      <button class="primary-button" type="button" data-action="save-settings">保存设置</button>
    </div>`);
  if (local) {
    $('#defaultWriterProviderSetting').value = provider.writer_provider_id || providerChoices[0]?.provider_id || '';
    $('#defaultValidatorProviderSetting').value = provider.validator_provider_id || providerChoices[0]?.provider_id || '';
  }
}

function openConflictModal() {
  const candidate = state.candidate;
  const source = state.versions.find((item) => item.id === candidate?.parent_version_id);
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="conflictTitle">
      <div class="modal-top"><div class="modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.2 4.5 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.8 4.5a2 2 0 0 0-3.6 0Z"/></svg></div><h2 id="conflictTitle">当前版本已经变化</h2><p>候选继续保留，但来源版本与当前正文不一致。为避免旧内容覆盖新修改，服务端禁止直接采用。</p></div>
      <div class="version-path"><span>候选基于 ${escapeHtml(displayVersion(source))}</span><i></i><span>当前正文 ${escapeHtml(displayVersion(state.currentVersion))}</span></div>
      <div class="modal-note">这是版本保护，不是内容质量判断。前端不会提供“强制覆盖”按钮。</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">继续查看候选</button><div class="right"><button class="secondary-button" type="button" data-action="show-editor">返回正文</button><button class="primary-button" type="button" data-action="regenerate-current">基于当前版重新生成</button></div></footer>
    </section>`;
}

function openUnknownOutcomeModal(stage = state.candidateTask?.unknown_stage || 'write') {
  const isValidator = stage === 'validate';
  const outcomeUnknown = state.candidateTask?.outcome_unknown === true;
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="unknownOutcomeTitle">
      <div class="modal-top"><div class="modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.2 4.5 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.8 4.5a2 2 0 0 0-3.6 0Z"/></svg></div><h2 id="unknownOutcomeTitle">${outcomeUnknown ? '上次 AI 请求结果未知' : '确认重新开始任务'}</h2><p>${outcomeUnknown ? '上次 AI 请求可能已经发送并产生费用，但本地未收到最终结果。系统没有自动重发。' : '上次任务已经停止。系统不会自动继续，只有你确认后才会发起新的请求。'}</p></div>
      <div class="modal-note">${isValidator ? '重新检查会复用已保存的原候选，只重新调用 Validator。' : '重新生成会建立一个可追踪的新任务，不会覆盖当前正文或已保存候选。'}${outcomeUnknown ? '无法确认远端结果时，不能承诺绝对零重复计费。' : ''}</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">暂不重试</button><button class="primary-button" type="button" data-action="${isValidator ? 'confirm-validator-retry' : 'confirm-generation-retry'}">我已了解，确认重试</button></footer>
    </section>`;
}

function openStopGenerationModal() {
  const taskId = state.activeTask?.id || state.candidateTask?.id;
  if (!taskId || state.stopping) return;
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="stopGenerationTitle">
      <div class="modal-top"><div class="modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8z"/></svg></div><h2 id="stopGenerationTitle">确认停止生成？</h2><p>停止会结束本机等待，但不会暂停任务。若请求已经发出，远端是否完成和是否计费可能无法确认。</p></div>
      <div class="modal-note">当前正文和已经保存的合法候选会保留；系统不会自动重新发送请求。</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">继续生成</button><button class="primary-button" type="button" data-action="confirm-stop-generation">确认停止</button></footer>
    </section>`;
}

function openFullReplacementConfirmModal() {
  if (!state.currentVersion || state.operation !== 'CREATE') return;
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="fullReplacementTitle">
      <div class="modal-top"><div class="modal-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01M10.2 4.5 3 17a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.8 4.5a2 2 0 0 0-3.6 0Z"/></svg></div><h2 id="fullReplacementTitle">确认生成整篇新候选？</h2><p>当前作品已有 ${escapeHtml(displayVersion(state.currentVersion))}。本次会生成一篇完整候选，可能整体替换现有正文；不会直接覆盖，仍需内容检查和手动采用。</p></div>
      <div class="version-path"><span>来源 ${escapeHtml(displayVersion(state.currentVersion))}</span><i></i><span>整篇新候选</span></div>
      <div class="modal-note">如果你只想接着写，请取消并选择“续写”。续写会由程序保留全部前文，只追加新内容。</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-full-replacement">确认生成整篇候选</button></footer>
    </section>`;
}

function openHistoryRestoreModal() {
  const historical = state.candidate;
  if (!historical || !state.candidateMeta.historical || !state.currentVersion) return;
  const current = historical.id === state.currentVersion.id;
  const operation = isAuthoringOperation(state.operation) ? operationLabels[state.operation] : '尚未选择';
  const scope = !state.operation ? '提交前必须重新选择'
    : state.selection && ['EXPAND', 'REWRITE'].includes(state.operation)
      ? `原选区将被清除，需在新来源重新选择`
      : state.operation === 'CONTINUE' ? '下一段，仅追加' : '整篇';
  const layer = $('#modalLayer');
  layer.hidden = false;
  if (current) {
    layer.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="historyAuthoringTitle">
        <div class="modal-top"><h2 id="historyAuthoringTitle">基于当前版本进入创作</h2><p>你正在只读查看 ${escapeHtml(displayVersion(historical))}。确认后会回到当前正文编辑器，不会创建版本，也不会自动发起模型请求。</p></div>
        <div class="history-authoring-summary"><span><small>创作来源</small><strong>${escapeHtml(displayVersion(historical))}（当前版本）</strong></span><span><small>本次操作</small><strong>${escapeHtml(operation)}</strong></span><span><small>修改范围</small><strong>${escapeHtml(scope)}</strong></span></div>
        <div class="modal-note">进入编辑器不会改变已经选择的操作；提交生成前请再次核对顶部的“本次操作、来源版本和修改范围”。</div>
        <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">继续只读查看</button><button class="primary-button" type="button" data-action="confirm-history-authoring-current">进入当前版本创作</button></footer>
      </section>`;
    return;
  }
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="historyRestoreTitle">
      <div class="modal-top"><h2 id="historyRestoreTitle">从历史版本发起新创作</h2><p>${escapeHtml(displayVersion(historical))} 不是当前正文，不能绕过版本保护直接作为创作来源。下一步需先把它安全恢复为一个新的当前版本。</p></div>
      <div class="history-authoring-summary"><span><small>恢复来源</small><strong>${escapeHtml(displayVersion(historical))}</strong></span><span><small>当前正式版本</small><strong>${escapeHtml(displayVersion(state.currentVersion))}，将保留</strong></span><span><small>本次操作</small><strong>创建新的正式版本</strong></span></div>
      <div class="history-authoring-summary"><span><small>恢复后操作</small><strong>${escapeHtml(operation)}</strong></span><span><small>修改范围</small><strong>${escapeHtml(scope)}</strong></span></div>
      <div class="modal-note">系统会复制历史正文并创建新版本；旧版本、当前版本和旧检查记录全部保留。若当前版本已变化，服务端会拒绝。恢复成功后仍需在编辑器再次确认操作与范围，模型不会自动调用。</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">继续只读查看</button><button class="primary-button" type="button" data-action="confirm-history-restore" data-source-version-id="${escapeAttribute(historical.id)}" data-expected-current-version-id="${escapeAttribute(state.currentVersion.id)}">恢复为新版本并进入创作</button></footer>
    </section>`;
}

function enterCurrentVersionAuthoring() {
  const current = state.currentVersion;
  if (!current || state.candidate?.id !== current.id || !state.candidateMeta.historical) return;
  $('#modalLayer').hidden = true;
  loadVersionIntoEditor(current);
  state.candidate = null;
  state.candidateTask = null;
  state.validationRuns = [];
  state.latestValidationRun = null;
  state.currentValidationRun = null;
  state.adoptionReadiness = null;
  state.candidateMeta = { stale: false, canApply: false, historical: false };
  state.operationNotice = isAuthoringOperation(state.operation)
    ? `已退出只读历史查看；本次“${operationLabels[state.operation]}”保持不变。提交前请核对来源版本和修改范围。`
    : '已退出只读历史查看。为防止误生成整篇，请先明确选择本次创作操作。';
  persistDraft();
  renderView('editor');
  toast('已进入当前版本创作；尚未调用模型');
}

async function retryUnknownGeneration() {
  if (!state.candidateTask?.id || state.busy) return;
  const expectedContract = state.candidateTask.contract || {
    operation: state.candidateTask.operation,
    source_version_id: state.candidateTask.source_version_id,
    target_scope: state.candidateTask.target_scope,
    merge_strategy: state.candidateTask.merge_strategy,
    expected_output_kind: state.candidateTask.output_kind,
    writer_provider_id: state.candidateTask.writer_provider_id,
    writer_model_id: state.candidateTask.writer_model_id
  };
  const originalTaskId = state.candidateTask.id;
  state.busy = true;
  $('#modalLayer').hidden = true;
  state.lastError = null;
  state.progressStage = state.candidateTask.failed_stage === 'plan' ? 'plan' : 'write';
  renderView('generating');
  try {
    const retried = await api(`/api/tasks/${encodeURIComponent(originalTaskId)}/retry`, {
      method: 'POST', body: JSON.stringify({ confirm_unknown_outcome: true })
    });
    state.candidateTask = retried.task;
    const taskId = retried.task.id;
    try {
      assertTaskContract(retried.task, expectedContract);
    } catch (contractError) {
      await api(`/api/tasks/${encodeURIComponent(taskId)}/stop`, {
        method: 'POST', body: JSON.stringify({ reason: 'client_contract_mismatch' })
      }).catch(() => {});
      throw contractError;
    }
    if (isAuthoringOperation(retried.task.operation)) state.operation = retried.task.operation;
    if (retried.next_stage === 'plan') {
      state.progressStage = 'plan';
      renderView('generating');
      await api(`/api/tasks/${encodeURIComponent(taskId)}/plan`, { method: 'POST', body: '{}' });
    }
    state.progressStage = 'write';
    renderView('generating');
    const written = await api(`/api/tasks/${encodeURIComponent(taskId)}/write`, { method: 'POST', body: '{}' });
    setCandidateFromPayload(written, { stale: written.source_is_current === false });
    persistDraft();
    await runValidation(taskId, { stale: written.source_is_current === false });
  } catch (error) {
    state.lastError = error;
    renderView(state.candidate ? 'candidate' : state.editorBody.trim() ? 'editor' : 'empty');
    toast(error.message);
  } finally {
    state.busy = false;
    syncBusyControls();
  }
}

async function restoreHistoricalVersion(button) {
  if (state.busy || !state.work?.id) return;
  const sourceVersionId = button?.dataset.sourceVersionId;
  const expectedCurrentVersionId = button?.dataset.expectedCurrentVersionId;
  if (!sourceVersionId || !expectedCurrentVersionId) return;
  const operationBeforeRestore = state.operation;
  const operationSelectedAtBeforeRestore = state.operationSelectedAt;
  state.busy = true;
  button.disabled = true;
  try {
    const payload = await api('/api/versions/restore', {
      method: 'POST',
      body: JSON.stringify({ work_id: state.work.id, source_version_id: sourceVersionId,
        expected_current_version_id: expectedCurrentVersionId })
    });
    $('#modalLayer').hidden = true;
    await bootstrap(payload.work_id);
    state.operation = isAuthoringOperation(operationBeforeRestore) ? operationBeforeRestore : null;
    state.operationSelectedAt = state.operation ? operationSelectedAtBeforeRestore || new Date().toISOString() : null;
    state.operationNotice = state.operation
      ? '历史版本已恢复为新版本；本次操作选择保持不变，修改范围已按新版本重新计算。'
      : '历史版本已恢复为新版本。开始下一次创作前，请重新选择操作。';
    await persistLocalAuthoringOperation();
    recordRoutingEvent('operation_restored_after_history_restore', {
      client_operation: state.operation,
      source_version_id: state.currentVersion?.id || null,
      writer_provider_id: state.modelSelection?.provider_id || null,
      writer_model_id: state.modelSelection?.writer_model_id || null,
      merge_strategy: state.operation ? operationMergeStrategy(state.operation, false) : null,
      result: state.operation ? 'operation_preserved' : 'selection_required'
    });
    persistDraft();
    renderView('editor');
    toast('服务端已创建新的恢复版本，原历史版本保持不变');
  } catch (error) {
    if (error.code === 'SOURCE_VERSION_CONFLICT') {
      $('#modalLayer').hidden = true;
      await bootstrap(state.work.id);
    }
    toast(error.message);
  } finally {
    state.busy = false;
    syncBusyControls();
  }
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function versionExportFilename(version) {
  return `${version.title || '未命名短剧'}-${displayVersion(version)}-${versionKind(version)}.md`.replace(/[\\/:*?"<>|]/gu, '_');
}

async function exportCurrent() {
  if (!state.currentVersion || !state.work?.id) return toast('当前没有可导出的已保存版本');
  const version = state.currentVersion;
  const workId = state.work.id;
  const title = version.title || '未命名短剧';
  const filename = versionExportFilename(version);
  try {
    if (state.localRuntime) {
      const response = await fetch(`/api/local/export?work_id=${encodeURIComponent(workId)}&version_id=${encodeURIComponent(version.id)}`, {
        headers: LOCAL_TOKEN ? { 'x-dramago-local-token': LOCAL_TOKEN } : {}
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message || '导出失败');
      downloadBlob(await response.blob(), filename);
    } else {
      downloadBlob(new Blob([`# ${title}\n\n${version.content}\n`], { type: 'text/markdown;charset=utf-8' }), filename);
    }
    toast('已导出当前选定版本');
  } catch (error) {
    toast(error.message);
  }
}

function exportCandidate() {
  if (!state.candidate) return toast('当前没有候选稿');
  const title = state.candidate.title || '未命名短剧';
  const isCandidate = state.candidate.status === 'candidate';
  const label = isCandidate ? '候选稿' : state.candidate.id === state.currentVersion?.id ? '当前正式版本' : '历史正式版本';
  downloadBlob(new Blob([
    `# ${title}（${label}）\n\n> 状态：${isCandidate ? '尚未采用' : '已采用版本'} · ${operationLabels[state.candidate.operation] || state.candidate.operation}\n\n${state.candidate.content}\n`
  ], { type: 'text/markdown;charset=utf-8' }), versionExportFilename(state.candidate));
  toast(`已导出${label}；文件状态已明确标注`);
}

async function saveStoryPlan() {
  if (!state.work?.id) return;
  const payload = await api(`/api/works/${encodeURIComponent(state.work.id)}/story-plan`, {
    method: 'POST', body: JSON.stringify({
      future_plot: $('#futurePlotPlan')?.value || '',
      ending_plan: $('#endingPlan')?.value || '',
      foreshadowing: $('#foreshadowingPlan')?.value || ''
    })
  });
  if (state.overview) state.overview.future_planning = payload.future_planning;
  renderView('overview');
  toast('作者规划已保存；正式正文与 Story Memory 未改变');
}

function openWorkStatusModal(nextStatus) {
  if (!state.work?.id || !state.currentVersion?.id) return toast('当前没有可标记状态的正式版本');
  const completing = nextStatus === 'completed';
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="workStatusTitle">
    <div class="modal-top"><h2 id="workStatusTitle">${completing ? '确认作品已经完结？' : '重新开启这部作品？'}</h2><p>${completing
      ? '只有你的明确确认会改变作品状态。此操作不会修改正文，也不代表系统评价结局质量。'
      : '重新开启后可以继续创作，已经采用的正文、历史版本和 Story Memory 都会保留。'}</p></div>
    <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-work-status" data-story-status="${nextStatus}">${completing ? '确认标记完结' : '确认重新开启'}</button></footer>
  </section>`;
}

async function updateWorkStatus(button) {
  const storyStatus = button?.dataset.storyStatus;
  if (!storyStatus || !state.work?.id || !state.currentVersion?.id) return;
  const payload = await api(`/api/works/${encodeURIComponent(state.work.id)}/status`, {
    method: 'POST', body: JSON.stringify({ story_status: storyStatus,
      expected_current_version_id: state.currentVersion.id })
  });
  state.work = { ...state.work, ...payload.work };
  rememberWork(state.work);
  $('#modalLayer').hidden = true;
  if (state.view === 'overview') await showOverview();
  else renderView(state.candidate ? 'candidate' : 'editor');
  toast(storyStatus === 'completed' ? '作品已由你确认标记为完结' : '作品已重新开启创作');
}

function reuseCandidateInstruction() {
  const instruction = state.candidate?.creative_brief?.user_instruction;
  if (!instruction) return toast('该历史任务没有可复用的创作指令');
  state.form.instruction = instruction;
  state.operation = isAuthoringOperation(state.candidate.operation) ? state.candidate.operation : state.operation;
  state.operationSelectedAt = new Date().toISOString();
  persistDraft();
  renderView(state.editorBody.trim() || state.currentVersion ? 'editor' : 'empty');
  toast('指令已明确载入为新的未提交草稿；尚未调用模型');
}

function openWorkSwitcher({ recycle = false } = {}) {
  const sourceWorks = state.localRuntime ? state.localWorks : recentWorks();
  const works = (sourceWorks || []).filter((item) => !recycle && String(item.title || '').toLowerCase()
    .includes(state.workSearch.toLowerCase()));
  openOverlay(`<div class="sheet-header"><div><small>${recycle ? '独立入口' : '本地作品'}</small><h2>${recycle ? '回收站' : '我的作品'}</h2></div><button class="icon-button" type="button" data-action="close-overlay" aria-label="关闭">×</button></div>
    ${recycle ? '<div class="sheet-empty"><strong>删除与恢复暂不支持</strong><p>当前版本不会删除作品，也没有可恢复的回收站记录。请通过历史版本查看或恢复正文。</p></div>' : `<label class="work-search"><span>搜索作品</span><input id="workSearchInput" value="${escapeAttribute(state.workSearch)}" placeholder="输入作品名"></label>
      <div class="work-switch-actions"><button class="primary-button" type="button" data-action="new-work">新建空白作品</button>${state.work ? '<button class="secondary-button" type="button" data-action="rename-work">重命名当前作品</button>' : ''}</div>
      <div class="work-switch-list">${works.length ? works.map((work) => `<button type="button" data-work-id="${escapeAttribute(work.id)}" class="work-switch-item ${work.id === state.work?.id ? 'active' : ''}"><strong>${escapeHtml(work.title)}</strong><small>${work.current_version_id ? (work.story_status === 'completed' ? '已完结' : '创作中') : '空白作品'} · ${new Date(work.updated_at).toLocaleString('zh-CN')}</small></button>`).join('') : '<p class="sheet-empty">没有匹配的作品。</p>'}</div>`}`);
}

async function importDocument(file) {
  if (!state.localRuntime || !file) return;
  if (file.size > 2 * 1024 * 1024) throw new Error('导入文件不能超过 2 MB。');
  const raw = (await file.text()).replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n');
  if (!raw.trim()) throw new Error('导入文件没有可保存的正文。');
  const heading = raw.match(/^#\s+(.+)\n+/u);
  const fallbackTitle = file.name.replace(/\.(md|markdown|txt)$/iu, '').trim() || '导入短剧';
  const title = (heading?.[1] || fallbackTitle).trim().slice(0, 160);
  const content = heading ? raw.slice(heading[0].length).trim() : raw.trim();
  if (!content) throw new Error('导入文件只有标题，没有正文。');
  const payload = await api('/api/versions/save', {
    method: 'POST',
    body: JSON.stringify({ title, content })
  });
  await refreshLocalRuntime();
  await bootstrap(payload.work_id);
  toast('已导入为独立本地作品，原作品未被覆盖');
}

function captureCreativeSettings() {
  if (!$('#contextSetting')) return;
  state.form.context = $('#contextSetting').value;
  state.form.preserve = $('#preserveSetting').value;
  state.form.targetLength = $('#lengthSetting').value;
  state.form.person = $('#personSetting').value;
  state.form.tone = $('#toneSetting').value;
  state.form.seriesOpening = $('#seriesOpeningSetting').checked;
  persistDraft();
}

function updateProviderSettingsOptions() {
  const presetId = $('#providerPresetSetting')?.value;
  const preset = state.localRuntime?.provider?.presets?.find((item) => item.provider_id === presetId);
  if (!preset) return;
  $('.provider-editor').dataset.presetId = preset.provider_id;
  $('#providerNameSetting').value = preset.provider_name || '';
  $('#providerEndpointSetting').value = preset.endpoint || '';
  $('#writerModelSetting').value = preset.default_writer_model || '';
  $('#validatorModelSetting').value = preset.default_validator_model || preset.default_writer_model || '';
  $('#providerJsonFormatSetting').checked = preset.default_request_capabilities?.response_format_json_object === true;
  $('#providerTemperatureSetting').checked = preset.default_request_capabilities?.temperature !== false;
}

function providerSettingsPayload(providerId) {
  const editor = $('.provider-editor');
  return {
    provider_id: providerId,
    preset_id: $('#providerPresetSetting')?.value || editor?.dataset.presetId || 'custom',
    display_name: $('#providerNameSetting').value,
    endpoint: $('#providerEndpointSetting').value,
    writer_model_id: $('#writerModelSetting').value,
    validator_model_id: $('#validatorModelSetting').value,
    disclosure_confirmed: $('#providerDisclosureSetting')?.checked === true,
    api_key: $('#providerKeySetting').value,
    timeout_ms: Number($('#providerTimeoutSetting').value || 180000),
    allow_insecure_local_http: $('#providerLocalHttpSetting').checked === true,
    request_capabilities: {
      temperature: $('#providerTemperatureSetting').checked === true,
      response_format_json_object: $('#providerJsonFormatSetting').checked === true,
      max_tokens: false
    }
  };
}

async function saveLocalProviderSettings() {
  if (!state.localRuntime) return;
  captureCreativeSettings();
  const editor = $('.provider-editor');
  if (!editor) return toast('请先选择要编辑的服务，或添加新服务');
  const adding = state.providerSettingsView?.mode === 'add';
  const presetId = $('#providerPresetSetting')?.value || editor.dataset.presetId || 'custom';
  const providerId = adding
    ? `${presetId === 'custom' ? 'custom' : presetId}_${Date.now().toString(36)}`.slice(0, 64)
    : editor.dataset.providerId;
  const payload = await api('/api/local/settings', {
    method: 'POST',
    body: JSON.stringify({ ...providerSettingsPayload(providerId), select_writer: false, select_validator: false })
  });
  $('#providerKeySetting').value = '';
  state.localRuntime.provider = payload.provider;
  state.providerSettingsView = { mode: 'list', providerId: null };
  rememberModelSelection({ writer_provider_id: state.localRuntime.provider.writer_provider_id,
    writer_model_id: state.localRuntime.provider.writer_model_id,
    validator_provider_id: state.localRuntime.provider.validator_provider_id,
    validator_model_id: state.localRuntime.provider.validator_model_id });
  setProvider({ configured: state.localRuntime.provider.configured,
    model: `${state.localRuntime.provider.writer_model} / ${state.localRuntime.provider.validator_model}`,
    missing: state.localRuntime.provider.configured ? [] : ['API Key'] });
  toast(adding ? '新的 AI 服务已安全添加' : 'AI 服务修改已安全保存');
  openSettings();
}

async function saveProviderRoles() {
  if (!state.localRuntime) return;
  const payload = await api('/api/local/settings/roles', { method: 'POST', body: JSON.stringify({
    writer_provider_id: $('#defaultWriterProviderSetting').value,
    validator_provider_id: $('#defaultValidatorProviderSetting').value
  }) });
  state.localRuntime.provider = payload.provider;
  rememberModelSelection({ writer_provider_id: payload.provider.writer_provider_id,
    writer_model_id: payload.provider.writer_model_id,
    validator_provider_id: payload.provider.validator_provider_id,
    validator_model_id: payload.provider.validator_model_id });
  toast('默认 Writer 与 Validator 已保存');
  openSettings();
}

async function testLocalProvider() {
  const result = $('#providerTestResult');
  if (result) result.textContent = '正在测试连接……';
  try {
    const payload = await api('/api/local/settings/test', { method: 'POST', body: JSON.stringify({
      provider_id: $('.provider-editor')?.dataset.providerId || state.localRuntime.provider.provider_id,
      model_id: $('#writerModelSetting')?.value || state.localRuntime.provider.writer_model_id,
      role: 'writer',
      confirm_billable_test: true
    }) });
    if (result) result.textContent = `连接成功 · HTTP ${payload.result.http_status} · ${payload.result.model} · ${payload.result.duration_ms} ms`;
  } catch (error) {
    if (result) result.textContent = error.message;
  }
}

async function deleteLocalProvider(providerId) {
  if (!providerId) return;
  const payload = await api('/api/local/settings/delete', { method: 'POST',
    body: JSON.stringify({ provider_id: providerId, clear_key: true }) });
  state.localRuntime.provider = payload.provider;
  state.providerSettingsView = { mode: 'list', providerId: null };
  rememberModelSelection(null);
  $('#modalLayer').hidden = true;
  toast('AI 服务配置与其本机 Key 已删除；历史任务记录保持不变');
  openSettings();
}

function openLocalConfirmModal(kind) {
  const restore = kind === 'restore';
  const backupId = restore ? $('#backupSetting')?.value : '';
  if (restore && !backupId) return toast('请先选择一个备份');
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="localConfirmTitle">
      <div class="modal-top"><h2 id="localConfirmTitle">${restore ? '确认恢复本地备份？' : '确认清除 API Key？'}</h2><p>${restore ? '当前数据库会先自动创建一个恢复前备份，然后用所选备份替换。作品页面将重新载入。' : '清除后仍可阅读、编辑和管理本地作品，但 AI 生成与语义检查将不可用。'}</p></div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="${restore ? 'confirm-restore' : 'confirm-clear-provider-key'}" ${restore ? `data-backup-id="${escapeAttribute(backupId)}"` : ''}>${restore ? '确认恢复' : '确认清除'}</button></footer>
    </section>`;
}

function openProviderDeleteModal(providerId) {
  const provider = state.localRuntime?.provider?.providers?.find((item) => item.provider_id === providerId);
  if (!provider) return;
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="deleteProviderTitle">
      <div class="modal-top"><h2 id="deleteProviderTitle">删除 ${escapeHtml(provider.provider_name)}？</h2><p>此操作会删除该服务配置及其本机加密 Key，但不会删除作品、候选或历史任务记录。</p></div>
      <div class="modal-note">如果它仍是默认 Writer 或 Validator，请先选择其他服务。</div>
      <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button danger-button" type="button" data-action="confirm-delete-provider" data-provider-id="${escapeAttribute(providerId)}">确认删除服务</button></footer>
    </section>`;
}

async function clearLocalProviderKey() {
  const provider = state.localRuntime.provider;
  const providerId = $('.provider-editor')?.dataset.providerId || provider.provider_id;
  const selected = provider.providers?.find((item) => item.provider_id === providerId);
  const payload = await api('/api/local/settings', {
    method: 'POST',
    body: JSON.stringify({
      provider_id: providerId,
      writer_model_id: selected?.writer_model_id,
      disclosure_confirmed: selected?.disclosure_confirmed === true,
      clear_key: true
    })
  });
  state.localRuntime.provider = payload.provider;
  setProvider({ configured: false, missing: ['OPENAI_API_KEY'] });
  $('#modalLayer').hidden = true;
  toast('本机 API Key 已清除');
  openSettings();
}

async function createLocalBackup() {
  const payload = await api('/api/local/backup', { method: 'POST', body: '{}' });
  state.localRuntime.backups = payload.backups || [];
  openSettings();
  toast('SQLite 备份已创建并完成校验');
}

async function restoreLocalBackup(button) {
  const backupId = button?.dataset.backupId;
  if (!backupId) return;
  const payload = await api('/api/local/restore', { method: 'POST', body: JSON.stringify({ backup_id: backupId }) });
  if (!payload.restored) throw new Error('备份恢复未完成。');
  $('#modalLayer').hidden = true;
  closeOverlay();
  await refreshLocalRuntime();
  await bootstrap(state.work?.id || null);
  toast('本地备份已恢复');
}

async function shutdownLocal() {
  await api('/api/local/shutdown', { method: 'POST', body: '{}' });
  closeOverlay();
  $('#viewRoot').innerHTML = '<section class="shutdown-view"><h1>DramaGo 已安全退出</h1><p>数据库连接已关闭。现在可以关闭此页面。</p></section>';
}

function showModalFormError(message) {
  const error = $('#modalLayer .modal-error');
  if (!error) return toast(message);
  error.textContent = message;
  error.hidden = false;
}

function openNewWorkModal() {
  if (state.busy) return toast('当前任务仍在执行，请等待完成');
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="newWorkTitle">
    <div class="modal-top"><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button><h2 id="newWorkTitle">新建空白作品</h2><p>先建立作品名称，不调用 AI，也不会创建虚假的正文版本、检查记录或故事记忆。</p></div>
    <div class="modal-form"><label class="settings-field"><span>作品名称</span><input id="newWorkName" maxlength="160" placeholder="例如：一日倾覆"></label><p class="modal-error" role="alert" hidden></p></div>
    <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-new-work">创建空白作品</button></footer>
  </section>`;
  requestAnimationFrame(() => $('#newWorkName')?.focus());
}

async function createBlankWork() {
  const title = String($('#newWorkName')?.value || '').trim();
  if (!title) return showModalFormError('请输入作品名称');
  const payload = await api('/api/works', { method: 'POST', body: JSON.stringify({ title }) });
  $('#modalLayer').hidden = true;
  await refreshLocalRuntime();
  await bootstrap(payload.work.id);
  toast('空白作品已建立；尚未创建正文版本或调用 AI');
}

function openRenameWorkModal() {
  if (!state.work?.id) return toast('请先建立作品');
  const layer = $('#modalLayer');
  layer.hidden = false;
  layer.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="renameWorkTitle">
    <div class="modal-top"><button class="modal-close" type="button" data-action="close-modal" aria-label="关闭弹窗">×</button><h2 id="renameWorkTitle">重命名作品</h2><p>只修改作品名称，不改变正文、版本、候选或故事记忆。</p></div>
    <div class="modal-form"><label class="settings-field"><span>作品名称</span><input id="renameWorkName" maxlength="160" value="${escapeAttribute(state.work.title || state.editorTitle)}"></label><p class="modal-error" role="alert" hidden></p></div>
    <footer class="modal-actions"><button class="text-button" type="button" data-action="close-modal">取消</button><button class="primary-button" type="button" data-action="confirm-rename-work">保存名称</button></footer>
  </section>`;
  requestAnimationFrame(() => $('#renameWorkName')?.select());
}

async function renameWork() {
  const title = String($('#renameWorkName')?.value || '').trim();
  if (!title) return showModalFormError('请输入作品名称');
  const payload = await api(`/api/works/${encodeURIComponent(state.work.id)}/rename`, {
    method: 'POST', body: JSON.stringify({ title })
  });
  state.work = { ...state.work, ...payload.work };
  state.editorTitle = title;
  rememberWork(state.work);
  await refreshLocalRuntime();
  $('#modalLayer').hidden = true;
  persistDraft();
  renderView(state.editorBody.trim() || state.currentVersion ? 'editor' : 'empty');
  toast('作品名称已更新');
}

function resetForNewWork() {
  if (state.busy) return toast('当前任务仍在执行，请等待完成');
  stopTaskRecoveryPoll();
  persistDraft();
  forgetCurrentPointer();
  Object.assign(state, {
    view: 'empty',
    operation: 'CREATE',
    operationSelectedAt: null,
    operationNotice: null,
    work: null,
    currentVersion: null,
    versions: [],
    candidate: null,
    candidateTask: null,
    validationRuns: [],
    latestValidationRun: null,
    currentValidationRun: null,
    adoptionReadiness: null,
    revalidationReadiness: null,
    availableCandidateActions: [],
    candidateRecoveryGuidance: null,
    candidateMemoryPreview: null,
    candidateMeta: { stale: false, canApply: false, historical: false },
    selection: null,
    dirty: false,
    editorRevision: state.editorRevision + 1,
    editorTitle: '未命名短剧',
    editorBody: '',
    form: emptyForm(),
    lastError: null
  });
  const draft = loadDraft(null);
  if (draft) {
    state.form = { ...emptyForm(), ...(draft.form || {}) };
    state.editorTitle = draft.title || '未命名短剧';
    state.editorBody = draft.body || '';
    state.dirty = Boolean(draft.dirty);
  }
  renderView(state.editorBody.trim() ? 'editor' : 'empty');
}

async function switchWork(workId) {
  if (!workId || state.busy) return;
  closeOverlay();
  await bootstrap(workId);
}

function restoreCandidateFromBootstrap(latestTask) {
  if (!latestTask?.result_version_id) return false;
  const candidate = state.versions.find((version) => version.id === latestTask.result_version_id);
  if (!candidate || candidate.status !== 'candidate' || candidate.id === state.currentVersion?.id) return false;
  state.candidate = candidate;
  state.candidateTask = latestTask;
  const liveSourceMismatch = (candidate.parent_version_id || null) !== (state.currentVersion?.id || null);
  state.candidateMeta = {
    stale: latestTask.source_is_current === false || liveSourceMismatch,
    canApply: Boolean(candidate.can_auto_apply && candidate.validation_status === 'passed'
      && latestTask.source_is_current !== false && !liveSourceMismatch),
    historical: false
  };
  return true;
}

function stopTaskRecoveryPoll() {
  if (state.taskPollTimer) clearTimeout(state.taskPollTimer);
  state.taskPollTimer = null;
}

async function recoverGenerationTask(task) {
  if (!task?.id || task.status === 'completed') return;
  stopTaskRecoveryPoll();
  state.candidateTask = task;
  if (isAuthoringOperation(task.operation)) {
    state.operation = task.operation;
    state.operationSelectedAt = task.created_at || new Date().toISOString();
    state.operationNotice = null;
    persistDraft();
    await persistLocalAuthoringOperation();
    recordRoutingEvent('operation_restored', {
      task_id: task.id,
      client_operation: task.operation,
      server_operation: task.operation,
      source_version_id: task.source_version_id || null,
      writer_provider_id: task.writer_provider_id || null,
      writer_model_id: task.writer_model_id || null,
      merge_strategy: task.merge_strategy || null,
      result: 'active_task_restored'
    });
  }
  state.busy = true;
  state.progressStage = task.stage === 'planning' ? 'plan' : task.stage === 'validating' ? 'validate' : 'write';
  renderView('generating');
  const taskId = task.id;

  const check = async () => {
    try {
      let payload = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
      const current = payload.task;
      state.candidateTask = current;
      if (payload.candidate) setCandidateFromPayload(payload, { stale: payload.source_is_current === false });
      const stage = current.stage || current.status;
      if (current.status === 'completed' || stage === 'validated') {
        state.busy = false;
        state.form.instruction = '';
        await consumePersistentDraft();
        persistDraft({ remote: false });
        renderView(state.candidate ? 'candidate' : 'editor');
        return;
      }
      if (current.status === 'failed' || stage === 'failed' || stage === 'abandoned' || stage === 'stopped') {
        state.busy = false;
        state.lastError = new Error(current.error_message || (stage === 'stopped'
          ? '任务已停止，当前正文和已保存候选均已保留。'
          : '上一次生成未完成，当前正文和已保存候选均已保留。'));
        state.lastError.code = current.error_code || current.last_error_code;
        renderView(state.candidate ? 'candidate' : state.editorBody.trim() ? 'editor' : 'empty');
        toast(state.lastError.message);
        return;
      }
      if (stage === 'created') {
        payload = await api(`/api/tasks/${encodeURIComponent(taskId)}/write`, { method: 'POST', body: '{}' });
        setCandidateFromPayload(payload, { stale: payload.source_is_current === false });
        await runValidation(taskId, { stale: payload.source_is_current === false });
        state.busy = false;
        return;
      }
      if (stage === 'planned') {
        payload = await api(`/api/tasks/${encodeURIComponent(taskId)}/write`, { method: 'POST', body: '{}' });
        setCandidateFromPayload(payload, { stale: payload.source_is_current === false });
        await runValidation(taskId, { stale: payload.source_is_current === false });
        state.busy = false;
        return;
      }
      if (stage === 'generated') {
        await runValidation(taskId, { stale: payload.source_is_current === false });
        state.busy = false;
        return;
      }
      state.progressStage = stage === 'planning' ? 'plan' : stage === 'validating' ? 'validate' : 'write';
      renderView('generating');
      state.taskPollTimer = setTimeout(check, 700);
    } catch (error) {
      if (error.code === 'TASK_STAGE_BUSY') {
        state.taskPollTimer = setTimeout(check, 700);
        return;
      }
      state.busy = false;
      state.lastError = error;
      renderView(state.candidate ? 'candidate' : state.editorBody.trim() ? 'editor' : 'empty');
      toast(error.message);
    }
  };
  await check();
}

async function bootstrap(explicitWorkId) {
  stopTaskRecoveryPoll();
  state.view = 'loading';
  renderView('loading');
  if (LOCAL_TOKEN && !state.localRuntime) await refreshLocalRuntime();
  const fromUrl = new URL(location.href).searchParams.get('work_id');
  const workId = explicitWorkId || fromUrl || localStorage.getItem(WORK_KEY) || null;
  try {
    const payload = await api(`/api/bootstrap${workId ? `?work_id=${encodeURIComponent(workId)}` : ''}`);
    setProvider(payload.provider);
    state.work = payload.work;
    state.currentVersion = payload.current_version;
    state.versions = payload.versions || [];
    state.candidate = null;
    state.candidateTask = payload.latest_task || null;
    state.validationRuns = payload.validation_runs || [];
    state.latestValidationRun = payload.latest_validation_run || state.validationRuns[0] || null;
    state.currentValidationRun = payload.current_validation_run
      || state.validationRuns.find((run) => run.id === payload.current_version?.current_validation_run_id) || null;
    state.adoptionReadiness = payload.adoption_readiness || null;
    state.revalidationReadiness = payload.revalidation_readiness || null;
    state.availableCandidateActions = payload.available_actions || [];
    state.candidateRecoveryGuidance = payload.recovery_guidance || null;
    state.candidateMemoryPreview = payload.memory_preview || null;
    state.candidateMeta = { stale: false, canApply: false, historical: false };
    state.selection = null;
    state.lastError = null;

    if (payload.work) {
      rememberWork(payload.work);
      let draft = loadDraft(payload.work.id);
      let keepDraft = Boolean(draft?.dirty && (draft.basedOnVersionId ?? null) === (state.currentVersion?.id ?? null));
      const localOperationState = await loadLocalAuthoringOperation(payload.work.id);
      const draftOperation = draft?.operationStateVersion === OPERATION_STATE_VERSION && isAuthoringOperation(draft?.operation)
        ? draft.operation
        : null;
      const restoredOperation = localOperationState?.operation || draftOperation || (!state.currentVersion ? 'CREATE' : null);
      const sqliteDraft = await loadPersistentDraft(payload.work.id, restoredOperation || 'CREATE');
      if (sqliteDraft) {
        const localRevision = Number(draft?.draftRevision || 0);
        const sqliteRevision = Number(sqliteDraft.draftRevision || 0);
        const localBoundToCurrent = (draft?.basedOnVersionId ?? null) === (state.currentVersion?.id ?? null);
        const localOperationMatches = draft?.operationStateVersion === OPERATION_STATE_VERSION
          && draft?.operation === restoredOperation;
        draft = localBoundToCurrent && localOperationMatches && localRevision > sqliteRevision
          ? draft : sqliteDraft;
        keepDraft = Boolean(draft.dirty && (draft.basedOnVersionId ?? null) === (state.currentVersion?.id ?? null));
      }
      state.draftId = draft?.draftId || null;
      state.draftRevision = Math.max(Number(draft?.draftRevision || 0), Number(sqliteDraft?.draftRevision || 0));
      state.operationDraftConsumed = Boolean(draft?.operationDraftConsumed);
      state.draftSaveState = draft && draft !== sqliteDraft && sqliteDraft ? 'saving'
        : sqliteDraft ? 'saved' : 'idle';
      state.form = { ...emptyForm(), ...(draft?.form || {}) };
      state.operation = restoredOperation;
      state.operationSelectedAt = restoredOperation
        ? localOperationState?.selected_at || draft?.operationSelectedAt || null
        : null;
      state.operationNotice = restoredOperation ? null : '没有可安全恢复的操作类型。为防止误生成整篇，请重新选择本次操作。';
      recordRoutingEvent('operation_restored', {
        client_operation: restoredOperation,
        source_version_id: state.currentVersion?.id || null,
        writer_provider_id: state.modelSelection?.provider_id || null,
        writer_model_id: state.modelSelection?.writer_model_id || null,
        merge_strategy: restoredOperation ? operationMergeStrategy(restoredOperation, false) : null,
        result: restoredOperation ? 'draft_restored' : 'selection_required',
        reason_code: restoredOperation ? null : 'NO_TRUSTED_OPERATION_STATE'
      });
      if (!localOperationState && draftOperation) await persistLocalAuthoringOperation();
      if (keepDraft) {
        state.editorTitle = draft.title || state.currentVersion?.title || payload.work.title || '未命名短剧';
        state.editorBody = draft.body || '';
        state.dirty = true;
      } else if (state.currentVersion) {
        state.editorTitle = state.currentVersion.title;
        state.editorBody = state.currentVersion.content;
        state.dirty = false;
      } else {
        state.editorTitle = draft?.title || payload.work.title || '未命名短剧';
        state.editorBody = draft?.body || '';
        state.dirty = Boolean(draft?.dirty);
      }
      if (state.draftSaveState === 'saving') schedulePersistentDraft();
      const restoredCandidate = restoreCandidateFromBootstrap(payload.latest_task);
      const latestTerminal = payload.latest_task && ['stopped', 'failed', 'abandoned'].includes(payload.latest_task.status);
      if (latestTerminal && (payload.latest_task.retry_confirmation_required || payload.latest_task.status === 'stopped')) {
        state.lastError = new Error(payload.latest_task.error_message || (payload.latest_task.outcome_unknown
          ? '上次 AI 请求可能已经发送并产生费用，但本地未收到最终结果。系统没有自动重发。'
          : '上次任务已经停止，当前正文和已保存候选均已保留。'));
        state.lastError.code = payload.latest_task.error_code || payload.latest_task.last_error_code;
      }
      persistDraft();
      renderView(restoredCandidate ? 'candidate' : 'editor');
      if (payload.latest_task && !['completed', 'stopped', 'failed', 'abandoned'].includes(payload.latest_task.status)) {
        recoverGenerationTask(payload.latest_task);
      }
    } else {
      forgetCurrentPointer();
      state.form = emptyForm();
      state.operation = 'CREATE';
      state.operationSelectedAt = null;
      state.operationNotice = null;
      state.editorTitle = '未命名短剧';
      state.editorBody = '';
      state.dirty = false;
      const draft = loadDraft(null);
      if (draft) {
        state.form = { ...emptyForm(), ...(draft.form || {}) };
        state.editorTitle = draft.title || '未命名短剧';
        state.editorBody = draft.body || '';
        state.dirty = Boolean(draft.dirty);
        state.operation = draft.operationStateVersion === OPERATION_STATE_VERSION && isAuthoringOperation(draft.operation)
          ? draft.operation
          : 'CREATE';
        state.operationSelectedAt = draft.operationSelectedAt || null;
      }
      renderView(state.editorBody.trim() ? 'editor' : 'empty');
    }
  } catch (error) {
    setProvider({ configured: false, missing: ['服务端配置'] });
    state.lastError = error;
    const draft = loadDraft(workId);
    if (draft) {
      state.form = { ...emptyForm(), ...(draft.form || {}) };
      state.editorTitle = draft.title || '未命名短剧';
      state.editorBody = draft.body || '';
      state.dirty = true;
      state.operation = draft.operationStateVersion === OPERATION_STATE_VERSION && isAuthoringOperation(draft.operation)
        ? draft.operation
        : null;
      state.operationSelectedAt = state.operation ? draft.operationSelectedAt || null : null;
      state.operationNotice = state.operation ? null : '无法连接工作台，且没有可安全恢复的操作类型。请连接恢复后重新选择。';
    }
    renderView(state.editorBody.trim() ? 'editor' : 'empty');
    toast(`工作台连接失败：${error.message}`);
  }
}

function saveSettings() {
  state.form.context = $('#contextSetting').value;
  state.form.preserve = $('#preserveSetting').value;
  state.form.targetLength = $('#lengthSetting').value;
  state.form.person = $('#personSetting').value;
  state.form.tone = $('#toneSetting').value;
  state.form.seriesOpening = $('#seriesOpeningSetting').checked;
  persistDraft();
  closeOverlay();
  renderView(state.editorBody.trim() || state.currentVersion ? 'editor' : 'empty');
  toast('创作设置已保存到当前浏览器');
}

function updateVisualViewport() {
  const viewport = window.visualViewport;
  const keyboardInset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
  document.documentElement.style.setProperty('--keyboard-inset', `${keyboardInset}px`);
  if (keyboardInset > 120) document.body.classList.add('keyboard-open');
  else if (!document.activeElement?.matches('textarea, input')) document.body.classList.remove('keyboard-open');
}

document.addEventListener('click', async (event) => {
  const relationshipPerson = event.target.closest('[data-relationship-person]');
  if (relationshipPerson) {
    openRelationshipPerson(relationshipPerson.dataset.relationshipPerson);
    return;
  }
  const memoryActionButton = event.target.closest('[data-memory-action]');
  if (memoryActionButton) {
    const action = memoryActionButton.dataset.memoryAction;
    if (action === 'correct') openMemoryCorrectionModal(memoryActionButton);
    else await saveMemoryFeedback(action, memoryActionButton.dataset.memoryItemId).catch((error) => toast(error.message));
    return;
  }
  const languageLocate = event.target.closest('[data-language-locate]');
  if (languageLocate) {
    const quote = languageLocate.dataset.languageLocate;
    closeOverlay();
    renderView(state.candidate ? 'candidate' : 'editor');
    requestAnimationFrame(() => {
      const paragraph = [...$$('.story-body p')].find((item) => item.textContent.includes(quote));
      if (paragraph) {
        paragraph.classList.add('evidence-highlight');
        paragraph.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } else toast('证据仍保留在检查记录中，但当前阅读视图未定位到原句');
    });
    return;
  }
  const languageKeep = event.target.closest('[data-language-keep]');
  if (languageKeep) {
    const key = `dramago-language-decisions:${state.candidate?.id || state.currentVersion?.id || 'none'}`;
    const decisions = JSON.parse(localStorage.getItem(key) || '{}');
    decisions[languageKeep.dataset.languageKeep] = { decision: 'keep', at: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(decisions));
    toast('已记录“保留此表达”；检查历史未被删除');
    return;
  }
  const languageRewrite = event.target.closest('[data-language-rewrite]');
  if (languageRewrite) {
    const quote = languageRewrite.dataset.languageRewrite;
    const start = state.editorBody.indexOf(quote);
    if (start < 0) return toast('当前正式正文中没有该原句，不能建立安全选区');
    closeOverlay();
    renderView('editor');
    requestAnimationFrame(() => {
      const editor = $('#bodyEditor');
      editor?.focus();
      editor?.setSelectionRange(start, start + quote.length);
      watchTextSelection();
    });
    toast('已定位当前正文；请确认选区后再选择局部改写，不会自动调用 AI');
    return;
  }
  const evidenceButton = event.target.closest('[data-evidence-version]');
  if (evidenceButton) {
    openEvidenceReadOnly(evidenceButton.dataset.evidenceVersion,
      Number(evidenceButton.dataset.evidenceStart), Number(evidenceButton.dataset.evidenceEnd));
    return;
  }
  const promptButton = event.target.closest('[data-prompt]');
  if (promptButton) {
    state.form.instruction = promptButton.dataset.prompt;
    renderView('empty');
    requestAnimationFrame(() => $('#ideaInput')?.focus());
    return;
  }

  const operation = event.target.closest('[data-operation]')?.dataset.operation;
  if (operation) {
    captureEditorValues();
    await setOperation(operation);
    return;
  }

  const selectionAction = event.target.closest('[data-selection-action]')?.dataset.selectionAction;
  if (selectionAction) {
    await bindSelection(selectionAction);
    return;
  }

  const compareSide = event.target.closest('[data-compare-side]')?.dataset.compareSide;
  if (compareSide) {
    state.compareSide = compareSide;
    $$('[data-compare-side]').forEach((button) => button.classList.toggle('active', button.dataset.compareSide === compareSide));
    $('.compare-surface')?.setAttribute('data-mobile-side', compareSide);
    return;
  }

  const compareMode = event.target.closest('[data-compare-mode]')?.dataset.compareMode;
  if (compareMode) {
    state.compareMode = compareMode;
    renderView('compare');
    return;
  }

  const versionId = event.target.closest('[data-version-id]')?.dataset.versionId;
  if (versionId) {
    const version = state.versions.find((item) => item.id === versionId);
    closeOverlay();
    if (version) await candidateForVersion(version, { historical: true });
    return;
  }

  const workId = event.target.closest('[data-work-id]')?.dataset.workId;
  if (workId) {
    await switchWork(workId);
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  const action = actionButton?.dataset.action;
  if (!action) return;
  event.preventDefault();
  const actions = {
    'show-editor': () => renderView(state.editorBody.trim() || state.currentVersion ? 'editor' : 'empty'),
    'show-candidate': () => state.candidate ? renderView('candidate') : toast('当前没有候选版本'),
    'show-compare': openCompare,
    'swap-compare': () => { [state.compareBaseId, state.compareTargetId] = [state.compareTargetId, state.compareBaseId]; renderView('compare'); },
    'show-overview': showOverview,
    'new-work': openNewWorkModal,
    'confirm-new-work': () => createBlankWork().catch((error) => showModalFormError(error.message)),
    'rename-work': openRenameWorkModal,
    'confirm-rename-work': () => renameWork().catch((error) => showModalFormError(error.message)),
    'confirm-memory-correction': () => confirmMemoryCorrection(actionButton).catch((error) => toast(error.message)),
    'add-memory-relationship': openAddRelationshipModal,
    'confirm-add-memory-relationship': () => addMemoryRelationship().catch((error) => toast(error.message)),
    'open-work-switcher': () => openWorkSwitcher(),
    'open-recycle-bin': () => openWorkSwitcher({ recycle: true }),
    'open-checks': openChecks,
    'open-candidate-memory': openCandidateMemory,
    'open-history': openHistory,
    'open-settings': openSettings,
    'close-overlay': closeOverlay,
    'close-modal': () => { $('#modalLayer').hidden = true; },
    'clear-selection': clearSelection,
    'generate': generate,
    'stop-generation': openStopGenerationModal,
    'confirm-stop-generation': async () => { $('#modalLayer').hidden = true; await stopGeneration(); },
    'confirm-full-replacement': async () => { $('#modalLayer').hidden = true; await generate({ confirmFullReplacement: true }); },
    'save-version': () => saveCurrent(),
    'adopt-candidate': adoptCandidate,
    'retry-validation': openValidatorRetryModal,
    'confirm-validator-retry-v13': confirmValidatorRetry,
    'request-candidate-revalidation': openCandidateRevalidationModal,
    'confirm-candidate-revalidation': revalidateCandidate,
    'request-generation-retry': () => openUnknownOutcomeModal(state.candidateTask?.unknown_stage || 'write'),
    'confirm-generation-retry': retryUnknownGeneration,
    'confirm-validator-retry': async () => { $('#modalLayer').hidden = true; await retryValidation({ confirmed: true }); },
    'request-history-authoring': openHistoryRestoreModal,
    'confirm-history-authoring-current': enterCurrentVersionAuthoring,
    'request-history-restore': openHistoryRestoreModal,
    'confirm-history-restore': () => restoreHistoricalVersion(actionButton),
    'save-settings': saveSettings,
    'save-provider-settings': () => saveLocalProviderSettings().catch((error) => toast(error.message)),
    'save-provider-roles': () => saveProviderRoles().catch((error) => toast(error.message)),
    'start-add-provider': () => { state.providerSettingsView = { mode: 'add', providerId: null }; openSettings(); },
    'edit-provider': () => { state.providerSettingsView = { mode: 'edit', providerId: actionButton.dataset.providerId }; openSettings(); },
    'cancel-provider-editor': () => { state.providerSettingsView = { mode: 'list', providerId: null }; openSettings(); },
    'request-delete-provider': () => openProviderDeleteModal(actionButton.dataset.providerId),
    'confirm-delete-provider': () => deleteLocalProvider(actionButton.dataset.providerId).catch((error) => toast(error.message)),
    'test-provider': testLocalProvider,
    'clear-provider-key': () => openLocalConfirmModal('clear'),
    'confirm-clear-provider-key': () => clearLocalProviderKey().catch((error) => toast(error.message)),
    'create-backup': () => createLocalBackup().catch((error) => toast(error.message)),
    'import-document': () => $('#importDocumentInput')?.click(),
    'request-restore': () => openLocalConfirmModal('restore'),
    'confirm-restore': () => restoreLocalBackup(actionButton).catch((error) => toast(error.message)),
    'export-current': exportCurrent,
    'export-candidate': exportCandidate,
    'save-story-plan': () => saveStoryPlan().catch((error) => toast(error.message)),
    'request-complete-work': () => openWorkStatusModal('completed'),
    'request-reopen-work': () => openWorkStatusModal('active'),
    'confirm-work-status': () => updateWorkStatus(actionButton).catch((error) => toast(error.message)),
    'reuse-candidate-instruction': reuseCandidateInstruction,
    'toggle-composer': () => { captureEditorValues(); state.composerCollapsed = !state.composerCollapsed; renderView('editor'); },
    'shutdown-local': () => shutdownLocal().catch((error) => toast(error.message)),
    'regenerate-current': async () => {
      const workId = state.work?.id;
      const operation = state.operation;
      const form = { ...state.form };
      const dependedOnSelection = Boolean(state.selection) && ['EXPAND', 'REWRITE'].includes(operation);
      $('#modalLayer').hidden = true;
      if (workId) await bootstrap(workId);
      state.form = form;
      state.operation = operation;
      state.selection = null;
      state.candidate = null;
      state.candidateTask = null;
      state.candidateMeta = { stale: false, canApply: false, historical: false };
      state.lastError = null;
      renderView('editor');
      persistDraft();
      if (dependedOnSelection) {
        toast('当前正文已刷新，请在最新版本中重新选择要修改的片段');
        return;
      }
      await generate();
    }
  };
  await actions[action]?.();
});

document.addEventListener('input', (event) => {
  if (event.target.closest('#modalLayer .modal-form')) {
    const error = $('#modalLayer .modal-error');
    if (error) error.hidden = true;
  }
  if (event.target.id === 'ideaInput' || event.target.id === 'composerInput') {
    state.form.instruction = event.target.value;
    state.operationDraftConsumed = false;
    state.lastError = null;
    persistDraft();
  }
  if (event.target.id === 'titleEditor' || event.target.id === 'bodyEditor') markEditorDirty();
  if (event.target.id === 'endingRequirements') { state.form.endingRequirements = event.target.value; persistDraft(); }
  if (event.target.id === 'exactFinalSentence') { state.form.exactFinalSentence = event.target.value; persistDraft(); }
  if (event.target.id === 'workSearchInput') {
    state.workSearch = event.target.value;
    openWorkSwitcher();
    requestAnimationFrame(() => { const input = $('#workSearchInput'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); });
  }
});

document.addEventListener('mousedown', (event) => {
  if (event.target.closest('#selectionToolbar button')) event.preventDefault();
});

document.addEventListener('change', (event) => {
  if (['compareBaseVersion', 'compareTargetVersion'].includes(event.target.id)) {
    const isBase = event.target.id === 'compareBaseVersion';
    const other = isBase ? state.compareTargetId : state.compareBaseId;
    if (event.target.value !== other && readableVersions().some((version) => version.id === event.target.value)) {
      state[isBase ? 'compareBaseId' : 'compareTargetId'] = event.target.value;
    }
    renderView('compare');
    return;
  }
  if (event.target.id === 'endingMode') {
    captureEditorValues();
    state.form.endingMode = event.target.value;
    persistDraft();
    renderView('editor');
    return;
  }
  if (event.target.id === 'taskModelSelection') {
    captureEditorValues();
    const [providerId, writerModelId] = event.target.value.split('|');
    rememberModelSelection({ ...state.modelSelection, provider_id: providerId,
      writer_provider_id: providerId, writer_model_id: writerModelId });
    persistDraft();
    if (state.view === 'editor' || state.view === 'failure') renderView('editor');
    return;
  }
  if (event.target.id === 'taskValidatorSelection') {
    captureEditorValues();
    const [providerId, validatorModelId] = event.target.value.split('|');
    rememberModelSelection({ ...state.modelSelection,
      validator_provider_id: providerId, validator_model_id: validatorModelId });
    persistDraft();
    if (state.view === 'editor' || state.view === 'failure') renderView('editor');
    return;
  }
  if (event.target.id === 'providerPresetSetting') {
    updateProviderSettingsOptions();
    return;
  }
  if (event.target.id !== 'importDocumentInput') return;
  const file = event.target.files?.[0];
  event.target.value = '';
  importDocument(file).catch((error) => toast(error.message));
});

document.addEventListener('select', (event) => {
  if (event.target.id === 'bodyEditor') watchTextSelection();
});

document.addEventListener('toggle', (event) => {
  const { memoryGroup, memoryCandidate } = event.target.dataset || {};
  if (memoryGroup === undefined || !memoryCandidate || !event.target.isConnected) return;
  (state.memoryDisclosureState[memoryCandidate] ||= {})[memoryGroup] = event.target.open;
}, true);

let selectionFrame = 0;
function updateSelectionPosition() {
  cancelAnimationFrame(selectionFrame);
  selectionFrame = requestAnimationFrame(watchTextSelection);
}
document.addEventListener('scroll', updateSelectionPosition, true);
window.addEventListener('resize', updateSelectionPosition);
window.visualViewport?.addEventListener('resize', updateSelectionPosition);
window.visualViewport?.addEventListener('scroll', updateSelectionPosition);
document.addEventListener('keyup', (event) => {
  if (event.target.id === 'bodyEditor') watchTextSelection();
});
document.addEventListener('mouseup', (event) => {
  if (event.target.id === 'bodyEditor') watchTextSelection();
});
document.addEventListener('touchend', (event) => {
  if (event.target.id === 'bodyEditor') setTimeout(watchTextSelection, 0);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeOverlay();
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generate();
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveCurrent();
  }
});
document.addEventListener('focusin', (event) => {
  if (window.innerWidth <= 720 && event.target.matches('textarea, input')) document.body.classList.add('keyboard-open');
});
document.addEventListener('focusout', () => {
  setTimeout(() => {
    if (!document.activeElement?.matches('textarea, input') && (!window.visualViewport || window.innerHeight - window.visualViewport.height < 120)) {
      document.body.classList.remove('keyboard-open');
    }
  }, 80);
});
$('#scrim').addEventListener('click', closeOverlay);
window.visualViewport?.addEventListener('resize', updateVisualViewport);
window.visualViewport?.addEventListener('scroll', updateVisualViewport);
window.addEventListener('beforeunload', persistDraft);
updateVisualViewport();

bootstrap();
