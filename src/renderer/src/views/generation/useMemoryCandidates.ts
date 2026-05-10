import type {
  AppData,
  ChapterGenerationJob,
  ID,
  MemoryUpdateCandidate,
  MemoryUpdatePatch,
  Project,
  QualityGateReport
} from '../../../../shared/types'
import { normalizeMemoryUpdatePatch } from '../../../../shared/defaults'
import { normalizeTreatmentMode } from '../../../../shared/foreshadowingTreatment'
import { QUALITY_GATE_HUMAN_REVIEW_SCORE, QualityGateService } from '../../../../services/QualityGateService'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import { newId, now } from '../../utils/format'
import { projectData } from '../../utils/projectData'
import { appendGenerationRunTraceIds } from '../../utils/runTrace'
import type { SaveDataInput } from '../../utils/saveDataState'

interface UseMemoryCandidatesArgs {
  project: Project
  selectedJob: ChapterGenerationJob | null
  qualityGateReports: QualityGateReport[]
  saveData: (next: SaveDataInput) => Promise<void>
  confirmAction: ConfirmFn
}

function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}

function resolveCandidatePatch(candidate: MemoryUpdateCandidate): MemoryUpdatePatch {
  const patch = candidate.proposedPatch
  if (patch.kind !== 'legacy_raw') return patch
  return normalizeMemoryUpdatePatch(patch.rawText, candidate.type, patch.rawText)
}

function patchMatchesCandidate(candidate: MemoryUpdateCandidate, patch: MemoryUpdatePatch): boolean {
  if (candidate.type === 'chapter_review') return patch.kind === 'chapter_review_update'
  if (candidate.type === 'character') return patch.kind === 'character_state_update'
  if (candidate.type === 'foreshadowing') return patch.kind === 'foreshadowing_create' || patch.kind === 'foreshadowing_status_update'
  if (candidate.type === 'stage_summary') return patch.kind === 'stage_summary_create'
  if (candidate.type === 'timeline_event') return patch.kind === 'timeline_event_create'
  return false
}

function warnCannotApply(message: string) {
  if (typeof window !== 'undefined') window.alert(message)
}

export function useMemoryCandidates({ project, selectedJob, qualityGateReports, saveData, confirmAction }: UseMemoryCandidatesArgs) {
  function resolveApplicablePatch(candidate: MemoryUpdateCandidate): { patch: MemoryUpdatePatch | null; error: string | null } {
    const patch = resolveCandidatePatch(candidate)
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

  function applyCandidatePatchToData(
    current: AppData,
    candidate: MemoryUpdateCandidate,
    patch: MemoryUpdatePatch,
    timestamp: string
  ): AppData {
    let nextData = current
    const currentScoped = projectData(current, project.id)

    if (candidate.type === 'chapter_review' && patch.kind === 'chapter_review_update') {
      const targetChapter =
        currentScoped.chapters.find((chapter) => chapter.id === patch.targetChapterId) ??
        currentScoped.chapters.find((chapter) => chapter.order === (patch.targetChapterOrder ?? selectedJob?.targetChapterOrder)) ??
        null
      if (!targetChapter) return current

      const continuityBridgeSuggestion = patch.continuityBridgeSuggestion
      const hasContinuitySuggestion =
        continuityBridgeSuggestion &&
        Object.values(continuityBridgeSuggestion).some((value) => String(value ?? '').trim())
      const existingBridge = nextData.chapterContinuityBridges.find(
        (bridge) => bridge.fromChapterId === targetChapter.id && bridge.toChapterOrder === targetChapter.order + 1
      )
      const nextBridge = hasContinuitySuggestion
        ? {
            id: existingBridge?.id ?? newId(),
            projectId: project.id,
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
          chapter.id === targetChapter.id ? { ...chapter, ...patch.review, updatedAt: timestamp } : chapter
        ),
        chapterContinuityBridges: nextBridge
          ? existingBridge
            ? nextData.chapterContinuityBridges.map((bridge) => (bridge.id === existingBridge.id ? nextBridge : bridge))
            : [nextBridge, ...nextData.chapterContinuityBridges]
          : nextData.chapterContinuityBridges
      }
    }

    if (candidate.type === 'character' && patch.kind === 'character_state_update') {
      const character = currentScoped.characters.find((item) => item.id === patch.characterId)
      if (!character) return current
      const targetChapter =
        currentScoped.chapters.find((chapter) => chapter.id === patch.relatedChapterId) ??
        currentScoped.chapters.find((chapter) => chapter.order === (patch.relatedChapterOrder ?? selectedJob?.targetChapterOrder)) ??
        null
      nextData = {
        ...nextData,
        characters: nextData.characters.map((item) =>
          item.id === character.id
            ? {
                ...item,
                emotionalState: patch.newCurrentEmotionalState || item.emotionalState,
                protagonistRelationship: patch.newRelationshipWithProtagonist || item.protagonistRelationship,
                nextActionTendency: patch.newNextActionTendency || item.nextActionTendency,
                lastChangedChapter: patch.relatedChapterOrder ?? selectedJob?.targetChapterOrder ?? item.lastChangedChapter,
                updatedAt: timestamp
              }
            : item
        ),
        characterStateLogs: [
          ...nextData.characterStateLogs,
          {
            id: newId(),
            projectId: project.id,
            characterId: character.id,
            chapterId: targetChapter?.id ?? null,
            chapterOrder: patch.relatedChapterOrder ?? selectedJob?.targetChapterOrder ?? null,
            note: patch.changeSummary,
            createdAt: timestamp
          }
        ]
      }
    }

    if (candidate.type === 'foreshadowing' && patch.kind === 'foreshadowing_create') {
      nextData = {
        ...nextData,
        foreshadowings: [
          ...nextData.foreshadowings,
          {
            id: newId(),
            projectId: project.id,
            title: patch.candidate.title,
            firstChapterOrder: patch.candidate.firstChapterOrder ?? selectedJob?.targetChapterOrder ?? null,
            description: patch.candidate.description,
            status: 'unresolved',
            weight: patch.candidate.suggestedWeight,
            treatmentMode: normalizeTreatmentMode(patch.candidate.recommendedTreatmentMode, 'unresolved', patch.candidate.suggestedWeight),
            expectedPayoff: patch.candidate.expectedPayoff,
            payoffMethod: '',
            relatedCharacterIds: patch.candidate.relatedCharacterIds,
            relatedMainPlot: '',
            notes: patch.candidate.notes,
            actualPayoffChapter: null,
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }
    }

    if (candidate.type === 'foreshadowing' && patch.kind === 'foreshadowing_status_update') {
      nextData = {
        ...nextData,
        foreshadowings: nextData.foreshadowings.map((item) =>
          item.id === patch.foreshadowingId
            ? {
                ...item,
                status: patch.suggestedStatus,
                treatmentMode: patch.recommendedTreatmentMode ?? item.treatmentMode,
                actualPayoffChapter:
                  patch.suggestedStatus === 'resolved'
                    ? patch.actualPayoffChapter ?? selectedJob?.targetChapterOrder ?? item.actualPayoffChapter
                    : item.actualPayoffChapter,
                notes: [item.notes, patch.notes || patch.evidenceText].filter(Boolean).join('\n'),
                updatedAt: timestamp
              }
            : item
        )
      }
    }

    if (candidate.type === 'stage_summary' && patch.kind === 'stage_summary_create') {
      const summary = patch.stageSummary
      nextData = {
        ...nextData,
        stageSummaries: [
          {
            id: summary.id ?? newId(),
            projectId: project.id,
            chapterStart: summary.chapterStart ?? selectedJob?.targetChapterOrder ?? 1,
            chapterEnd: summary.chapterEnd ?? summary.chapterStart ?? selectedJob?.targetChapterOrder ?? 1,
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

    if (candidate.type === 'timeline_event' && patch.kind === 'timeline_event_create') {
      const event = patch.event
      nextData = {
        ...nextData,
        timelineEvents: [
          {
            id: event.id ?? newId(),
            projectId: project.id,
            title: event.title ?? '未命名时间线事件',
            chapterOrder: event.chapterOrder ?? selectedJob?.targetChapterOrder ?? null,
            storyTime: event.storyTime ?? '',
            narrativeOrder: event.narrativeOrder ?? selectedJob?.targetChapterOrder ?? 0,
            participantCharacterIds: event.participantCharacterIds ?? [],
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
      projects: updateProjectTimestamp(nextData, project.id),
      memoryUpdateCandidates: nextData.memoryUpdateCandidates.map((item) =>
        item.id === candidate.id ? { ...item, proposedPatch: patch, status: 'accepted', updatedAt: timestamp } : item
      )
    }
    return appendGenerationRunTraceIds(acceptedData, candidate.jobId, 'acceptedMemoryCandidateIds', [candidate.id])
  }

  async function confirmQualityGateBypass(candidates: MemoryUpdateCandidate[], title: string, confirmLabel: string): Promise<boolean> {
    const reviewReports = [
      ...new Map(
        candidates
          .map((candidate) => qualityGateReports.find((item) => item.jobId === candidate.jobId && QualityGateService.shouldRequireHumanReview(item)) ?? null)
          .filter((item): item is QualityGateReport => Boolean(item))
          .map((report) => [report.id, report] as const)
      ).values()
    ]
    if (!reviewReports.length) return true
    const scoreText = reviewReports.map((report) => `${report.overallScore} 分`).join('、')
    const hasFailedReport = reviewReports.some((report) => !report.pass)
    return confirmAction({
      title,
      message: hasFailedReport
        ? `相关流水线质量门禁未通过（${scoreText}）。确认仍要应用这些长期记忆更新吗？`
        : `相关流水线质量门禁低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE} 分或存在关键维度风险（${scoreText}）。确认仍要应用这些长期记忆更新吗？`,
      confirmLabel,
      tone: hasFailedReport ? 'danger' : 'default'
    })
  }

  async function applyCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    const { patch, error } = resolveApplicablePatch(candidate)
    if (!patch) {
      warnCannotApply(error ?? '该记忆候选无法应用。')
      return
    }

    const ok = await confirmQualityGateBypass([candidate], '质量门禁未通过', '应用记忆更新')
    if (!ok) return

    const timestamp = now()
    await saveData((current) => applyCandidatePatchToData(current, candidate, patch, timestamp))
  }

  async function applyAllPendingCandidates(candidates: MemoryUpdateCandidate[]) {
    const pending = candidates.filter((candidate) => candidate.status === 'pending')
    if (!pending.length) return

    const applicable = pending
      .map((candidate) => ({ candidate, ...resolveApplicablePatch(candidate) }))
      .filter((item): item is { candidate: MemoryUpdateCandidate; patch: MemoryUpdatePatch; error: null } => Boolean(item.patch))
    const skipped = pending.length - applicable.length
    if (!applicable.length) {
      warnCannotApply('没有可安全应用的待确认记忆候选。')
      return
    }

    const ok = await confirmQualityGateBypass(applicable.map((item) => item.candidate), '一键通过记忆候选', `应用 ${applicable.length} 条候选`)
    if (!ok) return

    const timestamp = now()
    await saveData((current) =>
      applicable.reduce<AppData>((nextData, item) => applyCandidatePatchToData(nextData, item.candidate, item.patch, timestamp), current)
    )
    if (skipped > 0) warnCannotApply(`已应用 ${applicable.length} 条候选，另有 ${skipped} 条因格式不安全被跳过。`)
  }

  async function rejectCandidate(candidate: MemoryUpdateCandidate) {
    if (candidate.status !== 'pending') return
    const timestamp = now()
    await saveData((current) => {
      const rejectedData: AppData = {
        ...current,
        memoryUpdateCandidates: current.memoryUpdateCandidates.map((item) =>
          item.id === candidate.id ? { ...item, status: 'rejected', updatedAt: timestamp } : item
        )
      }
      return appendGenerationRunTraceIds(rejectedData, candidate.jobId, 'rejectedMemoryCandidateIds', [candidate.id])
    })
  }

  return { applyCandidate, applyAllPendingCandidates, rejectCandidate }
}
