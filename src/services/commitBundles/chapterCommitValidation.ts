import type { AppData, ChapterCommitBundle, ChapterVersion } from '../../shared/types'
import { validateAcceptanceReviewShape, validateCurrentAcceptanceReview } from './chapterAcceptanceReviewValidation'
import {
  assertImmutableCommit,
  assertNoCrossProjectIdCollision,
  assertProjectScope,
  requireCommitText
} from './commitBundleUtils'

function validateCore(bundle: ChapterCommitBundle, schemaVersion: number): void {
  if (!bundle || typeof bundle !== 'object') throw new Error('ChapterCommitBundle is required.')
  requireCommitText(bundle.commitId, 'ChapterCommitBundle requires commitId.')
  requireCommitText(bundle.id, 'ChapterCommitBundle requires id.')
  if (bundle.id !== bundle.commitId) throw new Error('ChapterCommitBundle id must match commitId.')
  requireCommitText(bundle.projectId, 'ChapterCommitBundle requires projectId.')
  requireCommitText(bundle.chapterId, 'ChapterCommitBundle requires chapterId.')
  requireCommitText(bundle.acceptedAt, 'ChapterCommitBundle requires acceptedAt.')
  if (bundle.acceptedBy !== 'user' && bundle.acceptedBy !== 'agent') throw new Error('ChapterCommitBundle acceptedBy must be user or agent.')
  if (bundle.acceptedBy === 'agent') {
    if (bundle.actor?.kind !== 'agent') throw new Error('Agent chapter commit requires actor provenance.')
    requireCommitText(bundle.actor.agentRunId, 'Agent chapter commit requires agentRunId.')
    requireCommitText(bundle.actor.actionPreviewId, 'Agent chapter commit requires actionPreviewId.')
  }
  if (bundle.schemaVersion !== schemaVersion) {
    throw new Error(`Unsupported ChapterCommitBundle schemaVersion: ${bundle.schemaVersion}.`)
  }
  if (!bundle.chapter || bundle.chapter.id !== bundle.chapterId) {
    throw new Error('ChapterCommitBundle chapter id mismatch.')
  }
  assertProjectScope(bundle.chapter, bundle.projectId, 'Chapter')

  if (bundle.generatedDraft) {
    if (bundle.generatedDraftId && bundle.generatedDraft.id !== bundle.generatedDraftId) {
      throw new Error('ChapterCommitBundle generatedDraftId mismatch.')
    }
    assertProjectScope(bundle.generatedDraft, bundle.projectId, 'GeneratedChapterDraft')
    if (bundle.jobId && bundle.generatedDraft.jobId !== bundle.jobId) {
      throw new Error('ChapterCommitBundle draft jobId mismatch.')
    }
    if (bundle.generatedDraft.chapterId !== bundle.chapterId) {
      throw new Error('ChapterCommitBundle draft chapterId mismatch.')
    }
  }

  if (bundle.chapterVersion) {
    assertProjectScope(bundle.chapterVersion, bundle.projectId, 'ChapterVersion')
    if (bundle.chapterVersion.chapterId !== bundle.chapterId) {
      throw new Error('ChapterCommitBundle chapterVersion chapterId mismatch.')
    }
    if (
      (bundle.chapterVersion.source === 'generated_draft' || bundle.chapterVersion.linkedChapterCommitId) &&
      bundle.chapterVersion.body !== bundle.chapter.body
    ) {
      throw new Error('ChapterCommitBundle accepted chapterVersion body must match chapter body.')
    }
    if (bundle.chapterVersion.linkedChapterCommitId && bundle.chapterVersion.linkedChapterCommitId !== bundle.commitId) {
      throw new Error('ChapterCommitBundle chapterVersion linkedChapterCommitId mismatch.')
    }
  }

  if (bundle.previousChapterVersion) {
    assertProjectScope(bundle.previousChapterVersion, bundle.projectId, 'Previous ChapterVersion')
    if (bundle.previousChapterVersion.chapterId !== bundle.chapterId) {
      throw new Error('ChapterCommitBundle previousChapterVersion chapterId mismatch.')
    }
    if (bundle.chapterVersion?.baseChapterVersionId !== bundle.previousChapterVersion.id) {
      throw new Error('ChapterCommitBundle previousChapterVersion must be the accepted version base.')
    }
  }
}

function validateReports(bundle: ChapterCommitBundle): void {
  for (const report of bundle.qualityGateReports ?? []) {
    assertProjectScope(report, bundle.projectId, 'QualityGateReport')
    if (bundle.jobId && report.jobId !== bundle.jobId) throw new Error(`QualityGateReport ${report.id} jobId mismatch.`)
    if (report.chapterId !== bundle.chapterId) throw new Error(`QualityGateReport ${report.id} chapterId mismatch.`)
    if (bundle.generatedDraftId && report.draftId !== bundle.generatedDraftId) {
      throw new Error(`QualityGateReport ${report.id} draftId mismatch.`)
    }
  }

  for (const report of bundle.consistencyReviewReports ?? []) {
    assertProjectScope(report, bundle.projectId, 'ConsistencyReviewReport')
    if (bundle.jobId && report.jobId !== bundle.jobId) {
      throw new Error(`ConsistencyReviewReport ${report.id} jobId mismatch.`)
    }
    if (report.chapterId !== bundle.chapterId) {
      throw new Error(`ConsistencyReviewReport ${report.id} chapterId mismatch.`)
    }
  }

  for (const report of bundle.redundancyReports ?? []) {
    assertProjectScope(report, bundle.projectId, 'RedundancyReport')
    if (report.chapterId !== bundle.chapterId) throw new Error(`RedundancyReport ${report.id} chapterId mismatch.`)
    if (bundle.jobId && report.jobId && report.jobId !== bundle.jobId) {
      throw new Error(`RedundancyReport ${report.id} jobId mismatch.`)
    }
    if (bundle.generatedDraftId && report.draftId !== bundle.generatedDraftId) {
      throw new Error(`RedundancyReport ${report.id} draftId mismatch.`)
    }
  }
}

function validateStateAndMemory(bundle: ChapterCommitBundle, existingData?: AppData): void {
  for (const candidate of bundle.acceptedMemoryUpdateCandidates ?? []) {
    assertProjectScope(candidate, bundle.projectId, 'MemoryUpdateCandidate')
    if (bundle.jobId && candidate.jobId !== bundle.jobId) {
      throw new Error(`MemoryUpdateCandidate ${candidate.id} jobId mismatch.`)
    }
    if (candidate.status !== 'accepted') {
      throw new Error(`MemoryUpdateCandidate ${candidate.id} must be accepted before chapter commit.`)
    }
  }

  for (const candidate of bundle.acceptedCharacterStateChangeCandidates ?? []) {
    assertProjectScope(candidate, bundle.projectId, 'CharacterStateChangeCandidate')
    if (candidate.chapterId && candidate.chapterId !== bundle.chapterId) {
      throw new Error(`CharacterStateChangeCandidate ${candidate.id} chapterId mismatch.`)
    }
    if (candidate.status !== 'accepted') {
      throw new Error(`CharacterStateChangeCandidate ${candidate.id} must be accepted before chapter commit.`)
    }
    if (candidate.proposedFact) {
      assertProjectScope(candidate.proposedFact, bundle.projectId, 'CharacterStateChangeCandidate proposed fact')
      if (candidate.proposedFact.characterId !== candidate.characterId) {
        throw new Error(`CharacterStateChangeCandidate ${candidate.id} proposed fact characterId mismatch.`)
      }
    }
    if (candidate.proposedTransaction) {
      assertProjectScope(
        candidate.proposedTransaction,
        bundle.projectId,
        'CharacterStateChangeCandidate proposed transaction'
      )
      if (candidate.proposedTransaction.characterId !== candidate.characterId) {
        throw new Error(`CharacterStateChangeCandidate ${candidate.id} proposed transaction characterId mismatch.`)
      }
    }
  }

  for (const fact of bundle.appliedCharacterStateFacts ?? []) {
    assertProjectScope(fact, bundle.projectId, 'CharacterStateFact')
  }

  for (const transaction of bundle.appliedCharacterStateTransactions ?? []) {
    assertProjectScope(transaction, bundle.projectId, 'CharacterStateTransaction')
    if (transaction.chapterId && transaction.chapterId !== bundle.chapterId) {
      throw new Error(`CharacterStateTransaction ${transaction.id} chapterId mismatch.`)
    }
    const linkedFact =
      bundle.appliedCharacterStateFacts?.find((fact) => fact.id === transaction.factId) ??
      existingData?.characterStateFacts.find((fact) => fact.id === transaction.factId)
    if (!linkedFact) {
      throw new Error(`CharacterStateTransaction ${transaction.id} references missing factId ${transaction.factId}.`)
    }
    if (linkedFact.projectId !== bundle.projectId || linkedFact.characterId !== transaction.characterId) {
      throw new Error(`CharacterStateTransaction ${transaction.id} fact scope mismatch.`)
    }
  }
}

function validateWorldAndTrace(bundle: ChapterCommitBundle, existingData?: AppData): void {
  for (const foreshadowing of bundle.appliedForeshadowingUpdates ?? []) {
    assertProjectScope(foreshadowing, bundle.projectId, 'Foreshadowing')
  }
  for (const event of bundle.appliedTimelineEvents ?? []) {
    assertProjectScope(event, bundle.projectId, 'TimelineEvent')
  }

  if (bundle.generationRunTrace) {
    assertProjectScope(bundle.generationRunTrace, bundle.projectId, 'GenerationRunTrace')
    if (bundle.jobId && bundle.generationRunTrace.jobId !== bundle.jobId) {
      throw new Error('ChapterCommitBundle trace jobId mismatch.')
    }
    if (bundle.generationRunTrace.targetChapterOrder !== bundle.chapter.order) {
      throw new Error('ChapterCommitBundle trace target chapter order mismatch.')
    }
  }

  if (!bundle.generatedDraftId) return
  const referencedDraft =
    (bundle.generatedDraft?.id === bundle.generatedDraftId ? bundle.generatedDraft : null) ??
    existingData?.generatedChapterDrafts.find((draft) => draft.id === bundle.generatedDraftId)
  if (!referencedDraft) {
    throw new Error(`ChapterCommitBundle references missing generatedDraftId ${bundle.generatedDraftId}.`)
  }
  if (
    referencedDraft.projectId !== bundle.projectId ||
    referencedDraft.chapterId !== bundle.chapterId ||
    (bundle.jobId && referencedDraft.jobId !== bundle.jobId)
  ) {
    throw new Error(`GeneratedChapterDraft ${referencedDraft.id} does not match the chapter commit scope.`)
  }
}

function validateExistingReferences(bundle: ChapterCommitBundle, existingData: AppData): void {
  const existingCommit = existingData.chapterCommitBundles.find(
    (commit) => commit.commitId === bundle.commitId || commit.id === bundle.id
  )
  assertImmutableCommit(existingCommit, bundle, 'ChapterCommitBundle')
  if (!existingCommit) validateCurrentAcceptanceReview(bundle, existingData)

  assertNoCrossProjectIdCollision(existingData.chapters, [bundle.chapter], 'Chapter')
  assertNoCrossProjectIdCollision(
    existingData.chapterVersions,
    [bundle.previousChapterVersion, bundle.chapterVersion].filter(
      (version): version is ChapterVersion => Boolean(version)
    ),
    'ChapterVersion'
  )
  assertNoCrossProjectIdCollision(
    existingData.generatedChapterDrafts,
    bundle.generatedDraft ? [bundle.generatedDraft] : [],
    'GeneratedChapterDraft'
  )
  assertNoCrossProjectIdCollision(existingData.qualityGateReports, bundle.qualityGateReports, 'QualityGateReport')
  assertNoCrossProjectIdCollision(
    existingData.consistencyReviewReports,
    bundle.consistencyReviewReports,
    'ConsistencyReviewReport'
  )
  assertNoCrossProjectIdCollision(existingData.redundancyReports, bundle.redundancyReports, 'RedundancyReport')
  assertNoCrossProjectIdCollision(
    existingData.memoryUpdateCandidates,
    bundle.acceptedMemoryUpdateCandidates,
    'MemoryUpdateCandidate'
  )
  assertNoCrossProjectIdCollision(
    existingData.characterStateChangeCandidates,
    bundle.acceptedCharacterStateChangeCandidates,
    'CharacterStateChangeCandidate'
  )
  assertNoCrossProjectIdCollision(existingData.characterStateFacts, bundle.appliedCharacterStateFacts, 'CharacterStateFact')
  assertNoCrossProjectIdCollision(
    existingData.characterStateTransactions,
    bundle.appliedCharacterStateTransactions,
    'CharacterStateTransaction'
  )
  assertNoCrossProjectIdCollision(existingData.foreshadowings, bundle.appliedForeshadowingUpdates, 'Foreshadowing')
  assertNoCrossProjectIdCollision(existingData.timelineEvents, bundle.appliedTimelineEvents, 'TimelineEvent')
  assertNoCrossProjectIdCollision(
    existingData.generationRunTraces,
    bundle.generationRunTrace ? [bundle.generationRunTrace] : [],
    'GenerationRunTrace'
  )

  const existingDraft = bundle.generatedDraftId
    ? existingData.generatedChapterDrafts.find((draft) => draft.id === bundle.generatedDraftId)
    : null
  if (existingDraft && existingDraft.status !== 'draft' && !existingCommit) {
    throw new Error(`Generated draft ${existingDraft.id} is already ${existingDraft.status} and cannot be committed again.`)
  }

  const existingJob = bundle.jobId ? existingData.chapterGenerationJobs.find((job) => job.id === bundle.jobId) : null
  if (existingJob) {
    if (existingJob.projectId !== bundle.projectId) throw new Error('ChapterCommitBundle job projectId mismatch.')
    if (existingJob.targetChapterOrder !== bundle.chapter.order) {
      throw new Error('ChapterCommitBundle chapter order does not match the generation job target.')
    }
  }

  for (const version of [bundle.previousChapterVersion, bundle.chapterVersion]) {
    if (!version) continue
    const existingVersion = existingData.chapterVersions.find((item) => item.id === version.id)
    assertImmutableCommit(existingVersion, version, 'ChapterVersion')
  }

  validateReportReferences(bundle, existingData)
}

function validateReportReferences(bundle: ChapterCommitBundle, existingData: AppData): void {
  if (bundle.qualityGateReportId) {
    const report =
      bundle.qualityGateReports?.find((item) => item.id === bundle.qualityGateReportId) ??
      existingData.qualityGateReports.find((item) => item.id === bundle.qualityGateReportId)
    if (!report) throw new Error(`ChapterCommitBundle references missing qualityGateReportId ${bundle.qualityGateReportId}.`)
    if (
      report.projectId !== bundle.projectId ||
      report.chapterId !== bundle.chapterId ||
      (bundle.jobId && report.jobId !== bundle.jobId) ||
      (bundle.generatedDraftId && report.draftId !== bundle.generatedDraftId)
    ) {
      throw new Error(`QualityGateReport ${report.id} does not match the chapter commit scope.`)
    }
  }

  if (bundle.consistencyReviewReportId) {
    const report =
      bundle.consistencyReviewReports?.find((item) => item.id === bundle.consistencyReviewReportId) ??
      existingData.consistencyReviewReports.find((item) => item.id === bundle.consistencyReviewReportId)
    if (!report) {
      throw new Error(`ChapterCommitBundle references missing consistencyReviewReportId ${bundle.consistencyReviewReportId}.`)
    }
    if (
      report.projectId !== bundle.projectId ||
      report.chapterId !== bundle.chapterId ||
      (bundle.jobId && report.jobId !== bundle.jobId)
    ) {
      throw new Error(`ConsistencyReviewReport ${report.id} does not match the chapter commit scope.`)
    }
  }

  if (bundle.generationRunTraceId) {
    const trace =
      (bundle.generationRunTrace?.id === bundle.generationRunTraceId ? bundle.generationRunTrace : null) ??
      existingData.generationRunTraces.find((item) => item.id === bundle.generationRunTraceId)
    if (!trace) {
      throw new Error(`ChapterCommitBundle references missing generationRunTraceId ${bundle.generationRunTraceId}.`)
    }
    if (
      trace.projectId !== bundle.projectId ||
      trace.targetChapterOrder !== bundle.chapter.order ||
      (bundle.jobId && trace.jobId !== bundle.jobId)
    ) {
      throw new Error(`GenerationRunTrace ${trace.id} does not match the chapter commit scope.`)
    }
  }
}

export function validateChapterCommitBundleData(
  bundle: ChapterCommitBundle,
  existingData: AppData | undefined,
  schemaVersion: number
): void {
  validateCore(bundle, schemaVersion)
  validateAcceptanceReviewShape(bundle)
  validateReports(bundle)
  validateStateAndMemory(bundle, existingData)
  validateWorldAndTrace(bundle, existingData)
  if (existingData) validateExistingReferences(bundle, existingData)
}
