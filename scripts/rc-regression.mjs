import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// All story, project, character, and plot text in this regression fixture is
// synthetic demo data. Do not replace it with customer manuscripts or private
// writing samples.

const root = process.cwd()
const outDir = join(root, 'tmp', 'rc-regression')
const exportDir = join(outDir, 'exports')
const dataPath = join(outDir, 'novel-director-data.json')
const migratedPath = join(outDir, 'migrated-storage', 'novel-director-data.json')
const corruptPath = join(outDir, 'corrupt-storage', 'novel-director-data.json')
const reportPath = join(outDir, 'rc-regression-report.json')

function now(offsetMinutes = 0) {
  return new Date(Date.UTC(2026, 3, 29, 9, offsetMinutes, 0)).toISOString()
}

function id(label) {
  return `rc-${label}-${randomUUID()}`
}

function estimateTokens(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const nonChineseChars = text.replace(/[\u4e00-\u9fff\s]/g, '').length
  return Math.ceil(chineseChars * 1.5 + nonChineseChars / 4)
}

function chapterHeading(chapter) {
  return `第 ${chapter.order} 章 ${chapter.title || '未命名'}`
}

function formatChapterAsText(chapter) {
  return `${chapterHeading(chapter)}\n\n${chapter.body || ''}`.trimEnd()
}

function formatChapterAsMarkdown(chapter) {
  return [
    `# ${chapterHeading(chapter)}`,
    '',
    chapter.body || '',
    '',
    '## 本章摘要',
    '',
    chapter.summary || '',
    '',
    '## 本章结尾钩子',
    '',
    chapter.endingHook || ''
  ].join('\n').trimEnd()
}

function formatAllChaptersAsText(chapters) {
  return [...chapters].sort((a, b) => a.order - b.order).map(formatChapterAsText).join('\n\n---\n\n')
}

function formatAllChaptersAsMarkdown(project, chapters) {
  const body = [...chapters]
    .sort((a, b) => a.order - b.order)
    .map((chapter) => [`## ${chapterHeading(chapter)}`, '', chapter.body || ''].join('\n').trimEnd())
    .join('\n\n---\n\n')
  return [`# ${project.name}`, '', body].join('\n').trimEnd()
}

async function atomicSave(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp`
  const backupPath = `${path}.bak`
  await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  try {
    await stat(path)
    await copyFile(path, backupPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  await rename(tmpPath, path)
}

async function loadWithCorruptBackup(path) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    const backupPath = `${path}.corrupt.${Date.now()}.json`
    await copyFile(path, backupPath)
    return { corruptBackupPath: backupPath }
  }
}

function makeRcData() {
  const projectId = id('project')
  const protagonistId = id('character-protagonist')
  const heroineId = id('character-heroine')
  const villainId = id('character-villain')
  const chapter1Id = id('chapter-1')
  const chapter2Id = id('chapter-2')
  const chapter3Id = id('chapter-3')
  const chapter4Id = id('chapter-4')
  const jobId = id('job')
  const draftId = id('draft')
  const reportId = id('quality')
  const consistencyReportId = id('consistency')
  const redundancyReportId = id('redundancy')
  const continuityBridgeId = id('continuity-bridge')
  const sessionId = id('revision-session')
  const requestId = id('revision-request')
  const revisionVersionId = id('revision-version')
  const promptVersionId = id('prompt-version')
  const candidateReviewId = id('candidate-review')
  const candidateCharacterId = id('candidate-character')
  const candidateForeshadowingId = id('candidate-foreshadowing')
  const runTraceId = id('run-trace')

  const project = {
    id: projectId,
    name: '《雾城测试稿》',
    genre: '都市悬疑 / 近未来',
    description: '一座被监控系统覆盖的雨城里，失忆调查员追查旧案，却发现每个人都在隐瞒同一场火灾。',
    targetReaders: '喜欢悬疑、角色拉扯和信息差推进的长篇读者',
    coreAppeal: '压迫感、真相拼图、关系反转、伏笔回收',
    style: '冷峻、克制、细节密集，动作和对白推动情绪',
    createdAt: now(),
    updatedAt: now(30)
  }

  const storyBible = {
    projectId,
    worldbuilding: '雾城长期阴雨，公共区域由“白塔系统”记录影像与声音，底层街区存在信号盲区。',
    corePremise: '当记忆不可靠时，人如何确认自己仍然站在正义一边。',
    protagonistDesire: '查清十年前火灾与自己失忆的关系。',
    protagonistFear: '发现自己才是旧案的加害者。',
    mainConflict: '主角追查真相与白塔系统、旧案幸存者、反派操控信息之间的冲突。',
    powerSystem: '监控数据可被篡改，但篡改会留下时间戳噪点；黑伞会能短暂屏蔽白塔系统。',
    bannedTropes: '禁止无铺垫失忆恢复、禁止反派长篇自白、禁止机械降神式证据。',
    styleSample: '雨落在监控镜头上，灯牌被水痕切成几段。林默看见自己的倒影碎在玻璃里，像一份被删改过的证词。',
    narrativeTone: '冷峻、克制、悬疑推进中保留情绪留白。',
    immutableFacts: '十年前火灾真实发生；白塔系统不能凭空创造不存在的影像；主角不能突然获得超自然能力。',
    updatedAt: now(1)
  }

  const characters = [
    {
      id: protagonistId,
      projectId,
      name: '林默',
      role: '失忆调查员 / 主角',
      surfaceGoal: '查清匿名信指向的旧案证人。',
      deepDesire: '证明自己没有背叛旧案受害者。',
      coreFear: '自己是火灾帮凶。',
      selfDeception: '他相信只要找到证据，就能不面对内心亏欠。',
      knownInformation: '知道白塔系统存在盲区，知道匿名信来自旧案相关人。',
      unknownInformation: '不知道苏晚曾在火灾当晚救过他。',
      protagonistRelationship: '本人',
      emotionalState: '警惕、疲惫、压抑自责',
      nextActionTendency: '继续追查匿名信来源，即使会触碰禁区。',
      forbiddenWriting: '不要突然恢复全部记忆，不要把判断说成绝对真相。',
      lastChangedChapter: 3,
      isMain: true,
      createdAt: now(2),
      updatedAt: now(20)
    },
    {
      id: heroineId,
      projectId,
      name: '苏晚',
      role: '法医 / 女主',
      surfaceGoal: '保护关键尸检记录不被白塔系统删除。',
      deepDesire: '让旧案受害者得到迟来的姓名。',
      coreFear: '林默认出她隐瞒过救援记录。',
      selfDeception: '她把保护林默说成只是保护证据链。',
      knownInformation: '知道火灾现场有第二名幸存者。',
      unknownInformation: '不知道反派已经定位她的离线档案。',
      protagonistRelationship: '盟友，但保留关键事实',
      emotionalState: '冷静外表下高度紧张',
      nextActionTendency: '表面拒绝林默，暗中替他挡下调查压力。',
      forbiddenWriting: '不要让她突然全盘坦白。',
      lastChangedChapter: 3,
      isMain: true,
      createdAt: now(3),
      updatedAt: now(20)
    },
    {
      id: villainId,
      projectId,
      name: '顾行',
      role: '白塔系统维护人 / 反派',
      surfaceGoal: '阻止旧案重新进入公开档案。',
      deepDesire: '维持自己设计的秩序与叙事控制。',
      coreFear: '雾城承认白塔系统从一开始就是错的。',
      selfDeception: '他认为牺牲少数真相可以保护城市。',
      knownInformation: '知道十年前火灾影像被拆成三份。',
      unknownInformation: '不知道银色怀表仍在林默手中。',
      protagonistRelationship: '敌对，表面合作',
      emotionalState: '镇定、傲慢、戒备',
      nextActionTendency: '用合法程序拖慢林默调查。',
      forbiddenWriting: '不要让他用长篇自白解释全部阴谋。',
      lastChangedChapter: 2,
      isMain: true,
      createdAt: now(4),
      updatedAt: now(18)
    }
  ]

  const foreshadowings = [
    {
      id: id('foreshadowing-low'),
      projectId,
      title: '雨衣上的红线头',
      firstChapterOrder: 1,
      description: '林默在案发巷口看到一截红线头，暂时只像普通衣料残留。',
      status: 'unresolved',
      weight: 'low',
      treatmentMode: 'hint',
      expectedPayoff: '第 8 章以后',
      payoffMethod: '指向旧案救援服来源',
      relatedCharacterIds: [protagonistId],
      relatedMainPlot: '旧案证物链',
      notes: '低权重，不应默认挤占轻量 prompt。',
      actualPayoffChapter: null,
      createdAt: now(5),
      updatedAt: now(5)
    },
    {
      id: id('foreshadowing-high'),
      projectId,
      title: '匿名信里的半枚塔印',
      firstChapterOrder: 1,
      description: '匿名信角落有白塔系统内部印章的一半，说明寄信人能接触旧档案。',
      status: 'unresolved',
      weight: 'high',
      treatmentMode: 'pause',
      expectedPayoff: '第 6-9 章推进',
      payoffMethod: '揭示寄信人曾是白塔内审员',
      relatedCharacterIds: [protagonistId, villainId],
      relatedMainPlot: '匿名信来源',
      notes: '高权重，标准 prompt 应进入。',
      actualPayoffChapter: null,
      createdAt: now(6),
      updatedAt: now(6)
    },
    {
      id: id('foreshadowing-payoff'),
      projectId,
      title: '银色怀表停在 23:47',
      firstChapterOrder: 2,
      description: '怀表停在火灾前六分钟，和监控时间戳不一致。',
      status: 'partial',
      weight: 'payoff',
      treatmentMode: 'payoff',
      expectedPayoff: '第 5 章回收',
      payoffMethod: '证明白塔记录被整体平移过六分钟',
      relatedCharacterIds: [protagonistId, heroineId],
      relatedMainPlot: '时间戳篡改',
      notes: 'payoff 权重，准备第 4/5 章时必须被看到。',
      actualPayoffChapter: null,
      createdAt: now(7),
      updatedAt: now(12)
    },
    {
      id: id('foreshadowing-near-five'),
      projectId,
      title: '旧档案的黑伞编号',
      firstChapterOrder: 3,
      description: '苏晚提到黑伞编号 17，但立刻转移话题。',
      status: 'unresolved',
      weight: 'medium',
      treatmentMode: 'advance',
      expectedPayoff: '第五章',
      payoffMethod: '让林默找到屏蔽白塔系统的方式',
      relatedCharacterIds: [heroineId],
      relatedMainPlot: '白塔盲区',
      notes: '用于测试中文章节数字解析。',
      actualPayoffChapter: null,
      createdAt: now(8),
      updatedAt: now(13)
    },
    {
      id: id('foreshadowing-resolved'),
      projectId,
      title: '废弃电话亭里的录音灯',
      firstChapterOrder: 1,
      description: '电话亭录音灯闪过一次。',
      status: 'resolved',
      weight: 'medium',
      treatmentMode: 'pause',
      expectedPayoff: '第 3 章',
      payoffMethod: '第 3 章确认有人提前监听林默。',
      relatedCharacterIds: [villainId],
      relatedMainPlot: '顾行监听',
      notes: '已回收，默认不应进入常规 prompt。',
      actualPayoffChapter: 3,
      createdAt: now(9),
      updatedAt: now(14)
    }
  ]

  const chapters = [
    {
      id: chapter1Id,
      projectId,
      order: 1,
      title: '雨夜的枪声',
      body: '雨声盖住了第一声枪响。林默站在旧港区的监控死角里，看见匿名信被水泡开，半枚塔印从纸角浮出来。',
      summary: '林默收到匿名信，进入旧港区监控死角，发现半枚塔印。',
      newInformation: '白塔系统存在旧港区盲区；匿名信可能来自内部人员。',
      characterChanges: '林默重新接触十年前火灾线索，压抑的自责被唤醒。',
      newForeshadowing: '半枚塔印；雨衣红线头。',
      resolvedForeshadowing: '',
      endingHook: '监控死角外，有人用林默的警号登录了白塔系统。',
      riskWarnings: '不要提前解释匿名信寄件人。',
      includedInStageSummary: true,
      createdAt: now(10),
      updatedAt: now(10)
    },
    {
      id: chapter2Id,
      projectId,
      order: 2,
      title: '停在 23:47 的怀表',
      body: '怀表在林默掌心停住，银色外壳冷得像一枚证词。苏晚只看了一眼，就把尸检袋重新封上。',
      summary: '林默发现银色怀表时间与白塔记录不一致，并第一次正面接触苏晚。',
      newInformation: '怀表停在 23:47；白塔记录显示火灾发生在 23:53。',
      characterChanges: '苏晚表面冷淡，但开始暗中保护林默。',
      newForeshadowing: '银色怀表时间差。',
      resolvedForeshadowing: '',
      endingHook: '顾行主动提出协助调查，却准确说出了怀表时间。',
      riskWarnings: '苏晚不能全盘坦白旧案。',
      includedInStageSummary: true,
      createdAt: now(11),
      updatedAt: now(11)
    },
    {
      id: chapter3Id,
      projectId,
      order: 3,
      title: '电话亭录音',
      body: '电话亭早已停用，录音灯却在林默靠近时亮了一下。苏晚隔着雨幕说，黑伞编号 17 不该出现在这里。',
      summary: '林默确认电话亭被监听，苏晚透露黑伞编号 17 的异常。',
      newInformation: '顾行可以通过废弃终端监听；黑伞编号与白塔盲区相关。',
      characterChanges: '林默开始怀疑顾行；苏晚主动暴露一点线索换取林默信任。',
      newForeshadowing: '黑伞编号 17。',
      resolvedForeshadowing: '电话亭录音灯被确认是监听装置。',
      endingHook: '林默收到第二封匿名信：不要相信救过你的人。',
      riskWarnings: '不要让林默立刻知道苏晚救过他。',
      includedInStageSummary: true,
      createdAt: now(12),
      updatedAt: now(12)
    }
  ]

  const chapter4DraftBody = '林默把第二封匿名信压在怀表下面。雨声沿着窗缝挤进来，像有人在门外反复清嗓。苏晚没有解释黑伞编号，只把一张离线尸检页推到他面前。页面右下角缺了六分钟，和怀表停住的位置刚好吻合。顾行的电话在这时打进来，他没有问林默在哪里，只说：“你身边的人，比白塔更会删掉真相。”'
  const revisedChapter4Body = '林默把第二封匿名信压在怀表下面。窗缝漏进来的雨声很细，像有人隔着门反复清嗓。\n\n苏晚没有解释黑伞编号。她只是把一张离线尸检页推过来，指尖停在右下角缺失的时间栏上。\n\n六分钟。\n\n林默看着怀表，表针停在 23:47。白塔档案里的火灾时间是 23:53。\n\n顾行的电话在这时亮起。屏幕上没有备注，只有一串内部短号。\n\n林默接通后，顾行没有问他在哪里。\n\n“你身边的人，”顾行说，“比白塔更懂得删掉真相。”'
  const chapter4 = {
    id: chapter4Id,
    projectId,
    order: 4,
    title: '缺失的六分钟',
    body: revisedChapter4Body,
    summary: '林默与苏晚确认尸检页缺失六分钟，顾行用电话挑拨林默对苏晚的信任。',
    newInformation: '尸检页缺失时间与怀表时间差对应。',
    characterChanges: '林默开始把怀疑指向苏晚；苏晚选择继续隐瞒救援事实。',
    newForeshadowing: '内部短号暴露顾行权限。',
    resolvedForeshadowing: '',
    endingHook: '顾行暗示苏晚删掉真相。',
    riskWarnings: '第 5 章可以推进怀表伏笔，但不要完全解释火灾真相。',
    includedInStageSummary: false,
    createdAt: now(25),
    updatedAt: now(30)
  }

  const continuityBridge = {
    id: continuityBridgeId,
    projectId,
    fromChapterId: chapter3Id,
    toChapterOrder: 4,
    lastSceneLocation: '废弃电话亭外的雨幕中',
    lastPhysicalState: '林默刚从监听确认的紧绷状态中回过神，手里握着第二封匿名信。',
    lastEmotionalState: '震惊、怀疑，同时不敢立刻质问苏晚。',
    lastUnresolvedAction: '林默还没回应匿名信里的“不要相信救过你的人”。',
    lastDialogueOrThought: '不要相信救过你的人。',
    immediateNextBeat: '第 4 章开头必须接住林默看完第二封匿名信后的沉默和苏晚的回避。',
    mustContinueFrom: '从电话亭外或紧接着的安全屋场景承接，不要重新介绍雾城和白塔系统。',
    mustNotReset: '不要重新解释白塔系统、监控盲区和怀表时间差；不要让苏晚突然坦白救援真相。',
    openMicroTensions: '林默没有质问苏晚；苏晚知道自己被匿名信推到危险位置；顾行可能已经监听到两人的行踪。',
    createdAt: now(15),
    updatedAt: now(15)
  }

  const stageSummary = {
    id: id('stage-summary'),
    projectId,
    chapterStart: 1,
    chapterEnd: 3,
    plotProgress: '林默收到匿名信，发现白塔内部塔印、怀表时间差和电话亭监听。',
    characterRelations: '林默与苏晚从互不信任到有限合作；顾行以协助者身份进入调查。',
    secrets: '苏晚知道火灾第二幸存者；顾行知道怀表时间。',
    foreshadowingPlanted: '半枚塔印、银色怀表、黑伞编号 17。',
    foreshadowingResolved: '电话亭录音灯已确认为监听装置。',
    unresolvedQuestions: '匿名信寄件人是谁；六分钟为何缺失；苏晚救过谁。',
    nextStageDirection: '第 4-6 章应围绕六分钟时间差和苏晚隐瞒继续加压。',
    createdAt: now(15),
    updatedAt: now(15)
  }

  const promptContent = [
    '# 第 4 章写作 Prompt',
    '## A. 写作任务声明',
    '请基于雾城、白塔系统、怀表六分钟时间差与当前角色状态，续写第 4 章。',
    '## 当前相关伏笔',
    '银色怀表停在 23:47；旧档案的黑伞编号；半枚塔印。',
    '## 上一章结尾衔接',
    '下一章开头必须接住林默看完第二封匿名信后的沉默和苏晚回避，不得重新介绍雾城与白塔系统。',
    '## 本章任务书',
    '目标：让林默发现六分钟缺失与苏晚隐瞒有关，但不要回收全部真相。'
  ].join('\n\n')

  const budgetProfile = {
    id: id('budget'),
    projectId,
    name: 'RC 标准预算',
    maxTokens: 16000,
    mode: 'standard',
    includeRecentChaptersCount: 3,
    includeStageSummariesCount: 2,
    includeMainCharacters: true,
    includeRelatedCharacters: true,
    includeForeshadowingWeights: ['medium', 'high', 'payoff'],
    includeTimelineEventsCount: 6,
    styleSampleMaxChars: 1200,
    createdAt: now(16),
    updatedAt: now(16)
  }
  const promptContextSnapshotId = id('prompt-context-snapshot')
  const contextSelectionResult = {
    selectedStoryBibleFields: ['worldbuilding', 'mainConflict', 'styleSample'],
    selectedChapterIds: chapters.map((chapter) => chapter.id),
    selectedStageSummaryIds: [stageSummary.id],
    selectedCharacterIds: [protagonistId, heroineId, villainId],
    selectedForeshadowingIds: foreshadowings.slice(1, 4).map((item) => item.id),
    selectedTimelineEventIds: [],
    estimatedTokens: estimateTokens(promptContent),
    omittedItems: [
      {
        type: 'foreshadowing',
        id: foreshadowings[0].id,
        reason: '低权重且本章不推进',
        estimatedTokensSaved: 120
      }
    ],
    warnings: []
  }

  const steps = [
    'context_need_planning',
    'context_budget_selection',
    'build_context',
    'generate_chapter_plan',
    'context_need_planning_from_plan',
    'context_budget_selection_delta',
    'rebuild_context_with_plan',
    'generate_chapter_draft',
    'generate_chapter_review',
    'propose_character_updates',
    'propose_foreshadowing_updates',
    'consistency_review',
    'quality_gate',
    'await_user_confirmation'
  ].map((type, index) => ({
    id: id(`step-${type}`),
    jobId,
    type,
    status: 'completed',
    inputSnapshot: JSON.stringify({ targetChapterOrder: 4, pipelineMode: 'standard', estimatedWordCount: '3000-5000' }, null, 2),
    output:
      type === 'build_context'
        ? JSON.stringify(
            {
              contextSource: 'prompt_context_snapshot',
              snapshotId: promptContextSnapshotId,
              finalPrompt: promptContent,
              contextSelectionResult,
              continuityBridgeId,
              continuitySource: 'saved_bridge'
            },
            null,
            2
          )
        : type === 'generate_chapter_draft'
          ? JSON.stringify({ title: '缺失的六分钟', body: chapter4DraftBody }, null, 2)
          : `RC fixture step ${type} completed.`,
    errorMessage: '',
    createdAt: now(16 + index),
    updatedAt: now(16 + index)
  }))

  const data = {
    schemaVersion: 2,
    projects: [project],
    storyBibles: [storyBible],
    chapters: [...chapters, chapter4],
    chapterContinuityBridges: [continuityBridge],
    characters,
    characterStateLogs: [
      {
        id: id('log-protagonist'),
        projectId,
        characterId: protagonistId,
        chapterId: chapter4Id,
        chapterOrder: 4,
        note: '林默开始怀疑苏晚隐瞒了关键事实，但仍保留合作。',
        createdAt: now(26)
      },
      {
        id: id('log-heroine'),
        projectId,
        characterId: heroineId,
        chapterId: chapter4Id,
        chapterOrder: 4,
        note: '苏晚继续保护林默，但隐藏救援事实的压力上升。',
        createdAt: now(27)
      }
    ],
    foreshadowings,
    timelineEvents: [
      {
        id: id('timeline-1'),
        projectId,
        title: '林默收到匿名信',
        chapterOrder: 1,
        storyTime: '雨夜 22:10',
        narrativeOrder: 1,
        participantCharacterIds: [protagonistId],
        result: '林默进入旧港区。',
        downstreamImpact: '重新打开旧案。',
        createdAt: now(10),
        updatedAt: now(10)
      },
      {
        id: id('timeline-4'),
        projectId,
        title: '确认尸检页缺失六分钟',
        chapterOrder: 4,
        storyTime: '雨夜 23:40',
        narrativeOrder: 4,
        participantCharacterIds: [protagonistId, heroineId],
        result: '怀表时间差获得证据支撑。',
        downstreamImpact: '第 5 章可推进怀表 payoff。',
        createdAt: now(28),
        updatedAt: now(28)
      }
    ],
    stageSummaries: [stageSummary],
    promptVersions: [
      {
        id: promptVersionId,
        projectId,
        targetChapterOrder: 4,
        title: 'RC 第 4 章标准 Prompt',
        mode: 'standard',
        content: promptContent,
        tokenEstimate: estimateTokens(promptContent),
        moduleSelection: {
          bible: true,
          progress: true,
          recentChapters: true,
          characters: true,
          foreshadowing: true,
          stageSummaries: true,
          timeline: false,
          chapterTask: true,
          forbidden: true,
          outputFormat: true
        },
        task: {
          goal: '确认六分钟缺失与苏晚隐瞒有关。',
          conflict: '林默想逼问苏晚，苏晚必须保护证据来源。',
          suspenseToKeep: '苏晚是否救过林默。',
          allowedPayoffs: '可推进怀表时间差。',
          forbiddenPayoffs: '禁止揭示火灾全部真相。',
          endingHook: '顾行挑拨林默与苏晚。',
          readerEmotion: '紧张、怀疑、期待下一章对质',
          targetWordCount: '3000-5000',
          styleRequirement: project.style
        },
        createdAt: now(16)
      }
    ],
    promptContextSnapshots: [
      {
        id: promptContextSnapshotId,
        projectId,
        targetChapterOrder: 4,
        mode: 'standard',
        budgetProfileId: budgetProfile.id,
        budgetProfile,
        contextSelectionResult,
        selectedCharacterIds: [protagonistId, heroineId, villainId],
        selectedForeshadowingIds: foreshadowings.slice(1, 4).map((item) => item.id),
        foreshadowingTreatmentOverrides: {
          [foreshadowings[2].id]: 'advance'
        },
        chapterTask: {
          goal: '确认六分钟缺失与苏晚隐瞒有关。',
          conflict: '林默想追问苏晚，苏晚必须保护证据来源。',
          suspenseToKeep: '苏晚是否救过林默。',
          allowedPayoffs: '可推进怀表时间差。',
          forbiddenPayoffs: '禁止揭示火灾全部真相。',
          endingHook: '顾行挑拨林默与苏晚。',
          readerEmotion: '紧张、怀疑、期待下一章对质',
          targetWordCount: '3000-5000',
          styleRequirement: project.style
        },
        finalPrompt: promptContent,
        estimatedTokens: estimateTokens(promptContent),
        source: 'manual',
        note: 'RC 手动上下文快照',
        createdAt: now(16),
        updatedAt: now(16)
      }
    ],
    chapterGenerationJobs: [
      {
        id: jobId,
        projectId,
        targetChapterOrder: 4,
        promptContextSnapshotId,
        contextSource: 'prompt_snapshot',
        status: 'completed',
        currentStep: 'await_user_confirmation',
        createdAt: now(16),
        updatedAt: now(25),
        errorMessage: ''
      }
    ],
    chapterGenerationSteps: steps,
    generatedChapterDrafts: [
      {
        id: draftId,
        projectId,
        chapterId: chapter4Id,
        jobId,
        title: '缺失的六分钟',
        body: chapter4DraftBody,
        summary: '林默与苏晚确认尸检页缺失六分钟。',
        status: 'accepted',
        tokenEstimate: estimateTokens(chapter4DraftBody),
        createdAt: now(19),
        updatedAt: now(25)
      }
    ],
    memoryUpdateCandidates: [
      {
        id: candidateReviewId,
        projectId,
        jobId,
        type: 'chapter_review',
        targetId: chapter4Id,
        proposedPatch: JSON.stringify({
          summary: chapter4.summary,
          newInformation: chapter4.newInformation,
          characterChanges: chapter4.characterChanges,
          newForeshadowing: chapter4.newForeshadowing,
          resolvedForeshadowing: '',
          endingHook: chapter4.endingHook,
          riskWarnings: chapter4.riskWarnings,
          continuityBridgeSuggestion: {
            lastSceneLocation: '安全屋窗边，顾行电话刚挂断',
            lastPhysicalState: '林默握着怀表和离线尸检页，指节发紧。',
            lastEmotionalState: '怀疑苏晚，但仍需要她解释。',
            lastUnresolvedAction: '林默还没有追问顾行那句挑拨。',
            lastDialogueOrThought: '你身边的人，比白塔更懂得删掉真相。',
            immediateNextBeat: '第 5 章开头应接住电话挂断后的沉默。',
            mustContinueFrom: '从安全屋内继续，不要跳到新调查点。',
            mustNotReset: '不要重新解释怀表和白塔时间差。',
            openMicroTensions: '苏晚是否救过林默；林默是否继续信任苏晚。'
          }
        }),
        evidence: 'RC 章节复盘草稿',
        confidence: 0.75,
        status: 'accepted',
        createdAt: now(20),
        updatedAt: now(25)
      },
      {
        id: candidateCharacterId,
        projectId,
        jobId,
        type: 'character',
        targetId: protagonistId,
        proposedPatch: JSON.stringify({ characterId: protagonistId, changeSummary: '林默开始怀疑苏晚。' }),
        evidence: '顾行电话挑拨成功制造裂缝。',
        confidence: 0.72,
        status: 'pending',
        createdAt: now(21),
        updatedAt: now(21)
      },
      {
        id: candidateForeshadowingId,
        projectId,
        jobId,
        type: 'foreshadowing',
        targetId: foreshadowings[2].id,
        proposedPatch: JSON.stringify({ kind: 'status', change: { foreshadowingId: foreshadowings[2].id, suggestedStatus: 'partial' } }),
        evidence: '尸检页缺失六分钟与怀表时间差对应。',
        confidence: 0.8,
        status: 'pending',
        createdAt: now(22),
        updatedAt: now(22)
      }
    ],
    consistencyReviewReports: [
      {
        id: consistencyReportId,
        projectId,
        jobId,
        chapterId: chapter4Id,
        promptContextSnapshotId,
        issues: [],
        legacyIssuesText: '',
        suggestions: '保持顾行挑拨，不提前解释火灾真相。',
        severitySummary: 'low',
        createdAt: now(23)
      }
    ],
    contextBudgetProfiles: [budgetProfile],
    qualityGateReports: [
      {
        id: reportId,
        projectId,
        jobId,
        chapterId: chapter4Id,
        draftId,
        promptContextSnapshotId,
        overallScore: 82,
        pass: true,
        dimensions: {
          plotCoherence: 84,
          characterConsistency: 82,
          foreshadowingControl: 80,
          chapterContinuity: 78,
          redundancyControl: 76,
          styleMatch: 83,
          pacing: 78,
          emotionalPayoff: 80,
          originality: 82,
          promptCompliance: 86
        },
        issues: [],
        requiredFixes: [],
        optionalSuggestions: ['可在修订时增强对白潜台词。'],
        createdAt: now(24)
      }
    ],
    generationRunTraces: [
      {
        id: runTraceId,
        projectId,
        jobId,
        targetChapterOrder: 4,
        promptContextSnapshotId,
        contextSource: 'prompt_snapshot',
        selectedChapterIds: chapters.map((chapter) => chapter.id),
        selectedStageSummaryIds: [stageSummary.id],
        selectedCharacterIds: [protagonistId, heroineId, villainId],
        selectedForeshadowingIds: foreshadowings.slice(1, 4).map((item) => item.id),
        selectedTimelineEventIds: [],
        foreshadowingTreatmentModes: Object.fromEntries(foreshadowings.slice(1, 4).map((item) => [item.id, item.treatmentMode])),
        foreshadowingTreatmentOverrides: {
          [foreshadowings[2].id]: 'advance'
        },
        omittedContextItems: contextSelectionResult.omittedItems,
        contextWarnings: [],
        contextTokenEstimate: Math.max(0, estimateTokens(promptContent) - estimateTokens('上一章结尾衔接')),
        forcedContextBlocks: [
          {
            kind: 'continuity_bridge',
            sourceId: continuityBridgeId,
            sourceType: 'saved_bridge',
            sourceChapterId: chapters[2].id,
            sourceChapterOrder: 3,
            title: '上一章结尾衔接',
            tokenEstimate: estimateTokens('上一章结尾衔接')
          }
        ],
        finalPromptTokenEstimate: estimateTokens(promptContent),
        generatedDraftId: draftId,
        consistencyReviewReportId: consistencyReportId,
        qualityGateReportId: reportId,
        revisionSessionIds: [sessionId],
        acceptedRevisionVersionId: revisionVersionId,
        acceptedMemoryCandidateIds: [candidateReviewId],
        rejectedMemoryCandidateIds: [],
        continuityBridgeId,
        continuitySource: 'saved_bridge',
        redundancyReportId,
        continuityWarnings: [],
        createdAt: now(18),
        updatedAt: now(30)
      }
    ],
    runTraceAuthorSummaries: [],
    redundancyReports: [
      {
        id: redundancyReportId,
        projectId,
        chapterId: chapter4Id,
        draftId,
        repeatedPhrases: ['六分钟'],
        repeatedSceneDescriptions: ['雨声与窗缝描写可保留一次即可'],
        repeatedExplanations: [],
        overusedIntensifiers: [],
        redundantParagraphs: [],
        compressionSuggestions: ['修订时压缩重复雨声描写，保留电话挑拨和尸检页证据。'],
        overallRedundancyScore: 28,
        createdAt: now(24)
      }
    ],
    revisionCandidates: [],
    revisionSessions: [
      {
        id: sessionId,
        projectId,
        chapterId: chapter4Id,
        sourceDraftId: draftId,
        status: 'completed',
        createdAt: now(26),
        updatedAt: now(30)
      }
    ],
    revisionRequests: [
      {
        id: requestId,
        sessionId,
        type: 'reduce_ai_tone',
        targetRange: '',
        instruction: '减少解释，增强场景动作和对白潜台词。',
        createdAt: now(27)
      }
    ],
    revisionVersions: [
      {
        id: revisionVersionId,
        sessionId,
        requestId,
        title: '缺失的六分钟 · 去 AI 味',
        body: revisedChapter4Body,
        changedSummary: '压缩解释性句子，增强雨声、动作和对话停顿。',
        risks: '未改变伏笔状态；第 5 章仍需人工确认怀表是否回收。',
        preservedFacts: '保留尸检页缺失六分钟、怀表 23:47、顾行电话挑拨。',
        status: 'accepted',
        createdAt: now(28),
        updatedAt: now(30)
      }
    ],
    chapterVersions: [
      {
        id: id('chapter-version'),
        projectId,
        chapterId: chapter4Id,
        source: 'revision_accept',
        title: '缺失的六分钟',
        body: chapter4DraftBody,
        note: '接受修订版本前自动保存',
        createdAt: now(29)
      }
    ],
    chapterCommitBundles: [],
    revisionCommitBundles: [],
    settings: {
      apiProvider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      modelName: 'gpt-4.1',
      temperature: 0.8,
      maxTokens: 8000,
      enableAutoSummary: false,
      enableChapterDiagnostics: false,
      defaultTokenBudget: 16000,
      defaultPromptMode: 'standard',
      theme: 'system'
    }
  }

  return data
}

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

function validateData(data) {
  const project = data.projects[0]
  const chapter4 = data.chapters.find((chapter) => chapter.order === 4)
  const payoff = data.foreshadowings.find((item) => item.weight === 'payoff')
  const acceptedRevisionVersion = data.revisionVersions.find((version) => version.status === 'accepted')
  const acceptedDraft = data.generatedChapterDrafts.find((draft) => draft.status !== 'draft')
  const checks = [
    assert(project?.name === '《雾城测试稿》', '创建测试项目'),
    assert(Boolean(data.storyBibles.find((item) => item.projectId === project.id)), '填写小说圣经'),
    assert(data.characters.length === 3 && data.characters.every((item) => item.isMain), '创建主角、女主、反派三个主要角色'),
    assert(data.foreshadowings.length === 5, '创建 5 条伏笔'),
    assert(data.foreshadowings.some((item) => item.weight === 'low'), '包含低权重伏笔'),
    assert(data.foreshadowings.some((item) => item.weight === 'high'), '包含高权重伏笔'),
    assert(Boolean(payoff), '包含 payoff 伏笔'),
    assert(data.foreshadowings.some((item) => /第\s*5|第五|第 5/.test(item.expectedPayoff)), '包含预计第 5 章回收的伏笔'),
    assert(data.chapters.filter((chapter) => chapter.order <= 3).length === 3, '创建第 1-3 章'),
    assert(data.stageSummaries.some((summary) => summary.chapterStart === 1 && summary.chapterEnd === 3), '生成 1-3 章阶段摘要'),
    assert(data.promptVersions.some((version) => version.targetChapterOrder === 4 && version.content.includes('第 4 章')), 'Prompt 构建器准备第 4 章'),
    assert(data.promptContextSnapshots.some((snapshot) => snapshot.targetChapterOrder === 4 && snapshot.finalPrompt.includes('第 4 章')), 'Prompt 构建器保存第 4 章上下文快照'),
    assert(data.chapterContinuityBridges.some((bridge) => bridge.toChapterOrder === 4 && bridge.immediateNextBeat), '保存第 4 章章节衔接桥'),
    assert(data.chapterGenerationJobs.some((job) => job.promptContextSnapshotId && job.contextSource === 'prompt_snapshot'), '生产流水线可绑定 Prompt 上下文快照'),
    assert(data.chapterGenerationJobs.some((job) => job.targetChapterOrder === 4 && job.status === 'completed'), '生产流水线完成第 4 章任务'),
    assert(data.generationRunTraces.some((trace) => trace.continuitySource === 'saved_bridge' && trace.redundancyReportId), '生成追踪记录衔接来源和冗余报告'),
    assert(data.memoryUpdateCandidates.some((item) => item.type === 'chapter_review'), '生成章节复盘候选'),
    assert(data.memoryUpdateCandidates.some((item) => item.type === 'character'), '生成角色更新候选'),
    assert(data.memoryUpdateCandidates.some((item) => item.type === 'foreshadowing'), '生成伏笔更新候选'),
    assert(data.qualityGateReports.some((report) => report.draftId && report.overallScore >= 75), '生成质量门禁报告'),
    assert(data.redundancyReports.some((report) => report.draftId && report.overallRedundancyScore < 70), '生成冗余描写检查报告'),
    assert(data.revisionSessions.some((session) => session.status === 'completed'), '进入修订工作台并完成修订会话'),
    assert(data.revisionVersions.some((version) => version.status === 'accepted'), '接受修订版本'),
    assert(Boolean(acceptedDraft), '接受草稿修订后草稿状态不再停留在 draft'),
    assert(data.generationRunTraces.some((trace) => trace.acceptedRevisionVersionId === acceptedRevisionVersion?.id), 'RunTrace 记录 acceptedRevisionVersionId'),
    assert(Boolean(chapter4?.body?.includes('六分钟')), '修订后的第 4 章已写入章节正文'),
    assert(data.chapterVersions.some((version) => version.chapterId === chapter4?.id), '接受修订前保存旧正文版本'),
    assert(data.memoryUpdateCandidates.some((item) => item.status === 'pending'), '长期记忆候选保留待确认，不自动污染数据')
  ]

  return checks
}

async function main() {
  const data = makeRcData()
  const checks = validateData(data)

  await mkdir(exportDir, { recursive: true })
  await atomicSave(dataPath, data)
  await atomicSave(migratedPath, data)

  const imported = JSON.parse(await readFile(migratedPath, 'utf-8'))
  checks.push(assert(imported.projects[0]?.name === '《雾城测试稿》', '模拟修改数据保存路径后可重新读取数据'))

  const chapter4 = data.chapters.find((chapter) => chapter.order === 4)
  await writeFile(join(exportDir, '第4章-缺失的六分钟.txt'), formatChapterAsText(chapter4), 'utf-8')
  await writeFile(join(exportDir, '第4章-缺失的六分钟.md'), formatChapterAsMarkdown(chapter4), 'utf-8')
  await writeFile(join(exportDir, '雾城测试稿-全章节.txt'), formatAllChaptersAsText(data.chapters), 'utf-8')
  await writeFile(join(exportDir, '雾城测试稿-全章节.md'), formatAllChaptersAsMarkdown(data.projects[0], data.chapters), 'utf-8')

  checks.push(assert((await readFile(join(exportDir, '第4章-缺失的六分钟.txt'), 'utf-8')).includes(chapter4.body), '导出当前章节 TXT'))
  checks.push(assert((await readFile(join(exportDir, '第4章-缺失的六分钟.md'), 'utf-8')).includes('## 本章摘要'), '导出当前章节 Markdown'))
  checks.push(assert((await readFile(join(exportDir, '雾城测试稿-全章节.txt'), 'utf-8')).includes('---'), '批量导出全部章节 TXT'))
  checks.push(assert((await readFile(join(exportDir, '雾城测试稿-全章节.md'), 'utf-8')).includes('# 《雾城测试稿》'), '批量导出全部章节 Markdown'))

  await mkdir(dirname(corruptPath), { recursive: true })
  await writeFile(corruptPath, '{ bad json', 'utf-8')
  const corruptResult = await loadWithCorruptBackup(corruptPath)
  checks.push(assert(Boolean(corruptResult?.corruptBackupPath), 'JSON 损坏时生成 corrupt 备份', corruptResult ?? {}))

  const ok = checks.every((check) => check.ok)
  const report = {
    ok,
    generatedAt: new Date().toISOString(),
    dataPath,
    migratedPath,
    exportDir,
    checks
  }
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8')
  console.log(JSON.stringify(report, null, 2))
  if (!ok) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
