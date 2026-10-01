import type {
  AppData,
  ConsistencyReviewIssue,
  EditorialCoverageStatus,
  EditorialVerdict,
  EditorialVerdictCoverage,
  EditorialVerdictAction,
  EditorialVerdictIssue,
  GeneratedChapterDraft,
  GenerationRunTrace,
  NoveltyAuditResult,
  NoveltyFinding
} from '../shared/types'
import { isEditorialIssueActive } from '../shared/editorialIssuePolicy'
import {
  QUALITY_GATE_HUMAN_REVIEW_SCORE,
  qualityGateEffectivelyPassed,
  shouldQualityGateRequireHumanReview
} from '../shared/qualityGatePolicy'
import {
  draftContentHash,
  latestConsistencyReportsForDraft,
  latestQualityReportForDraft,
  latestRedundancyReportForDraft,
  noveltyAuditMatchesDraft
} from './DraftDiagnosticBindingService'

const VERDICT_SCHEMA_VERSION = 1
const STATE_ISSUE_TYPES = new Set([
  'resource_underflow',
  'missing_inventory',
  'injury_reset',
  'knowledge_leak',
  'ability_overuse',
  'location_jump',
  'promise_ignored',
  'state_conflict',
  'character_state'
])

export interface EditorialStateIssueInput {
  id?: string
  draftId?: string | null
  draftContentHash?: string | null
  draftRevision?: string | null
  type: string
  severity: 'low' | 'medium' | 'high'
  description: string
  evidence?: string
  suggestedFix?: string
}

export interface BuildEditorialVerdictInput {
  appData: AppData
  draftId: string
  stateIssues?: EditorialStateIssueInput[]
  createdAt?: string
  coverageExpectation?: EditorialCoverageExpectation
}

export interface EditorialCoverageExpectation {
  recipeId?: 'fast' | 'standard' | 'strict' | 'custom'
  /** Actual execution expectation, including an escalated fast review. */
  consistency?: boolean
}

export interface EditorialVerdictWithCoverage extends EditorialVerdict {
  coverage: EditorialVerdictCoverage
}

function coverageStatus(requested: boolean, current: boolean, historical: boolean): EditorialCoverageStatus {
  if (current) return 'current'
  if (!requested) return 'not_requested'
  return historical ? 'stale' : 'unavailable'
}

function traceMatchesReports(trace: GenerationRunTrace, qualityId?: string, consistencyId?: string): boolean {
  return Boolean(
    (qualityId && trace.qualityGateReportId === qualityId) ||
    (consistencyId && trace.consistencyReviewReportId === consistencyId)
  )
}

function compact(value: unknown, maxLength = 220): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => compact(value)).filter(Boolean))).slice(0, 3)
}

function uniqueIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))).slice(0, 50)
}

function newestFirst<T extends { id: string; createdAt?: string; updatedAt?: string }>(left: T, right: T): number {
  const leftTime = left.updatedAt || left.createdAt || ''
  const rightTime = right.updatedAt || right.createdAt || ''
  return rightTime.localeCompare(leftTime) || right.id.localeCompare(left.id)
}

function findingKey(finding: NoveltyFinding): string {
  return [finding.kind, compact(finding.text), compact(finding.evidenceExcerpt)].join('|')
}

function noveltyFindings(audit: NoveltyAuditResult): NoveltyFinding[] {
  const findings = [
    ...audit.newNamedCharacters,
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules,
    ...audit.untracedNames
  ]
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = findingKey(finding)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function issueId(source: EditorialVerdictIssue['source'], sourceId: string | null | undefined, code: string, index = 0): string {
  return `editorial-${source}-${sourceId || 'unbound'}-${code}-${index}`
}

function addIssue(target: EditorialVerdictIssue[], issue: EditorialVerdictIssue): void {
  const duplicate = target.find((item) => item.source === issue.source && item.code === issue.code && item.title === issue.title)
  if (duplicate) {
    duplicate.evidence = unique([...duplicate.evidence, ...issue.evidence])
    return
  }
  target.push({ ...issue, evidence: unique(issue.evidence) })
}

function matchingNoveltySource(
  traces: GenerationRunTrace[],
  draft: GeneratedChapterDraft
): { audit: NoveltyAuditResult | null; trace: GenerationRunTrace | null } {
  const trace = [...traces]
    .filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId)
    .filter((item) => noveltyAuditMatchesDraft(item.noveltyAuditResult, draft))
    .sort(newestFirst)[0] ?? null
  return { audit: trace?.noveltyAuditResult ?? null, trace }
}

function selectTrace(
  traces: GenerationRunTrace[],
  draft: GeneratedChapterDraft,
  qualityReportId?: string,
  consistencyReportId?: string,
  noveltyTrace?: GenerationRunTrace | null
): GenerationRunTrace | null {
  const diagnosticTrace = [...traces]
    .filter((trace) => trace.projectId === draft.projectId && trace.jobId === draft.jobId)
    .filter((trace) =>
      trace.generatedDraftId === draft.id &&
      traceMatchesReports(trace, qualityReportId, consistencyReportId)
    )
    .sort(newestFirst)[0] ?? null
  return diagnosticTrace ?? noveltyTrace ?? null
}

function pushAction(actions: EditorialVerdictAction[], action: EditorialVerdictAction): void {
  if (actions.some((item) => item.actionType === action.actionType)) return
  actions.push(action)
}

function buildActions(
  status: EditorialVerdict['status'],
  blockers: EditorialVerdictIssue[],
  advisories: EditorialVerdictIssue[],
  incomplete: boolean
): EditorialVerdictAction[] {
  const actions: EditorialVerdictAction[] = []
  const issues = [...blockers, ...advisories]
  if (incomplete) {
    pushAction(actions, { actionType: 'rerun_diagnostics', label: '补齐当前正文诊断', reason: '所需报告缺失、正文绑定已失效或问题状态变化后需要重新计算门禁。', priority: 1 })
  }
  if (blockers.length) {
    pushAction(actions, { actionType: 'revise_draft', label: '修订阻断问题', reason: `当前正文有 ${blockers.length} 个阻断项，修复后再重新审稿。`, priority: 1 })
  }
  if (issues.some((issue) => issue.source === 'character_state')) {
    pushAction(actions, { actionType: 'update_character_state', label: '核对角色状态', reason: '正文存在角色硬状态风险，需要修正文或补齐已确认账本事实。', priority: blockers.length ? 2 : 1 })
  }
  if (issues.some((issue) => issue.source === 'novelty_audit')) {
    pushAction(actions, { actionType: 'review_novelty', label: '复核新增设定', reason: '确认新角色、新规则或新机制是否确有许可和铺垫。', priority: blockers.length ? 2 : 1 })
  }
  if (status === 'advisory' || status === 'approved') {
    pushAction(actions, { actionType: 'accept_draft', label: status === 'approved' ? '接受草稿' : '阅读建议后接受', reason: status === 'approved' ? '当前绑定诊断没有发现阻断项。' : '只有建议项，最终取舍由作者决定。', priority: status === 'approved' ? 1 : 3 })
  }
  if (advisories.some((issue) => issue.source === 'redundancy_report')) {
    pushAction(actions, { actionType: 'revise_draft', label: '精简重复表达', reason: '冗余不会单独阻断采纳，但局部压缩可改善节奏。', priority: 3 })
  }
  return actions.sort((left, right) => left.priority - right.priority).slice(0, 3)
}

function verdictSummary(status: EditorialVerdict['status'], blockers: number, advisories: number): string {
  if (status === 'blocked') return `当前正文有 ${blockers} 个阻断项和 ${advisories} 个建议项，建议修订后重新审稿。`
  if (status === 'incomplete') return '当前正文的诊断链不完整或已过期，暂不形成可采纳结论。'
  if (status === 'advisory') return `当前正文没有阻断项，但有 ${advisories} 个建议项供作者取舍。`
  return '当前正文已完成所需诊断，绑定报告未发现阻断项。'
}

export function buildEditorialVerdict(input: BuildEditorialVerdictInput): EditorialVerdictWithCoverage {
  const draft = input.appData.generatedChapterDrafts.find((item) => item.id === input.draftId)
  if (!draft) throw new Error(`找不到待裁定正文：${input.draftId}`)
  const contentHash = draftContentHash(draft.body)
  const scopedQuality = input.appData.qualityGateReports.filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId)
  const scopedConsistency = input.appData.consistencyReviewReports.filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId)
  const scopedRedundancy = input.appData.redundancyReports.filter(
    (item) => item.projectId === draft.projectId && (!item.jobId || item.jobId === draft.jobId)
  )
  const quality = latestQualityReportForDraft(scopedQuality, draft)
  const matchingConsistency = latestConsistencyReportsForDraft(scopedConsistency, draft)
  const consistency = matchingConsistency[0] ?? null
  // Only a strictly newer, hash-bound review supersedes a previous review.
  // Equal timestamps cannot prove resolution merely through an ID tie-break.
  const currentConsistencyIssues = new Map<string, { issue: ConsistencyReviewIssue; reportId: string }>()
  for (const report of matchingConsistency.filter((item) => item.createdAt === consistency?.createdAt)) {
    for (const issue of report.issues) {
      if (!currentConsistencyIssues.has(issue.id) || !isEditorialIssueActive(issue)) {
        currentConsistencyIssues.set(issue.id, { issue, reportId: report.id })
      }
    }
  }
  const inactiveConsistencyIds = new Set(
    matchingConsistency.flatMap((report) => report.issues)
      .filter((issue) => {
        const current = currentConsistencyIssues.get(issue.id)
        return !current || !isEditorialIssueActive(current.issue)
      }).map((issue) => issue.id)
  )
  const qualityIssues = quality?.issues.filter(
    (issue) => !issue.linkedConsistencyIssueId || !inactiveConsistencyIds.has(issue.linkedConsistencyIssueId)
  ) ?? []
  // A failed aggregate cannot be recomputed after its linked findings close.
  // Request a fresh gate instead of resurrecting those findings or approving it.
  const outdatedQualityFailure = Boolean(
    quality && !qualityGateEffectivelyPassed(quality) && qualityIssues.length !== quality.issues.length
  )
  const consistencyRequested = input.coverageExpectation?.consistency ?? (input.coverageExpectation?.recipeId !== 'fast')
  const coverage: EditorialVerdictWithCoverage['coverage'] = {
    quality: outdatedQualityFailure ? 'stale' : coverageStatus(true, Boolean(quality), scopedQuality.some((item) => item.draftId === draft.id)),
    consistency: coverageStatus(consistencyRequested, Boolean(consistency), scopedConsistency.some((item) => item.draftId === draft.id))
  }
  const redundancy = latestRedundancyReportForDraft(scopedRedundancy, draft)
  const noveltySource = matchingNoveltySource(input.appData.generationRunTraces, draft)
  const trace = selectTrace(input.appData.generationRunTraces, draft, quality?.id, consistency?.id, noveltySource.trace)
  const blockers: EditorialVerdictIssue[] = []
  const advisories: EditorialVerdictIssue[] = []

  if (coverage.quality !== 'current') {
    addIssue(advisories, {
      id: issueId('diagnostic_binding', draft.id, `quality_${coverage.quality}`), level: 'advisory', source: 'diagnostic_binding', code: `quality_${coverage.quality}`,
      title: coverage.quality === 'stale' ? '质量门禁报告已过期' : '当前正文缺少质量门禁报告',
      evidence: [outdatedQualityFailure ? '旧门禁失败结论引用了已关闭或已被新审稿取代的一致性问题，需要重新计算。' : '没有找到 draftId 与 contentHash 同时匹配的质量门禁报告。'],
      recommendation: '重新执行质量门禁后再形成最终编辑结论。', sourceId: null
    })
  }
  if (quality) {
    const qualityPassed = qualityGateEffectivelyPassed(quality)
    if (!qualityPassed && !outdatedQualityFailure) {
      addIssue(blockers, {
        id: issueId('quality_gate', quality.id, 'gate_failed'), level: 'blocker', source: 'quality_gate', code: 'gate_failed',
        title: `质量门禁未通过（${quality.overallScore} 分）`, evidence: [`总分 ${quality.overallScore}`, ...quality.requiredFixes],
        recommendation: quality.requiredFixes[0] || '处理质量门禁中的必修项。', sourceId: quality.id
      })
    } else if (qualityPassed && shouldQualityGateRequireHumanReview(quality)) {
      addIssue(advisories, {
        id: issueId('quality_gate', quality.id, 'human_review'), level: 'advisory', source: 'quality_gate', code: 'human_review',
        title: `质量门禁建议人工确认（${quality.overallScore} 分）`,
        evidence: [quality.overallScore < QUALITY_GATE_HUMAN_REVIEW_SCORE
          ? `总分低于人工确认线 ${QUALITY_GATE_HUMAN_REVIEW_SCORE}`
          : '存在需要作者判断的关键维度风险。'],
        recommendation: '阅读当前正文和关键维度后，再决定是否采纳。', sourceId: quality.id
      })
    }
    qualityIssues.forEach((item, index) => {
      if (item.linkedConsistencyIssueId && currentConsistencyIssues.has(item.linkedConsistencyIssueId)) return
      const stateIssue = STATE_ISSUE_TYPES.has(item.type)
      const level = (stateIssue || item.linkedConsistencyIssueId || outdatedQualityFailure) && item.severity === 'high' ? 'blocker' : 'advisory'
      addIssue(level === 'blocker' ? blockers : advisories, {
        id: issueId(stateIssue ? 'character_state' : 'quality_gate', quality.id, item.type, index),
        level,
        source: stateIssue ? 'character_state' : 'quality_gate',
        code: item.type,
        title: item.description || item.type,
        evidence: [item.evidence],
        recommendation: item.suggestedFix,
        sourceId: quality.id
      })
    })
  }

  if (coverage.consistency === 'unavailable' || coverage.consistency === 'stale') {
    addIssue(advisories, {
      id: issueId('diagnostic_binding', draft.id, `consistency_${coverage.consistency}`), level: 'advisory', source: 'diagnostic_binding', code: `consistency_${coverage.consistency}`,
      title: coverage.consistency === 'stale' ? '一致性审稿报告已过期' : '当前正文缺少一致性审稿报告', evidence: ['没有找到 draftId 与 contentHash 同时匹配的一致性报告。'],
      recommendation: '重新执行一致性审稿，避免旧正文问题被误当成当前结论。', sourceId: null
    })
  }
  if (consistency) {
    Array.from(currentConsistencyIssues.values()).filter(({ issue }) => isEditorialIssueActive(issue)).forEach(({ issue: item, reportId }, index) => {
      const level = item.severity === 'high' ? 'blocker' : 'advisory'
      const stateIssue = item.type.startsWith('character_')
      addIssue(level === 'blocker' ? blockers : advisories, {
        id: issueId(stateIssue ? 'character_state' : 'consistency_review', reportId, item.type, index),
        level,
        source: stateIssue ? 'character_state' : 'consistency_review',
        code: item.type,
        title: item.title || item.description,
        evidence: [item.evidence, item.description],
        recommendation: item.suggestedFix || item.revisionInstruction,
        sourceId: reportId
      })
    })
  }

  if (noveltySource.audit) {
    noveltyFindings(noveltySource.audit).forEach((finding, index) => {
      if (finding.severity === 'info' && finding.allowedByTask) return
      const isBlocker = finding.severity === 'fail' && !finding.allowedByTask && finding.confidence !== 'low'
      addIssue(isBlocker ? blockers : advisories, {
        id: issueId('novelty_audit', noveltySource.trace?.id, finding.kind, index),
        level: isBlocker ? 'blocker' : 'advisory',
        source: 'novelty_audit',
        code: finding.kind,
        title: finding.text || '新增内容风险',
        evidence: [finding.evidenceExcerpt, finding.reason],
        recommendation: finding.suggestedAction || '确认该新增内容是否有任务书许可或前文铺垫。',
        sourceId: noveltySource.trace?.id ?? null
      })
    })
    const hasNoveltyBlocker = blockers.some((item) => item.source === 'novelty_audit')
    const hasNoveltyAdvisory = advisories.some((item) => item.source === 'novelty_audit')
    if (noveltySource.audit.severity === 'fail' && !hasNoveltyBlocker && !hasNoveltyAdvisory) {
      addIssue(blockers, {
        id: issueId('novelty_audit', noveltySource.trace?.id, 'audit_failed'), level: 'blocker', source: 'novelty_audit', code: 'audit_failed',
        title: '新增内容审计未通过', evidence: [noveltySource.audit.summary],
        recommendation: '查看新增内容审计明细，确认未授权规则、机制或设定。', sourceId: noveltySource.trace?.id ?? null
      })
    }
  }

  if (redundancy && redundancy.overallRedundancyScore >= 45) {
    addIssue(advisories, {
      id: issueId('redundancy_report', redundancy.id, 'redundancy'), level: 'advisory', source: 'redundancy_report', code: 'redundancy',
      title: `重复与冗余风险（${redundancy.overallRedundancyScore}）`,
      evidence: redundancy.compressionSuggestions,
      recommendation: redundancy.compressionSuggestions[0] || '局部精简重复解释和相似描写。', sourceId: redundancy.id
    })
  }

  const matchingStateIssues = (input.stateIssues ?? []).filter(
    (item) => item.draftId === draft.id && item.draftContentHash === contentHash && (!item.draftRevision || item.draftRevision === draft.updatedAt)
  )
  matchingStateIssues.forEach((item, index) => {
    const level = item.severity === 'high' ? 'blocker' : 'advisory'
    addIssue(level === 'blocker' ? blockers : advisories, {
      id: issueId('character_state', item.id, item.type, index), level, source: 'character_state', code: item.type,
      title: item.description || item.type, evidence: [item.evidence || ''], recommendation: item.suggestedFix || '核对正文与角色状态账本。',
      sourceId: item.id ?? null
    })
  })

  const traceStateIssueIds = trace?.characterStateIssueIds.filter((id) => !inactiveConsistencyIds.has(id)) ?? []
  if (trace && traceMatchesReports(trace, quality?.id, consistency?.id)) {
    if (traceStateIssueIds.length) {
      addIssue(blockers, {
        id: issueId('character_state', trace.id, 'trace_state_issues'), level: 'blocker', source: 'character_state', code: 'trace_state_issues',
        title: '角色硬状态检查未通过', evidence: traceStateIssueIds.map((id) => `状态问题 ${id}`),
        recommendation: '查看关联状态问题，修正文中的资源、物品、伤势、知识、位置或能力矛盾。', sourceId: trace.id
      })
    }
    trace.characterStateWarnings.forEach((warning, index) => addIssue(advisories, {
      id: issueId('character_state', trace.id, 'trace_warning', index), level: 'advisory', source: 'character_state', code: 'trace_warning',
      title: '角色状态需要复核', evidence: [warning], recommendation: '核对当前正文与已确认角色状态事实。', sourceId: trace.id
    }))
  }

  const staleIds = uniqueIds([
    ...scopedQuality.filter((item) => item.draftId === draft.id && item.draftContentHash !== contentHash).map((item) => item.id),
    ...scopedConsistency.filter((item) => item.draftId === draft.id && item.draftContentHash !== contentHash).map((item) => item.id),
    ...scopedRedundancy.filter((item) => item.draftId === draft.id && item.draftContentHash !== contentHash).map((item) => item.id),
    ...input.appData.generationRunTraces
      .filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId)
      .filter((item) => item.noveltyAuditResult?.sourceDraftId === draft.id && !noveltyAuditMatchesDraft(item.noveltyAuditResult, draft))
      .map((item) => item.id),
    ...(input.stateIssues ?? []).filter((item) => item.id && !matchingStateIssues.includes(item)).map((item) => item.id as string)
  ])
  const incomplete = Object.values(coverage).some((state) => state === 'unavailable' || state === 'stale')
  const status: EditorialVerdict['status'] = blockers.length ? 'blocked' : incomplete ? 'incomplete' : advisories.length ? 'advisory' : 'approved'
  const timestamp = input.createdAt ?? new Date().toISOString()
  const verdict: EditorialVerdictWithCoverage = {
    id: `editorial-verdict-${draft.id}-${contentHash}`,
    projectId: draft.projectId,
    chapterId: draft.chapterId,
    jobId: draft.jobId,
    draftId: draft.id,
    draftContentHash: contentHash,
    draftRevision: draft.updatedAt,
    status,
    coverage,
    canAccept: status === 'approved' || status === 'advisory',
    summary: verdictSummary(status, blockers.length, advisories.length),
    blockers,
    advisories,
    actions: buildActions(status, blockers, advisories, incomplete),
    sourceRefs: {
      qualityGateReportId: quality?.id ?? null,
      consistencyReviewReportId: consistency?.id ?? null,
      redundancyReportId: redundancy?.id ?? null,
      noveltyAuditTraceId: noveltySource.trace?.id ?? null,
      generationRunTraceId: trace?.id ?? noveltySource.trace?.id ?? null,
      characterStateIssueIds: uniqueIds([
        ...matchingStateIssues.map((item) => item.id || ''),
        ...(trace && traceMatchesReports(trace, quality?.id, consistency?.id)
          ? traceStateIssueIds
          : [])
      ]),
      ignoredStaleReportIds: staleIds
    },
    schemaVersion: VERDICT_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  validateEditorialVerdict(verdict)
  return verdict
}

export function validateEditorialVerdict(verdict: EditorialVerdict): void {
  const errors: string[] = []
  if (!verdict.id) errors.push('id is required')
  if (!verdict.projectId) errors.push('projectId is required')
  if (!verdict.jobId) errors.push('jobId is required')
  if (!verdict.draftId) errors.push('draftId is required')
  if (!verdict.draftContentHash) errors.push('draftContentHash is required')
  if (!verdict.draftRevision) errors.push('draftRevision is required')
  if (verdict.actions.length > 3) errors.push('actions must contain at most 3 items')
  if (verdict.blockers.some((item) => item.level !== 'blocker')) errors.push('blockers contains a non-blocker issue')
  if (verdict.advisories.some((item) => item.level !== 'advisory')) errors.push('advisories contains a non-advisory issue')
  if (verdict.canAccept === (verdict.status === 'blocked' || verdict.status === 'incomplete')) errors.push('canAccept conflicts with status')
  if (JSON.stringify(verdict).length > 24_000) errors.push('verdict is too large; do not copy the draft or full prompt')
  if (errors.length) throw new Error(`EditorialVerdict 校验失败：${errors.join('；')}`)
}

export function upsertEditorialVerdictToAppData(appData: AppData, verdict: EditorialVerdict): AppData {
  validateEditorialVerdict(verdict)
  const existing = appData.editorialVerdicts ?? []
  const index = existing.findIndex(
    (item) => item.id === verdict.id || (item.draftId === verdict.draftId && item.draftContentHash === verdict.draftContentHash)
  )
  const next = index < 0
    ? [verdict, ...existing]
    : existing.map((item, itemIndex) => itemIndex === index ? { ...verdict, createdAt: item.createdAt || verdict.createdAt } : item)
  return { ...appData, editorialVerdicts: next }
}

export function getEditorialVerdictForDraft(appData: AppData, draftId: string): EditorialVerdict | null {
  const draft = appData.generatedChapterDrafts.find((item) => item.id === draftId)
  if (!draft) return null
  const contentHash = draftContentHash(draft.body)
  return [...(appData.editorialVerdicts ?? [])]
    .filter((item) => item.projectId === draft.projectId && item.jobId === draft.jobId &&
      item.draftId === draft.id && item.draftContentHash === contentHash && item.draftRevision === draft.updatedAt)
    .sort(newestFirst)[0] ?? null
}
