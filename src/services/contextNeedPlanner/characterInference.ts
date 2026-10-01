import type {
  ChapterContinuityBridge,
  Character,
  CharacterNeedInvolvement,
  ExpectedCharacterNeed,
  ExpectedPresence,
  ID
} from '../../shared/types'
import { containsAny, inferRoleInChapter, textMentions, textValue } from './rules'

const OFFSCREEN_TERMS = ['电话', '通讯', '广播', '消息', '远程', '隔空', '不在场', '未到场', '场外']
const REFERENCE_TERMS = ['提到', '提及', '谈及', '想起', '回忆', '照片', '档案', '记录', '传闻', '名字', '梦见', '听说']
const ACTION_TERMS = [
  '行动', '进入', '离开', '调查', '对抗', '保护', '阻止', '追击', '逃离', '打开', '使用',
  '交涉', '质问', '决定', '选择', '承担', '完成', '揭露', '兑现', '救出', '带领'
]
const STATE_CHECK_TERMS = ['状态', '伤势', '身体', '位置', '持有', '物品', '资源', '知道', '秘密', '关系', '承诺', '能力', '权限']

interface CharacterNeedCandidate extends ExpectedCharacterNeed {
  evidenceRank: number
}

export interface InferExpectedCharacterNeedsInput {
  characters: Character[]
  taskText: string
  storyDirectionText: string
  continuityBridge: ChapterContinuityBridge | null
  relatedCharacterIds: Set<ID>
  limit?: number
}

function characterWindows(text: string, name: string, radius = 34): string {
  const source = textValue(text)
  if (!source || name.length < 2) return ''
  const windows: string[] = []
  let from = 0
  while (from < source.length) {
    const index = source.indexOf(name, from)
    if (index < 0) break
    windows.push(source.slice(Math.max(0, index - radius), Math.min(source.length, index + name.length + radius)))
    from = index + name.length
  }
  return windows.join('\n')
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function actionAttachedToCharacter(text: string, name: string): boolean {
  const escapedName = escapedRegExp(name)
  return ACTION_TERMS.some((term) => {
    const escapedTerm = escapedRegExp(term)
    return new RegExp(`${escapedName}.{0,12}${escapedTerm}|${escapedTerm}.{0,8}${escapedName}`).test(text)
  })
}

function bridgeText(bridge: ChapterContinuityBridge | null): string {
  if (!bridge) return ''
  return [
    bridge.lastSceneLocation,
    bridge.lastPhysicalState,
    bridge.lastEmotionalState,
    bridge.lastUnresolvedAction,
    bridge.lastDialogueOrThought,
    bridge.immediateNextBeat,
    bridge.mustContinueFrom,
    bridge.mustNotReset,
    bridge.openMicroTensions
  ]
    .map(textValue)
    .filter(Boolean)
    .join('\n')
}

function explicitCandidate(
  character: Character,
  sourceText: string,
  evidence: 'task' | 'bridge' | 'story_direction'
): CharacterNeedCandidate | null {
  if (!textMentions(sourceText, character.name)) return null
  const localText = characterWindows(sourceText, character.name)
  const offscreen = containsAny(localText, OFFSCREEN_TERMS)
  const referenced = !offscreen && containsAny(localText, REFERENCE_TERMS)
  const mustAct = actionAttachedToCharacter(localText, character.name)
  const expectedPresence: ExpectedPresence = offscreen ? 'offscreen' : referenced && !mustAct ? 'referenced' : 'onstage'
  const involvement: CharacterNeedInvolvement = mustAct ? 'must_act' : expectedPresence === 'onstage' ? 'present' : 'mentioned'
  const uncertain = evidence === 'story_direction'
  const stateCheckRequired = involvement === 'must_act' || expectedPresence === 'onstage' || containsAny(localText, STATE_CHECK_TERMS)
  const sourceLabel = evidence === 'task' ? '章节任务契约' : evidence === 'bridge' ? '上一章衔接 Bridge' : '中期剧情导向'
  const involvementLabel = involvement === 'must_act' ? '必须行动' : involvement === 'present' ? '预计在场' : '仅被提及'

  return {
    characterId: character.id,
    roleInChapter: inferRoleInChapter(character, sourceText),
    expectedPresence,
    involvement,
    stateCheckRequired,
    uncertain,
    reason: `${sourceLabel}点名该角色，判断为“${involvementLabel}”${uncertain ? '；导向属于软性意图，仍需后续任务书确认。' : '。'}`,
    evidenceRank: evidence === 'bridge' ? 110 : evidence === 'task' ? 100 : 60
  }
}

function relatedForeshadowingCandidate(character: Character): CharacterNeedCandidate {
  return {
    characterId: character.id,
    roleInChapter: inferRoleInChapter(character, ''),
    expectedPresence: 'referenced',
    involvement: 'mentioned',
    stateCheckRequired: false,
    uncertain: true,
    reason: '本章相关伏笔关联到该角色，但任务契约未确认其在场；先作为候选角色保留。',
    evidenceRank: 35
  }
}

function fallbackProtagonist(characters: Character[]): CharacterNeedCandidate | null {
  const character =
    characters.find((item) => item.isMain && /主角|主人公|protagonist/i.test(item.role)) ??
    characters.find((item) => item.isMain)
  if (!character) return null
  return {
    characterId: character.id,
    roleInChapter: inferRoleInChapter(character, ''),
    expectedPresence: 'onstage',
    involvement: 'present',
    stateCheckRequired: true,
    uncertain: true,
    reason: '任务契约没有点名角色，暂以主要角色作为在场候选；该推断不会强制挤占上下文预算。',
    evidenceRank: 20
  }
}

function involvementRank(value: CharacterNeedInvolvement): number {
  return value === 'must_act' ? 3 : value === 'present' ? 2 : 1
}

function mergeCandidate(current: CharacterNeedCandidate, next: CharacterNeedCandidate): CharacterNeedCandidate {
  const primary = next.evidenceRank > current.evidenceRank ? next : current
  const strongerInvolvement = involvementRank(next.involvement) > involvementRank(current.involvement)
    ? next.involvement
    : current.involvement
  return {
    ...primary,
    involvement: strongerInvolvement,
    stateCheckRequired: current.stateCheckRequired || next.stateCheckRequired,
    uncertain: current.uncertain && next.uncertain,
    reason: current.reason === next.reason ? primary.reason : `${primary.reason} ${primary === current ? next.reason : current.reason}`,
    evidenceRank: Math.max(current.evidenceRank, next.evidenceRank)
  }
}

export function inferExpectedCharacterNeeds(input: InferExpectedCharacterNeedsInput): ExpectedCharacterNeed[] {
  const candidates = new Map<ID, CharacterNeedCandidate>()
  const upsert = (candidate: CharacterNeedCandidate | null) => {
    if (!candidate) return
    const current = candidates.get(candidate.characterId)
    candidates.set(candidate.characterId, current ? mergeCandidate(current, candidate) : candidate)
  }

  for (const character of input.characters) {
    upsert(explicitCandidate(character, input.taskText, 'task'))
    upsert(explicitCandidate(character, bridgeText(input.continuityBridge), 'bridge'))
    upsert(explicitCandidate(character, input.storyDirectionText, 'story_direction'))
    if (input.relatedCharacterIds.has(character.id)) upsert(relatedForeshadowingCandidate(character))
  }

  if (candidates.size === 0) upsert(fallbackProtagonist(input.characters))

  return [...candidates.values()]
    .sort((a, b) => b.evidenceRank - a.evidenceRank || Number(a.uncertain) - Number(b.uncertain))
    .slice(0, input.limit ?? 8)
    .map(({ evidenceRank: _evidenceRank, ...need }) => need)
}

export function characterCardRetrievalPriority(need: ExpectedCharacterNeed): number {
  const base = need.involvement === 'must_act' ? 92 : need.involvement === 'present' ? 82 : 42
  return Math.max(0, base - (need.uncertain ? 22 : 0))
}

export function characterStateRetrievalPriority(need: ExpectedCharacterNeed): number {
  if (!need.stateCheckRequired) return need.uncertain ? 18 : 30
  const base = need.involvement === 'must_act' ? 96 : need.involvement === 'present' ? 88 : 58
  return Math.max(0, base - (need.uncertain ? 22 : 0))
}
