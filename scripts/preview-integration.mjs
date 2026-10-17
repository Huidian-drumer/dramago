import { createServer } from 'node:http';
import worker from '../dist/server/index.js';
import { FakeD1 } from '../audit/fake-d1.mjs';

const port = Number(process.argv[2] || 4181);
const db = new FakeD1();
const originalFetch = globalThis.fetch;

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

const blockedValidation = {
  ...passValidation,
  findings: [{
    finding_type: 'EXPLICIT_HARD_CONSTRAINT_VIOLATION',
    severity: 'blocking',
    confidence: 0.98,
    source_priority: 'explicit_user_hard_constraint',
    evidence: ['“父亲迎面走来”'],
    reason: '候选直接违反了用户明确要求保留的人物死亡事实。'
  }],
  blocking_conflicts: [{ code: 'STORY_FACT_CONFLICT', message: '已死亡人物重新出现。', evidence: '父亲迎面走来' }],
  required_outcomes_met: false,
  preserve_status: { hard_met: false, soft_met: true, notes: ['明确事实冲突'] },
  operation_completed: false
};

function providerPayload(result, model) {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(result) } }],
    model,
    usage: { prompt_tokens: 120, completion_tokens: 180, total_tokens: 300 }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function writerResult(prompt) {
  if (prompt.includes('QA_LONG')) {
    const paragraphs = Array.from({ length: 48 }, (_, index) => {
      const scene = index + 1;
      return `第${scene}段。林晚沿着酒店长廊往前走，窗外的城市灯光一盏盏亮起来。她没有急着解释，只把刚才确认的事实、接下来要做的选择，以及必须由自己承担的后果逐一记在心里。`; 
    });
    return {
      output_kind: 'full',
      title: '长夜之后',
      content: paragraphs.join('\n\n'),
      change_summary: '生成用于长文本滚动与移动端安全区域检查的隔离候选',
      model_warnings: []
    };
  }
  if (prompt.includes('QA_BLOCK')) {
    return {
      output_kind: 'full',
      title: '阻断测试候选',
      content: '酒店大堂的灯光落在地面上。林晚正准备扩写环境，已经去世五年的父亲却迎面走来，替她解决了所有问题。这个结果直接改变了原有事实。',
      change_summary: '生成包含明确事实冲突的测试候选',
      model_warnings: []
    };
  }
  if (/"type"\s*:\s*"selection"/u.test(prompt)) {
    return {
      output_kind: 'segment',
      title: '婚礼前夜',
      content: '门被推开时，苏晴没有马上进来。她扶着门框，先扫了一眼桌面，才把视线落到林晚脸上。林晚仍在整理袖口，只从镜子里问：“司仪还说了什么？”苏晴把头纱展开，拇指反复压着同一道折痕：“没什么，只是大家都在等。”两个人都没有再看那部手机。',
      change_summary: '只扩写或改写绑定选区',
      model_warnings: []
    };
  }
  if (/"operation"\s*:\s*"CONTINUE"/u.test(prompt)) {
    return {
      output_kind: 'continuation',
      title: '婚礼之后',
      content: '第二天清晨，林晚关掉手机上的祝福消息。母亲把昨晚没来得及收走的喜糖放进纸箱，两个人第一次安静谈起婚礼取消后的生活。陈浩打来电话，她没有接，只回了一句：等彼此都能面对事实以后再谈。',
      change_summary: '在原文后追加下一阶段',
      model_warnings: []
    };
  }
  const marker = prompt.includes('QA_VALIDATOR_FAIL') ? '【QA_VALIDATOR_FAIL】' : '';
  return {
    output_kind: 'full',
    title: '婚礼前夜',
    content: marker + '婚礼开始前四十分钟，林晚独自坐在酒店化妆间里。窗外的雨刚停，她把陈浩的手机放回桌面，位置与拿起之前分毫不差。\n\n门被推开时，苏晴先看了桌面一眼。林晚已经知道聊天记录里的内容，却只问她司仪还说了什么。苏晴不知道真相已经暴露，仍试图从林晚的语气里判断情况。\n\n林晚没有立即摊牌。她保存证据，决定等婚礼正式开始后再公开问题。她拿起头纱，对苏晴说：“告诉司仪，我会准时出现。”',
    change_summary: '生成完整候选正文',
    model_warnings: []
  };
}

globalThis.fetch = async (url, options = {}) => {
  if (!String(url).includes('provider.invalid')) return originalFetch(url, options);
  const request = JSON.parse(options.body || '{}');
  const prompt = request.messages?.map((message) => message.content).join('\n') || '';
  const isValidator = /独立语义校验|candidate_internal_consistency|blocking_conflicts/u.test(prompt);
  if (prompt.includes('QA_PROVIDER_FAIL')) return new Response('controlled failure', { status: 500 });
  if (isValidator && prompt.includes('QA_VALIDATOR_FAIL')) return new Response('controlled validator failure', { status: 500 });
  if (prompt.includes('QA_SLOW')) await new Promise((resolve) => setTimeout(resolve, 900));
  if (isValidator) return providerPayload(prompt.includes('QA_BLOCK') ? blockedValidation : passValidation, 'ui-v2-qa-validator');
  return providerPayload(writerResult(prompt), 'ui-v2-qa-writer');
};

const env = {
  DB: db,
  OPENAI_API_KEY: 'local-qa-secret-not-production',
  OPENAI_MODEL: 'ui-v2-qa-writer',
  VALIDATOR_MODEL: 'ui-v2-qa-validator',
  OPENAI_ENDPOINT: 'https://provider.invalid/chat/completions',
  PROVIDER_TIMEOUT_MS: '5000'
};

async function nodeRequestToWeb(request) {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? undefined
    : Buffer.concat(await Array.fromAsync(request)).toString('utf8');
  return new Request(`http://127.0.0.1:${port}${request.url}`, {
    method: request.method,
    headers: request.headers,
    body
  });
}

const server = createServer(async (request, response) => {
  try {
    const result = await worker.fetch(await nodeRequestToWeb(request), env);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'LOCAL_PREVIEW_FAILURE', message: error.message } }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DramaGo isolated integration preview ready at http://127.0.0.1:${port}`);
  console.log('Uses in-memory D1 and an explicitly controlled QA provider. No production data or provider is used.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

