import type { Chapter, Character, CharacterStateFact, Foreshadowing, Project, StoryBible } from '../../../../shared/types'
import { getRelevantCharacterStatesForPrompt } from '../../../../services/characterState/stateSelection'
import { formatCharacterStateLedgerSlice } from '../../../../services/promptFormatters/characterFormatters'

interface ChapterAiContextInput {
  project: Project
  bible: StoryBible | null
  chapters: Chapter[]
  characters: Character[]
  characterStateFacts?: CharacterStateFact[]
  foreshadowings: Foreshadowing[]
  selectedChapter: Chapter | null
}

function formatRecentChapterRecap(chapter: Chapter): string {
  const recap = [chapter.summary, chapter.endingHook].map((item) => item?.trim()).filter(Boolean).join('；')
  return recap ? `第 ${chapter.order} 章《${chapter.title || '未命名'}》：${recap}` : ''
}

export function buildChapterAiContext({
  project,
  bible,
  chapters,
  characters,
  characterStateFacts = [],
  foreshadowings,
  selectedChapter
}: ChapterAiContextInput): string {
  const recentChapters = [...chapters]
    .filter((chapter) => !selectedChapter || chapter.order < selectedChapter.order)
    .sort((a, b) => b.order - a.order)
    .slice(0, 3)
    .map(formatRecentChapterRecap)
    .filter(Boolean)
    .join('\n')
  const mainCharacters = characters.filter((character) => character.isMain).map((character) => character.name).filter(Boolean).join('、')
  const cast = characters.filter(c => c.projectId === project.id && (c.isMain || (c.name && selectedChapter?.body.includes(c.name))))
  const facts = selectedChapter ? getRelevantCharacterStatesForPrompt(cast.map(c => c.id), null, selectedChapter.order,
    characterStateFacts.filter(f => f.projectId === project.id)) : []
  const ledger = formatCharacterStateLedgerSlice(cast, facts)
  const activeForeshadowings = foreshadowings
    .filter((item) => item.status !== 'resolved' && item.status !== 'abandoned')
    .map((item) => item.title)
    .filter(Boolean)
    .join('、')

  return [
    `项目：${project.name}`,
    project.description ? `简介：${project.description}` : '',
    project.genre ? `题材：${project.genre}` : '',
    project.coreAppeal ? `核心爽点：${project.coreAppeal}` : '',
    bible?.mainConflict ? `主线冲突：${bible.mainConflict}` : '',
    bible?.immutableFacts ? `重要不可违背设定：${bible.immutableFacts}` : '',
    mainCharacters ? `主要角色：${mainCharacters}` : '',
    ledger ? `【角色状态账本切片】\n${ledger}` : '',
    activeForeshadowings ? `未回收伏笔：${activeForeshadowings}` : '',
    recentChapters ? `最近章节摘要：\n${recentChapters}` : '未提供最近章节摘要；请只依据当前正文和已给出的项目资料分析，不要补写历史剧情。'
  ].filter(Boolean).join('\n')
}
