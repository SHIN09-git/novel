import type {
  AppData,
  Chapter,
  ChapterGenerationJob,
  ID,
  MemoryUpdateCandidate,
  MemoryUpdatePatch,
  Project
} from '../shared/types'
import { normalizeTreatmentMode } from '../shared/foreshadowingTreatment'
import { normalizeMemoryUpdatePatch } from '../shared/normalizers/memoryUpdate'

export interface ApplicableMemoryCandidatePatch {
  candidate: MemoryUpdateCandidate
  patch: MemoryUpdatePatch
  error: null
}

export interface ApplyMemoryCandidatePatchArgs {
  current: AppData
  projectId: ID
  targetChapterOrder: number | null
  candidate: MemoryUpdateCandidate
  patch: MemoryUpdatePatch
  timestamp: string
}

type TraceMemoryCandidateIdField = 'acceptedMemoryCandidateIds' | 'rejectedMemoryCandidateIds'

export function resolveMemoryCandidatePatch(candidate: MemoryUpdateCandidate): MemoryUpdatePatch {
  const patch = candidate.proposedPatch
  if (patch.kind !== 'legacy_raw') return patch
  return normalizeMemoryUpdatePatch(patch.rawText, candidate.type, patch.rawText)
}

export function patchMatchesCandidate(candidate: MemoryUpdateCandidate, patch: MemoryUpdatePatch): boolean {
  if (candidate.type === 'chapter_review') return patch.kind === 'chapter_review_update'
  if (candidate.type === 'character') return patch.kind === 'character_state_update'
  if (candidate.type === 'foreshadowing') return patch.kind === 'foreshadowing_create' || patch.kind === 'foreshadowing_status_update'
  if (candidate.type === 'stage_summary') return patch.kind === 'stage_summary_create'
  if (candidate.type === 'timeline_event') return patch.kind === 'timeline_event_create'
  return false
}

export function resolveApplicableMemoryPatch(candidate: MemoryUpdateCandidate): { patch: MemoryUpdatePatch | null; error: string | null } {
  const patch = resolveMemoryCandidatePatch(candidate)
  if (patch.kind === 'legacy_raw') {
    return {
      patch: null,
      error: '该记忆候选是旧版原始文本，无法识别为可安全应用的结构化补丁，已跳过。'
    }
  }
  if (!patchMatchesCandidate(candidate, patch)) {
    return {
      patch: null,
      error: `记忆候选类型与补丁类型不匹配：${candidate.type} / ${patch.kind}，已跳过。`
    }
  }
  return { patch, error: null }
}

function updateProjectTimestamp(data: AppData, projectId: ID, timestamp: string): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: timestamp } : project))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function patchesEqual(left: MemoryUpdatePatch, right: MemoryUpdatePatch): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function requireProject(data: AppData, projectId: ID): void {
  if (!data.projects.some((project) => project.id === projectId)) {
    throw new Error(`记忆候选所属项目不存在：${projectId}`)
  }
}

function requirePersistedCandidate(data: AppData, candidateId: ID, projectId: ID): MemoryUpdateCandidate {
  const matches = data.memoryUpdateCandidates.filter((item) => item.id === candidateId)
  if (!matches.length) throw new Error(`记忆候选不存在：${candidateId}`)
  if (matches.length > 1) throw new Error(`记忆候选 ID 重复，无法安全处理：${candidateId}`)
  const persistedCandidate = matches[0]
  if (persistedCandidate.projectId !== projectId) {
    throw new Error(`记忆候选不属于当前项目：${candidateId}`)
  }
  return persistedCandidate
}

function requireCandidateJob(data: AppData, candidate: MemoryUpdateCandidate): ChapterGenerationJob {
  const matches = data.chapterGenerationJobs.filter((job) => job.id === candidate.jobId)
  if (!matches.length) throw new Error(`记忆候选关联的生成任务不存在：${candidate.jobId}`)
  if (matches.length > 1) throw new Error(`记忆候选关联的生成任务 ID 重复：${candidate.jobId}`)
  const job = matches[0]
  if (job.projectId !== candidate.projectId) {
    throw new Error(`记忆候选关联的生成任务不属于当前项目：${candidate.jobId}`)
  }
  return job
}

function activeProjectChapters(data: AppData, projectId: ID): Chapter[] {
  return data.chapters.filter((chapter) => chapter.projectId === projectId && !chapter.archivedAt?.trim())
}

export function memoryPatchChapterReference(patch: MemoryUpdatePatch, fallbackOrder: number | null) {
  if (patch.kind === 'chapter_review_update') {
    return { chapterId: patch.targetChapterId ?? null, chapterOrder: patch.targetChapterOrder ?? fallbackOrder }
  }
  if (patch.kind === 'character_state_update') {
    return { chapterId: patch.relatedChapterId ?? null, chapterOrder: patch.relatedChapterOrder ?? fallbackOrder }
  }
  return { chapterId: null, chapterOrder: fallbackOrder }
}

function findChapterTarget(
  data: AppData,
  projectId: ID,
  chapters: Chapter[],
  explicitChapterId: ID | null,
  chapterOrder: number | null
): Chapter | null {
  if (explicitChapterId !== null) {
    const matches = data.chapters.filter((chapter) => chapter.id === explicitChapterId)
    if (!matches.length) throw new Error(`记忆候选关联的章节不存在：${explicitChapterId}`)
    const target = matches.find((chapter) => chapter.projectId === projectId)
    if (!target) throw new Error(`记忆候选关联的章节不属于当前项目：${explicitChapterId}`)
    if (target.archivedAt?.trim()) throw new Error(`记忆候选关联的章节已归档：${explicitChapterId}`)
    return target
  }
  return chapterOrder === null ? null : chapters.find((chapter) => chapter.order === chapterOrder) ?? null
}

function requireProjectTarget<T extends { id: ID; projectId: ID }>(
  items: readonly T[],
  id: ID,
  projectId: ID,
  label: string
): T {
  const matches = items.filter((item) => item.id === id)
  if (!matches.length) throw new Error(`记忆候选关联的${label}不存在：${id}`)
  const target = matches.find((item) => item.projectId === projectId)
  if (!target) throw new Error(`记忆候选关联的${label}不属于当前项目：${id}`)
  return target
}

function requireCandidateTargetMatch(candidate: MemoryUpdateCandidate, targetId: ID, label: string): void {
  if (candidate.targetId !== null && candidate.targetId !== targetId) {
    throw new Error(`记忆候选的${label}目标与已保存补丁不匹配：${candidate.targetId} / ${targetId}`)
  }
}

function requireCandidateWithoutTarget(candidate: MemoryUpdateCandidate, label: string): void {
  if (candidate.targetId !== null) {
    throw new Error(`新增${label}候选不应关联已有目标：${candidate.targetId}`)
  }
}

function validateCharacterIds(data: AppData, projectId: ID, ids: readonly ID[], label: string): void {
  for (const id of new Set(ids)) requireProjectTarget(data.characters, id, projectId, label)
}

function uniqueNewId(items: readonly { id: ID }[], label: string): ID {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = crypto.randomUUID()
    if (!items.some((item) => item.id === id)) return id
  }
  throw new Error(`无法为${label}生成唯一 ID`)
}

function requestedOrUniqueId(items: readonly { id: ID }[], requestedId: ID | null | undefined, label: string): ID {
  if (requestedId != null) {
    if (items.some((item) => item.id === requestedId)) {
      throw new Error(`${label} ID 已存在，无法创建：${requestedId}`)
    }
    return requestedId
  }
  return uniqueNewId(items, label)
}

function appendTraceCandidateId(
  data: AppData,
  projectId: ID,
  jobId: ID,
  field: TraceMemoryCandidateIdField,
  candidateId: ID,
  timestamp: string
): AppData {
  return {
    ...data,
    generationRunTraces: data.generationRunTraces.map((trace) => {
      const ids = trace[field] ?? []
      if (trace.projectId !== projectId || trace.jobId !== jobId || ids.includes(candidateId)) return trace
      return { ...trace, [field]: [...ids, candidateId], updatedAt: timestamp }
    })
  }
}

export function applyMemoryCandidatePatchToData({
  current,
  projectId,
  targetChapterOrder: _targetChapterOrder,
  candidate,
  patch,
  timestamp
}: ApplyMemoryCandidatePatchArgs): AppData {
  requireProject(current, projectId)
  const persistedCandidate = requirePersistedCandidate(current, candidate.id, projectId)
  if (persistedCandidate.status !== 'pending') return current

  const applicable = resolveApplicableMemoryPatch(persistedCandidate)
  if (!applicable.patch) throw new Error(applicable.error ?? `记忆候选无法应用：${persistedCandidate.id}`)
  const canonicalPatch = applicable.patch
  if (!patchesEqual(patch, canonicalPatch)) {
    throw new Error(`记忆候选补丁与已保存版本不匹配，请刷新后重试：${persistedCandidate.id}`)
  }

  const candidateJob = requireCandidateJob(current, persistedCandidate)
  const candidateTargetChapterOrder = candidateJob.targetChapterOrder
  const projectChapters = activeProjectChapters(current, projectId)
  const chapterReference = memoryPatchChapterReference(canonicalPatch, candidateTargetChapterOrder)
  let nextData = current

  if (persistedCandidate.type === 'chapter_review' && canonicalPatch.kind === 'chapter_review_update') {
    const targetChapter = findChapterTarget(
      current,
      projectId,
      projectChapters,
      chapterReference.chapterId,
      chapterReference.chapterOrder
    )
    if (!targetChapter) {
      throw new Error(`记忆候选关联的章节不存在：第 ${canonicalPatch.targetChapterOrder ?? candidateTargetChapterOrder ?? '?'} 章`)
    }
    requireCandidateTargetMatch(persistedCandidate, targetChapter.id, '章节')

    const continuityBridgeSuggestion = canonicalPatch.continuityBridgeSuggestion
    const hasContinuitySuggestion =
      continuityBridgeSuggestion &&
      Object.values(continuityBridgeSuggestion).some((value) => String(value ?? '').trim())
    const existingBridge = nextData.chapterContinuityBridges.find(
      (bridge) =>
        bridge.projectId === projectId &&
        bridge.fromChapterId === targetChapter.id &&
        bridge.toChapterOrder === targetChapter.order + 1
    )
    const nextBridge = hasContinuitySuggestion
      ? {
          id: existingBridge?.id ?? uniqueNewId(nextData.chapterContinuityBridges, '章节衔接记录'),
          projectId,
          fromChapterId: targetChapter.id,
          toChapterOrder: targetChapter.order + 1,
          ...continuityBridgeSuggestion,
          createdAt: existingBridge?.createdAt ?? timestamp,
          updatedAt: timestamp
        }
      : null

    nextData = {
      ...nextData,
      chapters: nextData.chapters.map((chapter) =>
        chapter.id === targetChapter.id && chapter.projectId === projectId
          ? { ...chapter, ...canonicalPatch.review, updatedAt: timestamp }
          : chapter
      ),
      chapterContinuityBridges: nextBridge
        ? existingBridge
          ? nextData.chapterContinuityBridges.map((bridge) =>
              bridge.id === existingBridge.id && bridge.projectId === projectId ? nextBridge : bridge
            )
          : [nextBridge, ...nextData.chapterContinuityBridges]
        : nextData.chapterContinuityBridges
    }
  }

  if (persistedCandidate.type === 'character' && canonicalPatch.kind === 'character_state_update') {
    const character = requireProjectTarget(current.characters, canonicalPatch.characterId, projectId, '角色')
    requireCandidateTargetMatch(persistedCandidate, character.id, '角色')
    const relatedChapterOrder = chapterReference.chapterOrder
    const targetChapter = findChapterTarget(
      current,
      projectId,
      projectChapters,
      chapterReference.chapterId,
      relatedChapterOrder
    )
    nextData = {
      ...nextData,
      characters: nextData.characters.map((item) =>
        item.id === character.id && item.projectId === projectId
          ? {
              ...item,
              emotionalState: canonicalPatch.newCurrentEmotionalState || item.emotionalState,
              protagonistRelationship: canonicalPatch.newRelationshipWithProtagonist || item.protagonistRelationship,
              nextActionTendency: canonicalPatch.newNextActionTendency || item.nextActionTendency,
              lastChangedChapter: relatedChapterOrder ?? item.lastChangedChapter,
              updatedAt: timestamp
            }
          : item
      ),
      characterStateLogs: [
        ...nextData.characterStateLogs,
        {
          id: uniqueNewId(nextData.characterStateLogs, '角色状态日志'),
          projectId,
          characterId: character.id,
          chapterId: targetChapter?.id ?? null,
          chapterOrder: relatedChapterOrder,
          note: canonicalPatch.changeSummary,
          createdAt: timestamp
        }
      ]
    }
  }

  if (persistedCandidate.type === 'foreshadowing' && canonicalPatch.kind === 'foreshadowing_create') {
    requireCandidateWithoutTarget(persistedCandidate, '伏笔')
    validateCharacterIds(current, projectId, canonicalPatch.candidate.relatedCharacterIds, '伏笔关联角色')
    nextData = {
      ...nextData,
      foreshadowings: [
        ...nextData.foreshadowings,
        {
          id: uniqueNewId(nextData.foreshadowings, '伏笔'),
          projectId,
          title: canonicalPatch.candidate.title,
          firstChapterOrder: canonicalPatch.candidate.firstChapterOrder ?? candidateTargetChapterOrder,
          description: canonicalPatch.candidate.description,
          status: 'unresolved',
          weight: canonicalPatch.candidate.suggestedWeight,
          treatmentMode: normalizeTreatmentMode(
            canonicalPatch.candidate.recommendedTreatmentMode,
            'unresolved',
            canonicalPatch.candidate.suggestedWeight
          ),
          expectedPayoff: canonicalPatch.candidate.expectedPayoff,
          payoffMethod: '',
          relatedCharacterIds: canonicalPatch.candidate.relatedCharacterIds,
          relatedMainPlot: '',
          notes: canonicalPatch.candidate.notes,
          actualPayoffChapter: null,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    }
  }

  if (persistedCandidate.type === 'foreshadowing' && canonicalPatch.kind === 'foreshadowing_status_update') {
    const foreshadowing = requireProjectTarget(
      current.foreshadowings,
      canonicalPatch.foreshadowingId,
      projectId,
      '伏笔'
    )
    requireCandidateTargetMatch(persistedCandidate, foreshadowing.id, '伏笔')
    nextData = {
      ...nextData,
      foreshadowings: nextData.foreshadowings.map((item) =>
        item.id === foreshadowing.id && item.projectId === projectId
          ? {
              ...item,
              status: canonicalPatch.suggestedStatus,
              treatmentMode: canonicalPatch.recommendedTreatmentMode ?? item.treatmentMode,
              actualPayoffChapter:
                canonicalPatch.suggestedStatus === 'resolved'
                  ? canonicalPatch.actualPayoffChapter ?? candidateTargetChapterOrder ?? item.actualPayoffChapter
                  : item.actualPayoffChapter,
              notes: [item.notes, canonicalPatch.notes || canonicalPatch.evidenceText].filter(Boolean).join('\n'),
              updatedAt: timestamp
            }
          : item
      )
    }
  }

  if (persistedCandidate.type === 'stage_summary' && canonicalPatch.kind === 'stage_summary_create') {
    const summary = canonicalPatch.stageSummary
    const summaryId = requestedOrUniqueId(nextData.stageSummaries, summary.id, '阶段摘要')
    nextData = {
      ...nextData,
      stageSummaries: [
        {
          id: summaryId,
          projectId,
          chapterStart: summary.chapterStart ?? candidateTargetChapterOrder ?? 1,
          chapterEnd: summary.chapterEnd ?? summary.chapterStart ?? candidateTargetChapterOrder ?? 1,
          coveredChapterRange: summary.coveredChapterRange ?? '',
          compressedPlotSummary: summary.compressedPlotSummary ?? summary.plotProgress ?? '',
          irreversibleChanges: summary.irreversibleChanges ?? '',
          endingCarryoverState: summary.endingCarryoverState ?? '',
          emotionalAftertaste: summary.emotionalAftertaste ?? '',
          pacingState: summary.pacingState ?? '',
          plotProgress: summary.plotProgress ?? summary.compressedPlotSummary ?? '',
          characterRelations: summary.characterRelations ?? '',
          secrets: summary.secrets ?? '',
          foreshadowingPlanted: summary.foreshadowingPlanted ?? '',
          foreshadowingResolved: summary.foreshadowingResolved ?? '',
          unresolvedQuestions: summary.unresolvedQuestions ?? '',
          nextStageDirection: summary.nextStageDirection ?? '',
          createdAt: summary.createdAt ?? timestamp,
          updatedAt: timestamp
        },
        ...nextData.stageSummaries
      ]
    }
  }

  if (persistedCandidate.type === 'timeline_event' && canonicalPatch.kind === 'timeline_event_create') {
    const event = canonicalPatch.event
    const participantCharacterIds = event.participantCharacterIds ?? []
    validateCharacterIds(current, projectId, participantCharacterIds, '时间线参与角色')
    const eventId = requestedOrUniqueId(nextData.timelineEvents, event.id, '时间线事件')
    nextData = {
      ...nextData,
      timelineEvents: [
        {
          id: eventId,
          projectId,
          title: event.title ?? '未命名时间线事件',
          chapterOrder: event.chapterOrder ?? candidateTargetChapterOrder,
          storyTime: event.storyTime ?? '',
          narrativeOrder: event.narrativeOrder ?? candidateTargetChapterOrder ?? 0,
          participantCharacterIds,
          result: event.result ?? '',
          downstreamImpact: event.downstreamImpact ?? '',
          createdAt: event.createdAt ?? timestamp,
          updatedAt: timestamp
        },
        ...nextData.timelineEvents
      ]
    }
  }

  const acceptedData: AppData = {
    ...nextData,
    projects: updateProjectTimestamp(nextData, projectId, timestamp),
    memoryUpdateCandidates: nextData.memoryUpdateCandidates.map((item) =>
      item.id === persistedCandidate.id && item.projectId === projectId
        ? { ...item, proposedPatch: canonicalPatch, status: 'accepted', updatedAt: timestamp }
        : item
    )
  }
  return appendTraceCandidateId(
    acceptedData,
    projectId,
    persistedCandidate.jobId,
    'acceptedMemoryCandidateIds',
    persistedCandidate.id,
    timestamp
  )
}

export function rejectMemoryCandidateInData(current: AppData, candidate: MemoryUpdateCandidate, timestamp: string): AppData {
  requireProject(current, candidate.projectId)
  const persistedCandidate = requirePersistedCandidate(current, candidate.id, candidate.projectId)
  if (persistedCandidate.status !== 'pending') return current
  const rejectedData: AppData = {
    ...current,
    memoryUpdateCandidates: current.memoryUpdateCandidates.map((item) =>
      item.id === persistedCandidate.id && item.projectId === persistedCandidate.projectId
        ? { ...item, status: 'rejected', updatedAt: timestamp }
        : item
    )
  }
  return appendTraceCandidateId(
    rejectedData,
    persistedCandidate.projectId,
    persistedCandidate.jobId,
    'rejectedMemoryCandidateIds',
    persistedCandidate.id,
    timestamp
  )
}
