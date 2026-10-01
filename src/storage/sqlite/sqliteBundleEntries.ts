import type {
  AppData,
  ChapterCommitBundle,
  GenerationRunBundle,
  RevisionCommitBundle
} from '../../shared/types'
import type { SqliteEntityEntry } from './sqliteTypes'

export function isPersistedCommitBundle(
  existing: AppData,
  bundle: ChapterCommitBundle | RevisionCommitBundle
): boolean {
  return 'commitId' in bundle
    ? existing.chapterCommitBundles.some((commit) => commit.commitId === bundle.commitId || commit.id === bundle.id)
    : existing.revisionCommitBundles.some(
        (commit) => commit.revisionCommitId === bundle.revisionCommitId || commit.id === bundle.id
      )
}

export function generationBundleEntityEntries(
  bundle: GenerationRunBundle
): SqliteEntityEntry[] {
  return [
    { collection: 'chapterGenerationJobs', value: bundle.job },
    ...bundle.steps.map((value) => ({ collection: 'chapterGenerationSteps' as const, value })),
    ...(bundle.promptContextSnapshot
      ? [{ collection: 'promptContextSnapshots' as const, value: bundle.promptContextSnapshot }]
      : []),
    ...(bundle.contextNeedPlans ?? []).map((value) => ({ collection: 'contextNeedPlans' as const, value })),
    ...(bundle.contextBudgetProfiles ?? []).map((value) => ({ collection: 'contextBudgetProfiles' as const, value })),
    ...bundle.generatedDrafts.map((value) => ({ collection: 'generatedChapterDrafts' as const, value })),
    ...bundle.qualityGateReports.map((value) => ({ collection: 'qualityGateReports' as const, value })),
    ...bundle.consistencyReviewReports.map((value) => ({ collection: 'consistencyReviewReports' as const, value })),
    ...bundle.memoryUpdateCandidates.map((value) => ({ collection: 'memoryUpdateCandidates' as const, value })),
    ...bundle.characterStateChangeCandidates.map((value) => ({ collection: 'characterStateChangeCandidates' as const, value })),
    ...bundle.redundancyReports.map((value) => ({
      collection: 'redundancyReports' as const,
      value,
      indexJobId: bundle.jobId
    })),
    ...(bundle.editorialVerdicts ?? []).map((value) => ({
      collection: 'editorialVerdicts' as const,
      value
    })),
    ...(bundle.runTrace
      ? [{ collection: 'generationRunTraces' as const, value: bundle.runTrace }]
      : [])
  ]
}

export function chapterCommitEntityEntries(
  bundle: ChapterCommitBundle,
  nextData: AppData
): SqliteEntityEntry[] {
  const entries: SqliteEntityEntry[] = [
    {
      collection: 'chapterCommitBundles',
      value: bundle,
      indexJobId: bundle.jobId ?? null
    },
    { collection: 'chapters', value: bundle.chapter }
  ]

  if (bundle.previousChapterVersion) {
    entries.push({ collection: 'chapterVersions', value: bundle.previousChapterVersion })
  }
  if (bundle.chapterVersion) {
    entries.push({ collection: 'chapterVersions', value: bundle.chapterVersion })
  }

  const draft = bundle.generatedDraft
    ?? nextData.generatedChapterDrafts.find((item) => item.id === bundle.generatedDraftId)
  if (draft) entries.push({ collection: 'generatedChapterDrafts', value: draft })

  for (const report of bundle.qualityGateReports ?? []) {
    entries.push({ collection: 'qualityGateReports', value: report })
  }
  for (const report of bundle.consistencyReviewReports ?? []) {
    entries.push({ collection: 'consistencyReviewReports', value: report })
  }
  for (const report of bundle.redundancyReports ?? []) {
    entries.push({ collection: 'redundancyReports', value: report })
  }
  for (const candidate of bundle.acceptedMemoryUpdateCandidates ?? []) {
    entries.push({ collection: 'memoryUpdateCandidates', value: candidate })
  }
  for (const candidate of bundle.acceptedCharacterStateChangeCandidates ?? []) {
    entries.push({ collection: 'characterStateChangeCandidates', value: candidate })
  }
  for (const fact of bundle.appliedCharacterStateFacts ?? []) {
    entries.push({ collection: 'characterStateFacts', value: fact })
  }
  for (const transaction of bundle.appliedCharacterStateTransactions ?? []) {
    entries.push({
      collection: 'characterStateTransactions',
      value: { ...transaction, chapterId: transaction.chapterId ?? bundle.chapterId }
    })
  }
  for (const foreshadowing of bundle.appliedForeshadowingUpdates ?? []) {
    entries.push({ collection: 'foreshadowings', value: foreshadowing })
  }
  for (const event of bundle.appliedTimelineEvents ?? []) {
    entries.push({ collection: 'timelineEvents', value: event })
  }
  if (bundle.generationRunTrace) {
    entries.push({ collection: 'generationRunTraces', value: bundle.generationRunTrace })
  }

  return entries
}

export function revisionCommitEntityEntries(
  bundle: RevisionCommitBundle,
  nextData: AppData
): SqliteEntityEntry[] {
  const entries: SqliteEntityEntry[] = [
    { collection: 'revisionCommitBundles', value: bundle },
    { collection: 'chapters', value: bundle.chapter },
    { collection: 'chapterVersions', value: bundle.chapterVersion }
  ]

  if (bundle.generatedDraft) {
    entries.push({ collection: 'generatedChapterDrafts', value: bundle.generatedDraft })
  }

  const revisionSession = bundle.revisionSession
    ?? nextData.revisionSessions.find((item) => item.id === bundle.revisionSessionId)
  const revisionVersion = bundle.revisionVersion
    ?? nextData.revisionVersions.find((item) => item.id === bundle.revisionVersionId)
  const generationRunTrace = bundle.generationRunTrace
    ?? nextData.generationRunTraces.find((item) => item.id === bundle.linkedGenerationRunTraceId)

  if (revisionSession) entries.push({ collection: 'revisionSessions', value: revisionSession })
  if (revisionVersion) entries.push({ collection: 'revisionVersions', value: revisionVersion })
  if (generationRunTrace) {
    entries.push({ collection: 'generationRunTraces', value: generationRunTrace })
  }

  return entries
}
