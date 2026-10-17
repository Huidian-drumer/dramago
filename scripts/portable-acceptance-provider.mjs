import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureLocalDirectories, localPaths } from '../local/paths.mjs';
import {
  defaultProviderConfiguration,
  WindowsDpapiProviderSecretStore,
  writeProviderConfiguration
} from '../local/secure-config.mjs';

const dataRoot = process.env.DRAMAGO_ACCEPTANCE_DATA_DIR;
const statusFile = process.env.DRAMAGO_ACCEPTANCE_PROVIDER_STATUS;
if (!dataRoot || !statusFile) {
  throw new Error('DRAMAGO_ACCEPTANCE_DATA_DIR and DRAMAGO_ACCEPTANCE_PROVIDER_STATUS are required.');
}

const status = {
  started_at: new Date().toISOString(),
  pid: process.pid,
  listening: false,
  port: null,
  counts: { writer: 0, validator: 0, connection: 0, crash_unknown: 0 },
  calls: []
};

async function persistStatus() {
  await mkdir(path.dirname(statusFile), { recursive: true });
  await writeFile(statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

const passValidation = {
  findings: [],
  blocking_conflicts: [],
  warnings: [],
  required_outcomes_met: true,
  preserve_status: { hard_met: true, soft_met: true, notes: [] },
  promise_payoff_status: { met: true, missing_payoffs: [], notes: [] },
  negative_constraint_status: { met: true, severity: 'pass', violations: [] },
  candidate_internal_consistency: { consistent: true, conflicts: [] },
  operation_completed: true,
  source_story_facts: { characters: [], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] },
  candidate_story_facts: { characters: ['林晚'], relationships: [], irreversible_facts: [], major_events: [], time_anchors: [] }
};

function openAiResponse(content, model) {
  return JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
    model,
    usage: { prompt_tokens: 96, completion_tokens: 144, total_tokens: 240 }
  });
}

function sendJson(response, content, model) {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(openAiResponse(content, model));
}

const provider = createServer(async (request, response) => {
  const receivedAt = new Date().toISOString();
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const prompt = (payload.messages || []).map((message) => message.content).join('\n');
  const isValidator = /candidate_internal_consistency|blocking_conflicts|独立语义校验/u.test(prompt);
  const isWriter = /output_kind|CreativeBrief|target_scope/u.test(prompt) && !isValidator;
  const call = {
    sequence: status.calls.length + 1,
    received_at: receivedAt,
    kind: isValidator ? 'validator' : isWriter ? 'writer' : 'connection',
    model: String(payload.model || ''),
    crash_unknown: prompt.includes('QA_CRASH_UNKNOWN'),
    response_finished: false
  };
  status.calls.push(call);

  if (!isWriter && !isValidator) {
    status.counts.connection += 1;
    sendJson(response, { ok: true }, payload.model || 'deepseek-v4-pro');
    call.response_finished = true;
    await persistStatus();
    return;
  }

  if (isValidator) {
    status.counts.validator += 1;
    sendJson(response, passValidation, 'deepseek-flash');
    call.response_finished = true;
    await persistStatus();
    return;
  }

  status.counts.writer += 1;
  if (call.crash_unknown) {
    status.counts.crash_unknown += 1;
    await persistStatus();
    await new Promise((resolve) => setTimeout(resolve, 120000));
  }

  let writer;
  if (/"type"\s*:\s*"selection"/u.test(prompt)) {
    const rewrite = /"operation"\s*:\s*"REWRITE"/u.test(prompt);
    writer = {
      output_kind: 'segment',
      title: '便携版验收短剧',
      content: rewrite
        ? '她把旧钥匙轻轻放在桌上，推到母亲面前。'
        : '她没有说话，只把窗帘拉开。晨光落在两个人之间，她才问：“你愿意把真相说完吗？”',
      change_summary: rewrite ? '只改写绑定选区' : '只扩写绑定选区',
      model_warnings: []
    };
  } else if (/"operation"\s*:\s*"CONTINUE"/u.test(prompt)) {
    writer = {
      output_kind: 'continuation',
      title: '便携版验收短剧',
      content: '第二天清晨，林晚打开店门，把昨夜没有寄出的信放在窗边。她没有复述过去，只决定先联系收信人。',
      change_summary: '追加下一阶段',
      model_warnings: []
    };
  } else {
    writer = {
      output_kind: 'full',
      title: '便携版验收短剧',
      content: '林晚在旧书店工作。她没有说话。\n\n她把旧钥匙放在桌上。母亲看着她，问：“你真的决定了吗？”\n\n林晚点头。她保留了信件，也保留了自己重新选择生活的权利。',
      change_summary: '生成完整短剧',
      model_warnings: []
    };
  }
  sendJson(response, writer, 'deepseek-v4-pro');
  call.response_finished = true;
  await persistStatus();
});

await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
status.listening = true;
status.port = provider.address().port;

const paths = localPaths(dataRoot);
await ensureLocalDirectories(paths);
await writeProviderConfiguration(paths.providerConfig, {
  ...defaultProviderConfiguration,
  provider_timeout_ms: 180000,
  providers: {
    ...defaultProviderConfiguration.providers,
    deepseek: { ...defaultProviderConfiguration.providers.deepseek, disclosure_confirmed_at: new Date().toISOString() }
  }
});
await new WindowsDpapiProviderSecretStore(paths.providerSecrets).set('deepseek', 'portable-acceptance-secret');
await persistStatus();

console.log(JSON.stringify({ ready: true, port: status.port, status_file: statusFile }));

async function shutdown(signal) {
  status.listening = false;
  status.stopped_at = new Date().toISOString();
  status.stop_signal = signal;
  await persistStatus();
  provider.close(() => process.exit(0));
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown(signal));

