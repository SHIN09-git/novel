import type { ChapterGenerationJob, ID } from '../shared/types'

export interface OpeningChapterSnapshotPolicyResult {
  job: ChapterGenerationJob
  ignoredPromptContextSnapshotId: ID | null
  mustRebuildFromStart: boolean
}

export function enforceOpeningChapterSnapshotPolicy(
  job: ChapterGenerationJob
): OpeningChapterSnapshotPolicyResult {
  const mustIgnoreSnapshot =
    job.targetChapterOrder === 1 &&
    Boolean(job.chapterTaskSnapshot) &&
    job.contextSource === 'prompt_snapshot'

  if (!mustIgnoreSnapshot) {
    return {
      job,
      ignoredPromptContextSnapshotId: null,
      mustRebuildFromStart: false
    }
  }

  return {
    job: {
      ...job,
      contextSource: 'auto',
      promptContextSnapshotId: null
    },
    ignoredPromptContextSnapshotId: job.promptContextSnapshotId ?? null,
    mustRebuildFromStart: true
  }
}
