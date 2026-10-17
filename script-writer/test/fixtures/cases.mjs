import { createWritingPacket } from '../../src/contracts.mjs';

const commonEndingPatterns = [/神秘短信/u, /陌生号码/u, /未完待续/u, /门外站着一个陌生人/u];

export const cases = [
  {
    id: 'identity-fulfillment',
    label: '身份兑现',
    packet: createWritingPacket({
      routeContract: {
        routeId: 'route-identity-dock-01',
        protagonist: { name: '周澄', identity: '第七码头夜班临时检修员；失踪海事工程师周芩的女儿' },
        centralGoal: '在不依赖身份特权的前提下阻止老旧门机事故，并为母亲洗清被归咎的旧事故责任。',
        ending: '门机停稳、工人获救，事故报告依据证据更正；周澄留下继续完成检修。',
        climaxResolution: '周澄依靠多年学到的机械知识、随身已有的旧检修册和现场操作完成旁路锁止。',
        knowledgeBoundaries: [{
          subject: '罗主任', fact: '周澄是周芩的女儿', unknownUntil: '周澄完成锁止并主动说明身份',
          forbiddenClaims: [/罗主任早就知道.{0,20}(周芩的女儿|她的身份)/u, /罗主任一开始就认出/u],
          allowedRevealMarkers: ['周芩是我母亲', '我是周芩的女儿']
        }],
        capabilityBoundaries: [{
          description: '不得由父母、资本或突然出现的专家完成救场',
          forbiddenSolutions: [/父亲.{0,16}(赶来|救下|解决)/u, /母亲.{0,16}(赶来|救下|解决)/u, /神秘投资人/u, /总部专家及时赶到/u]
        }],
        promises: [
          { id: 'P1', description: '母亲留下的“三短一长”检修记号必须在危机中发挥作用。', payoffMarkers: ['三短一长'] },
          { id: 'P2', description: '旧事故责任必须得到有证据的更正。', payoffMarkers: ['更正事故报告', '更正旧事故报告', '责任栏改'] }
        ],
        goalEvidenceMarkers: ['停机', '更正事故报告'],
        endingEvidenceMarkers: ['接下来的检查'],
        forbiddenDecisiveAdditions: [/直升机吊走门机/u, /突然调来一台全新门机/u],
        climaxEvidenceMarkers: ['旁路锁', '手动绞盘'],
        forbiddenEndingPatterns: commonEndingPatterns
      },
      skeleton: {
        skeletonId: 'skeleton-identity-dock-01', status: 'approved', kind: 'identity-fulfillment',
        phases: [
          { id: 'entry', purpose: '以临时身份进入码头并建立被轻视的位置。', weight: 1, requiredEvents: [
            { id: 'E1', description: '周澄以临时检修员身份进入第七码头。', evidenceMarkers: ['第七码头', '临时检修员'] }
          ] },
          { id: 'recognition', purpose: '通过母亲留下的检修语言识别风险。', weight: 1.2, requiredEvents: [
            { id: 'E2', description: '识别三短一长记号与异常振动。', evidenceMarkers: ['三短一长', '异常振动'] },
            { id: 'E3', description: '负责人在不知道真实身份时拒绝停机。', evidenceMarkers: ['不停机', '不能停机'] }
          ] },
          { id: 'climax', purpose: '主角用既有技能亲自完成锁止。', weight: 1.6, requiredEvents: [
            { id: 'E4', description: '使用旁路锁和手动绞盘解除危险。', evidenceMarkers: ['旁路锁', '手动绞盘'] }
          ] },
          { id: 'payoff', purpose: '身份和旧事故真相在行动之后兑现。', weight: 1, requiredEvents: [
            { id: 'E5', description: '周澄在事后主动公开与周芩的关系。', evidenceMarkers: ['周芩是我母亲', '我是周芩的女儿'] },
            { id: 'E6', description: '旧事故报告被更正并完整收束。', evidenceMarkers: ['更正事故报告', '更正旧事故报告', '责任栏改'] }
          ] }
        ]
      },
      characters: [
        { name: '周澄', role: '主角', knowledge: ['旧检修册的符号含义', '基础门机结构'] },
        { name: '罗主任', role: '码头负责人', knowledge: ['生产计划', '旧事故公开结论'], unknown: ['周澄的真实身份'] },
        { name: '阿全', role: '门机司机', knowledge: ['现场异响'] }
      ],
      initialFacts: ['旧检修册由周澄进入故事前合法持有', '暴雨将在夜班期间抵达', '七号门机存在长期未解决的振动'],
      knowledgeBoundaries: ['罗主任在高潮完成前不知道周澄与周芩的关系。'],
      emotionalAnchors: ['三短一长的铅笔记号', '被雨浸湿的母亲工牌', '事故报告上的责任栏'],
      voiceBrief: {
        person: '第二人称近距离', audienceInformationPosition: '观众与周澄同步知道身份，罗主任晚于观众得知',
        tone: '冷峻、克制，有工业现场的触感', narrativeDistance: '贴近主角感官，但不进入其他人物内心',
        dialogueStrategy: '短句、高压环境下以行动打断对白', timeCompressionStrategy: '夜班单线推进，关键操作不跳步',
        endingEffect: '身份在能力兑现后落地，情绪闭合，不追加悬念'
      },
      recentRepetitionProblems: ['避免以镜中自我介绍开场', '避免结尾使用“这一刻你终于明白”'],
      targetLength: 1600,
      authorRequirements: '系列句式“今天你体验的身份是……”可使用；不把身份本身写成通行证。'
    })
  },
  {
    id: 'long-term-growth',
    label: '长期成长',
    packet: createWritingPacket({
      routeContract: {
        routeId: 'route-growth-bridge-01',
        protagonist: { name: '江禾', identity: '从山村风速记录员成长为索桥工程师的女孩' },
        centralGoal: '用长期积累的观测和工程能力解决故乡索桥的风振风险。',
        ending: '桥在台风中被安全关闭并完成加固，江禾留下公开的巡检方法，村民重新通行。',
        climaxResolution: '江禾依据自己的十二年风速记录、失败试验和现场计算调整阻尼索。',
        knowledgeBoundaries: [{
          subject: '县工程队', fact: '江禾掌握针对这座桥的相位差模型', unknownUntil: '江禾在封桥会议上展示记录和试验',
          forbiddenClaims: [/工程队早就采用了江禾的模型/u], allowedRevealMarkers: ['摊开十二年的记录', '相位差模型']
        }],
        capabilityBoundaries: [{
          description: '高潮不得由父母、导师或外地专家代替江禾完成',
          forbiddenSolutions: [/父亲.{0,18}(调来|找来|请来).{0,8}(专家|设备)/u, /母亲.{0,18}(出钱|找人|救场)/u, /导师赶到现场.{0,20}(解决|完成)/u, /外地专家.{0,12}接管/u]
        }],
        promises: [
          { id: 'P1', description: '童年记录风的习惯必须成为高潮解决依据。', payoffMarkers: ['十二年的记录', '十二年风速记录'] },
          { id: 'P2', description: '失败的纸桥与试验过程必须转化为专业能力。', payoffMarkers: ['第七码试件', '失败试验', '第七次试验'] }
        ],
        goalEvidenceMarkers: ['封桥', '正式加固'],
        endingEvidenceMarkers: ['任何巡护员都能继续执行'],
        forbiddenDecisiveAdditions: [/军用直升机/u, /突然运到的智能机器人/u],
        climaxEvidenceMarkers: ['相位差', '阻尼索'],
        forbiddenEndingPatterns: commonEndingPatterns
      },
      skeleton: {
        skeletonId: 'skeleton-growth-bridge-01', status: 'approved', kind: 'long-term-growth',
        phases: [
          { id: 'seed', purpose: '建立童年观风与守桥动机。', weight: 0.9, requiredEvents: [
            { id: 'G1', description: '江禾在山口记录风速和桥索声音。', evidenceMarkers: ['风速本', '记录风速'] }
          ] },
          { id: 'practice', purpose: '呈现跨年学习、失败与修正，不把成长一句带过。', weight: 1.5, requiredEvents: [
            { id: 'G2', description: '经历纸桥、试件或模型的多次失败。', evidenceMarkers: ['第七码试件', '第七次试验', '失败试验'] },
            { id: 'G3', description: '离乡学习后持续保留故乡观测。', evidenceMarkers: ['十二年的记录', '十二年风速记录'] }
          ] },
          { id: 'return', purpose: '带着可验证能力回到故乡但先遭拒绝。', weight: 1, requiredEvents: [
            { id: 'G4', description: '县工程队最初拒绝封桥或调整方案。', evidenceMarkers: ['不能封桥', '不同意封桥'] }
          ] },
          { id: 'climax', purpose: '主角用记录与现场操作解决风振。', weight: 1.6, requiredEvents: [
            { id: 'G5', description: '江禾计算相位差并调整阻尼索。', evidenceMarkers: ['相位差', '阻尼索'] }
          ] },
          { id: 'closure', purpose: '以可持续方法和恢复通行完成成长兑现。', weight: 1, requiredEvents: [
            { id: 'G6', description: '加固完成并留下公开巡检方法。', evidenceMarkers: ['巡检表', '重新通行'] }
          ] }
        ]
      },
      characters: [
        { name: '江禾', role: '主角', knowledge: ['十二年风速记录', '结构动力学', '现场测量'] },
        { name: '老周', role: '守桥人', knowledge: ['桥索声音变化'], unknown: ['专业模型细节'] },
        { name: '县工程队负责人', role: '审批者', knowledge: ['现行检测报告'], unknown: ['江禾私有的长期观测结论'] }
      ],
      initialFacts: ['江禾童年起自发记录风速', '桥是村庄出行主通道', '她的父母没有工程资源'],
      knowledgeBoundaries: ['工程队只能在江禾展示记录后知道相位差模型。'],
      emotionalAnchors: ['起毛边的风速本', '失败的第七码试件', '桥索发出的低音'],
      voiceBrief: {
        person: '第三人称有限视角', audienceInformationPosition: '观众始终跟随江禾，先于村民理解长期记录的价值',
        tone: '朴素、坚韧，时间跨度大但不煽情', narrativeDistance: '在关键失败和现场操作时贴近，在年份跨越时适度拉远',
        dialogueStrategy: '对白承担阻力、方法校验与关系变化，不重复旁白', timeCompressionStrategy: '以代表性失败和记录物串联十二年，保留必要成长过程',
        endingEffect: '能力被公共方法继承，回到日常通行的完整收束'
      },
      recentRepetitionProblems: ['避免用身份揭晓驱动高潮', '避免每年都写成等长段落'],
      targetLength: 1700,
      authorRequirements: '不写父母出钱请专家；不把十二年浓缩成一句“她终于学会了”。'
    })
  },
  {
    id: 'relationship-closure',
    label: '关系／情感收束',
    packet: createWritingPacket({
      routeContract: {
        routeId: 'route-relationship-winter-01',
        protagonist: { name: '许棠', identity: '县城旧物代送员；与弟弟断联三年的姐姐' },
        centralGoal: '把父亲修好的旧保温桶亲手交给弟弟，并说清三年前各自误解的真相。',
        ending: '姐弟共同完成父亲留下的冬至送饭约定，关闭旧屋，关系获得明确而克制的修复。',
        climaxResolution: '许棠主动承认自己当年的逃避，许岑也说出隐瞒；两人通过对话与共同完成送饭处理关系。',
        knowledgeBoundaries: [{
          subject: '许岑', fact: '父亲生前已经修好保温桶并留下道歉字条', unknownUntil: '许棠在末班车上打开夹层',
          forbiddenClaims: [/许岑早就知道.{0,20}(保温桶|道歉字条)/u], allowedRevealMarkers: ['打开夹层', '道歉字条']
        }],
        capabilityBoundaries: [{
          description: '不得由亲戚调停、遗产或神秘来信替姐弟完成和解',
          forbiddenSolutions: [/姑姑.{0,18}(劝和|说服)/u, /律师.{0,18}(遗嘱|遗产).{0,12}(和好|原谅)/u, /神秘来信/u]
        }],
        promises: [
          { id: 'P1', description: '父亲每年冬至送饭的约定必须由姐弟亲手完成。', payoffMarkers: ['一起送到值班室', '把热饭送到值班室'] },
          { id: 'P2', description: '三年前的误解必须被双方说清，而非旁白概括。', payoffMarkers: ['我不是怪你', '我也没问你'] }
        ],
        goalEvidenceMarkers: ['保温桶', '送到值班室'],
        endingEvidenceMarkers: ['一个明确的下一次见面'],
        forbiddenDecisiveAdditions: [/巨额遗产/u, /突然出现的同父异母/u],
        climaxEvidenceMarkers: ['打开夹层', '一起送到值班室', '把热饭送到值班室'],
        forbiddenEndingPatterns: commonEndingPatterns
      },
      skeleton: {
        skeletonId: 'skeleton-relationship-winter-01', status: 'approved', kind: 'relationship-closure',
        phases: [
          { id: 'delivery', purpose: '以最后一件旧物迫使断联姐弟再次同行。', weight: 1, requiredEvents: [
            { id: 'R1', description: '许棠带着修好的保温桶上末班车。', evidenceMarkers: ['末班车', '保温桶'] }
          ] },
          { id: 'friction', purpose: '通过具体旧事暴露双方误解。', weight: 1.4, requiredEvents: [
            { id: 'R2', description: '许岑上车后与许棠发生克制冲突。', evidenceMarkers: ['许岑上车', '三年没见'] },
            { id: 'R3', description: '双方各自说出一部分当年真相。', evidenceMarkers: ['我不是怪你', '我也没问你'] }
          ] },
          { id: 'reveal', purpose: '在两人已开始诚实后才发现父亲字条。', weight: 1, requiredEvents: [
            { id: 'R4', description: '在末班车上打开夹层发现道歉字条。', evidenceMarkers: ['打开夹层', '道歉字条'] }
          ] },
          { id: 'choice', purpose: '姐弟以共同完成具体行动代替口头和好。', weight: 1.4, requiredEvents: [
            { id: 'R5', description: '两人一起把热饭送到父亲从前的值班室。', evidenceMarkers: ['一起送到值班室', '把热饭送到值班室'] }
          ] },
          { id: 'closure', purpose: '关闭旧屋并给关系明确落点。', weight: 1, requiredEvents: [
            { id: 'R6', description: '两人共同锁好旧屋，约定来年由自己做饭。', evidenceMarkers: ['锁好旧屋', '明年我们自己做'] }
          ] }
        ]
      },
      characters: [
        { name: '许棠', role: '主角', knowledge: ['父亲去世前修过保温桶', '自己三年前离家的真实原因'], unknown: ['夹层里有字条'] },
        { name: '许岑', role: '弟弟', knowledge: ['父亲最后住院时的情况', '自己没有转达电话'], unknown: ['保温桶已修好', '夹层里有字条'] },
        { name: '老秦', role: '末班车司机', knowledge: ['姐弟多年未同时出现'], unknown: ['家庭争执细节'] }
      ],
      initialFacts: ['父亲已经去世', '保温桶在父亲生前修好', '姐弟断联三年', '冬至夜末班车仍经过旧值班室'],
      knowledgeBoundaries: ['许岑在夹层被打开前不知道字条；老秦不知道家庭争执细节。'],
      emotionalAnchors: ['掉漆的保温桶', '末班车最后一排', '父亲值班室的旧门锁'],
      voiceBrief: {
        person: '第三人称双人近景，以许棠为主', audienceInformationPosition: '观众知道姐弟各自有隐瞒，但与两人同时发现字条',
        tone: '安静、生活化、冬夜质感', narrativeDistance: '贴近动作和停顿，不替人物提前总结感情',
        dialogueStrategy: '对白逐步纠正误解，每句都改变关系或行动', timeCompressionStrategy: '一趟末班车与一次送饭连续完成，不跳过关键对话',
        endingEffect: '以共同动作完成关系修复，明确闭合，不留悬疑尾巴'
      },
      recentRepetitionProblems: ['避免事故式高潮', '避免用“原来一切都是误会”概括'],
      targetLength: 1500,
      authorRequirements: '结尾完整收束；不加陌生短信、遗产秘密或父亲未死等反转。'
    })
  }
];
