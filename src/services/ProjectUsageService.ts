import type { AiTokenUsage } from '../shared/types/base'
import { usageCountFields as fields } from '../shared/tokenUsage'
import { usagePhases, type ProjectUsageReport, type UsageAttempt, type UsagePhase, type UsageTotals } from '../shared/projectUsage'
import { resolveReportedUsage } from './AcceptedChapterCostService'
import { findProjectRate, priceUsageAttempt } from './ProjectUsagePricing'
import type { UsageHistory } from './projectUsageHistory'

function empty(): UsageTotals {
  return { requests:0, failedRequests:0, unknownUsageRequests:0, partialUsageRequests:0, subscriptionRequests:0, unpricedRequests:0,
    tokens:{ promptTokens:null, completionTokens:null, totalTokens:null, reasoningTokens:null, cachedPromptTokens:null }, costs:[] }
}
function mergeCounts(left: AiTokenUsage | undefined, right: AiTokenUsage | undefined) {
  const value: AiTokenUsage = {}
  let conflict = false
  for (const k of fields) {
    if (left?.[k] !== undefined && right?.[k] !== undefined && left[k] !== right[k]) conflict = true
    const n = left?.[k] ?? right?.[k]
    if (n !== undefined) value[k] = n
  }
  return { value, conflict }
}

export function buildProjectUsageReport(history: UsageHistory, receipts: readonly UsageAttempt[], invalidRecords = 0): ProjectUsageReport {
  const totals = empty()
  const phases = Object.fromEntries(usagePhases.map(p => [p, empty()])) as Record<UsagePhase, UsageTotals>
  const buckets = (phase: UsagePhase) => [totals, phases[phase]]
  const jobsWithUsage = new Set<string>(), coveredCalls = new Map<string, number>()
  const callsWithUsage = new Set<string>()
  const records = new Map<string, UsageAttempt>(), bad = new Set<string>()
  const warnings: string[] = []
  const incompleteJournals = new Set<string>()
  let first: string | null = null, last: string | null = null
  for (const row of receipts) {
    if (row.projectId !== history.projectId) continue
    const old = records.get(row.id)
    if (!old) { records.set(row.id, row); continue }
    const count = mergeCounts(old.usage, row.usage)
    if (count.conflict || old.callId !== row.callId || old.runId !== row.runId || old.phase !== row.phase || old.provider !== row.provider ||
      old.endpoint !== row.endpoint || old.model !== row.model || old.outcome !== row.outcome ||
      (old.providerRequestId && row.providerRequestId && old.providerRequestId !== row.providerRequestId)) bad.add(row.id)
    else records.set(row.id, { ...old, usage:count.value, providerRequestId:old.providerRequestId ?? row.providerRequestId })
  }
  function countUsage(phase: UsagePhase, raw: AiTokenUsage | undefined, physical: boolean, row?: UsageAttempt) {
    const resolved = resolveReportedUsage(raw)
    if (resolved.invalid) invalidRecords++
    const r = row && row.provider !== 'codex_cli' ? findProjectRate(history.rates, row.provider, row.endpoint, row.model) : undefined
    const amount = !resolved.invalid && r ? priceUsageAttempt(resolved.usage, r) : null
    for (const b of buckets(phase)) {
      if (physical && !resolved.hasAny) b.unknownUsageRequests++
      else if (physical && (resolved.status !== 'complete' || resolved.invalid)) b.partialUsageRequests++
      for (const key of fields) {
        const n = resolved.usage[key]
        if (n !== undefined) b.tokens[key] = (b.tokens[key] ?? 0) + n
      }
      if (amount != null && r) {
        let c = b.costs.find(c => c.currency === r.currency)
        if (!c) b.costs.push(c = { currency:r.currency, amount:0, pricedRequests:0 })
        c.amount += amount; c.pricedRequests++
      } else if (physical && row?.provider !== 'codex_cli') b.unpricedRequests++
    }
    return resolved.hasAny
  }
  // A duplicated provider receipt within one logical call can describe two dispatches but only one reported charge.
  const providerReceipts = new Map<string, { row:UsageAttempt; value:AiTokenUsage | undefined; conflict:boolean; count:number }>()
  for (const row of records.values()) {
    if (first === null || row.startedAt < first) first = row.startedAt
    if (last === null || row.startedAt > last) last = row.startedAt
    for (const b of buckets(row.phase)) {
      b.requests++
      if (row.outcome !== 'success') b.failedRequests++
      if (row.provider === 'codex_cli') b.subscriptionRequests++
    }
    coveredCalls.set(row.callId, (coveredCalls.get(row.callId) ?? 0) + 1)
    const key = row.providerRequestId && !bad.has(row.id) ?
      JSON.stringify([row.callId,row.provider,row.endpoint,row.model,row.providerRequestId]) : JSON.stringify([row.id])
    const entry = providerReceipts.get(key)
    if (!entry) providerReceipts.set(key, { row, value:row.usage, conflict:bad.has(row.id), count:1 })
    else {
      const merge = mergeCounts(entry.value, row.usage)
      entry.conflict ||= merge.conflict || entry.row.phase !== row.phase
      entry.value = merge.value; entry.count++
    }
  }
  let reissued = 0
  for (const {row, value, conflict, count} of providerReceipts.values()) {
    if (conflict) invalidRecords++
    reissued += count - 1
    if (countUsage(row.phase, conflict ? undefined : value, true, row)) {
      callsWithUsage.add(row.callId)
      if (row.runId) jobsWithUsage.add(row.runId)
    }
  }
  const old = new Map<string, { jobId:string; phase:UsagePhase; provider:string; model:string; usage:AiTokenUsage|undefined; attempts:number; conflict:boolean }>()
  for (const { jobId, phase, telemetry:t } of history.calls) {
    if (!t.callId) { invalidRecords++; continue }
    if (t.usageJournalIncomplete) incompleteJournals.add(t.callId)
    const item = old.get(t.callId)
    const attempts = Number.isSafeInteger(t.attempts) && t.attempts > 0 ? t.attempts : 1
    if (!item) old.set(t.callId, { jobId, phase, provider:t.provider, model:t.model, usage:t.usage, attempts, conflict:false })
    else {
      const merged = mergeCounts(item.usage, t.usage)
      item.conflict ||= item.jobId !== jobId || item.provider !== t.provider || item.model !== t.model || merged.conflict
      item.usage = merged.value; item.attempts = Math.max(attempts, item.attempts)
    }
  }
  let legacyCalls = 0, unreportedRequests = 0
  for (const [id, item] of old) {
    const n = coveredCalls.get(id) ?? 0
    if (n) {
      if (!item.conflict && callsWithUsage.has(id)) jobsWithUsage.add(item.jobId)
      unreportedRequests += Math.max(0, item.attempts - n)
      continue
    }
    legacyCalls++
    unreportedRequests += Math.max(0, item.attempts - 1)
    if (item.conflict) invalidRecords++
    if (countUsage(item.phase, item.conflict ? undefined : item.usage, false)) jobsWithUsage.add(item.jobId)
  }
  const legacyJobsWithoutUsage = history.finishedJobs.filter(id => !jobsWithUsage.has(id)).length
  for (const b of [totals,...Object.values(phases)]) {
    for (const c of b.costs) c.amount = Number(c.amount.toFixed(12))
    b.costs.sort((a,b) => a.currency.localeCompare(b.currency))
  }
  if (!first) warnings.push('本书还没有逐次请求记录；这不表示过去没有使用过模型。')
  if (legacyCalls) warnings.push(`另有 ${legacyCalls} 次旧版调用记录。可核实的 token 已合计；旧记录没有逐次服务地址，不折算费用。`)
  if (legacyJobsWithoutUsage) warnings.push(`${legacyJobsWithoutUsage} 个已结束任务缺少可核实用量，不能按零费用处理。`)
  if (unreportedRequests) warnings.push('部分旧重试缺少逐次收据，不能确定它们的额外用量。')
  if (incompleteJournals.size) warnings.push(`${incompleteJournals.size} 次调用曾报告用量记录未完整保存；本页可能低于实际用量。`)
  if (reissued) warnings.push(`${reissued} 次重复返回了同一服务商请求编号；同一份用量只累计一次。`)
  if (invalidRecords) warnings.push('部分记录不完整或互相冲突；无法核实的数字未计入。')
  return { projectId:history.projectId, totals, byPhase:usagePhases.map(phase => ({phase,...phases[phase]})),
    coverage:{ firstRecordedAt:first,lastRecordedAt:last,legacyCalls,legacyJobsWithoutUsage,invalidRecords,unreportedRequests },
    warnings, balance:null }
}
