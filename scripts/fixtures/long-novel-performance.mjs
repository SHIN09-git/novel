// Synthetic data only. No text comes from an author project or a model provider.
export const LONG_NOVEL_PROJECT_ID = 'perf-long-novel'
export const LONG_NOVEL_SECOND_PROJECT_ID = 'perf-second-project'
export const LONG_NOVEL_FIXTURE_VERSION = 1

const at = '2026-09-07T00:00:00.000Z'
const stepTypes = ['context_need_planning', 'context_budget_selection', 'build_context', 'generate_chapter_plan',
  'context_need_planning_from_plan', 'context_budget_selection_delta', 'rebuild_context_with_plan',
  'generate_chapter_draft', 'generate_chapter_review', 'propose_character_updates', 'propose_foreshadowing_updates',
  'consistency_review', 'quality_gate', 'await_user_confirmation']

function prose(order, count) {
  const paragraphs = [
    `第${order}次调查开始于清晨。林砚把手中的旧地图平铺在桌上，逐一核对前一天留下的记录。`,
    '窗外的雨停了，街角的人群开始散去。苏宁没有急着作答，而是从封皮里取出一张折好的车票。',
    '他们仍不清楚报时声为什么慢了一拍。已有线索只能证明有人经过门口，不能证明房间里发生了什么。',
    '林砚右手的伤还没有痊愈，他改用左手握笔。那把铜钥匙一直留在衣袋中，尚未试过下一道锁。',
    '两人决定沿原路返回，在桥头等候送信的人。这次他们约好先观察，再决定是否追过去。'
  ]
  let text = ''
  for (let i = 0; text.length < count; i++) text += `${paragraphs[(i + order) % paragraphs.length]}\n\n`
  return text.slice(0, count)
}

function project(id, name) {
  return { id, name, genre: '悬疑', description: '完全虚构的长篇性能测试，不用于评价小说质量。', targetReaders: '',
    coreAppeal: '', style: '简洁，动作清楚。', createdAt: at, updatedAt: at }
}

export function createLongNovelFixture(chapterCount) {
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 1000) throw new Error('chapterCount must be 1..1000')
  const projectId = LONG_NOVEL_PROJECT_ID
  const data = { schemaVersion: 3,
    projects: [project(projectId, `长篇性能样本 ${chapterCount} 章`), project(LONG_NOVEL_SECOND_PROJECT_ID, '切换性能样本')],
    chapters: [], chapterVersions: [], chapterGenerationJobs: [], chapterGenerationSteps: [], generatedChapterDrafts: [],
    generationRunTraces: [], qualityGateReports: [], consistencyReviewReports: [], chapterCommitBundles: [],
    promptContextSnapshots: [], stageSummaries: [], timelineEvents: [], characters: [], characterStateFacts: [],
    foreshadowings: [], memoryUpdateCandidates: [],
    settings: { apiProvider: 'local', apiKey: '', hasApiKey: false, baseUrl: 'http://127.0.0.1:9/v1',
      modelName: 'synthetic-no-network', codexCliPath: '', codexCliModel: '', pipelineModelRoles: {},
      enableAutoSummary: false, enableChapterDiagnostics: false, theme: 'light', retryEnabled: false,
      requestTimeoutMs: 1000, defaultTokenBudget: 16000, defaultPromptMode: 'standard' } }
  for (let i = 1; i <= 12; i++) {
    const characterId = `perf-character-${i}`
    data.characters.push({ id: characterId, projectId, name: i === 1 ? '林砚' : i === 2 ? '苏宁' : `调查员${i}`,
      roleFunction: '核对线索', surfaceGoal: '找到车票的来源', abilitiesAndResources: '持有地图和笔记。',
      weaknessAndCost: '伤势尚未痊愈。', relationshipTension: '愿意协作但仍有保留。', isMain: i <= 2,
      createdAt: at, updatedAt: at })
    for (const [category, label, value, fields] of [
      ['physical', '右手伤势', '正在恢复，不能用力握物。', ['weaknessAndCost']],
      ['inventory', '持有物品', ['铜钥匙', '旧地图'], ['abilitiesAndResources']],
      ['knowledge', '已知线索', ['报时声慢了一拍'], ['abilitiesAndResources']],
      ['location', '当前位置', '旧街桥头', ['surfaceGoal']]
    ]) data.characterStateFacts.push({ id: `${characterId}-${category}`, projectId, characterId, category,
      key: category, label, value, valueType: Array.isArray(value) ? 'list' : 'string', linkedCardFields: fields,
      trackingLevel: 'hard', promptPolicy: 'when_relevant', status: 'active', createdAt: at, updatedAt: at })
  }
  for (let i = 1; i <= Math.max(20, Math.ceil(chapterCount / 2)); i++) {
    data.foreshadowings.push({ id: `perf-hook-${i}`, projectId, title: `车票线索${i}`, description: '票面日期与记录存在差异。',
      firstChapterOrder: Math.min(i, chapterCount), status: i < chapterCount / 3 ? 'resolved' : 'unresolved',
      weight: i % 3 === 0 ? 'high' : 'medium', treatmentMode: 'hint', expectedPayoff: '确认日期差异的实际原因。',
      relatedCharacterIds: ['perf-character-1'], createdAt: at, updatedAt: at })
  }
  for (let order = 1; order <= chapterCount; order++) {
    const id = `perf-chapter-${order}`, jobId = `perf-job-${order}`, draftId = `perf-draft-${order}`
    const body = prose(order, 3000), prompt = `## 本章任务\n核对第${order}条线索，不改变已知状态。\n${prose(order, 6000)}`
    const chapter = { id, projectId, order, title: `调查记录 ${order}`, body, summary: prose(order, 220),
      newInformation: '找到对应的记录页。', characterChanges: '', newForeshadowing: '', resolvedForeshadowing: '',
      endingHook: '门外传来约定的敲门声。', riskWarnings: '', includedInStageSummary: order % 5 !== 0, createdAt: at, updatedAt: at }
    const previous = { id: `${id}-v0`, projectId, chapterId: id, source: 'initial', title: chapter.title,
      body: prose(order + 1, 2900), note: '虚构旧稿', createdAt: at }
    const version = { id: `${id}-v1`, projectId, chapterId: id, source: 'generated_draft', title: chapter.title,
      body, note: '虚构采纳版本', baseChapterVersionId: previous.id, linkedChapterCommitId: `perf-commit-${order}`,
      linkedGenerationRunTraceId: `perf-trace-${order}`, createdAt: at }
    const draft = { id: draftId, projectId, jobId, chapterId: id, title: chapter.title, body, status: 'accepted', createdAt: at, updatedAt: at }
    const quality = { id: `perf-quality-${order}`, projectId, jobId, chapterId: id, draftId, passed: true,
      totalScore: 85, summary: '固定性能样本报告，不代表模型判断。', issues: [], createdAt: at, updatedAt: at }
    const consistency = { id: `perf-consistency-${order}`, projectId, jobId, chapterId: id, generatedDraftId: draftId,
      issues: [], summary: '固定性能样本报告。', createdAt: at, updatedAt: at }
    const trace = { id: `perf-trace-${order}`, projectId, jobId, targetChapterOrder: order,
      promptContextSnapshotId: `perf-snapshot-${order}`, contextSource: 'auto', generatedDraftId: draftId,
      qualityGateReportId: quality.id, consistencyReviewReportId: consistency.id,
      selectedCharacterIds: ['perf-character-1', 'perf-character-2'], selectedForeshadowingIds: ['perf-hook-1'],
      finalPromptTokenEstimate: 6500, aiCalls: ['planner', 'prose', 'extraction', 'reviewer'].map((role, i) => ({
        id: `${jobId}-${role}`, callId: `${jobId}-${role}`, runId: jobId, role, stepId: `${jobId}-${stepTypes[i + 3]}`,
        stepType: ['generate_chapter_plan', 'generate_chapter_draft', 'generate_chapter_review', 'consistency_review'][i],
        logicalCallIndex: i + 1, outcome: 'success', provider: 'local', model: 'synthetic-no-network',
        durationMs: 1000, attempts: 1, responseFormatFallback: false, terminationCategory: 'none',
        usage: { promptTokens: 6500, completionTokens: i === 1 ? 3000 : 600, totalTokens: i === 1 ? 9500 : 7100 }, createdAt: at
      })), createdAt: at, updatedAt: at }
    data.chapters.push(chapter)
    data.chapterVersions.push(previous, version)
    data.chapterGenerationJobs.push({ id: jobId, projectId, targetChapterOrder: order, contextSource: 'auto',
      status: 'completed', currentStep: 'await_user_confirmation', errorMessage: '', createdAt: at, updatedAt: at })
    data.generatedChapterDrafts.push(draft)
    data.generationRunTraces.push(trace)
    data.qualityGateReports.push(quality)
    data.consistencyReviewReports.push(consistency)
    data.chapterCommitBundles.push({ schemaVersion: 1, id: `perf-commit-${order}`, commitId: `perf-commit-${order}`,
      projectId, chapterId: id, jobId, generatedDraftId: draftId, acceptedAt: at, acceptedBy: 'user',
      chapter, chapterVersion: version, previousChapterVersion: previous, generatedDraft: draft,
      qualityGateReportId: quality.id, consistencyReviewReportId: consistency.id, generationRunTraceId: trace.id,
      qualityGateReports: [quality], consistencyReviewReports: [consistency], generationRunTrace: trace })
    for (const type of stepTypes) data.chapterGenerationSteps.push({ id: `${jobId}-${type}`, jobId, type,
      status: 'completed', inputSnapshot: '', output: type === 'build_context' || type === 'rebuild_context_with_plan'
        ? prompt : type === 'generate_chapter_draft' ? JSON.stringify({ title: chapter.title, body })
          : JSON.stringify({ summary: prose(order, 120) }), errorMessage: '', createdAt: at, updatedAt: at })
    data.promptContextSnapshots.push({ id: `perf-snapshot-${order}`, projectId, targetChapterOrder: order,
      mode: 'standard', budgetProfile: {}, contextSelectionResult: {}, chapterTask: { goal: `核对第${order}条线索。` },
      finalPrompt: prompt, estimatedTokens: 6500, source: 'prompt_builder', note: '虚构性能快照', createdAt: at, updatedAt: at })
    data.timelineEvents.push({ id: `perf-event-${order}`, projectId, title: `第${order}次调查`, chapterOrder: order,
      storyTime: `调查第${order}天`, narrativeOrder: order, participantCharacterIds: ['perf-character-1'],
      result: '核对记录后继续调查。', downstreamImpact: '下一次调查仍需地图。', createdAt: at, updatedAt: at })
    if (order % 5 === 0) data.stageSummaries.push({ id: `perf-summary-${order}`, projectId, chapterStart: order - 4,
      chapterEnd: order, compressedPlotSummary: prose(order, 800), irreversibleChanges: '已确认日期记录有误。',
      endingCarryoverState: '仍在调查，伤势未愈。', emotionalAftertaste: '谨慎', createdAt: at, updatedAt: at })
  }
  return data
}
