import type {
  ChapterGenerationJob,
  CharacterStateChangeCandidate,
  CharacterStateRiskLevel,
  ID,
  MemoryUpdateCandidate,
  MemoryUpdateCandidateType,
  StateFactCategory
} from '../shared/types'

export type DecisionInboxCandidateKind = 'memory_update' | 'character_state_change'
export type DecisionInboxRiskLevel = 'low' | 'medium' | 'high'
export type DecisionInboxFactCertainty = 'low' | 'medium' | 'high'
export type DecisionInboxImpactArea =
  | 'chapter_memory'
  | 'character_state'
  | 'foreshadowing'
  | 'stage_summary'
  | 'timeline'
  | 'unknown'

export interface DecisionInboxCandidateRef {
  id: ID
  kind: DecisionInboxCandidateKind
  candidateType: string
  targetId: ID | null
  characterId: ID | null
  evidence: string
  confidence: number
  riskLevel: DecisionInboxRiskLevel
  impactArea: DecisionInboxImpactArea
  createdAt: string
  updatedAt: string
}

export interface DecisionInboxEventGroup {
  id: string
  projectId: ID
  chapterId: ID | null
  chapterOrder: number | null
  jobIds: ID[]
  title: string
  evidence: string[]
  riskLevel: DecisionInboxRiskLevel
  riskReasons: string[]
  factCertainty: DecisionInboxFactCertainty
  factCertaintyScore: number
  factCertaintyReason: string
  impactAreas: DecisionInboxImpactArea[]
  impactSummary: string
  candidateIds: ID[]
  memoryCandidateIds: ID[]
  characterStateCandidateIds: ID[]
  candidates: DecisionInboxCandidateRef[]
  createdAt: string
  updatedAt: string
}

export interface DecisionInboxInput {
  projectId: ID
  memoryCandidates?: ReadonlyArray<MemoryUpdateCandidate | Partial<MemoryUpdateCandidate>>
  characterStateChangeCandidates?: ReadonlyArray<CharacterStateChangeCandidate | Partial<CharacterStateChangeCandidate>>
  jobs?: ReadonlyArray<Pick<ChapterGenerationJob, 'id' | 'projectId' | 'targetChapterOrder'>>
}

export interface DecisionInboxListOptions {
  riskLevels?: ReadonlyArray<DecisionInboxRiskLevel>
  factCertainties?: ReadonlyArray<DecisionInboxFactCertainty>
  impactAreas?: ReadonlyArray<DecisionInboxImpactArea>
  chapterOrder?: number | null
  limit?: number
}

interface NormalizedCandidate {
  ref: DecisionInboxCandidateRef
  projectId: ID
  jobId: ID | null
  chapterId: ID | null
  chapterOrder: number | null
  evidenceKey: string
  riskReasons: string[]
}

interface MutableEventGroup {
  projectId: ID
  chapterId: ID | null
  chapterOrder: number | null
  chapterKey: string
  evidenceKey: string
  candidates: NormalizedCandidate[]
}

const RISK_RANK: Record<DecisionInboxRiskLevel, number> = { low: 1, medium: 2, high: 3 }
const CERTAINTY_RANK: Record<DecisionInboxFactCertainty, number> = { low: 1, medium: 2, high: 3 }

const HARD_STATE_CATEGORIES = new Set<StateFactCategory>([
  'resource',
  'inventory',
  'location',
  'physical',
  'knowledge',
  'promise',
  'ability'
])

const IMPACT_LABELS: Record<DecisionInboxImpactArea, string> = {
  chapter_memory: '章节记忆',
  character_state: '角色状态',
  foreshadowing: '伏笔账本',
  stage_summary: '阶段摘要',
  timeline: '时间线',
  unknown: '未分类记忆'
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalId(value: unknown): ID | null {
  return stringValue(value) || null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clampConfidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : 0.45
}

function unique<T>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)]
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}

/**
 * Evidence identity is deliberately conservative. NFKC normalization and
 * punctuation removal join typographic variants of the same excerpt, but we
 * do not use fuzzy semantic matching: two merely similar events must remain
 * independently reviewable.
 */
function normalizeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const number = finiteNumber(value)
    if (number !== null) return number
  }
  return null
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value)
    if (text) return text
  }
  return ''
}

function memoryImpactArea(type: MemoryUpdateCandidateType | string, patchKind: string): DecisionInboxImpactArea {
  if (type === 'character' || patchKind === 'character_state_update') return 'character_state'
  if (type === 'foreshadowing' || patchKind.startsWith('foreshadowing_')) return 'foreshadowing'
  if (type === 'timeline_event' || patchKind === 'timeline_event_create') return 'timeline'
  if (type === 'stage_summary' || patchKind === 'stage_summary_create') return 'stage_summary'
  if (type === 'chapter_review' || patchKind === 'chapter_review_update') return 'chapter_memory'
  return 'unknown'
}

function stateCategory(candidate: Record<string, unknown>): StateFactCategory | null {
  const fact = objectValue(candidate.proposedFact)
  const category = stringValue(fact.category)
  return category ? category as StateFactCategory : null
}

function stateRisk(candidate: Record<string, unknown>): DecisionInboxRiskLevel {
  const value = stringValue(candidate.riskLevel)
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function memoryRisk(candidate: Record<string, unknown>, patch: Record<string, unknown>, confidence: number): {
  level: DecisionInboxRiskLevel
  reasons: string[]
} {
  const warnings = Array.isArray(patch.warnings)
    ? patch.warnings.map(stringValue).filter(Boolean)
    : []
  if (warnings.length) return { level: 'high', reasons: ['候选包含风险提示，需要逐条确认。'] }
  if (confidence < 0.55) return { level: 'medium', reasons: ['候选置信度偏低，需要核对原文证据。'] }
  return { level: 'low', reasons: ['候选未携带显式高风险标记。'] }
}

function memoryChapterIdentity(candidate: Record<string, unknown>, jobOrder: number | null): {
  chapterId: ID | null
  chapterOrder: number | null
} {
  const patch = objectValue(candidate.proposedPatch)
  const stageSummary = objectValue(patch.stageSummary)
  const event = objectValue(patch.event)
  const foreshadowingCandidate = objectValue(patch.candidate)
  return {
    chapterId: optionalId(patch.targetChapterId) ?? optionalId(patch.relatedChapterId),
    chapterOrder: firstNumber(
      patch.sourceChapterOrder,
      patch.targetChapterOrder,
      patch.relatedChapterOrder,
      event.chapterOrder,
      foreshadowingCandidate.firstChapterOrder,
      stageSummary.chapterEnd,
      stageSummary.chapterStart,
      jobOrder
    )
  }
}

function stateChapterIdentity(candidate: Record<string, unknown>, jobOrder: number | null): {
  chapterId: ID | null
  chapterOrder: number | null
} {
  const fact = objectValue(candidate.proposedFact)
  const transaction = objectValue(candidate.proposedTransaction)
  return {
    chapterId: optionalId(candidate.chapterId) ?? optionalId(transaction.chapterId) ?? optionalId(fact.sourceChapterId),
    chapterOrder: firstNumber(candidate.chapterOrder, transaction.chapterOrder, fact.sourceChapterOrder, jobOrder)
  }
}

function chapterKey(candidate: NormalizedCandidate): string {
  if (candidate.chapterOrder !== null) return `order:${candidate.chapterOrder}`
  if (candidate.chapterId) return `id:${candidate.chapterId}`
  if (candidate.jobId) return `job:${candidate.jobId}`
  return `unknown:${candidate.ref.kind}:${candidate.ref.id}`
}

function normalizeMemoryCandidate(
  raw: MemoryUpdateCandidate | Partial<MemoryUpdateCandidate>,
  projectId: ID,
  jobOrders: ReadonlyMap<ID, number>
): NormalizedCandidate | null {
  const candidate = objectValue(raw)
  const id = stringValue(candidate.id)
  const candidateProjectId = stringValue(candidate.projectId)
  const status = stringValue(candidate.status) || 'pending'
  if (!id || candidateProjectId !== projectId || status !== 'pending') return null

  const patch = objectValue(candidate.proposedPatch)
  const patchKind = stringValue(patch.kind)
  const type = stringValue(candidate.type) || 'chapter_review'
  const jobId = optionalId(candidate.jobId)
  const confidence = clampConfidence(candidate.confidence)
  const risk = memoryRisk(candidate, patch, confidence)
  const identity = memoryChapterIdentity(candidate, jobId ? jobOrders.get(jobId) ?? null : null)
  const evidence = firstText(
    candidate.evidence,
    patch.evidenceText,
    objectValue(patch.change).evidenceText
  )
  return {
    projectId,
    jobId,
    chapterId: identity.chapterId,
    chapterOrder: identity.chapterOrder,
    evidenceKey: normalizeEvidence(evidence),
    riskReasons: risk.reasons,
    ref: {
      id,
      kind: 'memory_update',
      candidateType: type,
      targetId: optionalId(candidate.targetId),
      characterId: optionalId(patch.characterId),
      evidence,
      confidence,
      riskLevel: risk.level,
      impactArea: memoryImpactArea(type, patchKind),
      createdAt: stringValue(candidate.createdAt),
      updatedAt: firstText(candidate.updatedAt, candidate.createdAt)
    }
  }
}

function normalizeStateCandidate(
  raw: CharacterStateChangeCandidate | Partial<CharacterStateChangeCandidate>,
  projectId: ID,
  jobOrders: ReadonlyMap<ID, number>
): NormalizedCandidate | null {
  const candidate = objectValue(raw)
  const id = stringValue(candidate.id)
  const candidateProjectId = stringValue(candidate.projectId)
  const status = stringValue(candidate.status) || 'pending'
  if (!id || candidateProjectId !== projectId || status !== 'pending') return null

  const jobId = optionalId(candidate.jobId)
  const confidence = clampConfidence(candidate.confidence)
  const riskLevel = stateRisk(candidate)
  const category = stateCategory(candidate)
  const identity = stateChapterIdentity(candidate, jobId ? jobOrders.get(jobId) ?? null : null)
  const fact = objectValue(candidate.proposedFact)
  const transaction = objectValue(candidate.proposedTransaction)
  const evidence = firstText(candidate.evidence, transaction.evidence, fact.evidence)
  const riskReasons = [
    riskLevel === 'high'
      ? '角色状态候选被标记为高风险。'
      : riskLevel === 'medium'
        ? '角色状态候选需要人工确认。'
        : '角色状态候选风险较低。',
    ...(category && HARD_STATE_CATEGORIES.has(category) ? [`将影响${stringValue(fact.label) || category}等硬状态。`] : [])
  ]
  return {
    projectId,
    jobId,
    chapterId: identity.chapterId,
    chapterOrder: identity.chapterOrder,
    evidenceKey: normalizeEvidence(evidence),
    riskReasons,
    ref: {
      id,
      kind: 'character_state_change',
      candidateType: stringValue(candidate.candidateType) || 'update_fact',
      targetId: optionalId(candidate.targetFactId),
      characterId: optionalId(candidate.characterId),
      evidence,
      confidence,
      riskLevel,
      impactArea: 'character_state',
      createdAt: stringValue(candidate.createdAt),
      updatedAt: firstText(candidate.updatedAt, candidate.createdAt)
    }
  }
}

function candidatesCanShareGroup(group: MutableEventGroup, candidate: NormalizedCandidate): boolean {
  if (!candidate.evidenceKey || group.evidenceKey !== candidate.evidenceKey) return false
  if (group.chapterKey !== chapterKey(candidate)) return false
  if (group.chapterId && candidate.chapterId && group.chapterId !== candidate.chapterId) return false
  if (group.chapterOrder !== null && candidate.chapterOrder !== null && group.chapterOrder !== candidate.chapterOrder) return false
  return true
}

function normalizedCandidateSort(left: NormalizedCandidate, right: NormalizedCandidate): number {
  return (right.chapterOrder ?? Number.NEGATIVE_INFINITY) - (left.chapterOrder ?? Number.NEGATIVE_INFINITY) ||
    chapterKey(left).localeCompare(chapterKey(right)) ||
    left.evidenceKey.localeCompare(right.evidenceKey) ||
    left.ref.kind.localeCompare(right.ref.kind) ||
    left.ref.id.localeCompare(right.ref.id)
}

function groupRisk(candidates: ReadonlyArray<NormalizedCandidate>): {
  level: DecisionInboxRiskLevel
  reasons: string[]
} {
  const level = candidates.reduce<DecisionInboxRiskLevel>(
    (highest, candidate) => RISK_RANK[candidate.ref.riskLevel] > RISK_RANK[highest] ? candidate.ref.riskLevel : highest,
    'low'
  )
  const areas = unique(candidates.map((candidate) => candidate.ref.impactArea))
  const reasons = unique(candidates.flatMap((candidate) => candidate.riskReasons))
  if (areas.length > 1) reasons.push('同一事件将影响多个长期记录区域。')
  return { level, reasons: unique(reasons) }
}

function groupCertainty(candidates: ReadonlyArray<NormalizedCandidate>, hasEvidence: boolean): {
  level: DecisionInboxFactCertainty
  score: number
  reason: string
} {
  if (!hasEvidence) {
    return { level: 'low', score: 0, reason: '候选没有可核对的正文证据，已保持独立。' }
  }
  const average = candidates.reduce((total, candidate) => total + candidate.ref.confidence, 0) / candidates.length
  const kinds = unique(candidates.map((candidate) => candidate.ref.kind))
  const score = Math.max(0, Math.min(1, average + (kinds.length > 1 ? 0.08 : 0)))
  const level: DecisionInboxFactCertainty = score >= 0.82 ? 'high' : score >= 0.58 ? 'medium' : 'low'
  return {
    level,
    score: Number(score.toFixed(3)),
    reason: kinds.length > 1
      ? '记忆提取与角色状态提取引用了同一证据，确定性已小幅上调。'
      : level === 'high'
        ? '候选置信度较高且有明确证据。'
        : level === 'medium'
          ? '候选有明确证据，但仍需作者确认其长期含义。'
          : '候选置信度偏低，建议回看正文上下文。'
  }
}

function compactTitle(chapterOrder: number | null, evidence: string, candidates: ReadonlyArray<NormalizedCandidate>): string {
  const chapter = chapterOrder === null ? '章节待确认' : `第 ${chapterOrder} 章`
  const cleanEvidence = evidence.replace(/\s+/g, ' ').trim()
  if (cleanEvidence) return `${chapter} · ${cleanEvidence.length > 42 ? `${cleanEvidence.slice(0, 42)}...` : cleanEvidence}`
  const first = candidates[0]
  const label = first.ref.kind === 'character_state_change' ? '无证据角色状态候选' : '无证据记忆候选'
  return `${chapter} · ${label}`
}

function finalizeGroup(group: MutableEventGroup): DecisionInboxEventGroup {
  const normalized = [...group.candidates].sort(normalizedCandidateSort)
  const refs = normalized.map((candidate) => candidate.ref)
  const evidence = unique(refs.map((candidate) => candidate.evidence).filter(Boolean))
  const impactAreas = unique(refs.map((candidate) => candidate.impactArea))
    .sort((left, right) => IMPACT_LABELS[left].localeCompare(IMPACT_LABELS[right], 'zh-CN'))
  const risk = groupRisk(normalized)
  const certainty = groupCertainty(normalized, Boolean(group.evidenceKey))
  const candidateIds = refs.map((candidate) => candidate.id).sort((left, right) => left.localeCompare(right))
  const memoryCandidateIds = refs
    .filter((candidate) => candidate.kind === 'memory_update')
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right))
  const characterStateCandidateIds = refs
    .filter((candidate) => candidate.kind === 'character_state_change')
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right))
  const jobIds = unique(normalized.map((candidate) => candidate.jobId).filter((value): value is ID => Boolean(value)))
    .sort((left, right) => left.localeCompare(right))
  const timestamps = refs.flatMap((candidate) => [candidate.createdAt, candidate.updatedAt]).filter(Boolean).sort()
  const groupIdentity = [group.projectId, group.chapterKey, group.evidenceKey || candidateIds.join('|')].join('|')
  return {
    id: `decision-event-${stableHash(groupIdentity)}`,
    projectId: group.projectId,
    chapterId: group.chapterId,
    chapterOrder: group.chapterOrder,
    jobIds,
    title: compactTitle(group.chapterOrder, evidence[0] ?? '', normalized),
    evidence,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    factCertainty: certainty.level,
    factCertaintyScore: certainty.score,
    factCertaintyReason: certainty.reason,
    impactAreas,
    impactSummary: `该事件涉及${impactAreas.map((area) => IMPACT_LABELS[area]).join('、')}，共 ${refs.length} 条待确认候选；底层候选仍需分别处理。`,
    candidateIds,
    memoryCandidateIds,
    characterStateCandidateIds,
    candidates: refs,
    createdAt: timestamps[0] ?? '',
    updatedAt: timestamps[timestamps.length - 1] ?? ''
  }
}

function listSort(left: DecisionInboxEventGroup, right: DecisionInboxEventGroup): number {
  return (right.chapterOrder ?? Number.NEGATIVE_INFINITY) - (left.chapterOrder ?? Number.NEGATIVE_INFINITY) ||
    RISK_RANK[right.riskLevel] - RISK_RANK[left.riskLevel] ||
    CERTAINTY_RANK[right.factCertainty] - CERTAINTY_RANK[left.factCertainty] ||
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.id.localeCompare(right.id)
}

/**
 * Pure grouping API. It never accepts candidates and never mutates AppData.
 */
export function groupDecisionInboxCandidates(input: DecisionInboxInput): DecisionInboxEventGroup[] {
  const jobOrders = new Map<ID, number>()
  for (const job of input.jobs ?? []) {
    if (job.projectId === input.projectId && job.id && Number.isFinite(job.targetChapterOrder)) {
      jobOrders.set(job.id, job.targetChapterOrder)
    }
  }

  const candidates = [
    ...(input.memoryCandidates ?? [])
      .map((candidate) => normalizeMemoryCandidate(candidate, input.projectId, jobOrders))
      .filter((candidate): candidate is NormalizedCandidate => Boolean(candidate)),
    ...(input.characterStateChangeCandidates ?? [])
      .map((candidate) => normalizeStateCandidate(candidate, input.projectId, jobOrders))
      .filter((candidate): candidate is NormalizedCandidate => Boolean(candidate))
  ].sort(normalizedCandidateSort)

  const groups: MutableEventGroup[] = []
  for (const candidate of candidates) {
    const key = chapterKey(candidate)
    const existing = candidate.evidenceKey
      ? groups.find((group) => candidatesCanShareGroup(group, candidate))
      : undefined
    if (existing) {
      existing.candidates.push(candidate)
      existing.chapterId ??= candidate.chapterId
      existing.chapterOrder ??= candidate.chapterOrder
      continue
    }
    groups.push({
      projectId: input.projectId,
      chapterId: candidate.chapterId,
      chapterOrder: candidate.chapterOrder,
      chapterKey: key,
      evidenceKey: candidate.evidenceKey,
      candidates: [candidate]
    })
  }

  return groups.map(finalizeGroup).sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * Author-facing list API. Filtering and ordering operate on immutable group
 * projections; the original candidate arrays and their independent IDs stay
 * untouched.
 */
export function listDecisionInboxGroups(
  input: DecisionInboxInput,
  options: DecisionInboxListOptions = {}
): DecisionInboxEventGroup[] {
  const risks = options.riskLevels ? new Set(options.riskLevels) : null
  const certainties = options.factCertainties ? new Set(options.factCertainties) : null
  const impacts = options.impactAreas ? new Set(options.impactAreas) : null
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.max(0, Math.floor(options.limit))
    : Number.POSITIVE_INFINITY
  return groupDecisionInboxCandidates(input)
    .filter((group) => !risks || risks.has(group.riskLevel))
    .filter((group) => !certainties || certainties.has(group.factCertainty))
    .filter((group) => !impacts || group.impactAreas.some((area) => impacts.has(area)))
    .filter((group) => options.chapterOrder === undefined || group.chapterOrder === options.chapterOrder)
    .sort(listSort)
    .slice(0, limit)
}

export const DecisionInboxService = {
  group: groupDecisionInboxCandidates,
  list: listDecisionInboxGroups
} as const
