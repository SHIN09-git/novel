import type { Chapter, ChapterVersion, ID } from '../../shared/types'
import { draftContentHash } from '../DraftDiagnosticBindingService'

export function createManuscriptEvidenceIndex(versions: readonly ChapterVersion[], projectId: ID) {
  const latest = new Map<ID, ChapterVersion[]>()
  for (const v of versions) {
    if (v.projectId !== projectId || v.source === 'before_accept_draft' || v.source === 'pre_commit_snapshot') continue
    const group = latest.get(v.chapterId)
    if (!group || v.createdAt > group[0].createdAt) latest.set(v.chapterId, [v])
    else if (v.createdAt === group[0].createdAt) group.push(v)
  }
  const cache = new WeakMap<Chapter, { versionId: ID | null; contentHash: string }>()
  return (chapter: Chapter) => {
    const cached = cache.get(chapter)
    if (cached) return cached
    const heads = latest.get(chapter.id) ?? []
    const replaced = new Set(heads.map(v => v.baseChapterVersionId))
    const matches = heads.filter(v => !replaced.has(v.id) && v.body === chapter.body && v.projectId === chapter.projectId)
    // Re-pasting text from an older version is not a restore commit. A current manuscript can have no matching version.
    const ref = { versionId: matches.length === 1 ? matches[0].id : null, contentHash: draftContentHash(chapter.body) }
    cache.set(chapter, ref)
    return ref
  }
}
