import type { ChapterGenerationStep, GeneratedChapterDraft, ID } from './types'

/** Read-only step output, never a GeneratedChapterDraft. */
export function readChapterStepFragment(step: Pick<ChapterGenerationStep, 'type' | 'output'>) {
  if (step.type !== 'generate_chapter_draft' || !step.output) return null
  try {
    const value = JSON.parse(step.output) as Record<string, unknown> | null
    if (value?.kind !== 'incomplete_chapter_fragment' || typeof value.body !== 'string' || !value.body.trim()) return null
    return {
      kind: 'incomplete_chapter_fragment' as const,
      title: typeof value.title === 'string' ? value.title : '',
      body: value.body,
      finishReason: typeof value.finishReason === 'string' ? value.finishReason : null
    }
  } catch {
    return null
  }
}

/** A retry replaces the prose step output, not the previous complete draft. */
export function isCurrentFragmentStep(step: ChapterGenerationStep, draft?: GeneratedChapterDraft | null) {
  return (!draft || step.updatedAt >= draft.createdAt) && Boolean(readChapterStepFragment(step))
}

export function hasCurrentChapterFragment(steps: readonly ChapterGenerationStep[], jobId: ID, draft?: GeneratedChapterDraft | null) {
  const step = steps.find((item) => item.jobId === jobId && item.type === 'generate_chapter_draft')
  return Boolean(step && isCurrentFragmentStep(step, draft))
}
