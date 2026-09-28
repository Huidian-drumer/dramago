const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const DRAFT_KEY = 'dramaworld-creative-workbench-draft-v01';
const operationLabels = { CREATE: '生成', EXPAND: '扩写', REWRITE: '改写', CONTINUE: '续写', MANUAL_EDIT: '手动保存' };
const actionLabels = { CREATE: '生成完整短剧', EXPAND: '丰富现有内容', REWRITE: '定向改写', CONTINUE: '续写下一段 / 集' };

const state = {
  operation: 'CREATE', work: null, currentVersion: null, versions: [], candidate: null,
  selection: null, dirty: false, busy: false, editorRevision: 0, toastTimer: null
};

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

function setStatus(kind, title, message) {
  $('#statusDot').className = `status-dot ${kind}`;
  $('#statusTitle').textContent = title;
  $('#statusMessage').textContent = message;
}

function persistLocalDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    context: $('#contextInput').value,
    instruction: $('#instructionInput').value,
    preserve: $('#preserveInput').value,
    length: $('#lengthInput').value,
    person: $('#personInput').value,
    tone: $('#toneInput').value,
    seriesOpening: $('#seriesOpeningInput').checked,
    title: $('#titleEditor').value,
    body: $('#bodyEditor').value,
    operation: state.operation,
    dirty: state.dirty,
    basedOnVersionId: state.currentVersion?.id || null
  }));
}

function loadLocalDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
  if (!draft) return null;
  $('#contextInput').value = draft.context || '';
  $('#instructionInput').value = draft.instruction || '';
  $('#preserveInput').value = draft.preserve || '';
  $('#lengthInput').value = draft.length || '2000';
  $('#personInput').value = draft.person || '第二人称';
  $('#toneInput').value = draft.tone || '克制、有张力';
  $('#seriesOpeningInput').checked = Boolean(draft.seriesOpening);
  $('#titleEditor').value = draft.title || '未命名短剧';
  $('#bodyEditor').value = draft.body || '';
  if (operationLabels[draft.operation]) setOperation(draft.operation, { clearSelection: false });
  state.dirty = Boolean(draft.dirty);
  updateEditorMeta();
  return draft;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ error: { code: 'INVALID_RESPONSE', message: '服务返回了无法读取的结果。' } }));
  if (!response.ok) {
    const error = new Error(payload.error?.message || '请求失败');
    error.code = payload.error?.code || 'REQUEST_FAILED';
    error.details = payload.error?.details || {};
    throw error;
  }
  return payload;
}

async function hashDocument(title, body) {
  const bytes = new TextEncoder().encode(`${title}\n${body}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function setProvider(provider) {
  const pill = $('#providerPill');
  pill.classList.remove('checking', 'ready', 'missing');
  if (provider?.configured) {
    pill.classList.add('ready');
    pill.querySelector('span').textContent = provider.model ? `模型已连接 · ${provider.model}` : '模型已连接';
    pill.title = '文本模型由服务端安全调用';
  } else {
    pill.classList.add('missing');
    pill.querySelector('span').textContent = '模型等待配置';
    pill.title = `缺少：${provider?.missing?.join('、') || '服务端配置'}`;
  }
}

function setOperation(operation, { clearSelection = true } = {}) {
  state.operation = operation;
  $$('.operation').forEach((button) => {
    const active = button.dataset.operation === operation;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#generateLabel').textContent = actionLabels[operation];
  const placeholders = {
    CREATE: '写清楚希望发生什么、人物怎么选择、结尾去向。要求足够时会直接创作。',
    EXPAND: '说明要丰富的过程、对白或情绪；默认保留事件结果与结局。',
    REWRITE: '明确要改变的事件、人物立场、表达或结局。新指令优先于旧设定。',
    CONTINUE: '说明从何时开始、承接哪些后果，以及后续不要发生什么。'
  };
  $('#instructionInput').placeholder = placeholders[operation];
  if (clearSelection && !['EXPAND', 'REWRITE'].includes(operation)) clearBoundSelection();
  persistLocalDraft();
}

function updateEditorMeta() {
  const count = [...$('#bodyEditor').value.replace(/\s/gu, '')].length;
  $('#characterCount').textContent = `${count} 字`;
  $('#saveState').textContent = state.dirty ? '有未保存修改' : state.currentVersion ? '已保存' : '输入会暂存在本机';
}

function markDirty() {
  if (state.selection) clearBoundSelection();
  state.dirty = true;
  state.editorRevision += 1;
  updateEditorMeta();
  persistLocalDraft();
}

function bindSelection(start, end, text) {
  if (!state.currentVersion) return;
  state.selection = { start, end, text, sourceVersionId: state.currentVersion.id };
  $('#selectionPreview').textContent = text;
  $('#selectionCard').hidden = false;
  $('#selectionToolbar').hidden = true;
  $('#formNote').textContent = '本次只替换绑定选区；选区外由程序保持原样。';
}

function clearBoundSelection() {
  state.selection = null;
  $('#selectionCard').hidden = true;
  $('#formNote').textContent = '结果先作为候选版本保存，不会直接覆盖当前正文。';
}

function watchTextSelection() {
  const editor = $('#bodyEditor');
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = end > start ? editor.value.slice(start, end) : '';
  $('#selectionToolbar').hidden = selected.trim().length < 2;
  $('#selectionCount').textContent = `已选 ${[...selected].length} 字`;
  $('#selectionToolbar').dataset.start = String(start);
  $('#selectionToolbar').dataset.end = String(end);
}

function renderVersions() {
  const list = $('#versionList');
  list.replaceChildren();
  $('#versionCount').textContent = `${state.versions.length} 个版本`;
  if (!state.versions.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '采用或手动保存后，可在这里恢复任一版本。';
    list.append(empty);
    return;
  }
  state.versions.forEach((version, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `version-item ${version.id === state.currentVersion?.id ? 'current' : ''}`;
    const number = document.createElement('span');
    number.className = 'version-number';
    number.textContent = `V${state.versions.length - index}`;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = version.title;
    const meta = document.createElement('small');
    meta.textContent = `${operationLabels[version.operation] || version.operation} · ${new Date(version.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    copy.append(title, meta);
    const status = document.createElement('em');
    status.textContent = version.id === state.currentVersion?.id ? '当前' : version.status === 'candidate' ? '候选' : '历史';
    button.append(number, copy, status);
    button.addEventListener('click', () => {
      if (version.id === state.currentVersion?.id) {
        loadVersionIntoEditor(version);
        toast('已回到当前采用版本');
      } else {
        showCandidate(version, { historical: true });
      }
    });
    list.append(button);
  });
}

function loadVersionIntoEditor(version) {
  state.currentVersion = version;
  $('#titleEditor').value = version?.title || '未命名短剧';
  $('#bodyEditor').value = version?.content || '';
  state.dirty = false;
  state.editorRevision += 1;
  $('#versionLabel').textContent = version ? `当前版本 · ${operationLabels[version.operation] || version.operation}` : '尚未建立版本';
  clearBoundSelection();
  updateEditorMeta();
  persistLocalDraft();
}

function renderChecks(checks = []) {
  const list = $('#checkList');
  list.replaceChildren();
  if (!checks.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '当前没有可显示的检查记录。';
    list.append(empty);
    $('#checkSummary').textContent = '未评估';
    return;
  }
  const warnings = checks.filter((item) => ['warning', 'fail', 'unavailable'].includes(item.status)).length;
  $('#checkSummary').textContent = warnings ? `${warnings} 项需留意，草稿仍可查看` : '规则未发现执行问题 · 待人工验收';
  checks.forEach((check) => {
    const item = document.createElement('div');
    item.className = `check-item ${check.status}`;
    const dot = document.createElement('i');
    const text = document.createElement('span');
    const label = check.finding_type === 'deterministic' ? '确定性' : check.finding_type === 'semantic_validator' ? '独立语义校验' : check.finding_type === 'model_judgment' ? '模型判断' : '人工待验收';
    text.textContent = `${label} · ${check.message}`;
    item.append(dot, text);
    list.append(item);
  });
}

function showCandidate(version, { stale = false, historical = false, canApply = true } = {}) {
  state.candidate = version;
  $('#resultEmpty').hidden = true;
  $('#candidatePanel').hidden = false;
  $('#candidateState').textContent = stale ? '基于旧版本' : historical ? '历史版本' : '已保存候选';
  $('#candidateOperation').textContent = operationLabels[version.operation] || version.operation;
  $('#candidateModel').textContent = version.model_name ? `模型 ${version.model_name}` : version.operation === 'MANUAL_EDIT' ? '作者编辑' : '模型未知';
  $('#candidateTitle').textContent = version.title;
  $('#changeSummary').textContent = stale
    ? '生成期间当前正文已被编辑。该候选已保留，但不会覆盖较新的编辑；请恢复源版本后重新应用或重新生成。'
    : version.change_summary || '候选版本已保存，采用前可先阅读全文。';
  $('#candidateBody').value = version.generated_segment && version.operation === 'CONTINUE' ? version.generated_segment : version.content;
  const scope = version.creative_brief?.target_scope;
  if (scope?.type === 'selection') {
    $('#diffView').hidden = false;
    $('#beforeText').textContent = scope.selected_text || '';
    $('#afterText').textContent = version.generated_segment || '';
  } else {
    $('#diffView').hidden = true;
  }
  const blocked = version.checks?.some((item) => item.status === 'fail');
  const readOnlyHistory = historical && version.status !== 'candidate';
  $('#adoptCandidate').disabled = stale || blocked || !canApply || readOnlyHistory || version.id === state.currentVersion?.id;
  $('#adoptCandidate').textContent = version.id === state.currentVersion?.id ? '当前已采用' : readOnlyHistory ? '历史版本仅查看' : '采用此版本';
  renderChecks(version.checks || []);
}

async function bootstrap(localDraft) {
  try {
    const payload = await api('/api/bootstrap');
    setProvider(payload.provider);
    state.work = payload.work;
    state.versions = payload.versions || [];
    state.currentVersion = payload.current_version;
    const keepLocal = localDraft?.dirty && localDraft.basedOnVersionId === state.currentVersion?.id;
    if (!keepLocal && state.currentVersion) loadVersionIntoEditor(state.currentVersion);
    else {
      $('#versionLabel').textContent = state.currentVersion ? '当前版本 · 含本机未保存修改' : '尚未建立版本';
      updateEditorMeta();
    }
    renderVersions();
    setStatus('idle', '准备就绪', payload.provider?.configured ? '模型与版本存储可用。' : '版本存储可用；模型等待服务端安全配置。');
  } catch (error) {
    setProvider({ configured: false, missing: ['服务端配置'] });
    setStatus('error', '工作台离线', `${error.message} 输入仍会暂存在本机。`);
  }
}

async function saveCurrent({ quiet = false } = {}) {
  const content = $('#bodyEditor').value;
  if (!content.trim()) {
    if (!quiet) toast('请先输入或粘贴正文');
    return null;
  }
  setStatus('working', '正在保存', '正在创建可恢复版本。');
  try {
    const payload = await api('/api/versions/save', {
      method: 'POST',
      body: JSON.stringify({
        work_id: state.work?.id || null,
        source_version_id: state.currentVersion?.id || null,
        title: $('#titleEditor').value.trim() || '未命名短剧',
        content
      })
    });
    state.work = { ...(state.work || {}), id: payload.work_id, current_version_id: payload.version.id, title: payload.version.title };
    state.versions = [payload.version, ...state.versions.filter((item) => item.id !== payload.version.id)];
    loadVersionIntoEditor(payload.version);
    renderVersions();
    setStatus('success', '已保存', '当前正文已成为可恢复版本。');
    if (!quiet) toast('版本已保存');
    return payload.version;
  } catch (error) {
    setStatus('error', '保存失败', `${error.message} 本机输入未清除。`);
    if (!quiet) toast(error.message);
    return null;
  }
}

async function ensureSaved() {
  if (!$('#bodyEditor').value.trim()) return null;
  if (!state.currentVersion || state.dirty) return saveCurrent({ quiet: true });
  return state.currentVersion;
}

function buildBrief(sourceVersion) {
  const targetScope = state.selection && ['EXPAND', 'REWRITE'].includes(state.operation)
    ? { type: 'selection', start: state.selection.start, end: state.selection.end, selected_text: state.selection.text }
    : { type: state.operation === 'CONTINUE' ? 'next_segment' : 'full' };
  return {
    operation: state.operation,
    source_version_id: sourceVersion?.id || null,
    target_scope: targetScope,
    user_instruction: $('#instructionInput').value.trim(),
    hard_preserve: $('#preserveInput').value,
    soft_preserve: [],
    freedom: '可补充必要人物、矛盾、动机、对白与前后衔接；作者未授权的范围保持原样。',
    output_preferences: {
      target_length: Number($('#lengthInput').value),
      person: $('#personInput').value,
      tone: $('#toneInput').value.trim(),
      series_opening: $('#seriesOpeningInput').checked
    }
  };
}

async function generate() {
  if (state.busy) return;
  const instruction = $('#instructionInput').value.trim();
  if (!instruction) {
    $('#instructionInput').focus();
    toast('请先填写本次创作要求');
    return;
  }
  let sourceVersion = state.currentVersion;
  if ($('#bodyEditor').value.trim() && (state.operation !== 'CREATE' || state.dirty)) {
    sourceVersion = await ensureSaved();
    if (!sourceVersion) return;
  }
  if (state.operation !== 'CREATE' && !sourceVersion) {
    toast('扩写、改写或续写前，请先粘贴并保存一份正文');
    return;
  }
  if (state.selection && state.selection.sourceVersionId !== sourceVersion?.id) {
    clearBoundSelection();
    toast('正文版本已变化，请重新选择目标段落');
    return;
  }

  state.busy = true;
  $('#generateButton').disabled = true;
  const brief = buildBrief(sourceVersion);
  const sourceHash = sourceVersion ? await hashDocument(sourceVersion.title, sourceVersion.content) : null;
  const requestSnapshot = { revision: state.editorRevision, sourceVersionId: sourceVersion?.id || null };
  setStatus('working', '正在理解要求', '已整理本次操作、目标范围与必须保留内容。');
  $('#candidateState').textContent = '理解要求';
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    setStatus('working', '正在生成', '文本模型正在创作；当前正文与已采用版本不会被覆盖。');
    $('#candidateState').textContent = '模型生成中';
    const payload = await api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        work_id: state.work?.id || null,
        context: $('#contextInput').value,
        brief,
        source_hash: sourceHash
      })
    });
    state.work = { ...(state.work || {}), id: payload.work_id };
    state.versions = [payload.candidate, ...state.versions.filter((item) => item.id !== payload.candidate.id)];
    const stale = requestSnapshot.revision !== state.editorRevision || requestSnapshot.sourceVersionId !== state.currentVersion?.id || payload.source_is_current === false;
    showCandidate(payload.candidate, { stale, canApply: payload.can_auto_apply });
    renderVersions();
    setStatus(stale ? 'error' : 'success', stale ? '候选基于旧版本' : '候选已保存', stale
      ? '生成期间正文发生编辑，结果不会自动覆盖新内容。'
      : `模型 ${payload.task.model || '未知'} · 用量${payload.task.usage ? '已记录' : '未知'} · 成本未知`);
    toast(stale ? '候选已保留，请重新应用或生成' : '候选版本已生成');
  } catch (error) {
    $('#candidateState').textContent = '生成失败';
    if (error.code === 'PROVIDER_NOT_CONFIGURED') setProvider({ configured: false, missing: error.details?.missing || ['OPENAI_API_KEY', 'OPENAI_MODEL'] });
    setStatus('error', error.code || '生成失败', `${error.message} 已输入内容与源稿均未修改。`);
    toast(error.message);
  } finally {
    state.busy = false;
    $('#generateButton').disabled = false;
    persistLocalDraft();
  }
}

async function adoptCandidate() {
  if (!state.candidate || $('#adoptCandidate').disabled) return;
  setStatus('working', '正在采用', '正在更新当前版本，原版本会继续保留。');
  try {
    const payload = await api('/api/versions/adopt', {
      method: 'POST', body: JSON.stringify({ work_id: state.candidate.work_id, version_id: state.candidate.id })
    });
    state.work = { ...(state.work || {}), id: payload.work_id, current_version_id: payload.version.id, title: payload.version.title };
    state.versions = state.versions.map((item) => item.id === payload.version.id ? payload.version : item);
    loadVersionIntoEditor(payload.version);
    renderVersions();
    showCandidate(payload.version);
    setStatus('success', '新版本已采用', '修改前版本仍在版本记录中，可随时恢复。');
    toast('已采用新版本');
  } catch (error) {
    setStatus('error', '采用失败', error.message);
    toast(error.message);
  }
}

function closeCandidate() {
  state.candidate = null;
  $('#candidatePanel').hidden = true;
  $('#resultEmpty').hidden = false;
  $('#candidateState').textContent = '保留原版';
  renderChecks(state.currentVersion?.checks || []);
}

function download(format) {
  const title = $('#titleEditor').value.trim() || '未命名短剧';
  const body = $('#bodyEditor').value;
  if (!body.trim()) return toast('当前没有可导出的正文');
  const content = format === 'md' ? `# ${title}\n\n${body}\n` : `${title}\n\n${body}\n`;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${title.replace(/[\\/:*?"<>|]/g, '_')}.${format}`;
  link.click();
  URL.revokeObjectURL(link.href);
  $('#exportOptions').hidden = true;
}

$$('.operation').forEach((button) => button.addEventListener('click', () => setOperation(button.dataset.operation)));
['#contextInput', '#instructionInput', '#preserveInput', '#lengthInput', '#personInput', '#toneInput', '#seriesOpeningInput'].forEach((selector) => {
  $(selector).addEventListener('input', persistLocalDraft);
  $(selector).addEventListener('change', persistLocalDraft);
});
['#titleEditor', '#bodyEditor'].forEach((selector) => $(selector).addEventListener('input', markDirty));
$('#bodyEditor').addEventListener('select', watchTextSelection);
$('#bodyEditor').addEventListener('keyup', watchTextSelection);
$('#bodyEditor').addEventListener('mouseup', watchTextSelection);
$$('[data-selection-action]').forEach((button) => button.addEventListener('click', async () => {
  const editor = $('#bodyEditor');
  const start = Number($('#selectionToolbar').dataset.start);
  const end = Number($('#selectionToolbar').dataset.end);
  const text = editor.value.slice(start, end);
  const saved = await ensureSaved();
  if (!saved) return;
  setOperation(button.dataset.selectionAction, { clearSelection: false });
  bindSelection(start, end, text);
  $('#instructionInput').focus();
}));
$('#clearSelection').addEventListener('click', clearBoundSelection);
$('#generateButton').addEventListener('click', generate);
$('#saveButton').addEventListener('click', () => saveCurrent());
$('#adoptCandidate').addEventListener('click', adoptCandidate);
$('#keepOriginal').addEventListener('click', closeCandidate);
$('#copyButton').addEventListener('click', async () => {
  const text = `${$('#titleEditor').value}\n\n${$('#bodyEditor').value}`;
  if (!$('#bodyEditor').value.trim()) return toast('当前没有可复制的正文');
  await navigator.clipboard.writeText(text);
  toast('正文已复制');
});
$('#exportButton').addEventListener('click', () => {
  const options = $('#exportOptions');
  options.hidden = !options.hidden;
  $('#exportButton').setAttribute('aria-expanded', String(!options.hidden));
});
$$('[data-format]').forEach((button) => button.addEventListener('click', () => download(button.dataset.format)));
document.addEventListener('click', (event) => {
  if (!event.target.closest('.export-menu')) $('#exportOptions').hidden = true;
});

const localDraft = loadLocalDraft();
bootstrap(localDraft);
