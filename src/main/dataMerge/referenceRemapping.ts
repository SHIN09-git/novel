import type { AppData, ID } from '../../shared/types'
import { ALL_ENTITY_COLLECTIONS, type AppDataArrayKey } from '../../shared/appDataCollections'

export type { AppDataArrayKey } from '../../shared/appDataCollections'

export type Entity = Record<string, unknown>
type IdMap = Map<ID, ID>

export type IdRemaps = Partial<Record<AppDataArrayKey, IdMap>> & {
  any: IdMap
  ambiguous: Set<ID>
  unresolvedGenericReferences: Set<ID>
}

const REFERENCE_COLLECTION_BY_KEY: Partial<Record<string, AppDataArrayKey>> = {
  projectId: 'projects',
  agentRunId: 'agentRuns',
  actionPreviewId: 'agentActionPreviews',
  receiptId: 'candidateDecisionReceipts',
  undoesReceiptId: 'candidateDecisionReceipts',
  jobId: 'chapterGenerationJobs',
  createdJobIds: 'chapterGenerationJobs',
  chapterId: 'chapters',
  sourceChapterId: 'chapters',
  fromChapterId: 'chapters',
  targetChapterId: 'chapters',
  relatedChapterId: 'chapters',
  originalChapterId: 'chapters',
  selectedChapterIds: 'chapters',
  generatedFromChapterIds: 'chapters',
  relatedChapterIds: 'chapters',
  newlyRequiredChapterIds: 'chapters',
  characterId: 'characters',
  selectedCharacterIds: 'characters',
  relatedCharacterIds: 'characters',
  newlyRequiredCharacterIds: 'characters',
  affectedCharacterIds: 'characters',
  foreshadowingId: 'foreshadowings',
  selectedForeshadowingIds: 'foreshadowings',
  requiredForeshadowingIds: 'foreshadowings',
  forbiddenForeshadowingIds: 'foreshadowings',
  relatedForeshadowingIds: 'foreshadowings',
  newlyRequiredForeshadowingIds: 'foreshadowings',
  advancedForeshadowingIds: 'foreshadowings',
  resolvedForeshadowingIds: 'foreshadowings',
  affectedForeshadowingIds: 'foreshadowings',
  timelineEventId: 'timelineEvents',
  selectedTimelineEventIds: 'timelineEvents',
  requiredTimelineEventIds: 'timelineEvents',
  newlyRequiredTimelineEventIds: 'timelineEvents',
  relatedTimelineEventIds: 'timelineEvents',
  affectedTimelineEventIds: 'timelineEvents',
  selectedStageSummaryIds: 'stageSummaries',
  generatedFromStageSummaryIds: 'stageSummaries',
  draftId: 'generatedChapterDrafts',
  generatedDraftId: 'generatedChapterDrafts',
  sourceDraftId: 'generatedChapterDrafts',
  createdDraftIds: 'generatedChapterDrafts',
  promptContextSnapshotId: 'promptContextSnapshots',
  contextNeedPlanId: 'contextNeedPlans',
  baseContextNeedPlanId: 'contextNeedPlans',
  budgetProfileId: 'contextBudgetProfiles',
  consistencyReviewReportId: 'consistencyReviewReports',
  qualityGateReportId: 'qualityGateReports',
  sourceEditorialVerdictId: 'editorialVerdicts',
  redundancyReportId: 'redundancyReports',
  redundancyReportIds: 'redundancyReports',
  generationRunTraceId: 'generationRunTraces',
  linkedGenerationRunTraceId: 'generationRunTraces',
  traceId: 'generationRunTraces',
  continuityBridgeId: 'chapterContinuityBridges',
  revisionSessionId: 'revisionSessions',
  revisionSessionIds: 'revisionSessions',
  sessionId: 'revisionSessions',
  revisionVersionId: 'revisionVersions',
  acceptedRevisionVersionId: 'revisionVersions',
  requestId: 'revisionRequests',
  chapterVersionId: 'chapterVersions',
  newChapterVersionId: 'chapterVersions',
  baseChapterVersionId: 'chapterVersions',
  commitId: 'chapterCommitBundles',
  linkedChapterCommitId: 'chapterCommitBundles',
  revisionCommitId: 'revisionCommitBundles',
  linkedRevisionCommitId: 'revisionCommitBundles',
  factId: 'characterStateFacts',
  targetFactId: 'characterStateFacts',
  linkedFactId: 'characterStateFacts',
  includedCharacterStateFactIds: 'characterStateFacts',
  linkedCandidateId: 'characterStateChangeCandidates',
  acceptedMemoryCandidateIds: 'memoryUpdateCandidates',
  rejectedMemoryCandidateIds: 'memoryUpdateCandidates',
  storyDirectionGuideId: 'storyDirectionGuides'
}

const EMBEDDED_ENTITY_COLLECTION_BY_KEY: Partial<Record<string, AppDataArrayKey>> = {
  chapter: 'chapters',
  chapterVersion: 'chapterVersions',
  generatedDraft: 'generatedChapterDrafts',
  revisionSession: 'revisionSessions',
  revisionVersion: 'revisionVersions',
  generationRunTrace: 'generationRunTraces',
  runTrace: 'generationRunTraces',
  promptContextSnapshot: 'promptContextSnapshots',
  contextNeedPlan: 'contextNeedPlans',
  budgetProfile: 'contextBudgetProfiles',
  storyDirectionGuide: 'storyDirectionGuides',
  proposedFact: 'characterStateFacts',
  proposedTransaction: 'characterStateTransactions',
  steps: 'chapterGenerationSteps',
  contextNeedPlans: 'contextNeedPlans',
  contextBudgetProfiles: 'contextBudgetProfiles',
  generatedDrafts: 'generatedChapterDrafts',
  qualityGateReports: 'qualityGateReports',
  consistencyReviewReports: 'consistencyReviewReports',
  memoryUpdateCandidates: 'memoryUpdateCandidates',
  acceptedMemoryUpdateCandidates: 'memoryUpdateCandidates',
  characterStateChangeCandidates: 'characterStateChangeCandidates',
  acceptedCharacterStateChangeCandidates: 'characterStateChangeCandidates',
  appliedCharacterStateFacts: 'characterStateFacts',
  appliedCharacterStateTransactions: 'characterStateTransactions',
  appliedForeshadowingUpdates: 'foreshadowings',
  appliedTimelineEvents: 'timelineEvents',
  redundancyReports: 'redundancyReports'
}

const RECORD_KEY_COLLECTION_BY_KEY: Partial<Record<string, AppDataArrayKey>> = {
  requiredCharacterCardFields: 'characters',
  requiredStateFactCategories: 'characters',
  newlyRequiredStateFactCategories: 'characters',
  foreshadowingTreatmentModes: 'foreshadowings',
  foreshadowingTreatmentOverrides: 'foreshadowings'
}

const RETRIEVAL_TYPE_COLLECTION: Partial<Record<string, AppDataArrayKey>> = {
  character_card: 'characters',
  character_state: 'characters',
  foreshadowing: 'foreshadowings',
  timeline: 'timelineEvents',
  story_bible: 'storyBibles',
  stage_summary: 'stageSummaries',
  chapter_ending: 'chapters',
  hard_canon: 'hardCanonPacks',
  story_direction: 'storyDirectionGuides',
  recent_chapter: 'chapters'
}

const NEED_SOURCE_COLLECTION: Partial<Record<string, AppDataArrayKey>> = {
  character: 'characters',
  character_state: 'characters',
  foreshadowing: 'foreshadowings',
  timeline: 'timelineEvents',
  stageSummary: 'stageSummaries',
  hardCanon: 'hardCanonPacks',
  storyDirection: 'storyDirectionGuides',
  chapterEnding: 'chapters',
  recentChapter: 'chapters'
}

const WORLD_ENTITY_COLLECTION: Partial<Record<string, AppDataArrayKey>> = {
  character: 'characters',
  character_state: 'characterStateFacts',
  foreshadowing: 'foreshadowings',
  timeline_event: 'timelineEvents',
  story_direction: 'storyDirectionGuides'
}

function worldReceiptCollection(owner: Entity): AppDataArrayKey | undefined {
  return typeof owner.commandFingerprint === 'string' && typeof owner.previewFingerprint === 'string' &&
    typeof owner.entity === 'string' ? WORLD_ENTITY_COLLECTION[owner.entity] : undefined
}

export function createIdRemaps(): IdRemaps {
  return {
    any: new Map<ID, ID>(),
    ambiguous: new Set<ID>(),
    unresolvedGenericReferences: new Set<ID>()
  }
}

function getRemap(remaps: IdRemaps, collection: AppDataArrayKey): IdMap {
  remaps[collection] ??= new Map<ID, ID>()
  return remaps[collection] as IdMap
}

export function rememberId(
  remaps: IdRemaps,
  collection: AppDataArrayKey,
  oldId: ID,
  newId: ID
) {
  getRemap(remaps, collection).set(oldId, newId)

  const existing = remaps.any.get(oldId)
  if (existing === undefined || existing === newId) {
    if (!remaps.ambiguous.has(oldId)) remaps.any.set(oldId, newId)
    return
  }

  remaps.any.delete(oldId)
  remaps.ambiguous.add(oldId)
}

function remapId(
  remaps: IdRemaps,
  id: unknown,
  collection?: AppDataArrayKey
): unknown {
  if (typeof id !== 'string') return id
  if (collection) return remaps[collection]?.get(id) ?? id
  if (remaps.ambiguous.has(id)) {
    remaps.unresolvedGenericReferences.add(id)
    return id
  }
  return remaps.any.get(id) ?? id
}

function isIdKey(key: string): boolean {
  return key === 'id' || key.endsWith('Id')
}

function isIdsKey(key: string): boolean {
  return key.endsWith('Ids')
}

function discriminatedCollection(
  owner: Entity,
  parentKey: string,
  fieldKey: string
): AppDataArrayKey | undefined {
  if (fieldKey === 'targetId') return worldReceiptCollection(owner)
  if ((parentKey === 'retrievalPriorities' || parentKey === 'exclusionRules') && fieldKey === 'id') {
    return typeof owner.type === 'string' ? RETRIEVAL_TYPE_COLLECTION[owner.type] : undefined
  }
  if (parentKey === 'contextNeeds' && fieldKey === 'sourceId') {
    return typeof owner.sourceHint === 'string' ? NEED_SOURCE_COLLECTION[owner.sourceHint] : undefined
  }
  if ((parentKey === 'decisions' || parentKey === 'amendments') && fieldKey === 'candidateId') {
    return owner.kind === 'memory' ? 'memoryUpdateCandidates'
      : owner.kind === 'character_state' ? 'characterStateChangeCandidates' : undefined
  }
  if (parentKey === 'changedRecords' && fieldKey === 'ids' &&
    ALL_ENTITY_COLLECTIONS.includes(owner.collection as AppDataArrayKey)) {
    return owner.collection as AppDataArrayKey
  }
  return undefined
}

function remapReference(
  remaps: IdRemaps,
  value: unknown,
  fieldKey: string,
  owner?: Entity,
  parentKey = ''
): unknown {
  const collection = REFERENCE_COLLECTION_BY_KEY[fieldKey]
    ?? (owner ? discriminatedCollection(owner, parentKey, fieldKey) : undefined)
  return remapId(remaps, value, collection)
}

export function remapReferencesDeep(
  value: unknown,
  remaps: IdRemaps,
  key = '',
  depth = 0
): unknown {
  if (Array.isArray(value)) {
    if (isIdsKey(key)) return value.map((entry) => remapReference(remaps, entry, key))
    return value.map((entry) => remapReferencesDeep(entry, remaps, key, depth + 1))
  }
  if (!value || typeof value !== 'object') {
    return isIdKey(key) ? remapReference(remaps, value, key) : value
  }

  const entity = value as Entity
  // Field snapshots encode IDs in values and path segments without collection metadata.
  // A remapped import keeps receipts, but cannot safely replay these historical effects.
  const invalidateEffects = typeof entity.commandFingerprint === 'string' && Array.isArray(entity.decisions) &&
    Array.isArray(entity.changedRecords) && Object.values(remaps).some((map) => map instanceof Map &&
      [...map].some(([oldId, newId]) => oldId !== newId))
  const recordKeyCollection = RECORD_KEY_COLLECTION_BY_KEY[key]
  return Object.entries(entity).reduce<Entity>((acc, [entryKey, entryValue]) => {
    if (invalidateEffects && entryKey === 'effects') return acc
    const outputKey = recordKeyCollection
      ? String(remapId(remaps, entryKey, recordKeyCollection))
      : entryKey
    if (entryKey === 'id') {
      const idCollection = depth > 0
        ? EMBEDDED_ENTITY_COLLECTION_BY_KEY[key] ?? discriminatedCollection(entity, key, entryKey)
        : undefined
      acc[outputKey] = idCollection
        ? remapId(remaps, entryValue, idCollection)
        : entryValue
    } else if (isIdKey(entryKey)) {
      acc[outputKey] = remapReference(remaps, entryValue, entryKey, entity, key)
    } else if ((isIdsKey(entryKey) || discriminatedCollection(entity, key, entryKey)) && Array.isArray(entryValue)) {
      acc[outputKey] = entryValue.map((entry) => remapReference(remaps, entry, entryKey, entity, key))
    } else {
      acc[outputKey] = remapReferencesDeep(entryValue, remaps, entryKey, depth + 1)
      // Receipts retain historical field values; only their entity references
      // follow a remapped import. Original fingerprints are not replay authority.
      const worldCollection = (entryKey === 'before' || entryKey === 'after') ? worldReceiptCollection(entity) : undefined
      if (worldCollection && acc[outputKey] && typeof acc[outputKey] === 'object' && !Array.isArray(acc[outputKey])) {
        const snapshot = acc[outputKey] as Entity
        snapshot.id = remapId(remaps, snapshot.id, worldCollection)
      }
    }
    return acc
  }, {})
}
