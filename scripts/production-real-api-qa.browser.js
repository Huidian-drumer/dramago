(async () => {
  const workId = `work_ui_v21_real_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const qa = {
    workId,
    current: null,
    results: [],
    async request(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.headers || {}) }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error?.message || `HTTP ${response.status}`);
        error.code = payload.error?.code || 'REQUEST_FAILED';
        error.http = response.status;
        error.payload = payload;
        throw error;
      }
      return { response, payload };
    },
    async sourceHash(version) {
      if (!version) return null;
      const bytes = new TextEncoder().encode(`${version.title}\n${version.content}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
    },
    selectionScope(version) {
      const content = version.content;
      const paragraph = content.split(/\n\s*\n/u).find((item) => item.trim().length >= 24) || content;
      const sentence = paragraph.match(/^.{18,80}?[。！？]/u)?.[0] || paragraph.slice(0, Math.min(60, paragraph.length));
      const start = content.indexOf(sentence);
      return { type: 'selection', start, end: start + sentence.length, selected_text: sentence };
    },
    async run(operation) {
      const startedAt = performance.now();
      const source = operation === 'CREATE' ? null : this.current;
      const instructions = {
        CREATE: '生成一篇约500字的第二人称短剧：你在婚礼前发现重要信息，但先通过观察与对话确认事实，最后主动暂停婚礼。情节完整，不追加神秘悬念。',
        EXPAND: '只扩写选中的片段，增加具体动作、对话和信息差，不改变选区外事实。',
        REWRITE: '只改写选中的片段，让人物动作更克制、更具体，保持既有事实和事件结果。',
        CONTINUE: '从第二天开始续写约250字，承接婚礼暂停的后果，不复述前文，不让人物立刻复合。'
      };
      const targetScope = ['EXPAND', 'REWRITE'].includes(operation)
        ? this.selectionScope(source)
        : { type: operation === 'CONTINUE' ? 'next_segment' : 'full' };
      const brief = {
        operation,
        source_version_id: source?.id || null,
        target_scope: targetScope,
        user_instruction: instructions[operation],
        hard_preserve: operation === 'CREATE' ? [] : ['既有主要事实与人物关系'],
        soft_preserve: [],
        required_outcomes: operation === 'CONTINUE' ? ['故事从第二天开始'] : [],
        freedom: '只补充完成本次操作所需的动作、对白与衔接。',
        output_preferences: {
          target_length: operation === 'CREATE' ? 500 : operation === 'CONTINUE' ? 250 : 160,
          person: '第二人称',
          tone: '克制、有张力',
          series_opening: false
        }
      };
      const record = { operation, started_at: new Date().toISOString(), target_scope: targetScope.type };
      try {
        const created = (await this.request('/api/generate', {
          method: 'POST',
          body: JSON.stringify({ work_id: this.workId, context: '现代都市，人物均为成年人。', brief, source_hash: await this.sourceHash(source) })
        })).payload;
        record.task_id = created.task.id;
        record.work_id = created.work_id;
        const written = (await this.request(`/api/tasks/${encodeURIComponent(created.task.id)}/write`, { method: 'POST', body: '{}' })).payload;
        record.candidate_version_id = written.candidate?.id || null;
        record.writer_model = written.task?.model_name || written.candidate?.model_name || null;
        record.output_kind = written.task?.output_kind || null;
        record.writer_usage = written.task?.usage || written.candidate?.usage || null;
        record.candidate_chars = written.candidate?.content?.length || 0;
        const validated = (await this.request(`/api/tasks/${encodeURIComponent(created.task.id)}/validate`, { method: 'POST', body: '{}' })).payload;
        record.validator_model = validated.task?.validator_model_name || null;
        record.validation_status = validated.task?.validation_status || validated.candidate?.validation_status || null;
        record.can_auto_apply = Boolean(validated.can_auto_apply);
        record.source_is_current = validated.source_is_current;
        record.blocking_count = (validated.candidate?.checks || []).filter((item) => item.status === 'fail').length;
        record.warning_count = (validated.candidate?.checks || []).filter((item) => item.status === 'warning').length;
        if (validated.can_auto_apply) {
          const adopted = (await this.request('/api/versions/adopt', {
            method: 'POST',
            body: JSON.stringify({ work_id: this.workId, version_id: validated.candidate.id })
          })).payload;
          this.current = adopted.version;
          record.adopted = true;
          record.current_version_id = adopted.version.id;
        } else {
          record.adopted = false;
        }
      } catch (error) {
        record.error = { code: error.code || 'UNKNOWN', http: error.http || null, message: error.message };
      }
      record.duration_ms = Math.round(performance.now() - startedAt);
      this.results.push(record);
      return record;
    }
  };
  window.__dramagoUiV21RealQa = qa;
  return { ready: true, work_id: workId };
})()
