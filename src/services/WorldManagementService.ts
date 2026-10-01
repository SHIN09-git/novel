import type {
  AppData,
  Character,
  CharacterStateFact,
  Foreshadowing,
  HardCanonItem,
  ID,
  StoryDirectionChapterBeat,
  StoryDirectionGuide,
  TimelineEvent,
  WorldManagedEntity,
  WorldManagementAction,
  WorldManagementCommand,
  WorldManagementReceipt,
  WorldManagementSource
} from '../shared/types'
import { normalizeTreatmentMode } from '../shared/foreshadowingTreatment'
import { normalizeStoryDirectionGuide } from '../shared/normalizers/storyDirection'
import { decisionFingerprint } from './candidateDecisionPrimitives'
import { CharacterStateService } from './CharacterStateService'
import { HardCanonPackService } from './HardCanonPackService'

export type { WorldManagedEntity, WorldManagementAction, WorldManagementCommand, WorldManagementSource } from '../shared/types'

export interface WorldManagementAudit {
  actor: 'agent'
  source: WorldManagementSource
  operationId: ID
  entity: WorldManagedEntity
  action: WorldManagementAction
  recordedAt: string
  receiptId: ID
  authorizationGrantId: ID | null
}

export interface WorldManagementResult {
  data: AppData
  result: {
    projectId: ID
    entity: WorldManagedEntity
    action: WorldManagementAction
    id: ID
    fingerprint: string
    changed: boolean
    replayed: boolean
    before: unknown | null
    after: unknown
    audit: WorldManagementAudit
  }
}

type ManagedRecord = Character | CharacterStateFact | Foreshadowing | TimelineEvent | HardCanonItem | StoryDirectionGuide

const ENTITY_VALUES: readonly WorldManagedEntity[] = [
  'character', 'character_state', 'foreshadowing', 'timeline_event', 'hard_canon', 'story_direction'
]
const ACTION_VALUES: readonly WorldManagementAction[] = ['create', 'update', 'set_status', 'archive']
const CHARACTER_FIELDS = [
  'name', 'role', 'surfaceGoal', 'deepDesire', 'coreFear', 'selfDeception', 'knownInformation',
  'unknownInformation', 'protagonistRelationship', 'emotionalState', 'nextActionTendency',
  'forbiddenWriting', 'roleFunction', 'deepNeed', 'decisionLogic', 'abilitiesAndResources',
  'weaknessAndCost', 'relationshipTension', 'futureHooks', 'lastChangedChapter', 'isMain'
] as const
const STATE_FIELDS = [
  'characterId', 'category', 'key', 'label', 'valueType', 'value', 'unit', 'linkedCardFields',
  'trackingLevel', 'promptPolicy', 'status', 'sourceChapterId', 'sourceChapterOrder', 'evidence', 'confidence'
] as const
const FORESHADOWING_FIELDS = [
  'title', 'firstChapterOrder', 'description', 'status', 'weight', 'treatmentMode', 'expectedPayoff',
  'payoffMethod', 'relatedCharacterIds', 'relatedMainPlot', 'notes', 'actualPayoffChapter'
] as const
const TIMELINE_FIELDS = [
  'title', 'chapterOrder', 'storyTime', 'narrativeOrder', 'participantCharacterIds', 'result', 'downstreamImpact'
] as const
const HARD_CANON_FIELDS = [
  'category', 'title', 'content', 'priority', 'status', 'sourceId', 'relatedCharacterIds',
  'relatedForeshadowingIds', 'relatedTimelineEventIds'
] as const
const DIRECTION_FIELDS = [
  'title', 'status', 'horizonChapters', 'startChapterOrder', 'endChapterOrder', 'userRawIdea',
  'userPolishedIdea', 'aiGuidance', 'strategicTheme', 'coreDramaticPromise', 'emotionalCurve',
  'characterArcDirectives', 'foreshadowingDirectives', 'constraints', 'forbiddenTurns', 'chapterBeats',
  'generatedFromStageSummaryIds', 'generatedFromChapterIds', 'warnings'
] as const
const BEAT_FIELDS = [
  'id', 'chapterOffset', 'chapterOrder', 'goal', 'conflict', 'characterFocus', 'foreshadowingToUse',
  'foreshadowingNotToReveal', 'suspenseToKeep', 'endingHook', 'readerEmotion', 'mustAvoid', 'notes'
] as const
const CHARACTER_CARD_FIELDS = [
  'roleFunction', 'surfaceGoal', 'deepNeed', 'coreFear', 'decisionLogic', 'abilitiesAndResources',
  'weaknessAndCost', 'relationshipTension', 'futureHooks'
] as const
const STATE_CATEGORIES = ['resource', 'inventory', 'location', 'physical', 'mental', 'knowledge', 'relationship', 'goal', 'promise', 'secret', 'ability', 'status', 'custom'] as const
const STATE_VALUE_TYPES = ['string', 'number', 'boolean', 'list', 'text'] as const
const STATE_TRACKING_LEVELS = ['hard', 'soft', 'note'] as const
const STATE_PROMPT_POLICIES = ['always', 'when_relevant', 'manual_only'] as const
const STATE_STATUSES = ['active', 'resolved', 'inactive', 'retconned'] as const
const FORESHADOWING_STATUSES = ['unresolved', 'partial', 'resolved', 'abandoned'] as const
const FORESHADOWING_WEIGHTS = ['low', 'medium', 'high', 'payoff'] as const
const FORESHADOWING_TREATMENTS = ['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'] as const
const HARD_CANON_CATEGORIES = ['world_rule', 'system_rule', 'character_identity', 'character_hard_state', 'timeline_anchor', 'foreshadowing_rule', 'relationship_fact', 'prohibition', 'style_boundary', 'other'] as const
const HARD_CANON_PRIORITIES = ['must', 'high', 'medium'] as const
const HARD_CANON_STATUSES = ['active', 'inactive', 'deprecated'] as const
const DIRECTION_STATUSES = ['draft', 'active', 'archived'] as const

// Kept beside the service allowlists so Agent descriptors never drift from accepted fields.
export const WORLD_MANAGEMENT_FIELD_HELP = {
  character: { fields: CHARACTER_FIELDS, cardFields: CHARACTER_CARD_FIELDS },
  character_state: {
    fields: STATE_FIELDS,
    enums: {
      category: STATE_CATEGORIES, valueType: STATE_VALUE_TYPES, trackingLevel: STATE_TRACKING_LEVELS,
      promptPolicy: STATE_PROMPT_POLICIES, status: STATE_STATUSES, linkedCardFields: CHARACTER_CARD_FIELDS
    }
  },
  foreshadowing: {
    fields: FORESHADOWING_FIELDS,
    enums: { status: FORESHADOWING_STATUSES, weight: FORESHADOWING_WEIGHTS, treatmentMode: FORESHADOWING_TREATMENTS }
  },
  timeline_event: { fields: TIMELINE_FIELDS },
  hard_canon: {
    fields: HARD_CANON_FIELDS,
    enums: { category: HARD_CANON_CATEGORIES, priority: HARD_CANON_PRIORITIES, status: HARD_CANON_STATUSES }
  },
  story_direction: {
    fields: DIRECTION_FIELDS,
    enums: { status: DIRECTION_STATUSES, horizonChapters: [5, 10] as const },
    chapterBeatFields: BEAT_FIELDS
  }
} as const

function timestamp(source: WorldManagementSource): string {
  if (source.requestedAt !== undefined && !Number.isFinite(Date.parse(source.requestedAt))) {
    throw new Error('source.requestedAt must be a valid ISO timestamp.')
  }
  return source.requestedAt ?? new Date().toISOString()
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

function recordId(entity: WorldManagedEntity, operationId: string): ID {
  return `world-${entity}-${operationId}`
}

function requireProject(data: AppData, projectId: ID): void {
  if (!data.projects.some((project) => project.id === projectId)) throw new Error(`Project not found: ${projectId}`)
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function assertOnlyFields(patch: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(patch).filter((field) => !allowed.includes(field))
  if (unknown.length) throw new Error(`${label} contains unsupported fields: ${unknown.join(', ')}.`)
}

function assertOptionalString(patch: Record<string, unknown>, fields: readonly string[], label: string, nullable = false): void {
  for (const field of fields) {
    if (nullable && patch[field] === null) continue
    if (patch[field] !== undefined && typeof patch[field] !== 'string') throw new Error(`${label}.${field} must be a string.`)
  }
}

function assertOptionalEnum(patch: Record<string, unknown>, field: string, values: readonly string[], label: string): void {
  if (patch[field] !== undefined && (typeof patch[field] !== 'string' || !values.includes(patch[field]))) {
    throw new Error(`${label}.${field} must be one of: ${values.join(', ')}.`)
  }
}

function assertOptionalInteger(patch: Record<string, unknown>, fields: readonly string[], label: string, nullable = true): void {
  for (const field of fields) {
    const value = patch[field]
    if (value === undefined || (nullable && value === null)) continue
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}.${field} must be a non-negative integer or null.`)
  }
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`)
  }
}

function assertEnumArray(value: unknown, values: readonly string[], label: string): void {
  assertStringArray(value, label)
  if ((value as string[]).some((item) => !values.includes(item))) {
    throw new Error(`${label} contains an unsupported value.`)
  }
}

function assertStateValue(value: unknown, label: string): void {
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return
  throw new Error(`${label} must be a string, finite number, boolean, or string array.`)
}

function assertReferences(data: AppData, projectId: ID, ids: unknown, collection: 'characters' | 'foreshadowings' | 'timelineEvents', label: string): void {
  if (ids === undefined) return
  assertStringArray(ids, label)
  const known = new Set((data[collection] as Array<{ id: ID; projectId: ID }>).filter((item) => item.projectId === projectId).map((item) => item.id))
  for (const id of ids as string[]) if (!known.has(id)) throw new Error(`${label} references a missing or foreign record: ${id}`)
}

function projectTimestamp(data: AppData, projectId: ID, updatedAt: string): AppData {
  return {
    ...data,
    projects: data.projects.map((project) => project.id === projectId ? { ...project, updatedAt } : project)
  }
}

function statusForRecord(entity: WorldManagedEntity, record: ManagedRecord): string | null {
  if (entity === 'character' || entity === 'timeline_event') return null
  return String((record as { status: string }).status)
}

function itemCollection(data: AppData, projectId: ID, entity: WorldManagedEntity): ManagedRecord[] {
  if (entity === 'character') return data.characters.filter((item) => item.projectId === projectId)
  if (entity === 'character_state') return data.characterStateFacts.filter((item) => item.projectId === projectId)
  if (entity === 'foreshadowing') return data.foreshadowings.filter((item) => item.projectId === projectId)
  if (entity === 'timeline_event') return data.timelineEvents.filter((item) => item.projectId === projectId)
  if (entity === 'story_direction') return data.storyDirectionGuides.filter((item) => item.projectId === projectId)
  return HardCanonPackService.getHardCanonPackForProject(data, projectId).items
}

function findRecord(data: AppData, projectId: ID, entity: WorldManagedEntity, id: ID): ManagedRecord | null {
  return itemCollection(data, projectId, entity).find((item) => item.id === id) ?? null
}

// Keep this in lockstep with HardCanonPackService.upsertHardCanonItem. The
// domain service intentionally coalesces a sourced duplicate onto its old ID;
// an Agent operation must instead name that ID and make an explicit update.
function findHardCanonDeduplicationConflict(data: AppData, projectId: ID, candidate: HardCanonItem): HardCanonItem | null {
  const sourceId = candidate.sourceId
  if (!sourceId) return null
  const sourceType = candidate.sourceType ?? 'manual'
  const content = candidate.content.trim()
  return HardCanonPackService.getHardCanonPackForProject(data, projectId).items.find((existing) =>
    existing.id !== candidate.id &&
    Boolean(existing.sourceId) &&
    existing.sourceId === sourceId &&
    existing.sourceType === sourceType &&
    existing.category === candidate.category &&
    existing.content.trim() === content
  ) ?? null
}

function assertNoHardCanonDeduplicationConflict(data: AppData, projectId: ID, candidate: HardCanonItem): void {
  const duplicate = findHardCanonDeduplicationConflict(data, projectId, candidate)
  if (duplicate) {
    throw new Error(`HardCanon already exists for this source and content: ${duplicate.id}. Use action "update" with id "${duplicate.id}" instead.`)
  }
}

function sameManagedFields(left: ManagedRecord, right: ManagedRecord): boolean {
  const { createdAt: _leftCreatedAt, updatedAt: _leftUpdatedAt, ...leftStable } = left as ManagedRecord & { createdAt: string; updatedAt: string }
  const { createdAt: _rightCreatedAt, updatedAt: _rightUpdatedAt, ...rightStable } = right as ManagedRecord & { createdAt: string; updatedAt: string }
  return decisionFingerprint(leftStable) === decisionFingerprint(rightStable)
}

function sourceFor(command: WorldManagementCommand): WorldManagementSource {
  const source = requireObject(command.source, 'source')
  assertOnlyFields(source, ['kind', 'reason', 'agentRunId', 'requestedAt'], 'source')
  if (source.kind !== 'agent_director') {
    throw new Error('World records can only be canonized by an explicit agent_director action; AI detection output is not a canon source.')
  }
  const result: WorldManagementSource = {
    kind: 'agent_director', reason: requireString(source.reason, 'source.reason')
  }
  if (source.agentRunId !== undefined) result.agentRunId = requireString(source.agentRunId, 'source.agentRunId')
  if (source.requestedAt !== undefined) result.requestedAt = requireString(source.requestedAt, 'source.requestedAt')
  return result
}

function normalizeCommand(data: AppData, input: WorldManagementCommand): WorldManagementCommand {
  const entity = input.entity
  const action = input.action
  if (!ENTITY_VALUES.includes(entity)) throw new Error(`Unsupported world entity: ${String(entity)}`)
  if (!ACTION_VALUES.includes(action)) throw new Error(`Unsupported world action: ${String(action)}`)
  const projectId = requireString(input.projectId, 'projectId')
  requireProject(data, projectId)
  const operationId = requireString(input.operationId, 'operationId')
  const patch = input.patch === undefined ? {} : requireObject(input.patch, 'patch')
  const id = input.id === undefined ? undefined : requireString(input.id, 'id')
  if ((action === 'update' || action === 'set_status' || action === 'archive') && !id) throw new Error(`${action} requires id.`)
  if (action === 'create' && id !== undefined) throw new Error('create assigns an ID from operationId; do not supply id.')
  return { projectId, entity, action, operationId, ...(id ? { id } : {}), patch, source: sourceFor(input), expectedFingerprint: input.expectedFingerprint }
}

function requireAgentRun(data: AppData, command: WorldManagementCommand): void {
  if (command.source.agentRunId && !data.agentRuns.some((run) => run.id === command.source.agentRunId && run.projectId === command.projectId)) {
    throw new Error(`AgentRun does not belong to project: ${command.source.agentRunId}`)
  }
}

function validateStateSourceChapter(
  data: AppData,
  projectId: ID,
  sourceChapterId: unknown,
  sourceChapterOrder: unknown,
  label: string
): void {
  const chapterId = sourceChapterId === null || sourceChapterId === undefined ? null : requireString(sourceChapterId, `${label}.sourceChapterId`)
  const chapterOrder = sourceChapterOrder === null || sourceChapterOrder === undefined ? null : sourceChapterOrder
  if (chapterOrder !== null && (!Number.isSafeInteger(chapterOrder) || (chapterOrder as number) < 1)) {
    throw new Error(`${label}.sourceChapterOrder must be a positive integer or null.`)
  }
  const byId = chapterId ? data.chapters.find((chapter) => chapter.id === chapterId && chapter.projectId === projectId) : null
  if (chapterId && !byId) throw new Error(`${label}.sourceChapterId references a missing or foreign chapter: ${chapterId}`)
  if (chapterOrder !== null) {
    const byOrder = data.chapters.find((chapter) => chapter.projectId === projectId && chapter.order === chapterOrder)
    if (!byOrder) throw new Error(`${label}.sourceChapterOrder references a missing chapter in this project: ${chapterOrder}`)
    if (byId && byId.order !== chapterOrder) throw new Error(`${label}.sourceChapterId and sourceChapterOrder refer to different chapters.`)
  }
}

function validateCharacterPatch(patch: Record<string, unknown>): void {
  assertOnlyFields(patch, CHARACTER_FIELDS, 'character patch')
  assertOptionalString(patch, CHARACTER_FIELDS.filter((field) => !['lastChangedChapter', 'isMain'].includes(field)), 'character patch')
  assertOptionalInteger(patch, ['lastChangedChapter'], 'character patch')
  if (patch.isMain !== undefined && typeof patch.isMain !== 'boolean') throw new Error('character patch.isMain must be a boolean.')
}

function validateStatePatch(data: AppData, projectId: ID, patch: Record<string, unknown>): void {
  assertOnlyFields(patch, STATE_FIELDS, 'character state patch')
  assertOptionalString(patch, ['characterId', 'key', 'label', 'unit', 'sourceChapterId', 'evidence'], 'character state patch', true)
  assertOptionalInteger(patch, ['sourceChapterOrder'], 'character state patch')
  assertOptionalEnum(patch, 'category', STATE_CATEGORIES, 'character state patch')
  assertOptionalEnum(patch, 'valueType', STATE_VALUE_TYPES, 'character state patch')
  assertOptionalEnum(patch, 'trackingLevel', STATE_TRACKING_LEVELS, 'character state patch')
  assertOptionalEnum(patch, 'promptPolicy', STATE_PROMPT_POLICIES, 'character state patch')
  assertOptionalEnum(patch, 'status', STATE_STATUSES, 'character state patch')
  if (patch.value !== undefined) assertStateValue(patch.value, 'character state patch.value')
  if (patch.confidence !== undefined && (typeof patch.confidence !== 'number' || !Number.isFinite(patch.confidence) || patch.confidence < 0 || patch.confidence > 1)) {
    throw new Error('character state patch.confidence must be a number between 0 and 1.')
  }
  if (patch.linkedCardFields !== undefined) assertEnumArray(patch.linkedCardFields, CHARACTER_CARD_FIELDS, 'character state patch.linkedCardFields')
  validateStateSourceChapter(data, projectId, patch.sourceChapterId, patch.sourceChapterOrder, 'character state patch')
}

function validateForeshadowingPatch(data: AppData, projectId: ID, patch: Record<string, unknown>): void {
  assertOnlyFields(patch, FORESHADOWING_FIELDS, 'foreshadowing patch')
  assertOptionalString(patch, ['title', 'description', 'status', 'weight', 'treatmentMode', 'expectedPayoff', 'payoffMethod', 'relatedMainPlot', 'notes'], 'foreshadowing patch')
  assertOptionalInteger(patch, ['firstChapterOrder', 'actualPayoffChapter'], 'foreshadowing patch')
  assertOptionalEnum(patch, 'status', FORESHADOWING_STATUSES, 'foreshadowing patch')
  assertOptionalEnum(patch, 'weight', FORESHADOWING_WEIGHTS, 'foreshadowing patch')
  assertOptionalEnum(patch, 'treatmentMode', FORESHADOWING_TREATMENTS, 'foreshadowing patch')
  assertReferences(data, projectId, patch.relatedCharacterIds, 'characters', 'foreshadowing patch.relatedCharacterIds')
}

function validateTimelinePatch(data: AppData, projectId: ID, patch: Record<string, unknown>): void {
  assertOnlyFields(patch, TIMELINE_FIELDS, 'timeline patch')
  assertOptionalString(patch, ['title', 'storyTime', 'result', 'downstreamImpact'], 'timeline patch')
  assertOptionalInteger(patch, ['chapterOrder', 'narrativeOrder'], 'timeline patch')
  assertReferences(data, projectId, patch.participantCharacterIds, 'characters', 'timeline patch.participantCharacterIds')
}

function validateHardCanonPatch(data: AppData, projectId: ID, patch: Record<string, unknown>): void {
  assertOnlyFields(patch, HARD_CANON_FIELDS, 'HardCanon patch')
  assertOptionalString(patch, ['category', 'title', 'content', 'priority', 'status', 'sourceId'], 'HardCanon patch', true)
  assertOptionalEnum(patch, 'category', HARD_CANON_CATEGORIES, 'HardCanon patch')
  assertOptionalEnum(patch, 'priority', HARD_CANON_PRIORITIES, 'HardCanon patch')
  assertOptionalEnum(patch, 'status', HARD_CANON_STATUSES, 'HardCanon patch')
  assertReferences(data, projectId, patch.relatedCharacterIds, 'characters', 'HardCanon patch.relatedCharacterIds')
  assertReferences(data, projectId, patch.relatedForeshadowingIds, 'foreshadowings', 'HardCanon patch.relatedForeshadowingIds')
  assertReferences(data, projectId, patch.relatedTimelineEventIds, 'timelineEvents', 'HardCanon patch.relatedTimelineEventIds')
}

function validateDirectionPatch(data: AppData, projectId: ID, patch: Record<string, unknown>): void {
  assertOnlyFields(patch, DIRECTION_FIELDS, 'story direction patch')
  assertOptionalString(patch, ['title', 'status', 'userRawIdea', 'userPolishedIdea', 'aiGuidance', 'strategicTheme', 'coreDramaticPromise', 'emotionalCurve', 'characterArcDirectives', 'foreshadowingDirectives', 'constraints', 'forbiddenTurns'], 'story direction patch')
  assertOptionalInteger(patch, ['horizonChapters', 'startChapterOrder', 'endChapterOrder'], 'story direction patch', false)
  assertOptionalEnum(patch, 'status', DIRECTION_STATUSES, 'story direction patch')
  if (patch.horizonChapters !== undefined && patch.horizonChapters !== 5 && patch.horizonChapters !== 10) {
    throw new Error('story direction patch.horizonChapters must be 5 or 10.')
  }
  for (const field of ['generatedFromStageSummaryIds', 'generatedFromChapterIds', 'warnings'] as const) {
    if (patch[field] !== undefined) assertStringArray(patch[field], `story direction patch.${field}`)
  }
  if (patch.chapterBeats !== undefined) {
    if (!Array.isArray(patch.chapterBeats)) throw new Error('story direction patch.chapterBeats must be an array.')
    patch.chapterBeats.forEach((beat, index) => {
      const raw = requireObject(beat, `story direction patch.chapterBeats[${index}]`)
      assertOnlyFields(raw, BEAT_FIELDS, `story direction patch.chapterBeats[${index}]`)
      assertOptionalString(raw, BEAT_FIELDS.filter((field) => !['chapterOffset', 'chapterOrder'].includes(field)), `story direction patch.chapterBeats[${index}]`)
      assertOptionalInteger(raw, ['chapterOffset', 'chapterOrder'], `story direction patch.chapterBeats[${index}]`)
    })
  }
  if (patch.generatedFromStageSummaryIds !== undefined) {
    assertStringArray(patch.generatedFromStageSummaryIds, 'story direction patch.generatedFromStageSummaryIds')
    const known = new Set(data.stageSummaries.filter((item) => item.projectId === projectId).map((item) => item.id))
    for (const id of patch.generatedFromStageSummaryIds as string[]) {
      if (!known.has(id)) throw new Error(`story direction patch.generatedFromStageSummaryIds references a missing or foreign record: ${id}`)
    }
  }
  if (patch.generatedFromChapterIds !== undefined) {
    const known = new Set(data.chapters.filter((item) => item.projectId === projectId).map((item) => item.id))
    for (const id of patch.generatedFromChapterIds as string[]) {
      if (!known.has(id)) throw new Error(`story direction patch.generatedFromChapterIds references a missing or foreign record: ${id}`)
    }
  }
}

function assertActiveDirectionRange(guide: StoryDirectionGuide): void {
  if (guide.status !== 'active') return
  const expectedEnd = guide.startChapterOrder + guide.horizonChapters - 1
  if (guide.endChapterOrder !== expectedEnd) {
    throw new Error(`Active story direction must cover exactly ${guide.horizonChapters} chapters (${guide.startChapterOrder}-${expectedEnd}).`)
  }
  for (const beat of guide.chapterBeats) {
    const expectedOrder = guide.startChapterOrder + beat.chapterOffset - 1
    if (beat.chapterOffset < 1 || beat.chapterOffset > guide.horizonChapters ||
      (beat.chapterOrder !== null && beat.chapterOrder !== expectedOrder)) {
      throw new Error('Active story direction beats must stay within the guide range and match their chapterOffset.')
    }
  }
}

function characterFromPatch(projectId: ID, id: ID, patch: Record<string, unknown>, at: string): Character {
  validateCharacterPatch(patch)
  if (!patch.name || typeof patch.name !== 'string' || !patch.name.trim()) throw new Error('character patch.name is required for create.')
  return {
    id, projectId, name: patch.name.trim(), role: '', surfaceGoal: '', deepDesire: '', coreFear: '', selfDeception: '',
    knownInformation: '', unknownInformation: '', protagonistRelationship: '', emotionalState: '', nextActionTendency: '',
    forbiddenWriting: '', roleFunction: '', deepNeed: '', decisionLogic: '', abilitiesAndResources: '',
    weaknessAndCost: '', relationshipTension: '', futureHooks: '', lastChangedChapter: null, isMain: false,
    createdAt: at, updatedAt: at, ...patch
  } as Character
}

function stateFromPatch(data: AppData, projectId: ID, id: ID, patch: Record<string, unknown>): AppData {
  validateStatePatch(data, projectId, patch)
  const characterId = requireString(patch.characterId, 'character state patch.characterId')
  if (!data.characters.some((character) => character.id === characterId && character.projectId === projectId)) {
    throw new Error(`character state references a missing or foreign character: ${characterId}`)
  }
  const label = requireString(patch.label, 'character state patch.label')
  return CharacterStateService.createOrUpdateFact({ ...patch, id, projectId, characterId, label } as Parameters<typeof CharacterStateService.createOrUpdateFact>[0], data)
}

function foreshadowingFromPatch(projectId: ID, id: ID, patch: Record<string, unknown>, at: string): Foreshadowing {
  if (!patch.title || typeof patch.title !== 'string' || !patch.title.trim()) throw new Error('foreshadowing patch.title is required for create.')
  const status = patch.status === undefined ? 'unresolved' : patch.status
  const weight = patch.weight === undefined ? 'medium' : patch.weight
  return {
    id, projectId, title: patch.title.trim(), firstChapterOrder: null, description: '', status: status as Foreshadowing['status'],
    weight: weight as Foreshadowing['weight'], treatmentMode: normalizeTreatmentMode(patch.treatmentMode, status as Foreshadowing['status'], weight as Foreshadowing['weight']),
    expectedPayoff: '', payoffMethod: '', relatedCharacterIds: [], relatedMainPlot: '', notes: '', actualPayoffChapter: null,
    createdAt: at, updatedAt: at, ...patch
  } as Foreshadowing
}

function timelineFromPatch(projectId: ID, id: ID, patch: Record<string, unknown>, at: string): TimelineEvent {
  if (!patch.title || typeof patch.title !== 'string' || !patch.title.trim()) throw new Error('timeline patch.title is required for create.')
  return {
    id, projectId, title: patch.title.trim(), chapterOrder: null, storyTime: '', narrativeOrder: 0,
    participantCharacterIds: [], result: '', downstreamImpact: '', createdAt: at, updatedAt: at, ...patch
  } as TimelineEvent
}

function hardCanonFromPatch(projectId: ID, id: ID, patch: Record<string, unknown>, at: string): HardCanonItem {
  if (!patch.title || typeof patch.title !== 'string' || !patch.title.trim()) throw new Error('HardCanon patch.title is required for create.')
  if (!patch.content || typeof patch.content !== 'string' || !patch.content.trim()) throw new Error('HardCanon patch.content is required for create.')
  return {
    id, projectId, category: 'other', title: patch.title.trim(), content: patch.content.trim(), priority: 'medium', status: 'active',
    sourceType: 'manual', sourceId: null, relatedCharacterIds: [], relatedForeshadowingIds: [], relatedTimelineEventIds: [], createdAt: at, updatedAt: at, ...patch
  } as HardCanonItem
}

function directionFromPatch(projectId: ID, id: ID, patch: Record<string, unknown>, at: string): StoryDirectionGuide {
  if (!patch.title || typeof patch.title !== 'string' || !patch.title.trim()) throw new Error('story direction patch.title is required for create.')
  const start = typeof patch.startChapterOrder === 'number' ? patch.startChapterOrder : 1
  const horizon = patch.horizonChapters === 10 ? 10 : 5
  const guide = normalizeStoryDirectionGuide({
    id, projectId, title: patch.title.trim(), status: 'draft', source: 'mixed', horizonChapters: horizon,
    startChapterOrder: start, endChapterOrder: typeof patch.endChapterOrder === 'number' ? patch.endChapterOrder : start + horizon - 1,
    userRawIdea: '', userPolishedIdea: '', aiGuidance: '', strategicTheme: '', coreDramaticPromise: '', emotionalCurve: '',
    characterArcDirectives: '', foreshadowingDirectives: '', constraints: '', forbiddenTurns: '', chapterBeats: [],
    generatedFromStageSummaryIds: [], generatedFromChapterIds: [], warnings: [], createdAt: at, updatedAt: at, ...patch
  })
  assertActiveDirectionRange(guide)
  return guide
}

function updateRecord(data: AppData, projectId: ID, entity: WorldManagedEntity, id: ID, next: ManagedRecord, at: string): AppData {
  let changed: AppData
  if (entity === 'character') changed = { ...data, characters: data.characters.map((item) => item.id === id && item.projectId === projectId ? next as Character : item) }
  else if (entity === 'character_state') changed = { ...data, characterStateFacts: data.characterStateFacts.map((item) => item.id === id && item.projectId === projectId ? next as CharacterStateFact : item) }
  else if (entity === 'foreshadowing') changed = { ...data, foreshadowings: data.foreshadowings.map((item) => item.id === id && item.projectId === projectId ? next as Foreshadowing : item) }
  else if (entity === 'timeline_event') changed = { ...data, timelineEvents: data.timelineEvents.map((item) => item.id === id && item.projectId === projectId ? next as TimelineEvent : item) }
  else if (entity === 'story_direction') changed = {
    ...data,
    storyDirectionGuides: data.storyDirectionGuides.map((item) => {
      if (item.id === id && item.projectId === projectId) return next as StoryDirectionGuide
      if ((next as StoryDirectionGuide).status === 'active' && item.projectId === projectId && item.status === 'active') return { ...item, status: 'archived', updatedAt: at }
      return item
    })
  }
  else changed = HardCanonPackService.upsertHardCanonItem(data, next as HardCanonItem)
  return projectTimestamp(changed, projectId, at)
}

function createRecord(data: AppData, projectId: ID, entity: WorldManagedEntity, record: ManagedRecord, at: string): AppData {
  if (entity === 'character') return projectTimestamp({ ...data, characters: [...data.characters, record as Character] }, projectId, at)
  if (entity === 'character_state') return projectTimestamp(data, projectId, at)
  if (entity === 'foreshadowing') return projectTimestamp({ ...data, foreshadowings: [...data.foreshadowings, record as Foreshadowing] }, projectId, at)
  if (entity === 'timeline_event') return projectTimestamp({ ...data, timelineEvents: [...data.timelineEvents, record as TimelineEvent] }, projectId, at)
  if (entity === 'story_direction') return updateRecord({ ...data, storyDirectionGuides: [...data.storyDirectionGuides, record as StoryDirectionGuide] }, projectId, entity, record.id, record, at)
  return projectTimestamp(HardCanonPackService.upsertHardCanonItem(data, record as HardCanonItem), projectId, at)
}

function expectedFingerprint(data: AppData, command: WorldManagementCommand): string {
  const current = command.id ? findRecord(data, command.projectId, command.entity, command.id) : null
  return decisionFingerprint({ command: { ...command, expectedFingerprint: undefined }, current })
}

function commandFingerprint(command: WorldManagementCommand): string {
  return decisionFingerprint({ ...command, expectedFingerprint: undefined })
}

function receiptId(operationId: ID): ID {
  return `world-management-receipt-${operationId}`
}

function existingReceipt(data: AppData, command: WorldManagementCommand): WorldManagementReceipt | null {
  const receipt = data.worldManagementReceipts.find((item) => item.id === receiptId(command.operationId) || item.operationId === command.operationId)
  if (!receipt) return null
  if (receipt.projectId !== command.projectId || receipt.commandFingerprint !== commandFingerprint(command)) {
    throw new Error('The operationId was already used for a different world-management command.')
  }
  return receipt
}

function visibleRecord(record: ManagedRecord): Record<string, unknown> {
  return copy(record) as unknown as Record<string, unknown>
}

function visibleReceipt(receipt: WorldManagementReceipt): WorldManagementReceipt {
  return copy(receipt)
}

function audit(command: WorldManagementCommand, receipt: WorldManagementReceipt): WorldManagementAudit {
  return {
    actor: 'agent', source: receipt.source, operationId: command.operationId, entity: command.entity, action: command.action,
    recordedAt: receipt.createdAt, receiptId: receipt.id, authorizationGrantId: receipt.authorizationGrantId
  }
}

function resultFromReceipt(command: WorldManagementCommand, receipt: WorldManagementReceipt): WorldManagementResult['result'] {
  return {
    projectId: receipt.projectId, entity: receipt.entity, action: receipt.action, id: receipt.targetId,
    fingerprint: receipt.previewFingerprint, changed: false, replayed: true, before: copy(receipt.before), after: copy(receipt.after),
    audit: audit(command, receipt)
  }
}

function buildMutation(data: AppData, command: WorldManagementCommand): { data: AppData; id: ID; before: ManagedRecord | null; after: ManagedRecord; changed: boolean } {
  const at = timestamp(command.source)
  const patch = command.patch ?? {}
  const createId = recordId(command.entity, command.operationId)
  const id = command.id ?? createId
  const before = findRecord(data, command.projectId, command.entity, id)
  const currentFingerprint = expectedFingerprint(data, command)
  if (!command.expectedFingerprint || command.expectedFingerprint !== currentFingerprint) {
    throw new Error('World record changed since preview. Refresh the preview and use its expectedFingerprint.')
  }

  if (command.action === 'create') {
    if (before) {
      const desired = buildCreated(data, command, id, at)
      // A matching stable ID without a receipt is a verified adoption, not a replay.
      // apply() records this operation so a later retry can be a true receipt replay.
      if (sameManagedFields(before, desired.record)) return { data, id, before, after: before, changed: false }
      throw new Error(`World operation ID collides with a different ${command.entity}: ${id}`)
    }
    const created = buildCreated(data, command, id, at)
    if (command.entity === 'hard_canon') {
      assertNoHardCanonDeduplicationConflict(data, command.projectId, created.record as HardCanonItem)
    }
    const next = command.entity === 'character_state'
      ? created.data
      : createRecord(data, command.projectId, command.entity, created.record, at)
    // Shared domain services may normalize values and timestamps on write.
    // Receipts describe that actual result, not the input draft.
    return { data: next, id, before: null, after: findRecord(next, command.projectId, command.entity, id)!, changed: true }
  }

  if (!before) throw new Error(`${command.entity} not found in project: ${id}`)
  const update = buildUpdated(data, command, before, at)
  const after = update.record
  if (command.entity === 'hard_canon') {
    assertNoHardCanonDeduplicationConflict(data, command.projectId, after as HardCanonItem)
  }
  if (sameManagedFields(before, after)) return { data, id, before, after: before, changed: false }
  const nextData = update.data
    ? projectTimestamp(update.data, command.projectId, at)
    : updateRecord(data, command.projectId, command.entity, id, after, at)
  return { data: nextData, id, before, after: findRecord(nextData, command.projectId, command.entity, id)!, changed: true }
}

function buildCreated(data: AppData, command: WorldManagementCommand, id: ID, at: string): { record: ManagedRecord; data: AppData } {
  const patch = command.patch ?? {}
  if (command.entity === 'character') return { record: characterFromPatch(command.projectId, id, patch, at), data }
  if (command.entity === 'character_state') {
    const next = stateFromPatch(data, command.projectId, id, patch)
    const record = next.characterStateFacts.find((item) => item.id === id)
    if (!record) throw new Error('CharacterStateService did not create the requested fact.')
    return { record, data: projectTimestamp(next, command.projectId, at) }
  }
  if (command.entity === 'foreshadowing') {
    validateForeshadowingPatch(data, command.projectId, patch)
    return { record: foreshadowingFromPatch(command.projectId, id, patch, at), data }
  }
  if (command.entity === 'timeline_event') {
    validateTimelinePatch(data, command.projectId, patch)
    return { record: timelineFromPatch(command.projectId, id, patch, at), data }
  }
  if (command.entity === 'hard_canon') {
    validateHardCanonPatch(data, command.projectId, patch)
    return { record: hardCanonFromPatch(command.projectId, id, patch, at), data }
  }
  validateDirectionPatch(data, command.projectId, patch)
  return { record: directionFromPatch(command.projectId, id, patch, at), data }
}

function buildUpdated(data: AppData, command: WorldManagementCommand, before: ManagedRecord, at: string): { record: ManagedRecord; data?: AppData } {
  const patch = command.patch ?? {}
  if (command.action === 'archive') {
    if (command.entity === 'character' || command.entity === 'timeline_event') {
      throw new Error(`${command.entity} has no supported archive lifecycle. Edit the record; do not emulate an untracked archive.`)
    }
    const status = command.entity === 'character_state' ? 'inactive' : command.entity === 'foreshadowing' ? 'abandoned' : command.entity === 'hard_canon' ? 'deprecated' : 'archived'
    if (command.entity === 'foreshadowing') {
      const next = { ...before, status, updatedAt: at } as Foreshadowing
      return { record: { ...next, treatmentMode: normalizeTreatmentMode(next.treatmentMode, next.status, next.weight) } }
    }
    return { record: { ...before, status, updatedAt: at } as ManagedRecord }
  }

  if (command.action === 'set_status') {
    assertOnlyFields(patch, ['status'], `${command.entity} status patch`)
    const status = requireString(patch.status, 'patch.status')
    if (command.entity === 'character' || command.entity === 'timeline_event') {
      throw new Error(`${command.entity} has no supported status lifecycle. Edit the record; do not emulate an untracked status.`)
    }
    const valid = command.entity === 'character_state'
      ? ['active', 'resolved', 'inactive', 'retconned']
      : command.entity === 'foreshadowing'
        ? ['unresolved', 'partial', 'resolved', 'abandoned']
        : command.entity === 'hard_canon'
          ? ['active', 'inactive', 'deprecated']
          : ['draft', 'active', 'archived']
    if (!valid.includes(status)) throw new Error(`Unsupported ${command.entity} status: ${status}`)
    if (command.entity === 'foreshadowing') {
      const next = { ...before, status, updatedAt: at } as Foreshadowing
      return { record: { ...next, treatmentMode: normalizeTreatmentMode(next.treatmentMode, next.status, next.weight) } }
    }
    const record = { ...before, status, updatedAt: at } as ManagedRecord
    if (command.entity === 'story_direction') assertActiveDirectionRange(record as StoryDirectionGuide)
    return { record }
  }

  if (command.entity === 'character') {
    validateCharacterPatch(patch)
    return { record: { ...before, ...patch, updatedAt: at } as Character }
  }
  if (command.entity === 'character_state') {
    validateStatePatch(data, command.projectId, patch)
    const existing = before as CharacterStateFact
    if (patch.characterId !== undefined && patch.characterId !== existing.characterId) throw new Error('character state characterId cannot be reassigned.')
    const draft = {
      ...existing, ...patch, id: existing.id, projectId: command.projectId,
      characterId: existing.characterId, label: String(patch.label ?? existing.label)
    } as Parameters<typeof CharacterStateService.createOrUpdateFact>[0]
    validateStateSourceChapter(data, command.projectId, draft.sourceChapterId, draft.sourceChapterOrder, 'character state patch')
    const next = CharacterStateService.createOrUpdateFact(draft, data)
    const fact = next.characterStateFacts.find((item) => item.id === before.id)
    if (!fact) throw new Error('CharacterStateService did not retain the target fact.')
    return { record: fact, data: next }
  }
  if (command.entity === 'foreshadowing') {
    validateForeshadowingPatch(data, command.projectId, patch)
    const next = { ...before, ...patch, updatedAt: at } as Foreshadowing
    return { record: { ...next, treatmentMode: normalizeTreatmentMode(next.treatmentMode, next.status, next.weight) } }
  }
  if (command.entity === 'timeline_event') {
    validateTimelinePatch(data, command.projectId, patch)
    return { record: { ...before, ...patch, updatedAt: at } as TimelineEvent }
  }
  if (command.entity === 'hard_canon') {
    validateHardCanonPatch(data, command.projectId, patch)
    return { record: { ...before, ...patch, projectId: command.projectId, sourceType: 'manual', updatedAt: at } as HardCanonItem }
  }
  validateDirectionPatch(data, command.projectId, patch)
  const guide = normalizeStoryDirectionGuide({ ...before, ...patch, projectId: command.projectId, source: 'mixed', updatedAt: at })
  assertActiveDirectionRange(guide)
  return { record: guide }
}

export class WorldManagementService {
  static list(data: AppData, projectId: ID, entity: WorldManagedEntity, includeArchived = false): unknown[] {
    requireProject(data, projectId)
    if (!ENTITY_VALUES.includes(entity)) throw new Error(`Unsupported world entity: ${String(entity)}`)
    return itemCollection(data, projectId, entity)
      .filter((item) => includeArchived || !['inactive', 'archived', 'deprecated', 'abandoned'].includes(statusForRecord(entity, item) ?? ''))
      .map((item) => visibleRecord(item))
  }

  static get(data: AppData, projectId: ID, entity: WorldManagedEntity, id: ID): unknown {
    requireProject(data, projectId)
    const record = findRecord(data, projectId, entity, id)
    if (!record) throw new Error(`${entity} not found in project: ${id}`)
    return visibleRecord(record)
  }

  static getReceipt(data: AppData, projectId: ID, operationId: ID): WorldManagementReceipt {
    requireProject(data, projectId)
    const receipt = data.worldManagementReceipts.find((item) => item.projectId === projectId && item.operationId === operationId)
    if (!receipt) throw new Error(`World-management receipt not found in project: ${operationId}`)
    return visibleReceipt(receipt)
  }

  static listReceipts(data: AppData, projectId: ID): WorldManagementReceipt[] {
    requireProject(data, projectId)
    return data.worldManagementReceipts
      .filter((item) => item.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .map(visibleReceipt)
  }

  static preview(data: AppData, input: WorldManagementCommand): WorldManagementResult['result'] {
    const command = normalizeCommand(data, input)
    requireAgentRun(data, command)
    const receipt = existingReceipt(data, command)
    if (receipt) return resultFromReceipt(command, receipt)
    const at = timestamp(command.source)
    const mutation = buildMutation(data, { ...command, expectedFingerprint: command.expectedFingerprint ?? expectedFingerprint(data, command) })
    const previewFingerprint = expectedFingerprint(data, command)
    return {
      projectId: command.projectId, entity: command.entity, action: command.action, id: mutation.id,
      fingerprint: previewFingerprint, changed: mutation.changed, replayed: false,
      before: mutation.before ? visibleRecord(mutation.before) : null,
      after: visibleRecord(mutation.after),
      audit: { actor: 'agent', source: command.source, operationId: command.operationId, entity: command.entity, action: command.action,
        recordedAt: at, receiptId: receiptId(command.operationId), authorizationGrantId: null }
    }
  }

  // This is intentionally pure. Agent tools persist result.data only after a trusted authorization gate succeeds.
  static apply(
    data: AppData,
    input: WorldManagementCommand,
    options: { authorizationGrantId: ID }
  ): WorldManagementResult {
    const command = normalizeCommand(data, input)
    requireAgentRun(data, command)
    const previous = existingReceipt(data, command)
    if (previous) return { data, result: resultFromReceipt(command, previous) }
    const authorizationGrantId = requireString(options.authorizationGrantId, 'authorizationGrantId')
    const currentFingerprint = expectedFingerprint(data, command)
    const at = timestamp(command.source)
    const mutation = buildMutation(data, command)
    const receipt: WorldManagementReceipt = {
      id: receiptId(command.operationId), projectId: command.projectId, operationId: command.operationId,
      commandFingerprint: commandFingerprint(command), previewFingerprint: currentFingerprint,
      entity: command.entity, action: command.action, targetId: mutation.id, source: command.source,
      authorizationGrantId,
      before: mutation.before ? visibleRecord(mutation.before) : null, after: visibleRecord(mutation.after), createdAt: at, schemaVersion: 1
    }
    const nextData = { ...mutation.data, worldManagementReceipts: [receipt, ...mutation.data.worldManagementReceipts] }
    return {
      data: nextData,
      result: {
        projectId: command.projectId, entity: command.entity, action: command.action, id: mutation.id,
        fingerprint: currentFingerprint, changed: mutation.changed, replayed: false,
        before: receipt.before, after: receipt.after, audit: audit(command, receipt)
      }
    }
  }
}
