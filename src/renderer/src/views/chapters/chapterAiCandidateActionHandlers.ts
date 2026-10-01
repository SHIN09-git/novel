import type { Dispatch, SetStateAction } from 'react'
import type {
  Chapter,
  Character,
  CharacterStateChangeCandidate,
  CharacterStateChangeSuggestion,
  CharacterStateFact,
  CharacterStateLog,
  CharacterStateSuggestion,
  CharacterStateTransaction,
  Foreshadowing,
  ForeshadowingCandidate,
  ForeshadowingStatus,
  ForeshadowingStatusChangeSuggestion,
  Project
} from '../../../../shared/types'
import { normalizeTreatmentMode } from '../../../../shared/foreshadowingTreatment'
import { newId, now } from '../../utils/format'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { updateProjectTimestamp } from '../viewTypes'

export interface ChapterCharacterActionContext {
  selected: Chapter | null
  project: Project
  characters: Character[]
  characterStateFacts: CharacterStateFact[]
  saveData: SaveDataHandler
  setCharacterSuggestions: Dispatch<SetStateAction<CharacterStateSuggestion[]>>
  setAiMessage: Dispatch<SetStateAction<string>>
}

export interface ChapterForeshadowingActionContext {
  selected: Chapter | null
  project: Project
  saveData: SaveDataHandler
}

export async function applyCharacterSuggestion(
  context: ChapterCharacterActionContext,
  suggestion: CharacterStateSuggestion
): Promise<void> {
  const { selected, project, characters, saveData, setCharacterSuggestions } = context
  if (!selected) return
  const character = characters.find((item) => item.id === suggestion.characterId)
  if (!character) return
  const timestamp = now()
  const log: CharacterStateLog = {
    id: newId(),
    projectId: project.id,
    characterId: character.id,
    chapterId: selected.id,
    chapterOrder: selected.order,
    note: suggestion.changeSummary,
    createdAt: timestamp
  }
  const saved = await saveData((current) => ({
    ...current,
    projects: updateProjectTimestamp(current, project.id),
    characters: current.characters.map((item) =>
      item.id === character.id
        ? {
            ...item,
            emotionalState: suggestion.newCurrentEmotionalState || item.emotionalState,
            protagonistRelationship: suggestion.newRelationshipWithProtagonist || item.protagonistRelationship,
            nextActionTendency: suggestion.newNextActionTendency || item.nextActionTendency,
            lastChangedChapter: selected.order,
            updatedAt: timestamp
          }
        : item
    ),
    characterStateLogs: [...current.characterStateLogs, log]
  }))
  if (!saved.ok) return
  setCharacterSuggestions((items) => items.filter((item) => item !== suggestion))
}

export async function createStateChangeCandidate(
  context: ChapterCharacterActionContext,
  suggestion: CharacterStateChangeSuggestion
): Promise<void> {
  const { selected, project, characters, characterStateFacts, saveData, setAiMessage } = context
  if (!selected) return
  const character = characters.find((item) => item.id === suggestion.characterId)
  if (!character) return
  const timestamp = now()
  const existingFact = characterStateFacts.find(
    (fact) => fact.characterId === suggestion.characterId && fact.key === suggestion.key && fact.status === 'active'
  )
  const proposedFact: CharacterStateFact = {
    id: existingFact?.id ?? newId(),
    projectId: project.id,
    characterId: suggestion.characterId,
    category: suggestion.category,
    key: suggestion.key,
    label: suggestion.label,
    valueType: Array.isArray(suggestion.afterValue)
      ? 'list'
      : typeof suggestion.afterValue === 'number'
        ? 'number'
        : 'text',
    value: suggestion.afterValue ?? existingFact?.value ?? '',
    unit: existingFact?.unit ?? '',
    linkedCardFields: suggestion.linkedCardFields,
    trackingLevel: suggestion.category === 'relationship' || suggestion.category === 'status' ? 'soft' : 'hard',
    promptPolicy: 'when_relevant',
    status: 'active',
    sourceChapterId: selected.id,
    sourceChapterOrder: selected.order,
    evidence: suggestion.evidence,
    confidence: suggestion.confidence,
    createdAt: existingFact?.createdAt ?? timestamp,
    updatedAt: timestamp
  }
  const proposedTransaction: CharacterStateTransaction = {
    id: newId(),
    projectId: project.id,
    characterId: suggestion.characterId,
    factId: proposedFact.id,
    chapterId: selected.id,
    chapterOrder: selected.order,
    transactionType: suggestion.suggestedTransactionType,
    beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
    afterValue: suggestion.afterValue,
    delta: suggestion.delta,
    reason: suggestion.evidence,
    evidence: suggestion.evidence,
    source: 'chapter_review',
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const candidate: CharacterStateChangeCandidate = {
    id: newId(),
    projectId: project.id,
    characterId: suggestion.characterId,
    chapterId: selected.id,
    chapterOrder: selected.order,
    candidateType: suggestion.changeType,
    targetFactId: existingFact?.id ?? null,
    proposedFact,
    proposedTransaction,
    beforeValue: suggestion.beforeValue ?? existingFact?.value ?? null,
    afterValue: suggestion.afterValue,
    evidence: suggestion.evidence,
    confidence: suggestion.confidence,
    riskLevel: suggestion.riskLevel,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const saved = await saveData((current) => ({
    ...current,
    projects: updateProjectTimestamp(current, project.id),
    characterStateChangeCandidates: [candidate, ...current.characterStateChangeCandidates]
  }))
  if (!saved.ok) return
  setAiMessage(`已加入 ${character.name} 的状态变化候选。`)
}

export async function applyForeshadowingCandidate(
  context: ChapterForeshadowingActionContext,
  candidate: ForeshadowingCandidate,
  status: ForeshadowingStatus = 'unresolved'
): Promise<void> {
  const { selected, project, saveData } = context
  if (!selected) return
  const timestamp = now()
  const item: Foreshadowing = {
    id: newId(),
    projectId: project.id,
    title: candidate.title,
    firstChapterOrder: candidate.firstChapterOrder ?? selected.order,
    description: candidate.description,
    status,
    weight: candidate.suggestedWeight,
    treatmentMode: normalizeTreatmentMode(candidate.recommendedTreatmentMode, status, candidate.suggestedWeight),
    expectedPayoff: candidate.expectedPayoff,
    payoffMethod: '',
    relatedCharacterIds: candidate.relatedCharacterIds,
    relatedMainPlot: '',
    notes: candidate.notes,
    actualPayoffChapter: null,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  await saveData((current) => ({
    ...current,
    projects: updateProjectTimestamp(current, project.id),
    foreshadowings: [...current.foreshadowings, item]
  }))
}

export async function applyForeshadowingStatusChange(
  context: ChapterForeshadowingActionContext,
  change: ForeshadowingStatusChangeSuggestion
): Promise<void> {
  const { selected, project, saveData } = context
  if (!selected) return
  await saveData((current) => ({
    ...current,
    projects: updateProjectTimestamp(current, project.id),
    foreshadowings: current.foreshadowings.map((item) =>
      item.id === change.foreshadowingId
        ? {
            ...item,
            status: change.suggestedStatus,
            actualPayoffChapter: change.suggestedStatus === 'resolved' ? selected.order : item.actualPayoffChapter,
            notes: [item.notes, change.notes || change.evidenceText].filter(Boolean).join('\n'),
            updatedAt: now()
          }
        : item
    )
  }))
}
