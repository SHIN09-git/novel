import type { AppData, CandidateDecisionCommand } from '../shared/types'

// A chapter-limited grant must not authorize a global or ambiguously sourced edit.
export function candidateDecisionChapterOrders(data: AppData, command: Pick<CandidateDecisionCommand, 'decisions' | 'undo' | 'projectId'>): number[] | undefined {
  const decisions = command.undo
    ? data.candidateDecisionReceipts.find((receipt) => receipt.id === command.undo!.receiptId && receipt.projectId === command.projectId)?.decisions
    : command.decisions
  if (!decisions?.length) return undefined
  const orders = new Set<number>()
  for (const decision of decisions) {
    const candidate = decision.kind === 'memory'
      ? data.memoryUpdateCandidates.find((item) => item.id === decision.candidateId && item.projectId === command.projectId)
      : data.characterStateChangeCandidates.find((item) => item.id === decision.candidateId && item.projectId === command.projectId)
    if (!candidate) return undefined
    const job = data.chapterGenerationJobs.find((item) => item.id === candidate.jobId && item.projectId === command.projectId)
    const chapter = 'chapterId' in candidate
      ? data.chapters.find((item) => item.id === candidate.chapterId && item.projectId === command.projectId)
      : undefined
    const values = [job?.targetChapterOrder, chapter?.order, 'chapterOrder' in candidate ? candidate.chapterOrder : undefined]
      .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    if (!values.length || new Set(values).size !== 1) return undefined
    orders.add(values[0])
  }
  return [...orders]
}
