(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const STORAGE_KEY = 'dramaworld-v02';
  const WEDDING_TIME = 15 * 3600;
  const at = (h, m, s = 0) => h * 3600 + m * 60 + s;
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const createInitialState = () => ({
    version: 2,
    time: at(14, 32),
    scene: 1,
    turn: 0,
    mode: '自由世界',
    player: '林晚',
    location: '云璟酒店 · 新娘化妆间',
    locationKey: 'makeup-room',
    locationAtmosphere: '宴会厅的钢琴声从门外隐约传来',
    narration: '你刚看见陈浩与苏晴的异常聊天记录。苏晴推门进来，若无其事地走到你身后，开始替你整理头纱。',
    speaker: '苏晴',
    dialogue: '“怎么了？脸色不太好。是不是昨晚没睡好？”',
    suMood: '若无其事',
    tension: 42,
    phase: '疑云',
    dramaticQuestion: '你能否在不暴露自己的情况下，判断苏晴是否在撒谎？',
    lowValueTurns: 0,
    flags: {
      suPresent: true,
      suSuspicious: false,
      leftRoom: false,
      evidenceExists: true,
      evidenceSecured: false,
      chenKnows: false,
      motherKnows: false,
      motherPresent: false,
      messageObserved: false,
      weddingActive: true
    },
    triggered: {},
    beats: { suspicion: 'active', investigation: 'eligible', confrontation: 'eligible', wedding: 'active' },
    consequences: [],
    events: [
      ['14:32', '你在陈浩手机上发现一段异常聊天记录。'],
      ['13:50', '你与伴娘苏晴抵达酒店化妆间。']
    ],
    worldLog: [['14:32', 'StoryWorld 开始运行。']]
  });

  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    state = saved?.version === 2 ? saved : createInitialState();
  } catch {
    state = createInitialState();
  }

  let busy = false;
  let lastInteractionAt = Date.now();
  let toastTimer;

  function fmtTime(total) {
    const normalized = ((total % 86400) + 86400) % 86400;
    const h = Math.floor(normalized / 3600);
    const m = Math.floor((normalized % 3600) / 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function weddingCountdown() {
    const seconds = WEDDING_TIME - state.time;
    if (seconds <= 0) return '婚礼原定时间已到';
    const minutes = Math.ceil(seconds / 60);
    return `婚礼还有 ${minutes} 分钟`;
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('#saveState').textContent = '世界已保存';
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
  }

  function setWorldPulse(message = '世界正在运行') {
    const text = $('#worldLive span');
    if (text) text.textContent = message;
  }

  function addObservedEvent(text, eventTime = state.time) {
    state.events.unshift([fmtTime(eventTime), text]);
    state.events = state.events.slice(0, 30);
  }

  function logWorld(text, eventTime = state.time) {
    state.worldLog.unshift([fmtTime(eventTime), text]);
    state.worldLog = state.worldLog.slice(0, 60);
  }

  function castMarkup() {
    const people = [];
    if (state.flags.suPresent && state.locationKey === 'makeup-room') {
      people.push({ initial: '晴', name: '苏晴', role: '伴娘 · 公司同事', mood: state.suMood });
    }
    if (state.flags.motherPresent && state.locationKey === 'makeup-room') {
      people.push({ initial: '母', name: '林母', role: '母亲 · 刚刚进入', mood: '催促婚礼' });
    }
    people.push({ initial: '晚', name: '林晚', role: '你 · 新娘', mood: state.tension > 68 ? '承受压力' : '保持克制' });
    return people.map(person => `<div class="person"><span class="avatar">${person.initial}</span><span><strong>${person.name}</strong><small>${person.role}</small></span><span class="mood">${person.mood}</span></div>`).join('');
  }

  function getThreads() {
    const threads = [];
    if (state.flags.weddingActive) threads.push({ text: '婚礼是否会照常开始？', hot: state.time >= at(14, 42) });
    if (!state.flags.leftRoom) threads.push({ text: '苏晴会不会暴露真正的关系？', hot: state.flags.suSuspicious });
    else threads.push({ text: '你离开以后，婚礼现场会如何应对？', hot: true });
    threads.push({ text: state.flags.evidenceSecured ? '已经保存的证据将被谁看见？' : '手机里的证据能否保留下来？', hot: !state.flags.evidenceSecured });
    if (!state.flags.motherKnows) threads.push({ text: '林母什么时候会察觉异常？', hot: false });
    return threads.slice(0, 4);
  }

  function noticeFacts() {
    const facts = [`${weddingCountdown()}，时间压力正在增加。`];
    if (state.locationKey === 'makeup-room' && state.flags.suPresent) facts.push(`苏晴现在${state.suMood}，她能看见你在房间里的动作。`);
    if (state.flags.messageObserved) facts.push('苏晴刚才迅速按灭了手机，她不希望你看清屏幕。');
    if (state.flags.evidenceSecured) facts.push('聊天记录截图已经保存在你的手机里。');
    else if (state.flags.evidenceExists) facts.push('原始聊天记录暂时仍在陈浩的手机里。');
    if (state.locationKey === 'corridor') facts.push('走廊通向宴会厅、电梯和停车场，你的离开已经被工作人员注意到。');
    return facts.slice(0, 4);
  }

  function renderTimeline() {
    $('#timeline').innerHTML = state.events.slice(0, 7).map(([time, text]) => `<div class="event"><span class="dot"></span><time>${esc(time)}</time><p>${esc(text)}</p></div>`).join('');
  }

  function render() {
    $('#worldTime').textContent = fmtTime(state.time);
    $('#locationName').textContent = state.location;
    $('#locationDetail').innerHTML = `<span class="countdown">${esc(weddingCountdown())}</span> · ${state.locationKey === 'makeup-room' ? '门外脚步声越来越频繁' : '宴会工作人员正在来回穿行'}`;
    $('#sceneCount').textContent = `第 ${String(state.scene).padStart(2, '0')} 幕`;
    $('#ambientText').textContent = state.locationAtmosphere;
    $('#narration').textContent = state.narration;
    $('#speakerName').textContent = state.speaker;
    $('#dialogueText').textContent = state.dialogue;
    $('#castList').innerHTML = castMarkup();
    $('#phaseLabel').textContent = state.phase;
    $('#dramaticQuestion').textContent = state.dramaticQuestion;
    $('#tensionBar').style.width = `${Math.max(8, Math.min(96, state.tension))}%`;
    $('#tensionLabel').textContent = state.tension < 38 ? '暂时平静' : state.tension < 60 ? '暗流涌动' : state.tension < 78 ? '明显紧绷' : '一触即发';
    $('#modePill').textContent = state.mode;
    $('#threadList').innerHTML = getThreads().map(thread => `<div class="thread${thread.hot ? ' hot' : ''}">${esc(thread.text)}</div>`).join('');
    $('#noticePanel').innerHTML = noticeFacts().map(fact => `<p>${esc(fact)}</p>`).join('');
    renderTimeline();
  }

  const worldEvents = [
    {
      id: 'chen-message', time: at(14, 33), importance: 'minor',
      apply(start, end) {
        logWorld('陈浩给苏晴发送消息，要求她确认林晚是否发现异常。', this.time);
        if (state.locationKey === 'makeup-room' && state.flags.suPresent) {
          state.flags.messageObserved = true;
          state.suMood = '迅速掩饰';
          state.tension += 8;
          return { importance: this.importance, text: '苏晴的手机突然亮了一下，屏幕上闪过一个备注为“C”的联系人。她几乎立刻按灭了屏幕。', speaker: '苏晴', dialogue: '“婚礼群的消息，没什么。”' };
        }
        return null;
      }
    },
    {
      id: 'mother-arrives', time: at(14, 38), importance: 'major',
      condition: () => state.locationKey === 'makeup-room' && state.flags.weddingActive,
      apply() {
        state.flags.motherPresent = true;
        state.tension += 12;
        state.dramaticQuestion = '你要在母亲面前继续隐瞒，还是让婚礼停下来？';
        state.phase = '压力上升';
        logWorld('林母来到化妆间催促林晚。', this.time);
        return { importance: this.importance, text: '门被推开。林母看了看时间，又看向你和苏晴，房间里来不及掩饰的沉默让她停了一下。', speaker: '林母', dialogue: '“晚晚，司仪在找你。你们这是怎么了？”' };
      },
      cancel() { logWorld('林母前往化妆间的事件因林晚离开而失效。', this.time); state.beats.investigation = 'invalidated'; }
    },
    {
      id: 'chen-deletes', time: at(14, 39), importance: 'hidden',
      apply() {
        if (!state.flags.evidenceSecured) state.flags.evidenceExists = false;
        logWorld('陈浩删除了自己手机中的部分聊天记录。', this.time);
        return null;
      }
    },
    {
      id: 'emcee-pressure', time: at(14, 42), importance: 'minor',
      apply() {
        state.tension += 7;
        logWorld('司仪开始催促婚礼核心人员到场。', this.time);
        return { importance: this.importance, text: '门外传来急促的脚步，工作人员隔着门提醒：婚礼流程只剩最后一次确认机会。', speaker: '工作人员', dialogue: '“林小姐，五分钟后必须去候场了。”' };
      }
    },
    {
      id: 'chen-arrives', time: at(14, 45), importance: 'major',
      condition: () => state.locationKey === 'makeup-room' && state.flags.weddingActive,
      apply() {
        state.tension += 16;
        state.phase = '正面交锋';
        state.dramaticQuestion = '陈浩走进房间后，谁会先暴露自己掌握的信息？';
        logWorld('陈浩来到化妆间试图控制局面。', this.time);
        return { importance: this.importance, text: '门再次打开。陈浩没有先看你，而是极快地扫了苏晴一眼。这个动作很短，却足够被你看见。', speaker: '陈浩', dialogue: '“都准备好了吗？外面在等我们。”' };
      }
    },
    {
      id: 'wedding-deadline', time: WEDDING_TIME, importance: 'major',
      condition: () => state.flags.weddingActive,
      apply() {
        state.tension = Math.max(state.tension, 84);
        state.phase = '重大决定';
        state.dramaticQuestion = '婚礼原定时间已到，你现在是否还会走进宴会厅？';
        logWorld('婚礼原定开始时间到达。', this.time);
        return { importance: this.importance, text: '宴会厅的音乐停了一瞬。原定的入场时间已经到了，所有人都在等待一个不会再自动延后的决定。', speaker: '司仪', dialogue: '“请新娘准备入场。”' };
      }
    }
  ];

  function simulateWorld(start, end) {
    const visible = [];
    for (const event of worldEvents) {
      if (state.triggered[event.id] || event.time <= start || event.time > end) continue;
      state.triggered[event.id] = true;
      if (event.condition && !event.condition()) {
        event.cancel?.();
        continue;
      }
      const presentation = event.apply(start, end);
      if (presentation) visible.push({ ...presentation, time: event.time });
    }

    const remaining = [];
    for (const consequence of state.consequences) {
      if (consequence.due > start && consequence.due <= end) {
        if (consequence.type === 'su-warns-chen') {
          state.flags.chenKnows = true;
          logWorld('苏晴提醒陈浩：林晚可能已经发现异常。', consequence.due);
        } else if (consequence.type === 'mother-hears') {
          state.flags.motherKnows = true;
          state.tension += 10;
          logWorld('林母从工作人员口中得知化妆间发生争执。', consequence.due);
          visible.push({ importance: 'major', time: consequence.due, text: '几分钟前的争执已经传了出去。林母推门进来，目光在你们之间来回停留。', speaker: '林母', dialogue: '“到底发生了什么？别再瞒着我。”' });
        }
      } else remaining.push(consequence);
    }
    state.consequences = remaining;

    if (state.lowValueTurns >= 2 && !state.triggered['dead-conversation-break']) {
      state.triggered['dead-conversation-break'] = true;
      state.tension += 6;
      visible.push({ importance: 'minor', time: end, text: '这段绕圈的谈话被门外的敲门声打断。婚礼统筹在催促你做最后确认。', speaker: '婚礼统筹', dialogue: '“林小姐，我们不能再等了。”' });
    }

    const majors = visible.filter(event => event.importance === 'major').slice(0, 1);
    const minors = visible.filter(event => event.importance !== 'major').slice(0, 2);
    return [...majors, ...minors].sort((a, b) => a.time - b.time);
  }

  function parseWaitDuration(input) {
    if (/婚礼开始|到婚礼/.test(input)) return Math.max(20, WEDDING_TIME - state.time);
    const arabic = input.match(/(\d+)\s*(分钟|分|秒)/);
    if (arabic) return Number(arabic[1]) * (arabic[2] === '秒' ? 1 : 60);
    const chinese = { '一': 1, '两': 2, '二': 2, '三': 3, '五': 5, '十': 10, '十五': 15, '二十': 20 };
    const hit = Object.entries(chinese).find(([word]) => input.includes(`${word}分钟`));
    return hit ? hit[1] * 60 : 300;
  }

  function resolvePlayerAction(input) {
    const clean = input.trim();
    const lower = clean.toLowerCase();
    const waitAction = /(等待|等一|等五|等十|什么也不做|不做任何事)/.test(clean);
    if (waitAction) {
      return { duration: parseWaitDuration(clean), narration: '你没有立刻介入。时间继续向前，而房间内外的人都在按照自己的目标行动。', speaker: '世界', dialogue: '没有人会因为你的沉默而停下来。', event: `你选择等待，让世界自行运行。`, isWait: true };
    }
    if (/(试探|昨晚|睡得|聊天)/.test(clean)) {
      state.flags.suSuspicious = true;
      state.suMood = '开始警惕';
      state.tension += 8;
      state.lowValueTurns = 0;
      return { duration: 80, narration: '你装作只是随口一问，把话题轻轻带到昨晚。苏晴整理头纱的手停了不到一秒。', speaker: '苏晴', dialogue: '“昨晚？我一直在确认婚礼流程啊。你怎么突然问这个？”', event: '你隐藏真实意图，间接试探苏晴昨晚的行程。' };
    }
    if (/(观察|表情|看着|反应)/.test(clean)) {
      state.lowValueTurns = 0;
      return { duration: 40, narration: '你没有急着说话，只在镜子里观察苏晴。她避开你的目光，随后若无其事地检查了一次手机。', speaker: '苏晴', dialogue: '“真的没事吗？你今天安静得有点反常。”', event: '你观察苏晴的反应，发现她在刻意回避目光。' };
    }
    if (/(截图|保存|证据|查看.*手机|陈浩.*手机)/.test(clean)) {
      state.flags.evidenceSecured = true;
      state.lowValueTurns = 0;
      return { duration: 35, narration: '你借着整理捧花的动作确认聊天记录，并把关键内容保存下来。原始记录是否会消失，已经不再决定证据是否存在。', speaker: '苏晴', dialogue: '“还在处理工作吗？”', event: '你保存了关键聊天记录，证据状态发生变化。' };
    }
    if (/(偷|抢|拿走).*手机/.test(clean)) {
      state.flags.suSuspicious = true;
      state.suMood = '强烈防备';
      state.tension += 16;
      state.consequences.push({ type: 'su-warns-chen', due: state.time + 120 });
      state.lowValueTurns = 0;
      return { duration: 20, narration: '你伸手去拿苏晴的手机，但她几乎同时收紧手指并后退一步。你没有拿到手机，这个意图却已经无法收回。', speaker: '苏晴', dialogue: '“你想干什么？”', event: '你试图拿走苏晴的手机但失败，她对你的戒心显著上升。' };
    }
    if (/(质问|摊牌|承认|秘密|说清楚)/.test(clean)) {
      state.flags.suSuspicious = true;
      state.suMood = '强烈防备';
      state.tension += 20;
      state.phase = '冲突升级';
      state.dramaticQuestion = '苏晴会继续否认，还是转而通知陈浩？';
      state.consequences.push({ type: 'su-warns-chen', due: state.time + 60 });
      state.consequences.push({ type: 'mother-hears', due: state.time + 150 });
      state.lowValueTurns = 0;
      return { duration: 120, narration: '你把问题直接摆到她面前。苏晴先看向门口，随后否认了一切。争执的声音已经传到了走廊。', speaker: '苏晴', dialogue: '“我不知道你在说什么。今天是你的婚礼，别胡思乱想。”', event: '你正面质问苏晴，冲突产生了可能向外传播的延迟后果。' };
    }
    if (/(离开|出去|走廊|停车场)/.test(clean)) {
      state.flags.leftRoom = true;
      state.flags.suPresent = false;
      state.location = clean.includes('停车场') ? '云璟酒店 · 地下停车场' : '云璟酒店 · 二层走廊';
      state.locationKey = 'corridor';
      state.locationAtmosphere = '电梯提示音与宴会厅的人声在走廊交错';
      state.beats.investigation = 'invalidated';
      state.phase = '路线分叉';
      state.dramaticQuestion = '离开化妆间以后，你要寻找证据、陈浩，还是直接离开婚礼？';
      state.tension += 10;
      state.lowValueTurns = 0;
      return { duration: 180, narration: '你提起裙摆走出化妆间。门在身后合上，苏晴原本的安排被打乱；而你也失去了继续观察她的机会。', speaker: '苏晴', dialogue: '“林晚，你去哪儿？化妆师马上就回来。”', event: '你主动离开化妆间，原有调查节拍失效，世界开始重新规划。' };
    }
    if (/(飞到|瞬移|让.*跪|一定要.*认错)/.test(clean) || lower.includes('teleport')) {
      state.lowValueTurns = 0;
      return { duration: 10, narration: '你产生了这个念头，但当前身份、环境与现实规则无法直接让它发生。世界没有替你改写客观条件。', speaker: '世界', dialogue: '你仍然需要通过可执行的行动影响别人。', event: `你尝试“${clean.slice(0, 36)}”，但行动不符合当前世界条件。` };
    }
    state.lowValueTurns += 1;
    return { duration: 90, narration: `你尝试${clean.replace(/[。！？!?]$/, '')}。事情没有完全照你的设想发展，但在场的人开始重新判断你的意图。`, speaker: '苏晴', dialogue: '“你今天有点不一样。到底发生什么了？”', event: `你尝试“${clean.slice(0, 42)}${clean.length > 42 ? '…' : ''}”，周围的人注意到了这个举动。` };
  }

  function commitTick(result, source = 'player') {
    const start = state.time;
    const end = Math.min(state.time + Math.max(1, result.duration), at(16, 30));
    state.time = end;
    state.turn += source === 'player' ? 1 : 0;
    state.scene += 1;
    addObservedEvent(result.event, end);
    const worldChanges = simulateWorld(start, end);
    if (worldChanges.length) {
      const presentation = worldChanges.map(change => change.text).join(' ');
      state.narration = `${result.narration} ${presentation}`;
      const finalChange = worldChanges[worldChanges.length - 1];
      state.speaker = finalChange.speaker || result.speaker;
      state.dialogue = finalChange.dialogue || result.dialogue;
      for (const change of worldChanges) addObservedEvent(change.text, change.time);
      setWorldPulse('世界发生了变化');
    } else {
      state.narration = result.narration;
      state.speaker = result.speaker;
      state.dialogue = result.dialogue;
      setWorldPulse('世界正在运行');
    }
    state.tension = Math.max(12, Math.min(94, state.tension));
    render();
    persist();
  }

  function runAction(input, source = 'player') {
    const clean = input.trim();
    if (!clean || busy) return;
    busy = true;
    lastInteractionAt = Date.now();
    $('#saveState').textContent = '正在完成世界 Tick…';
    setWorldPulse('人物正在行动');
    const previous = JSON.stringify(state);
    setTimeout(() => {
      try {
        const result = source === 'auto'
          ? { duration: 60, narration: '你暂时没有介入，但时间没有停止。其他人物仍在按照自己的计划行动。', speaker: '世界', dialogue: '一分钟过去了。', event: '你没有介入，世界自行推进了一分钟。', isWait: true }
          : resolvePlayerAction(clean);
        commitTick(result, source);
        toast(source === 'auto' ? '你没有行动，但世界继续向前' : '世界 Tick 已完成并自动保存');
      } catch (error) {
        state = JSON.parse(previous);
        render();
        persist();
        toast('本轮未完成，世界已回到上一个稳定状态');
      } finally {
        busy = false;
      }
    }, source === 'auto' ? 120 : 420);
  }

  $('#actionForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#actionInput');
    runAction(input.value);
    input.value = '';
  });

  document.querySelectorAll('.hint').forEach((button) => button.addEventListener('click', () => {
    $('#actionInput').value = button.textContent;
    $('#actionInput').focus();
    lastInteractionAt = Date.now();
  }));

  $('#waitBtn').addEventListener('click', () => runAction('我什么也不做，等待五分钟'));

  $('#noticeBtn').addEventListener('click', () => {
    lastInteractionAt = Date.now();
    const panel = $('#noticePanel');
    panel.classList.toggle('open');
    $('#noticeBtn').textContent = panel.classList.contains('open') ? '收起观察' : '我现在注意到了什么？';
  });

  let setupStep = 0;
  const setupData = { text: '', character: '林晚', mode: state.mode };

  function openSetup() {
    setupStep = 0;
    $('#setupOverlay').classList.add('open');
    renderSetup();
  }

  function closeSetup() { $('#setupOverlay').classList.remove('open'); }

  function setupBars() {
    return `<div class="steps">${[0, 1, 2].map(index => `<span class="${index <= setupStep ? 'active' : ''}"></span>`).join('')}</div>`;
  }

  function renderSetup() {
    const body = $('#setupBody');
    const bars = setupBars();
    if (setupStep === 0) {
      body.innerHTML = `${bars}<label class="input-label" for="storySource">粘贴短剧、剧本、小说片段或剧情梗概</label><textarea class="story-input" id="storySource" placeholder="系统会提取人物、关系、地点、秘密、Agenda、待触发事件和故事节拍……">${esc(setupData.text)}</textarea><input id="storyFile" type="file" accept=".txt,.md,.docx" hidden><div class="setup-actions"><span><button class="link-btn" id="useSample">使用《婚礼前夜》示例</button> · <button class="link-btn" id="uploadStory">上传文件</button></span><button class="primary" id="parseBtn">构建 StoryWorld</button></div>`;
      $('#useSample').onclick = () => { $('#storySource').value = '婚礼开始前，林晚在未婚夫陈浩的手机上发现了他与伴娘苏晴的暧昧聊天记录。她没有立即质问，而是决定先试探苏晴。苏晴试图隐瞒昨晚与陈浩见面的事实。林母和宾客尚不知情，婚礼将在15:00开始。'; };
      $('#uploadStory').onclick = () => $('#storyFile').click();
      $('#storyFile').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (/\.(txt|md)$/i.test(file.name)) $('#storySource').value = await file.text();
        else $('#storySource').value = `[DOCX] ${file.name}\n\n文件已接收。当前原型将使用结构化示例演示解析结果。`;
        toast(`已读取 ${file.name}`);
      };
      $('#parseBtn').onclick = () => {
        setupData.text = $('#storySource').value.trim();
        if (!setupData.text) return toast('请先粘贴故事或选择示例');
        setupStep = 1;
        renderSetup();
      };
    } else if (setupStep === 1) {
      body.innerHTML = `${bars}<div class="parse-summary"><div class="metric"><b>4</b><span>核心人物</span></div><div class="metric"><b>3</b><span>NPC Agenda</span></div><div class="metric"><b>5</b><span>待触发事件</span></div><div class="metric"><b>5</b><span>未决线索</span></div></div><div class="character-list"><div class="character-row"><span class="avatar">晚</span><span><strong>林晚</strong><small>新娘 · 已发现异常</small></span><span class="tag">Source Fact</span></div><div class="character-row"><span class="avatar">浩</span><span><strong>陈浩</strong><small>目标：让婚礼顺利进行</small></span><span class="tag">Agenda 运行中</span></div><div class="character-row"><span class="avatar">晴</span><span><strong>苏晴</strong><small>计划：隐瞒昨晚的见面</small></span><span class="tag">核心 NPC</span></div></div><label class="input-label" style="margin-top:16px" for="worldCorrection">需要修正设定？直接告诉系统</label><input id="worldCorrection" placeholder="例如：苏晴不是大学同学，她们只是同事" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px;background:#120f18;color:var(--text)"><div class="setup-actions"><button class="link-btn" id="backBtn">返回修改</button><button class="primary" id="confirmParse">确认并重建关系</button></div>`;
      $('#backBtn').onclick = () => { setupStep = 0; renderSetup(); };
      $('#confirmParse').onclick = () => { if ($('#worldCorrection').value.trim()) toast('修正已同步到关系、知识、事件与节拍'); setupStep = 2; renderSetup(); };
    } else {
      body.innerHTML = `${bars}<label class="input-label">选择进入方式</label><div class="choice-grid" id="characterChoices"><button class="choice selected" data-value="林晚"><strong>成为林晚</strong><p>继承她的关系、资源和当前知识，但不继承未来行为。</p></button><button class="choice" disabled aria-disabled="true"><strong>自定义角色 · P1</strong><p>根据描述生成合理身份、初始知识和进入原因。</p></button></div><label class="input-label" style="margin-top:20px">选择世界运行方式</label><div class="choice-grid" id="modeChoices"><button class="choice ${state.mode === '自由世界' ? 'selected' : ''}" data-value="自由世界"><strong>自由世界</strong><p>原剧情只是可能性，失效的节拍不会被强制恢复。</p></button><button class="choice ${state.mode === '原剧情体验' ? 'selected' : ''}" data-value="原剧情体验"><strong>原剧情体验</strong><p>保留故事节拍的惯性，但仍服从当前世界事实。</p></button></div><div class="setup-actions"><button class="link-btn" id="backBtn">上一步</button><button class="primary" id="enterWorld">让世界开始运行</button></div>`;
      document.querySelectorAll('#modeChoices .choice').forEach(button => button.onclick = () => {
        button.parentElement.querySelectorAll('.choice').forEach(item => item.classList.remove('selected'));
        button.classList.add('selected');
      });
      $('#backBtn').onclick = () => { setupStep = 1; renderSetup(); };
      $('#enterWorld').onclick = () => {
        state = createInitialState();
        state.mode = $('#modeChoices .selected').dataset.value;
        persist();
        render();
        closeSetup();
        toast(`林晚已进入故事 · ${state.mode}`);
      };
    }
  }

  $('#newStoryBtn').onclick = openSetup;
  $('#closeSetup').onclick = closeSetup;
  $('#setupOverlay').addEventListener('click', (event) => { if (event.target === $('#setupOverlay')) closeSetup(); });
  $('#restartBtn').onclick = () => {
    if (confirm('重新开始会清除当前世界的行动、Agenda 进度和延迟后果，确定继续吗？')) {
      localStorage.removeItem(STORAGE_KEY);
      state = createInitialState();
      render();
      persist();
      toast('世界已回到 14:32 的初始状态');
    }
  };

  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSetup(); });
  document.addEventListener('pointerdown', () => { lastInteractionAt = Date.now(); }, { passive: true });
  document.addEventListener('keydown', () => { lastInteractionAt = Date.now(); }, { passive: true });

  setInterval(() => {
    const overlayOpen = $('#setupOverlay').classList.contains('open');
    if (!document.hidden && !overlayOpen && !busy && Date.now() - lastInteractionAt >= 45000) {
      runAction('自动等待一分钟', 'auto');
      lastInteractionAt = Date.now();
    }
  }, 5000);

  render();
  persist();

  try {
    if (navigator.modelContext?.registerTool) {
      navigator.modelContext.registerTool({
        name: 'take_story_action',
        description: '让玩家在当前 DramaWorld 中尝试一个自由行动。结果由世界规则决定。',
        inputSchema: { type: 'object', properties: { action: { type: 'string' } }, required: ['action'] },
        execute: async ({ action }) => { runAction(action); return { content: [{ type: 'text', text: '行动已提交给世界裁判。' }] }; }
      });
      navigator.modelContext.registerTool({
        name: 'wait_in_story_world',
        description: '让玩家等待指定分钟，同时继续运行 NPC Agenda、待触发事件和延迟后果。',
        inputSchema: { type: 'object', properties: { minutes: { type: 'number', minimum: 1, maximum: 60 } }, required: ['minutes'] },
        execute: async ({ minutes }) => { runAction(`等待${minutes}分钟`); return { content: [{ type: 'text', text: '等待已开始，世界会继续运行。' }] }; }
      });
    }
  } catch {
    // The experience remains fully usable without browser-agent tools.
  }
})();
