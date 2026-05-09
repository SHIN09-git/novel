import type { ChapterReviewDraft } from '../../../../shared/types'

export type ReviewTextField = Exclude<keyof ChapterReviewDraft, 'continuityBridgeSuggestion' | 'characterStateChangeSuggestions'>

export const reviewFields: Array<{ key: ReviewTextField; label: string }> = [
  { key: 'summary', label: '本章剧情摘要' },
  { key: 'newInformation', label: '本章新增信息' },
  { key: 'characterChanges', label: '本章角色变化' },
  { key: 'newForeshadowing', label: '本章新增伏笔' },
  { key: 'resolvedForeshadowing', label: '本章已回收伏笔' },
  { key: 'endingHook', label: '本章结尾钩子' },
  { key: 'riskWarnings', label: '本章风险提醒' }
]
