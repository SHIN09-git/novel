import type { Character, CharacterCardReview, CharacterCardReviewCommand, CharacterProfilePatch, ID } from '../../shared/types'
import { decisionFingerprint } from '../candidateDecisionPrimitives'
import { createCardReviewEvidenceIndex, type CardReviewChapter, type CardReviewData, type CardReviewEvidence } from './cardReviewEvidence'

export { CHARACTER_CARD_REVIEW_COLLECTIONS } from './cardReviewEvidence'
export type { CardReviewChapter, CardReviewData, CardReviewEvidence } from './cardReviewEvidence'

const PROFILE_FIELDS = [
  'name', 'role', 'roleFunction', 'surfaceGoal', 'deepDesire', 'deepNeed', 'coreFear', 'selfDeception', 'decisionLogic',
  'knownInformation', 'unknownInformation', 'abilitiesAndResources', 'weaknessAndCost', 'relationshipTension',
  'protagonistRelationship', 'emotionalState', 'nextActionTendency', 'forbiddenWriting', 'futureHooks', 'lastChangedChapter', 'isMain'
] as const satisfies readonly (keyof CharacterProfilePatch)[]

export interface CharacterCardReviewSummary {
  projectId: ID
  characterId: ID
  characterName: string
  currentChapter: CardReviewChapter | null
  lastChangedChapter: number | null
  lastCardReview: CharacterCardReview | null
  lastReviewedChapter: CardReviewChapter | null
  status: 'unreviewed' | 'reviewed' | 'stale'
  chaptersSinceReview: number | null
  changesSinceReview: number | null
  latestConfirmedFactChapter: CardReviewChapter | null
  latestConfirmedFact: CardReviewEvidence | null
  evidence: CardReviewEvidence[]
  unlocatedCount: number
  canMarkReviewed: boolean
  previewFingerprint: string
}

function basisFingerprint(character: Character, chapter: CardReviewChapter, rows: CardReviewEvidence[]) {
  return decisionFingerprint([PROFILE_FIELDS.filter(field => field !== 'lastChangedChapter').map(field => character[field]),
    chapter.chapterOrder, chapter.bodyFingerprint,
    rows.filter(row => row.chapter.chapterOrder <= chapter.chapterOrder).map(row => [
      row.chapter.chapterId, row.chapter.chapterOrder, row.chapter.bodyFingerprint, row.chapter.chapterVersionId,
      row.factId, row.transactionId, row.transactionType, row.stateKey, row.label, row.before, row.after, row.unit, row.evidence, row.location
    ])])
}

/** Project-scoped read projection, also usable by the Agent without write authorization. */
function reviewContext(data: CardReviewData, projectId: ID) {
  const index = createCardReviewEvidenceIndex(data, projectId)
  const characters = data.characters.filter(c => c.projectId === projectId)
  function prepare(characterId: ID, asOfChapterOrder?: number) {
    const matches = characters.filter(c => c.id === characterId)
    if (matches.length !== 1) throw new Error('当前项目中找不到唯一匹配的角色卡。')
    const character = matches[0]
    if (asOfChapterOrder !== undefined && (!Number.isSafeInteger(asOfChapterOrder) || asOfChapterOrder < 1)) {
      throw new Error('核对章号必须是正整数。')
    }
    const current = index.chapters.filter(c => asOfChapterOrder === undefined || c.order <= asOfChapterOrder).at(-1)
    const currentChapter = current ? index.source(current) : null
    const through = asOfChapterOrder ?? current?.order ?? 0
    const { rows, unlocatedCount } = index.readEvidence(characterId, through)
    const stored = character.lastCardReview
    const anchor = stored && index.byId.get(stored.chapterId)
    const later = Boolean(stored && (anchor?.order ?? stored.chapterOrder) > through)
    const lastCardReview = (!later || asOfChapterOrder === undefined) && stored ? stored : null
    const reviewed = lastCardReview && anchor ? index.source(anchor) : null
    const valid = reviewed && lastCardReview && lastCardReview.chapterVersionId === reviewed.chapterVersionId &&
      lastCardReview.basisFingerprint === basisFingerprint(character, reviewed, rows)
    const subsequent = reviewed ? rows.filter(row => row.chapter.chapterOrder > reviewed.chapterOrder) : null
    const evidence = valid && subsequent ? subsequent : rows
    const summary: CharacterCardReviewSummary = { projectId, characterId, characterName: character.name, currentChapter,
      lastChangedChapter: asOfChapterOrder === undefined || (character.lastChangedChapter !== null && character.lastChangedChapter <= through)
        ? character.lastChangedChapter : null,
      lastCardReview, lastReviewedChapter: reviewed, status: valid ? 'reviewed' : lastCardReview ? 'stale' : 'unreviewed',
      chaptersSinceReview: reviewed && current ? current.order - reviewed.chapterOrder : null,
      changesSinceReview: subsequent?.length ?? null,
      latestConfirmedFactChapter: rows.at(-1)?.chapter ?? null, latestConfirmedFact: rows.at(-1) ?? null, evidence, unlocatedCount,
      canMarkReviewed: Boolean(current && !later && (!stored || (anchor?.order ?? stored.chapterOrder) <= current.order)),
      previewFingerprint: decisionFingerprint([projectId, characterId, stored, character.lastChangedChapter, currentChapter,
        currentChapter && basisFingerprint(character, currentChapter, rows), unlocatedCount]) }
    return { character, summary, rows }
  }
  return { chapters: index.chapters.map(c => ({ id: c.id, order: c.order, title: c.title })), prepare }
}

export function createCharacterCardReviewReader(data: CardReviewData, projectId: ID) {
  const { chapters, prepare } = reviewContext(data, projectId)
  return { chapters, get: (characterId: ID, asOfChapterOrder?: number) => prepare(characterId, asOfChapterOrder).summary }
}

export function getCharacterCardReview(data: CardReviewData, projectId: ID, characterId: ID, asOfChapterOrder?: number) {
  return createCharacterCardReviewReader(data, projectId).get(characterId, asOfChapterOrder)
}

function validatedPatch(character: Character, command: CharacterCardReviewCommand): CharacterProfilePatch {
  if (command.decision === 'keep' && command.patch === undefined) return {}
  if (command.decision !== 'update' || !command.patch || typeof command.patch !== 'object' || Array.isArray(command.patch)) {
    throw new Error('请明确选择保留原卡，或确认本次表单修改。')
  }
  for (const [field, value] of Object.entries(command.patch)) {
    if (!PROFILE_FIELDS.some(key => key === field) || (field === 'isMain' ? typeof value !== 'boolean' :
      field === 'lastChangedChapter' ? value !== null && !(typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
        : typeof value !== 'string')) throw new Error('角色卡修改包含不支持的字段或取值。')
  }
  if (!PROFILE_FIELDS.some(key => Object.hasOwn(command.patch, key) && command.patch[key] !== character[key])) {
    throw new Error('角色卡没有改动，请选择保留原卡。')
  }
  return command.patch
}

/** Rebuild the exact preview against the storage transaction, never trust a renderer-supplied card or chapter. */
export function applyCharacterCardReview(data: CardReviewData, command: CharacterCardReviewCommand, reviewedAt: string): Character {
  if (!command || !Number.isSafeInteger(command.chapterOrder) || !command.chapterId ||
    !data.projects.some(p => p.id === command.projectId)) throw new Error('缺少当前项目或明确的核对章节。')
  const { summary, character, rows } = reviewContext(data, command.projectId).prepare(command.characterId, command.chapterOrder)
  const chapter = summary.currentChapter
  if (!chapter || chapter.chapterId !== command.chapterId || chapter.chapterOrder !== command.chapterOrder) {
    throw new Error('核对目标不是所选项目中该章号的当前正式正文。')
  }
  if (!summary.canMarkReviewed) throw new Error('不能用更早的章节覆盖较晚的人工核对。')
  if (summary.previewFingerprint !== command.expectedFingerprint) throw new Error('角色卡、章节或事实证据已变化，请重新查看后核对。')
  const next = { ...character, ...validatedPatch(character, command),
    updatedAt: command.decision === 'update' ? reviewedAt : character.updatedAt }
  return { ...next, lastCardReview: { chapterId: chapter.chapterId, chapterOrder: chapter.chapterOrder,
    chapterVersionId: chapter.chapterVersionId, reviewedAt, decision: command.decision, basisFingerprint: basisFingerprint(next, chapter, rows) } }
}
