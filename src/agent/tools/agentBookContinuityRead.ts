import { BOOK_CONTINUITY_COLLECTIONS, createBookContinuityReader } from '../../services/BookContinuityService'
import type { BookAuditKind, BookAuditOptions, BookAuditStatus } from '../../services/bookContinuity/types'
import { createBookCollectionSelection } from '../../shared/bookCollectionSelection'
import { loadAgentBookProjection } from './agentBookProjection'
import type { AgentToolCallResult } from './agentToolTypes'

const kinds = ['money', 'headcount', 'inventory', 'promise', 'whereabouts', 'season', 'countdown'] as const satisfies readonly BookAuditKind[]
const statuses = ['conflict', 'needs_evidence', 'open'] as const satisfies readonly BookAuditStatus[]
const maxPageSize = 50
export const bookContinuityProperties = {
  projectId: { type: 'string' }, project: { type: 'string' },
  from: { type: 'integer', minimum: 1, description: 'First chapter with a finding. Earlier comparison evidence is retained.' },
  to: { type: 'integer', minimum: 1, description: 'Last chapter visible to the audit, inclusive.' },
  kind: { type: 'string', enum: kinds }, status: { type: 'string', enum: statuses },
  offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: maxPageSize, default: 10 }
}

function parseOptions(args: Record<string, unknown>): BookAuditOptions {
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(bookContinuityProperties, key) && key !== 'storagePath' && key !== 'userDataPath') {
      throw new Error(`Unsupported book continuity argument: ${key}.`)
    }
    if (['projectId', 'project', 'storagePath', 'userDataPath'].includes(key) && args[key] !== undefined &&
      (typeof args[key] !== 'string' || !args[key].trim())) throw new Error(`Invalid ${key}.`)
  }
  const integer = (key: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    const value = args[key]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}.`)
    return value
  }
  const choice = <T extends string>(key: string, choices: readonly T[]) => {
    if (args[key] === undefined) return undefined
    const chosen = choices.find(value => value === args[key])
    if (!chosen) throw new Error(`Invalid ${key}.`)
    return chosen
  }
  const from = integer('from', 1), to = integer('to', 1)
  if (from !== undefined && to !== undefined && from > to) throw new Error('from must not exceed to.')
  return { from, to, kind: choice('kind', kinds), status: choice('status', statuses),
    offset: integer('offset', 0), limit: integer('limit', 1, maxPageSize) ?? 10 }
}

type BookSnapshot = Awaited<ReturnType<typeof loadAgentBookProjection>>

function partialQuote(text: string): string {
  const clause = text.replace(/[。！？.!?；;…”’」』]+$/u, '').trimEnd()
  if (clause.length < text.length) return clause
  // Do not split a number, unit or negation to shorten a one-line chapter.
  const parts = text.split(/[，,；;\n]/u).map(s => s.trim()).filter(Boolean)
  return parts.length > 1 ? parts.reduce((a, b) => a.length >= b.length ? a : b) : ''
}

function openReader({ data: snapshot, projectId, storage }: BookSnapshot, to?: number) {
  const data = storage.source === 'sqlite' ? snapshot : createBookCollectionSelection(projectId, BOOK_CONTINUITY_COLLECTIONS)(snapshot)
  const reader = createBookContinuityReader(data, projectId, { to })
  const shortBodies = new Map<string, string>()
  for (const chapter of data.chapters) {
    if (chapter.projectId !== projectId || chapter.archivedAt || (to !== undefined && chapter.order > to)) continue
    // A verbatim clue can be an entire one-line legacy chapter. Do not return the whole chapter over MCP.
    const body = chapter.body.trim()
    if (body && body.length <= 320) shortBodies.set(chapter.id, body)
  }
  return { projectId, storage, to, read(options: BookAuditOptions) {
    const report = reader.read(options)
    return { ...report, findings: report.findings.map(f => ({ ...f, evidence: f.evidence.map(e => {
      if (!e.excerpt || e.excerpt !== shortBodies.get(e.chapterId)) return e
      return { ...e, excerpt: partialQuote(e.excerpt) }
    }) })) }
  } }
}

// One immutable snapshot per server. A cheap project/revision read invalidates it before any page is served.
let lastReader: ReturnType<typeof openReader> | undefined

export async function readAgentBookContinuity(args: Record<string, unknown>): Promise<AgentToolCallResult> {
  const options = parseOptions(args)
  const previous = lastReader
  const header = previous && previous.to === options.to ? await loadAgentBookProjection(args, ['projects']) : undefined
  const tool = 'agent.getBookContinuityReport'
  if (previous && header && previous.projectId === header.projectId &&
    previous.storage.source === header.storage.source && previous.storage.storagePath === header.storage.storagePath &&
    header.storage.revision !== '0' && previous.storage.revision === header.storage.revision) {
    return { tool, ok: true, storage: header.storage, data: previous.read(options) }
  }
  const book = header && header.storage.source !== 'sqlite' ? header : await loadAgentBookProjection(args, BOOK_CONTINUITY_COLLECTIONS)
  const reader = openReader(book, options.to)
  lastReader = reader
  return { tool, ok: true, storage: book.storage, data: reader.read(options) }
}
