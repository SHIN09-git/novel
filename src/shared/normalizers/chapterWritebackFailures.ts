import type { ChapterWritebackFailure } from '../types'
import { redactSensitiveText } from '../errorUtils'

const safeReason = '存储写入失败，未发现本次提交回执或目标版本。'

export function normalizeChapterWritebackFailure(input: unknown, legacyKey = ''): ChapterWritebackFailure | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const row = input as Record<string, unknown>
  const id = (v: unknown): v is string => typeof v === 'string' && /^[\p{L}\p{N}._:-]{1,256}$/u.test(v) &&
    redactSensitiveText(v, [legacyKey]) === v && !/^(?:sk-|github_pat_|gh[pousr]_|xox[baprs]-|eyJ[\w-]+\.)/i.test(v)
  if (!id(row.id) || !id(row.projectId) || !id(row.chapterId) || !id(row.commitId) || !id(row.versionId) ||
    typeof row.chapterOrder !== 'number' || !Number.isSafeInteger(row.chapterOrder) || row.chapterOrder < 1 ||
    (row.kind !== 'chapter_commit' && row.kind !== 'revision_commit') ||
    typeof row.attemptedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(row.attemptedAt) ||
    !Number.isFinite(Date.parse(row.attemptedAt))) return
  const failure: ChapterWritebackFailure = {
    id: row.id, projectId: row.projectId, chapterId: row.chapterId, chapterOrder: row.chapterOrder,
    kind: row.kind, commitId: row.commitId, versionId: row.versionId,
    attemptedAt: new Date(row.attemptedAt).toISOString(), reason: safeReason
  }
  for (const key of ['jobId', 'draftId', 'revisionSessionId', 'revisionVersionId', 'baseChapterVersionId'] as const) {
    const value = row[key]
    if (value == null) continue
    if (!id(value)) return
    failure[key] = value
  }
  if (row.intentFingerprint != null) {
    if (typeof row.intentFingerprint !== 'string' || !/^writeback-v1:draft-v1-[a-f0-9]{16}-\d{1,10}$/.test(row.intentFingerprint)) return
    failure.intentFingerprint = row.intentFingerprint
  }
  return failure
}

export function normalizeChapterWritebackFailures(input: unknown, legacyKey = '', projects?: readonly { id: string }[]): ChapterWritebackFailure[] {
  if (!Array.isArray(input) || !input.length) return []
  const projectIds = projects && new Set(projects.map((p) => p.id))
  return input.flatMap((row: unknown) => {
    const failure = normalizeChapterWritebackFailure(row, legacyKey)
    return failure && (!projectIds || projectIds.has(failure.projectId)) ? [failure] : []
  })
}
