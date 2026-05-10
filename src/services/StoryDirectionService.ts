import type {
  ChapterTask,
  ID,
  StageSummary,
  StoryDirectionChapterBeat,
  StoryDirectionGuide
} from '../shared/types'
import { StageSummaryService } from './StageSummaryService'

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = '\n'): string {
  return parts.map(clean).filter(Boolean).join(separator)
}

function line(label: string, value: string | null | undefined): string {
  const text = clean(value)
  return text ? `${label}${text}` : ''
}

function timestampSort(a: StoryDirectionGuide, b: StoryDirectionGuide): number {
  return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
}

export class StoryDirectionService {
  static getActiveGuideForChapter(
    guides: StoryDirectionGuide[] = [],
    projectId: ID,
    targetChapterOrder: number
  ): StoryDirectionGuide | null {
    return (
      guides
        .filter((guide) => guide.projectId === projectId)
        .filter((guide) => guide.status === 'active')
        .filter((guide) => targetChapterOrder >= guide.startChapterOrder && targetChapterOrder <= guide.endChapterOrder)
        .sort(timestampSort)[0] ?? null
    )
  }

  static getBeatForChapter(guide: StoryDirectionGuide, targetChapterOrder: number): StoryDirectionChapterBeat | null {
    return guide.chapterBeats.find((beat) => beat.chapterOrder === targetChapterOrder) ?? null
  }

  static deriveChapterTaskPatch(
    guide: StoryDirectionGuide | null,
    targetChapterOrder: number
  ): Partial<ChapterTask> {
    if (!guide) return {}
    const beat = StoryDirectionService.getBeatForChapter(guide, targetChapterOrder)
    if (beat) {
      return {
        goal: clean(beat.goal),
        conflict: clean(beat.conflict),
        suspenseToKeep: clean(beat.suspenseToKeep),
        allowedPayoffs: clean(beat.foreshadowingToUse),
        forbiddenPayoffs: joinNonEmpty([beat.foreshadowingNotToReveal, guide.forbiddenTurns]),
        endingHook: clean(beat.endingHook),
        readerEmotion: clean(beat.readerEmotion)
      }
    }

    if (targetChapterOrder < guide.startChapterOrder || targetChapterOrder > guide.endChapterOrder) return {}
    return {
      goal: joinNonEmpty([guide.coreDramaticPromise, guide.strategicTheme], '；'),
      conflict: clean(guide.aiGuidance),
      suspenseToKeep: clean(guide.emotionalCurve),
      forbiddenPayoffs: joinNonEmpty([guide.forbiddenTurns, guide.constraints]),
      readerEmotion: clean(guide.emotionalCurve)
    }
  }

  static formatForPrompt(guide: StoryDirectionGuide | null, targetChapterOrder: number): string {
    if (!guide) return ''
    const beat = StoryDirectionService.getBeatForChapter(guide, targetChapterOrder)
    const beatText = beat
      ? [
          '本章对应节拍：',
          line('- 目标：', beat.goal),
          line('- 冲突：', beat.conflict),
          line('- 角色焦点：', beat.characterFocus),
          line('- 可使用伏笔：', beat.foreshadowingToUse),
          line('- 禁止提前揭示：', beat.foreshadowingNotToReveal),
          line('- 保留悬念：', beat.suspenseToKeep),
          line('- 结尾压力：', beat.endingHook),
          line('- 读者情绪：', beat.readerEmotion),
          line('- 必须避免：', beat.mustAvoid),
          line('- 备注：', beat.notes)
        ]
          .filter(Boolean)
          .join('\n')
      : '本章没有精确节拍；只参考本导向的战略主题、情绪曲线和禁区。'

    return [
      '## 中期剧情导向 StoryDirectionGuide',
      `状态：${guide.status}`,
      `覆盖章节：第 ${guide.startChapterOrder}-${guide.endChapterOrder} 章`,
      line('核心戏剧承诺：', guide.coreDramaticPromise),
      line('战略主题：', guide.strategicTheme),
      line('情绪曲线：', guide.emotionalCurve),
      line('角色弧线方向：', guide.characterArcDirectives),
      line('伏笔推进方向：', guide.foreshadowingDirectives),
      line('限制与禁区：', joinNonEmpty([guide.constraints, guide.forbiddenTurns], '；')),
      beatText,
      '硬规则：本导向只用于选择剧情推进方向；不得覆盖上一章结尾衔接、本章任务契约、角色硬状态账本、伏笔 treatmentMode、最小硬设定和禁止事项。如冲突，自动服从更高优先级上下文。'
    ]
      .filter(Boolean)
      .join('\n')
  }

  static formatStageSummaryReview(stageSummaries: StageSummary[] = []): string {
    return [...stageSummaries]
      .sort((a, b) => b.chapterEnd - a.chapterEnd || b.chapterStart - a.chapterStart)
      .map((summary) => StageSummaryService.formatForPrompt(summary))
      .join('\n\n')
  }
}
