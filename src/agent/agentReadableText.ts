import type { AppData, ChapterGenerationJob, ID } from '../shared/types'

export type AgentReadDetail = 'summary' | 'compact' | 'full'

export interface AgentReadOptions {
  detail?: AgentReadDetail
  includeProse?: boolean
  includePrompt?: boolean
  includeDiagnostics?: boolean
  maxChars?: number
}

export interface AgentTextReadResult {
  id: ID
  kind: 'chapter' | 'draft' | 'version' | 'prompt' | 'trace' | 'candidate'
  title: string
  charCount: number
  excerpt: string
  text?: string
  metadata: Record<string, unknown>
}

export interface VersionText {
  id: string
  title: string
  body: string
  source: string
  createdAt: string
}

export function compact(value: string | null | undefined, maxLength = 220): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
}

export function readLimit(options: AgentReadOptions, fallback = 1200): number {
  const value = options.maxChars
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value)
  return fallback
}

function shouldIncludeFullText(options: AgentReadOptions, kind: 'prose' | 'prompt' | 'diagnostics' = 'prose'): boolean {
  if (options.detail === 'full') return true
  if (kind === 'prompt') return options.includePrompt === true
  if (kind === 'diagnostics') return options.includeDiagnostics === true
  return options.includeProse === true
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_API_KEY]')
    .replace(/api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,}/gi, 'apiKey=[REDACTED]')
}

export function textPayload(
  id: ID,
  kind: AgentTextReadResult['kind'],
  title: string,
  text: string,
  options: AgentReadOptions,
  metadata: Record<string, unknown> = {},
  textKind: 'prose' | 'prompt' | 'diagnostics' = 'prose'
): AgentTextReadResult {
  const safeText = redactSensitiveText(text)
  const excerptLimit = readLimit(options, textKind === 'prompt' ? 1600 : 1200)
  const explicitTextLimit =
    typeof options.maxChars === 'number' && Number.isFinite(options.maxChars) && options.maxChars > 0
      ? Math.floor(options.maxChars)
      : null
  const include = shouldIncludeFullText(options, textKind)
  return {
    id,
    kind,
    title,
    charCount: safeText.length,
    excerpt: compact(safeText, excerptLimit),
    text: include ? (explicitTextLimit ? safeText.slice(0, explicitTextLimit) : safeText) : undefined,
    metadata
  }
}

export function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function extractPromptFromParsed(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const directKeys = ['finalPrompt', 'prompt', 'context', 'writingPrompt']
  for (const key of directKeys) {
    if (typeof record[key] === 'string' && record[key]) return String(record[key])
  }
  for (const key of Object.keys(record)) {
    const nested = extractPromptFromParsed(record[key])
    if (nested) return nested
  }
  return ''
}

export function resolvePromptSnapshotText(
  data: AppData,
  job: ChapterGenerationJob,
  candidatePrompt: string
): { text: string; snapshotId: ID | null } {
  const candidate = candidatePrompt.trim()
  const legacySnapshotId =
    !job.promptContextSnapshotId &&
    candidate.length > 0 &&
    candidate.length <= 256 &&
    data.promptContextSnapshots.some((item) => item.id === candidate)
      ? candidate
      : null
  const snapshotId = job.promptContextSnapshotId ?? legacySnapshotId
  const snapshot = snapshotId ? data.promptContextSnapshots.find((item) => item.id === snapshotId) ?? null : null
  if (!snapshot) return { text: candidatePrompt, snapshotId: job.promptContextSnapshotId ?? null }
  return { text: snapshot.finalPrompt || candidatePrompt, snapshotId: snapshot.id }
}

export function findVersionText(data: AppData, chapterId: ID, versionId: string): VersionText | null {
  const chapter = data.chapters.find((item) => item.id === chapterId) ?? null
  if (chapter && versionId === `current:${chapter.id}`) {
    return {
      id: versionId,
      title: chapter.title,
      body: chapter.body,
      source: 'current',
      createdAt: chapter.updatedAt || chapter.createdAt
    }
  }
  const version = data.chapterVersions.find((item) => item.id === versionId && item.chapterId === chapterId) ?? null
  if (!version) return null
  return {
    id: version.id,
    title: version.title,
    body: version.body,
    source: version.source,
    createdAt: version.createdAt
  }
}

export function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let index = 0
  while (index < limit && a[index] === b[index]) index += 1
  return index
}

export function commonSuffixLength(a: string, b: string, prefixLength: number): number {
  const limit = Math.min(a.length, b.length) - prefixLength
  let offset = 0
  while (offset < limit && a[a.length - 1 - offset] === b[b.length - 1 - offset]) offset += 1
  return offset
}
