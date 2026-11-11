import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { usagePhases, type UsageAttempt } from '../shared/projectUsage'
import { redactSensitiveText } from '../shared/errorUtils'
import { readTokenUsage } from '../shared/tokenUsage'
import { withJsonWriteLock } from './jsonWriteLock'

const identifier = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max &&
  !/[\s\u0000-\u001f\u007f/?#\\=&@]/u.test(v) && redactSensitiveText(v) === v

export function projectUsagePath(storagePath: string, projectId: string): string {
  if (!storagePath || typeof projectId !== 'string' || !projectId.trim()) throw new Error('用量账本缺少书库或项目。')
  // Hash the project ID: imported IDs need not be valid or safe file names on Windows.
  return join(dirname(storagePath), basename(storagePath) + '.usage', createHash('sha256').update(projectId).digest('hex') + '.jsonl')
}

function plainAttempt(value: unknown): UsageAttempt | undefined {
  if (!value || typeof value !== 'object') return
  const r = value as UsageAttempt
  if (!identifier(r.id) || !identifier(r.callId) || typeof r.projectId !== 'string' || !r.projectId.trim() ||
    r.projectId.length > 256 || /[\u0000-\u001f]/u.test(r.projectId) || redactSensitiveText(r.projectId) !== r.projectId ||
    !usagePhases.includes(r.phase) || !['openai','compatible','local','codex_cli'].includes(r.provider) ||
    !['success','failed','cancelled'].includes(r.outcome) || typeof r.startedAt !== 'string' || !Number.isFinite(Date.parse(r.startedAt))) return
  let endpoint = ''
  if (r.provider !== 'codex_cli') {
    try {
      const url = new URL(r.endpoint)
      if (!/^https?:$/.test(url.protocol) || redactSensitiveText(url.origin) !== url.origin) return
      endpoint = url.origin
    } catch { return }
  }
  const model = typeof r.model === 'string' && /^[\p{L}\p{N}._:/ -]{1,160}$/u.test(r.model) &&
    !r.model.includes('://') && redactSensitiveText(r.model) === r.model ? r.model.trim() || 'unknown' : 'unknown'
  return { id:r.id, callId:r.callId, projectId:r.projectId, phase:r.phase, provider:r.provider, model, endpoint,
    startedAt:new Date(r.startedAt).toISOString(), outcome:r.outcome, usage:readTokenUsage(r.usage),
    ...(identifier(r.runId) ? {runId:r.runId} : {}),
    ...(identifier(r.providerRequestId) ? {providerRequestId:r.providerRequestId} : {}) }
}

// Operational receipts live beside the book, not in the versioned manuscript: a model response
// must never invalidate the save revision of the chapter that is waiting for it.
export async function appendProjectUsageAttempts(storagePath: string, attempts: readonly UsageAttempt[]): Promise<void> {
  const batches = new Map<string, UsageAttempt[]>()
  for (const attempt of attempts) {
    const safe = plainAttempt(attempt)
    if (!safe) throw new Error('未保存用量：请求标识或提供商信息无效。')
    const rows = batches.get(safe.projectId)
    if (rows) rows.push(safe)
    else batches.set(safe.projectId, [safe])
  }
  for (const [projectId, rows] of batches) {
    const file = projectUsagePath(storagePath, projectId)
    await withJsonWriteLock(file, async () => {
      const handle = await open(file, 'a', 0o600)
      try {
        // A leading newline isolates new receipts even after an interrupted previous append.
        await handle.writeFile('\n' + rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8')
        await handle.sync()
      } finally { await handle.close() }
    })
  }
}

export async function readProjectUsageAttempts(storagePath: string, projectId: string) {
  const file = projectUsagePath(storagePath, projectId)
  const rows: UsageAttempt[] = []
  let invalidRecords = 0
  let handle
  try { handle = await open(file, 'r') } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { rows, invalidRecords }
    throw e
  }
  const stream = createReadStream(file, { fd: handle.fd, autoClose: false, encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      try {
        const row = line.length < 8192 && plainAttempt(JSON.parse(line))
        if (row && row.projectId === projectId) rows.push(row)
        else invalidRecords++
      } catch { invalidRecords++ }
    }
  } finally { lines.close(); await handle.close() }
  return { rows, invalidRecords }
}
