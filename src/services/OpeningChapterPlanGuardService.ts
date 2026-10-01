import type { ChapterPlan, ChapterTask } from '../shared/types'
import { shouldIsolateOpeningLegacyContext } from './OpeningChapterContextPolicy'

export interface GuardOpeningChapterPlanInput {
  generatedPlan: ChapterPlan
  targetChapterOrder: number
  chapterTaskSnapshot?: ChapterTask | null
}

function clean(value: string): string {
  return value.trim()
}

function labeled(label: string, value: string): string {
  const normalized = clean(value)
  return normalized ? `${label}：${normalized}` : ''
}

function joined(values: string[], fallback: string): string {
  const result = values.filter(Boolean).join('\n')
  return result || fallback
}

function allowedTaskScope(task: ChapterTask): string {
  return joined(
    [
      labeled('本章目标', task.goal),
      labeled('必须推进的冲突', task.conflict),
      labeled('允许兑现', task.allowedPayoffs),
      labeled('任务指定收束', task.endingHook),
      labeled('读者情绪', task.readerEmotion),
      labeled('文风要求', task.styleRequirement)
    ],
    'ChapterTask 未明确授权任何新增素材。'
  )
}

function forbiddenTaskScope(task: ChapterTask): string {
  return joined(
    [
      '不得新增 ChapterTask 未明确提供的带专名人物或地点、人物关系、背景、机制、剧情行动、剧情事件、危险或悬念钩子。',
      '允许补充不带专名、无剧情功能的普通食材、器具、摊贩或路人、环境细节和生活动作，但不得让它们承载线索、设定、解法或钩子。',
      labeled('必须保留的悬念', task.suspenseToKeep),
      labeled('禁止兑现', task.forbiddenPayoffs)
    ],
    '不得新增 ChapterTask 未明确提供的素材。'
  )
}

/**
 * Builds the only plan shape allowed to reach a draft request for an
 * authoritative chapter-one job. No value from the model plan is read here.
 */
export function buildAuthoritativeOpeningPlan(task: ChapterTask): ChapterPlan {
  const goal = clean(task.goal)
  const conflict = clean(task.conflict)
  const suspense = clean(task.suspenseToKeep)
  const allowedPayoffs = clean(task.allowedPayoffs)
  const forbiddenPayoffs = clean(task.forbiddenPayoffs)
  const endingHook = clean(task.endingHook)
  const readerEmotion = clean(task.readerEmotion)
  const targetWordCount = clean(task.targetWordCount)

  return {
    chapterTitle: '第一章',
    chapterGoal: goal,
    conflictToPush: conflict,
    characterBeats: joined(
      [labeled('只围绕任务目标推进', goal), labeled('只处理任务冲突', conflict)],
      '只执行 ChapterTask 明确要求的当下行动，不补写任务外人物或剧情。'
    ),
    foreshadowingToUse: allowedPayoffs
      ? `仅可处理 ChapterTask 明确允许兑现的内容：${allowedPayoffs}`
      : '不主动添加或兑现 ChapterTask 未明确允许的伏笔。',
    foreshadowingNotToReveal: joined(
      [labeled('必须保留', suspense), labeled('禁止兑现', forbiddenPayoffs)],
      '不得提前揭示 ChapterTask 未授权的答案或未来真相。'
    ),
    endingHook: endingHook || '按本章任务自然收束，不添加额外危险、命运暗示或悬念钩子。',
    readerEmotionTarget: readerEmotion || '从本章当下自然建立情绪基线，不预告后续阶段压力。',
    estimatedWordCount: targetWordCount || '按 ChapterTask 的字数要求执行。',
    openingContinuationBeat: goal
      ? `从 ChapterTask 指定的当下自然开场：${goal}`
      : '从本章当下自然开场，不虚构上一章或任务外前史。',
    carriedPhysicalState: '第一章没有上一章身体状态可承接；不得自行补写前史状态。',
    carriedEmotionalState: readerEmotion
      ? `第一章不承接不存在的上一章情绪；按任务要求建立基线：${readerEmotion}`
      : '第一章不承接不存在的上一章情绪，只从本章当下建立基线。',
    unresolvedMicroTensions: conflict || '只保留任务明确要求的生活小摩擦，不自行添加微悬念。',
    forbiddenResets: joined(
      [
        '不得虚构上一章、既有危机或既有剧情状态。',
        forbiddenPayoffs ? `不得以任何方式兑现：${forbiddenPayoffs}` : ''
      ],
      '不得虚构上一章、既有危机或既有剧情状态。'
    ),
    allowedNovelty: {
      allowedNewCharacters: [],
      allowedNewRules: [],
      allowedNewSystemMechanics: [],
      allowedNewOrganizationsOrRanks: [],
      allowedLoreReveals: [],
      notes: `剧情素材的唯一授权来源为以下 ChapterTask 正向字段；另可补充不带专名、无剧情功能的普通生活纹理。\n${allowedTaskScope(task)}`
    },
    forbiddenNovelty: {
      forbiddenNewCharacters: ['ChapterTask 未明确提供的带专名人物或有剧情功能的新人物'],
      forbiddenNewRules: ['ChapterTask 未明确提供的新规则'],
      forbiddenSystemMechanics: ['ChapterTask 未明确提供的新机制或权限'],
      forbiddenOrganizationsOrRanks: ['ChapterTask 未明确提供的新组织或身份层级'],
      forbiddenLoreReveals: ['ChapterTask 未明确允许揭示的真相或设定'],
      notes: forbiddenTaskScope(task)
    }
  }
}

/**
 * Later chapters and jobs without an authoritative task retain their generated
 * plan unchanged. Authoritative chapter one is rebuilt solely from its snapshot.
 */
export function guardOpeningChapterPlanForDraft(input: GuardOpeningChapterPlanInput): ChapterPlan {
  const task = input.chapterTaskSnapshot
  if (!task || !shouldIsolateOpeningLegacyContext(input.targetChapterOrder, true)) {
    return input.generatedPlan
  }
  return buildAuthoritativeOpeningPlan(task)
}
