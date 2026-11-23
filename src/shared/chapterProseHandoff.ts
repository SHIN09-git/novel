import type { ChapterGenerationStep, ChapterPlan } from './types'

export interface ChapterProseHandoff {
  kind: 'awaiting_prose_draft'
  handoffId: string
  inputHash: string
  plan: ChapterPlan
  messages: readonly { role: string; content: string }[]
  includedHardCanonItemIds: string[]
}

export interface AgentDraftSubmission {
  actorTag?: string
  handoffId: string
  title: string
  body: string
}

export function readChapterProseHandoff(step?: ChapterGenerationStep): ChapterProseHandoff | null {
  if (step?.type !== 'generate_chapter_draft' || !step.output || step.status === 'completed') return null
  try {
    const value = JSON.parse(step.output)
    return value?.kind === 'awaiting_prose_draft' && typeof value.handoffId === 'string' &&
      typeof value.inputHash === 'string' && value.plan && Array.isArray(value.messages) ? value : null
  } catch { return null }
}
