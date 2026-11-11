import type { HardCanonAuditFinding } from './types/hardCanonCheck'

/** Both readers show the same sentence without storing another copy of the prose. */
export function hardCanonEvidenceContext(item: HardCanonAuditFinding, body?: string) {
  if (!body || body.slice(item.start, item.end) !== item.excerpt) return null
  const left = body.slice(Math.max(0, item.start - 100), item.start)
  const right = body.slice(item.end, item.end + 100)
  const before = /[^。！？!?；;\r\n]*$/u.exec(left)?.[0] ?? ''
  const after = /^[^。！？!?；;\r\n]*[。！？!?；;]?/u.exec(right)?.[0] ?? ''
  return { before: (before.length === 100 && item.start > 100 ? '…' : '') + before,
    after: after + (after.length === 100 && body.length > item.end + 100 ? '…' : '') }
}
