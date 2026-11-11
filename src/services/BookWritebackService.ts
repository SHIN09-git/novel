import type { AppData, Chapter, ChapterVersion, ID } from '../shared/types'
import { isChapterArchived } from './ChapterLifecycleService'
import { unresolvedChapterWritebackFailures } from './ChapterWritebackFailureService'

type ReceiptData = Pick<AppData, 'chapters' | 'chapterVersions' | 'chapterCommitBundles' | 'revisionCommitBundles' | 'chapterGenerationJobs' | 'generatedChapterDrafts' | 'chapterWritebackFailures'>

interface VersionReceipt {
  commitId: ID
  versionId: ID
  jobId: ID | null
  draftId: ID | null
  writtenAt: string
}

export interface JobWritebackProof {
  confirmed: boolean
  chapterId: ID | null
  draftId: ID | null
  versionId: ID | null
  commitId: ID | null
  writebackFailure?: AppData['chapterWritebackFailures'][number]
  reason: string
}

// An embedded version in a receipt is not a persisted chapterVersion. Index both
// sides once; neither a completed job nor an old chapter at the same order is proof.
export function createBookWritebackIndex(data: ReceiptData, projectId: ID, failures = unresolvedChapterWritebackFailures(data, projectId)) {
  const chapters = new Map(data.chapters.filter(c => c.projectId === projectId).map(c => [c.id, c]))
  const activeOrders = new Set<number>(), ambiguous = new Set<number>()
  for (const c of chapters.values()) {
    if (isChapterArchived(c)) continue
    if (activeOrders.has(c.order)) ambiguous.add(c.order)
    activeOrders.add(c.order)
  }
  const versions = new Map(data.chapterVersions.filter(v => v.projectId === projectId).map(v => [v.id, v]))
  const jobs = new Map(data.chapterGenerationJobs.filter(j => j.projectId === projectId).map(j => [j.id, j]))
  const drafts = new Map(data.generatedChapterDrafts.filter(d => d.projectId === projectId).map(d => [d.id, d]))
  const pendingByJob = new Map<ID, (typeof data.generatedChapterDrafts)[number]>()
  for (const d of drafts.values()) {
    const prev = pendingByJob.get(d.jobId)
    if (d.status === 'draft' && (!prev || d.createdAt > prev.createdAt || (d.createdAt === prev.createdAt && d.id > prev.id))) {
      pendingByJob.set(d.jobId, d)
    }
  }
  const acceptedByJob = new Map<ID, VersionReceipt[]>()
  const generationVersions = new Set<ID>()
  const latestByChapter = new Map<ID, VersionReceipt>()
  const incompleteSince = new Map<ID, string>()
  const incomplete = (id: ID, at: string) => {
    if (!incompleteSince.has(id) || at > incompleteSince.get(id)!) incompleteSince.set(id, at)
  }
  const byAttempt = [...failures].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt) || a.id.localeCompare(b.id))
  const failedJobs = new Map(byAttempt.filter(f => f.jobId).map(f => [f.jobId, f]))
  const failedChapters = new Map(byAttempt.map(f => [f.chapterId, f]))
  const record = (v: ChapterVersion, receipt: VersionReceipt) => {
    const prev = latestByChapter.get(v.chapterId)
    // Repeated restores can have the same text, even the same timestamp in imports.
    if (!prev || receipt.writtenAt > prev.writtenAt || (receipt.writtenAt === prev.writtenAt &&
      (descendsFrom(v.id, prev.versionId, v.chapterId) || (!descendsFrom(prev.versionId, v.id, v.chapterId) && v.id > prev.versionId)))) {
      latestByChapter.set(v.chapterId, receipt)
    }
  }
  for (const c of data.chapterCommitBundles) {
    if (c.projectId !== projectId) continue
    const v = c.chapterVersion && versions.get(c.chapterVersion.id)
    if (!v || v.chapterId !== c.chapterId || c.chapter?.id !== c.chapterId || c.chapter.projectId !== projectId ||
      v.source === 'before_accept_draft' || v.body !== c.chapter.body || v.body !== c.chapterVersion?.body ||
      (v.linkedChapterCommitId && v.linkedChapterCommitId !== c.commitId)) { incomplete(c.chapterId, c.acceptedAt); continue }
    const r = { commitId: c.commitId, versionId: v.id, jobId: c.jobId ?? null,
      draftId: c.generatedDraftId ?? null, writtenAt: c.acceptedAt }
    generationVersions.add(v.id)
    record(v, r)
    if (r.jobId && r.draftId) {
      const receipts = acceptedByJob.get(r.jobId) ?? []
      receipts.push(r)
      acceptedByJob.set(r.jobId, receipts)
    }
  }
  for (const c of data.revisionCommitBundles) {
    if (c.projectId !== projectId) continue
    const v = versions.get(c.newChapterVersionId)
    if (!v || v.chapterId !== c.chapterId || c.chapter?.id !== c.chapterId || c.chapter.projectId !== projectId ||
      v.id !== c.chapterVersion?.id || v.body !== c.afterText || v.body !== c.chapter.body ||
      (v.linkedRevisionCommitId && v.linkedRevisionCommitId !== c.revisionCommitId)) { incomplete(c.chapterId, c.revisedAt); continue }
    record(v, { commitId: c.revisionCommitId, versionId: v.id, jobId: null,
      draftId: c.generatedDraft?.id ?? null, writtenAt: c.revisedAt })
  }
  const current = (chapter: Chapter) => {
    const r = latestByChapter.get(chapter.id)
    return r && (!incompleteSince.has(chapter.id) || incompleteSince.get(chapter.id)! < r.writtenAt) &&
      versions.get(r.versionId)?.body === chapter.body ? r : null
  }
  function descendsFrom(head: ID, ancestor: ID, chapterId: ID, onlyRevisions = false) {
    const seen = new Set<ID>()
    let id: ID | null | undefined = head
    while (id && !seen.has(id)) {
      const version: ChapterVersion | undefined = versions.get(id)
      if (!version || version.chapterId !== chapterId) return false
      if (id === ancestor) return true
      if (onlyRevisions && generationVersions.has(id)) return false
      seen.add(id)
      id = version.baseChapterVersionId
    }
    return false
  }
  const verifyJob = (jobId: ID): JobWritebackProof => {
    const job = jobs.get(jobId)
    const receipts = acceptedByJob.get(jobId) ?? []
    const pending = pendingByJob.get(jobId)
    const failed = failedJobs.get(jobId) ?? receipts.map(r => failedChapters.get(versions.get(r.versionId)!.chapterId)).find(Boolean)
    if (failed) return { confirmed: false, chapterId: chapters.has(failed.chapterId) ? failed.chapterId : null,
      draftId: failed.draftId ?? pending?.id ?? null, versionId: null, commitId: null, writebackFailure: failed,
      reason: failed.kind === 'revision_commit' ? '新修订尚未写回。请回到该修订稿，核对后重试提交；旧正文仍保留。' : '草稿写回失败，请回到该稿重试提交。' }
    if (job && ambiguous.has(job.targetChapterOrder)) return { confirmed: false, chapterId: null, draftId: pending?.id ?? null,
      versionId: null, commitId: null, reason: '同一章号有多份未归档章节，请先确认哪一份是正式正文。' }
    for (const r of receipts) {
      const v = versions.get(r.versionId)!
      const chapter = chapters.get(v.chapterId)
      const draft = r.draftId && drafts.get(r.draftId)
      if (!job || !chapter || !draft || draft.jobId !== jobId || draft.chapterId !== chapter.id ||
        draft.status !== 'accepted' || isChapterArchived(chapter) || chapter.order !== job.targetChapterOrder || !chapter.body.trim()) continue
      const head = current(chapter)
      if (pending && pending.createdAt >= r.writtenAt) continue
      if (head && descendsFrom(head.versionId, r.versionId, chapter.id, true)) {
        return { confirmed: true, chapterId: chapter.id, draftId: r.draftId, versionId: head.versionId,
          commitId: r.commitId, reason: '本次采纳的回执和正式版本均在，当前正文可追溯到该版本。' }
      }
    }
    return { confirmed: false, chapterId: pending?.chapterId ?? null, draftId: pending?.id ?? null, versionId: null, commitId: null,
      reason: pending ? '本次草稿尚未正式写回，请审阅后采纳，再继续下一章。' : '未能核实本次草稿的采纳回执、落库版本和当前正文，请先检查提交结果。' }
  }
  return { current, verifyJob }
}
