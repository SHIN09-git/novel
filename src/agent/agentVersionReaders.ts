import type { AppData, Chapter, ID } from '../shared/types'
import {
  findActiveChapterByOrder,
  isChapterArchived
} from '../services/ChapterLifecycleService'
import { getChapterVersionChain as buildChapterVersionChain } from '../services/ChapterVersionChainService'
import {
  commonPrefixLength,
  commonSuffixLength,
  compact,
  readLimit,
  textPayload
} from './agentReadableText'
import type { AgentReadOptions, AgentTextReadResult } from './agentReadableText'
import type { AgentVersionChainSummary, AgentVersionDiffResult } from './agentReadableSummaryTypes'

export function findReadableChapterByOrder(
  data: AppData,
  projectId: ID,
  chapterOrder: number
): Chapter | null {
  const active = findActiveChapterByOrder(data.chapters, projectId, chapterOrder)
  if (active) return active
  return [...data.chapters]
    .filter(
      (chapter) =>
        chapter.projectId === projectId &&
        chapter.order === chapterOrder &&
        isChapterArchived(chapter)
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
}

function requireReadableChapter(data: AppData, projectId: ID, chapterOrder: number): Chapter {
  const chapter = findReadableChapterByOrder(data, projectId, chapterOrder)
  if (!chapter) throw new Error(`Chapter not found: project=${projectId}, order=${chapterOrder}`)
  return chapter
}

export function getChapterVersionChain(
  data: AppData,
  projectId: ID,
  chapterOrder: number
): AgentVersionChainSummary {
  const projectExists = data.projects.some((project) => project.id === projectId)
  if (!projectExists) throw new Error(`Project not found: ${projectId}`)
  const chapter = findReadableChapterByOrder(data, projectId, chapterOrder)
  const entries = chapter ? buildChapterVersionChain(data, chapter.id) : []
  return {
    projectId,
    chapterOrder,
    chapterId: chapter?.id ?? null,
    chapterArchived: chapter ? isChapterArchived(chapter) : false,
    versions: entries.map((entry) => ({
      id: entry.id,
      source: entry.source,
      isCurrent: entry.isCurrent,
      title: entry.title,
      createdAt: entry.createdAt,
      bodyCharCount: entry.body.length,
      linkedChapterCommitId: entry.linkedChapterCommitId,
      linkedRevisionCommitId: entry.linkedRevisionCommitId,
      linkedGenerationRunTraceId: entry.linkedGenerationRunTraceId
    }))
  }
}

export function getVersionDetail(
  data: AppData,
  projectId: ID,
  chapterOrder: number,
  versionId: string,
  options: AgentReadOptions = {}
): AgentTextReadResult {
  const chapter = requireReadableChapter(data, projectId, chapterOrder)
  const entry = buildChapterVersionChain(data, chapter.id).find((item) => item.id === versionId) ?? null
  if (!entry) throw new Error(`Version not found: ${versionId}`)
  return textPayload(entry.id, 'version', entry.title, entry.body, options, {
    projectId,
    chapterId: chapter.id,
    chapterOrder,
    chapterArchived: isChapterArchived(chapter),
    source: entry.source,
    sourceKind: entry.sourceKind,
    createdAt: entry.createdAt,
    linkedChapterCommitId: entry.linkedChapterCommitId,
    linkedRevisionCommitId: entry.linkedRevisionCommitId,
    linkedGenerationRunTraceId: entry.linkedGenerationRunTraceId
  })
}

export function getVersionDiff(
  data: AppData,
  projectId: ID,
  chapterOrder: number,
  fromVersionId: string,
  toVersionId: string,
  options: AgentReadOptions = {}
): AgentVersionDiffResult {
  const chapter = requireReadableChapter(data, projectId, chapterOrder)
  const chain = buildChapterVersionChain(data, chapter.id)
  const fromVersion = chain.find((entry) => entry.id === fromVersionId) ?? null
  const toVersion = chain.find((entry) => entry.id === toVersionId) ?? null
  if (!fromVersion) throw new Error(`Version not found: ${fromVersionId}`)
  if (!toVersion) throw new Error(`Version not found: ${toVersionId}`)
  const prefix = commonPrefixLength(fromVersion.body, toVersion.body)
  const suffix = commonSuffixLength(fromVersion.body, toVersion.body, prefix)
  const limit = readLimit(options, 700)
  const fromChanged = fromVersion.body.slice(prefix, Math.max(prefix, fromVersion.body.length - suffix))
  const toChanged = toVersion.body.slice(prefix, Math.max(prefix, toVersion.body.length - suffix))
  return {
    projectId,
    chapterOrder,
    fromVersionId,
    toVersionId,
    fromTitle: fromVersion.title,
    toTitle: toVersion.title,
    fromCharCount: fromVersion.body.length,
    toCharCount: toVersion.body.length,
    deltaChars: toVersion.body.length - fromVersion.body.length,
    commonPrefixChars: prefix,
    commonSuffixChars: suffix,
    changedFromExcerpt: compact(fromChanged, limit),
    changedToExcerpt: compact(toChanged, limit)
  }
}
