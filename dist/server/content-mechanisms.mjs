const CURATED_SOURCE = 'manual-curation:CONTENT_INTELLIGENCE_V0.1';

export const CONTENT_MECHANISMS_V01 = Object.freeze([
  {
    id: 'audience_leads_information_gap',
    description: '让观众先知道关键底牌，而故事中的部分人物稍后才知道，以形成持续的信息差期待。',
    applicable_when: '作者明确要求隐藏身份、隐藏资源、秘密计划，或希望观众先于剧中人物掌握关键信息。',
    avoid: '不要让所有故事都变成隐藏身份；不要让知情角色无理由装傻，也不要用集体震惊代替实际剧情结果。',
    source_reference_id: `${CURATED_SOURCE}:audience_leads_information_gap`
  },
  {
    id: 'delayed_reveal_with_reason',
    description: '主角延后公开底牌时，为延后行为建立清楚且与目标相关的理由。',
    applicable_when: '故事需要延迟身份、证据、能力或计划的公开，而且延迟本身会影响冲突推进。',
    avoid: '不要只为拖时长而隐瞒；理由不能依赖角色突然失去常识或反复错过自然说明机会。',
    source_reference_id: `${CURATED_SOURCE}:delayed_reveal_with_reason`
  },
  {
    id: 'conflict_creates_payoff_opportunity',
    description: '让前段冲突直接制造后续兑现能力、身份或选择的机会，使解决方式来自同一条因果链。',
    applicable_when: '作者已给出核心冲突，但身份、能力或资源如何自然进入高潮尚未明确。',
    avoid: '不要临时添加无关危机、外援或巧合，只为给主角安排展示机会。',
    source_reference_id: `${CURATED_SOURCE}:conflict_creates_payoff_opportunity`
  },
  {
    id: 'observable_status_change',
    description: '通过称呼、站位、回应速度、资源分配和具体选择等可观察行为表现人物态度或地位变化。',
    applicable_when: '故事关注关系冷暖、身份落差、地位变化，或作者要求写出身边人态度的改变。',
    avoid: '不要只用旁白宣布“大家态度变了”；不要把所有配角写成同时翻脸或同时道歉。',
    source_reference_id: `${CURATED_SOURCE}:observable_status_change`
  },
  {
    id: 'promise_payoff',
    description: '把开头建立的重要身份、资源、能力或目标承诺，在后文转化为可观察的结果。',
    applicable_when: '开头对身份、能力、资源、关系或结果作出明确承诺，读者会等待后续兑现。',
    avoid: '不要只重复设定或用台词承认承诺；兑现必须改变事件、关系、选择或结局。',
    source_reference_id: `${CURATED_SOURCE}:promise_payoff`
  },
  {
    id: 'emotional_anchor_callback',
    description: '让前期建立的人物、物件、话语或承诺，在后期承担情感回收作用。',
    applicable_when: '故事存在家庭、关系、失去、守护或成长主题，并已有可回收的具体锚点。',
    avoid: '不要硬塞象征物；回收不能取代关键行动，也不要靠重复原句强行煽情。',
    source_reference_id: `${CURATED_SOURCE}:emotional_anchor_callback`
  },
  {
    id: 'growth_compounding',
    description: '让能力、判断、关系或责任感通过多个阶段积累，后期结果来自前期积累而非突然成功。',
    applicable_when: '作者要求长期成长、身份跌落后的承担，或阶段性改变而非即时逆袭。',
    avoid: '不要写成逐日流水账；不要用一次顿悟、偶遇贵人或突然暴富替代成长过程。',
    source_reference_id: `${CURATED_SOURCE}:growth_compounding`
  },
  {
    id: 'autonomy_payoff',
    description: '把最终奖励落在主角重新获得选择权、拒绝权或承担后果的主动权，而不必等同于财富或职位。',
    applicable_when: '故事核心是摆脱控制、承担责任、确认价值或在获得认可后作出自己的选择。',
    avoid: '不要把离开、拒绝或独立自动写成胜利；选择必须由前文经历支持，并承担真实代价。',
    source_reference_id: `${CURATED_SOURCE}:autonomy_payoff`
  }
]);

const mechanismById = new Map(CONTENT_MECHANISMS_V01.map((mechanism) => [mechanism.id, mechanism]));

export function resolveContentMechanisms(ids) {
  if (!Array.isArray(ids)) return [];
  const selected = [];
  const seen = new Set();
  for (const value of ids) {
    const id = String(value || '').trim();
    if (!id || seen.has(id) || !mechanismById.has(id)) continue;
    selected.push(mechanismById.get(id));
    seen.add(id);
    if (selected.length >= 5) break;
  }
  return selected;
}

export function mechanismCatalogForPlanning() {
  return CONTENT_MECHANISMS_V01.map(({ id, description, applicable_when, avoid }) => ({
    id,
    description,
    applicable_when,
    avoid
  }));
}

export function mechanismsForWriter(mechanisms) {
  return (mechanisms || []).map(({ id, description, applicable_when, avoid }) => ({
    id,
    description,
    applicable_when,
    avoid
  }));
}
