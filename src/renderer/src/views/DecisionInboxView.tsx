import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CandidateDecisionCommand,
  CandidateDecisionKind,
  CandidateDecisionPreview,
  CandidateDecisionPreviewItem,
  CandidateDecisionSelection,
  CandidateDecisionAmendment,
  CandidateDecisionUndoPreview
} from '../../../shared/types/candidateDecision'
import { previewCandidateDecisions } from '../../../services/CandidateDecisionService'
import { previewCandidateDecisionUndo } from '../../../services/CandidateDecisionUndoService'
import {
  DecisionInboxService,
  type DecisionInboxCandidateRef,
  type DecisionInboxEventGroup,
  type DecisionInboxRiskLevel
} from '../../../services/DecisionInboxService'
import { useConfirm } from '../components/ConfirmDialog'
import { Header } from '../components/Layout'
import { StatusBadge, type BadgeTone } from '../components/UI'
import type { ProjectProps } from './viewTypes'
import { DecisionInboxAmendmentEditor } from './inbox/DecisionInboxAmendmentEditor'
import { DecisionInboxHistory } from './inbox/DecisionInboxHistory'
import {
  INBOX_FILTERS, canSubmitDecisionUndo, inboxCandidateKey, matchesInboxFilter, selectedInboxCandidates,
  type InboxFilter
} from './inbox/decisionInboxUiModel'
import '../styles/views/inbox.css'

type CandidateDecision = CandidateDecisionSelection['decision']
type DisplayInboxGroup = DecisionInboxEventGroup & { previewErrors: string[] }

interface DecisionInboxViewProps extends ProjectProps {
  executeCandidateDecision?: (command: CandidateDecisionCommand) => Promise<void>
}

const RISK_LABELS: Record<DecisionInboxRiskLevel, string> = {
  high: '高风险',
  medium: '需确认',
  low: '低风险'
}

const RISK_TONES: Record<DecisionInboxRiskLevel, BadgeTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success'
}

const RISK_RANK: Record<DecisionInboxRiskLevel, number> = { low: 1, medium: 2, high: 3 }

const IMPACT_LABELS = {
  chapter_memory: '章节记忆',
  character_state: '角色状态',
  foreshadowing: '伏笔',
  stage_summary: '阶段摘要',
  timeline: '时间线',
  unknown: '其他记录'
} as const

function compactText(value: string, limit = 220): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function candidateLabel(candidate: DecisionInboxCandidateRef): string {
  if (candidate.kind === 'character_state_change') return '角色状态变化'
  const labels: Record<string, string> = {
    chapter_review: '章节复盘',
    character: '角色记忆',
    foreshadowing: '伏笔更新',
    timeline_event: '时间线事件',
    stage_summary: '阶段摘要'
  }
  return labels[candidate.candidateType] ?? '记忆更新'
}

function selectionFor(
  candidate: DecisionInboxCandidateRef,
  decision: CandidateDecision,
  amendment?: CandidateDecisionAmendment
): CandidateDecisionSelection {
  return { kind: decisionKindFor(candidate), candidateId: candidate.id, decision, ...(amendment ? { amendment } : {}) }
}

function decisionKindFor(candidate: DecisionInboxCandidateRef): CandidateDecisionKind {
  return candidate.kind === 'memory_update' ? 'memory' : 'character_state'
}

function previewKeyFor(candidate: DecisionInboxCandidateRef): string {
  return inboxCandidateKey(candidate)
}

function highestRisk(risks: ReadonlyArray<DecisionInboxRiskLevel>): DecisionInboxRiskLevel {
  return risks.reduce<DecisionInboxRiskLevel>(
    (highest, risk) => RISK_RANK[risk] > RISK_RANK[highest] ? risk : highest,
    'low'
  )
}

function confirmationCopy(preview: CandidateDecisionPreview, decision: CandidateDecision): string {
  const action = decision === 'accept' ? '写入长期记录' : '拒绝'
  const changes = preview.items
    .map((item) => `${item.title}：${compactText(item.summary, 90)}`)
    .join('；')
  const warnings = [...new Set(preview.items.flatMap((item) => item.warnings).filter(Boolean))]
  return `以下 ${preview.items.length} 项将一并${action}：${changes}${warnings.length ? `。请特别留意：${warnings.join('；')}` : ''}`
}

export function DecisionInboxView(props: DecisionInboxViewProps) {
  return <DecisionInboxProjectView key={props.project.id} {...props} />
}

function DecisionInboxProjectView({ data, project, executeCandidateDecision }: DecisionInboxViewProps) {
  const confirmAction = useConfirm()
  const [view, setView] = useState<'pending' | 'history'>('pending')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(() => new Set())
  const [feedback, setFeedback] = useState('')
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [editingCandidateKey, setEditingCandidateKey] = useState<string | null>(null)
  const decisionInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const latestDataRef = useRef(data)
  latestDataRef.current = data
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  const receipts = useMemo(() => (data.candidateDecisionReceipts ?? [])
    .filter((receipt) => receipt.projectId === project.id)
    .slice().sort((left, right) => right.decidedAt.localeCompare(left.decidedAt) || right.id.localeCompare(left.id)),
  [data.candidateDecisionReceipts, project.id])
  const groups = useMemo(() => DecisionInboxService.list({
    projectId: project.id,
    memoryCandidates: data.memoryUpdateCandidates,
    characterStateChangeCandidates: data.characterStateChangeCandidates,
    jobs: data.chapterGenerationJobs
  }), [data.characterStateChangeCandidates, data.chapterGenerationJobs, data.memoryUpdateCandidates, project.id])
  useEffect(() => {
    const pendingKeys = new Set(groups.flatMap((group) => group.candidates.map(previewKeyFor)))
    setSelectedCandidateKeys((current) => {
      const next = new Set([...current].filter((key) => pendingKeys.has(key)))
      return next.size === current.size ? current : next
    })
  }, [groups])
  const { previewByCandidateId, previewErrorByCandidateId } = useMemo(() => {
    const previews = new Map<string, CandidateDecisionPreviewItem>()
    const errors = new Map<string, string>()
    for (const group of groups) {
      for (const candidate of group.candidates) {
        const key = previewKeyFor(candidate)
        try {
          const preview = previewCandidateDecisions(data, {
            projectId: project.id,
            decisions: [selectionFor(candidate, 'accept')]
          })
          const item = preview.items[0]
          if (item) previews.set(key, item)
          else errors.set(key, '候选预览未返回内容。')
        } catch (error) {
          errors.set(key, error instanceof Error && error.message ? error.message : '候选内容无法解析。')
        }
      }
    }
    return { previewByCandidateId: previews, previewErrorByCandidateId: errors }
  }, [data, groups, project.id])
  const displayGroups = useMemo<DisplayInboxGroup[]>(() => groups.map((group) => {
    const previewErrors = group.candidates
      .map((candidate) => previewErrorByCandidateId.get(previewKeyFor(candidate)))
      .filter((error): error is string => Boolean(error))
    const previewRisks = group.candidates.map((candidate) =>
      previewByCandidateId.get(previewKeyFor(candidate))?.risk ?? 'medium'
    )
    return {
      ...group,
      riskLevel: highestRisk([group.riskLevel, ...previewRisks]),
      previewErrors
    }
  }), [groups, previewByCandidateId, previewErrorByCandidateId])
  const filterCounts = useMemo(() => Object.fromEntries(INBOX_FILTERS.map(([value]) =>
    [value, displayGroups.filter((group) => matchesInboxFilter(group, value)).length]
  )) as Record<InboxFilter, number>, [displayGroups])
  const visibleGroups = useMemo(() => displayGroups.filter((group) => matchesInboxFilter(group, filter)), [displayGroups, filter])
  const isBusy = busyLabel !== null

  async function decide(selections: CandidateDecisionSelection[], decision: CandidateDecision, scope: string) {
    if (!mountedRef.current || decisionInFlightRef.current) return
    if (!executeCandidateDecision) {
      setFeedback('候选确认暂不可用，请稍后重试。')
      return
    }

    decisionInFlightRef.current = true
    setBusyLabel('正在核对候选')
    setFeedback('正在核对候选…')
    try {
      let preview: CandidateDecisionPreview
      try {
        preview = previewCandidateDecisions(latestDataRef.current, { projectId: project.id, decisions: selections })
      } catch (error) {
        setFeedback(error instanceof Error ? `无法生成候选预览：${error.message}` : '无法生成候选预览。')
        return
      }
      if (!preview.items.length) {
        setFeedback('这些候选已不再待确认，请刷新后再试。')
        return
      }

      let confirmed = false
      if (preview.requiresConfirmation) {
        confirmed = await confirmAction({
          title: decision === 'accept' ? '确认处理高风险候选' : '确认拒绝高风险候选',
          message: confirmationCopy(preview, decision),
          confirmLabel: decision === 'accept' ? '确认处理' : '确认拒绝',
          cancelLabel: '先返回核对',
          tone: 'danger'
        })
        if (!mountedRef.current) return
        if (!confirmed) {
          setFeedback('已取消本次候选处理。')
          return
        }
      }

      const action = decision === 'accept' ? '接受并写入' : '拒绝'
      setBusyLabel(`${action}${scope}`)
      setFeedback(`正在${action}${scope}…`)
      const command: CandidateDecisionCommand = {
        id: crypto.randomUUID(),
        projectId: project.id,
        actor: { kind: 'user' },
        reason: `决策收件箱：${action}${scope}`,
        decidedAt: new Date().toISOString(),
        schemaVersion: 1,
        decisions: preview.items.map(({ kind, candidateId, decision: itemDecision, expectedFingerprint, amendment }) => ({
          kind,
          candidateId,
          decision: itemDecision,
          expectedFingerprint,
          ...(amendment ? { amendment } : {})
        })),
        ...(confirmed ? { confirmedHighRisk: true } : {})
      }
      await executeCandidateDecision(command)
      if (!mountedRef.current) return
      setSelectedCandidateKeys((current) => {
        const next = new Set(current)
        for (const item of preview.items) next.delete(`${item.kind}:${item.candidateId}`)
        return next
      })
      setFeedback(`已${action}${scope}，共处理 ${preview.items.length} 条候选。`)
    } catch (error) {
      if (!mountedRef.current) return
      const action = decision === 'accept' ? '接受并写入' : '拒绝'
      const detail = error instanceof Error && error.message ? `：${error.message}` : ''
      setFeedback(`${action}${scope}失败${detail}`)
    } finally {
      decisionInFlightRef.current = false
      if (mountedRef.current) setBusyLabel(null)
    }
  }

  function decideGroup(group: DecisionInboxEventGroup, decision: CandidateDecision) {
    const selected = selectedInboxCandidates(group, selectedCandidateKeys)
    const targets = selected.length ? selected : group.candidates
    return decide(targets.map((candidate) => selectionFor(candidate, decision)), decision,
      selected.length ? `本事件所选 ${selected.length} 项` : '本事件')
  }

  function selectCandidates(candidates: DecisionInboxCandidateRef[], selected: boolean) {
    setSelectedCandidateKeys((current) => {
      const next = new Set(current)
      for (const candidate of candidates) {
        if (selected) next.add(previewKeyFor(candidate))
        else next.delete(previewKeyFor(candidate))
      }
      return next
    })
  }

  async function undoDecision(shownPreview: CandidateDecisionUndoPreview, restoreChangedFields: boolean) {
    if (!mountedRef.current || decisionInFlightRef.current || shownPreview.projectId !== project.id) return
    if (!executeCandidateDecision) {
      setFeedback('候选确认暂不可用，请稍后重试。')
      return
    }
    decisionInFlightRef.current = true
    setBusyLabel('正在核对撤销预览')
    try {
      const preview = previewCandidateDecisionUndo(latestDataRef.current, { projectId: project.id, receiptId: shownPreview.receiptId })
      if (preview.expectedFingerprint !== shownPreview.expectedFingerprint || preview.status !== shownPreview.status) {
        setFeedback('相关记录已变化，请重新核对撤销预览。')
        return
      }
      if (!canSubmitDecisionUndo(preview, restoreChangedFields)) {
        setFeedback('当前无法撤销，请先核对预览中的提示。')
        return
      }
      const current = previewCandidateDecisionUndo(latestDataRef.current, { projectId: project.id, receiptId: preview.receiptId })
      if (current.expectedFingerprint !== preview.expectedFingerprint || current.status !== preview.status) {
        setFeedback('确认期间记录已变化，请重新核对撤销预览。')
        return
      }
      setBusyLabel('正在撤销这次处理')
      await executeCandidateDecision({
        id: crypto.randomUUID(), projectId: project.id, actor: { kind: 'user' },
        reason: '决策收件箱：按预览撤销这次候选处理', decidedAt: new Date().toISOString(), schemaVersion: 1,
        decisions: [], undo: {
          receiptId: preview.receiptId, expectedFingerprint: preview.expectedFingerprint,
          ...(preview.status === 'conflict' && restoreChangedFields ? { restoreChangedFields: true } : {})
        },
        ...(preview.requiresConfirmation ? { confirmedHighRisk: true } : {})
      })
      if (mountedRef.current) setFeedback('已按预览撤销这次处理，原处理记录和历史已保留。')
    } catch (error) {
      if (mountedRef.current) setFeedback(`撤销失败：${error instanceof Error ? error.message : '请稍后重试。'}`)
    } finally {
      decisionInFlightRef.current = false
      if (mountedRef.current) setBusyLabel(null)
    }
  }

  function decideCandidate(candidate: DecisionInboxCandidateRef, decision: CandidateDecision, amendment?: CandidateDecisionAmendment) {
    const suffix = amendment ? '（编辑后）' : ''
    return decide([selectionFor(candidate, decision, amendment)], decision, `「${candidateLabel(candidate)}」${suffix}`)
  }

  function candidateActions(candidate: DecisionInboxCandidateRef, canAccept: boolean, previewError: string | undefined) {
    return (
      <div className="inbox-candidate-actions">
        <button className="ghost-button" type="button" disabled={isBusy} onClick={() => void decideCandidate(candidate, 'reject')}>拒绝</button>
        <button className="primary-button" type="button" disabled={isBusy || !canAccept} title={previewError} onClick={() => void decideCandidate(candidate, 'accept')}>接受</button>
        <button className="text-button inbox-amendment-trigger" type="button" disabled={isBusy || !canAccept} title={previewError}
          onClick={() => setEditingCandidateKey(previewKeyFor(candidate))}>编辑后接受</button>
      </div>
    )
  }

  return (
    <div className="decision-inbox-view" aria-busy={isBusy}>
      <Header
        title="决策收件箱"
        description="集中确认章节生成后可能进入长期记忆和角色状态账本的变化。候选不会自动成为正式设定。"
        actions={<span className="inbox-pending-count">{displayGroups.length} 个待确认事件</span>}
      />

      <div className="inbox-view-switch" role="group" aria-label="收件箱视图">
        <button className={view === 'pending' ? 'active' : ''} type="button" aria-pressed={view === 'pending'} onClick={() => setView('pending')}>待确认 {displayGroups.length}</button>
        <button className={view === 'history' ? 'active' : ''} type="button" aria-pressed={view === 'history'} onClick={() => setView('history')}>处理记录 {receipts.length}</button>
      </div>

      {view === 'pending' ? <div className="inbox-toolbar" role="group" aria-label="筛选待确认变化">
        {INBOX_FILTERS.map(([value, label]) => (
          <button key={value} className={filter === value ? 'active' : ''} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {label}<span>{filterCounts[value]}</span>
          </button>
        ))}
      </div> : null}

      {feedback ? <p className="inbox-feedback" role="status">{feedback}</p> : null}

      {view === 'history' ? <DecisionInboxHistory data={data} projectId={project.id} receipts={receipts}
        disabled={isBusy || !executeCandidateDecision} onUndo={(preview, restore) => void undoDecision(preview, restore)} /> : visibleGroups.length ? (
        <div className="inbox-event-list">
          {visibleGroups.map((group) => {
            const selected = selectedInboxCandidates(group, selectedCandidateKeys)
            const targetErrors = selected.length ? selected.map((candidate) => previewErrorByCandidateId.get(previewKeyFor(candidate))).filter(Boolean) : group.previewErrors
            const groupAcceptError = targetErrors.length
              ? `${selected.length ? '所选候选' : '本事件'}含 ${targetErrors.length} 条无法预览的候选：${compactText(targetErrors[0]!, 120)} 请逐条处理后再接受。`
              : undefined
            const groupAcceptErrorId = `inbox-group-preview-warning-${group.id}`
            return (
              <article className={`inbox-event risk-${group.riskLevel}`} data-decision-event-id={group.id} key={group.id}>
              <header className="inbox-event-heading">
                <div>
                  <p>{group.chapterOrder === null ? '章节待确认' : `第 ${group.chapterOrder} 章`}</p>
                  <h2>{group.title.replace(/^第\s*\d+\s*章\s*·\s*/, '')}</h2>
                </div>
                <div className="inbox-event-badges">
                  <StatusBadge tone={RISK_TONES[group.riskLevel]}>{RISK_LABELS[group.riskLevel]}</StatusBadge>
                  <StatusBadge tone="neutral">事实确定性 {Math.round(group.factCertaintyScore * 100)}%</StatusBadge>
                </div>
              </header>

              {group.evidence[0]
                ? <blockquote>{compactText(group.evidence[0])}</blockquote>
                : <p className="inbox-no-evidence">暂无可核对正文证据，请谨慎处理。</p>}

              <div className="inbox-event-meta">
                <span>影响：{group.impactAreas.map((area) => IMPACT_LABELS[area]).join('、')}</span>
                <span>{group.candidateIds.length} 条底层候选</span>
              </div>

              <div className="inbox-event-actions" aria-label={`${group.title} 的${selected.length ? '所选候选' : '整组'}操作`}>
                {selected.length ? <span className="inbox-selection-count">已选 {selected.length} / {group.candidates.length} 项</span> : null}
                <button className="ghost-button" type="button" disabled={isBusy} onClick={() => void decideGroup(group, 'reject')}>{selected.length ? `拒绝所选 ${selected.length} 项` : '拒绝本事件'}</button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isBusy || Boolean(groupAcceptError)}
                  title={groupAcceptError}
                  aria-describedby={groupAcceptError ? groupAcceptErrorId : undefined}
                  onClick={() => void decideGroup(group, 'accept')}
                >
                  {selected.length ? `接受所选 ${selected.length} 项并写入` : '接受本事件并写入'}
                </button>
              </div>
              {groupAcceptError ? <p id={groupAcceptErrorId} className="inbox-group-preview-warning">{groupAcceptError}</p> : null}

              <details>
                <summary>逐条确认{selected.length ? `（已选 ${selected.length} 项）` : ''}</summary>
                <label className="inbox-selection-toggle"><input type="checkbox" disabled={isBusy}
                  checked={selected.length === group.candidates.length}
                  ref={(element) => { if (element) element.indeterminate = selected.length > 0 && selected.length < group.candidates.length }}
                  onChange={(event) => selectCandidates(group.candidates, event.target.checked)} />全选本事件</label>
                <div className="inbox-candidate-list">
                  {group.candidates.map((candidate) => {
                    const previewKey = previewKeyFor(candidate)
                    const preview = previewByCandidateId.get(previewKey)
                    const previewError = previewErrorByCandidateId.get(previewKey)
                    const displayRisk = highestRisk([candidate.riskLevel, preview?.risk ?? 'medium'])
                    return (
                      <section className="inbox-candidate" data-candidate-id={candidate.id} key={`${candidate.kind}:${candidate.id}`}>
                        <div className="inbox-candidate-copy">
                          <label className="inbox-selection-toggle"><input type="checkbox" disabled={isBusy}
                            checked={selectedCandidateKeys.has(previewKey)}
                            aria-label={`选择${candidateLabel(candidate)}：${preview?.title ?? compactText(candidate.evidence, 60)}`}
                            onChange={(event) => selectCandidates([candidate], event.target.checked)} />
                            <strong>{candidateLabel(candidate)}</strong></label>
                          <span className="inbox-proposed-change">{preview?.summary ?? `无法生成拟议变更：${previewError ?? '候选内容无法解析。'}`}</span>
                          {candidate.evidence ? <span>证据：{compactText(candidate.evidence, 160)}</span> : <span>暂无证据文本</span>}
                          <small>置信度 {Math.round(candidate.confidence * 100)}% · {RISK_LABELS[displayRisk]}</small>
                          {preview?.warnings.length ? <small className="inbox-candidate-warning">{preview.warnings.join(' ')}</small> : null}
                          {previewError ? <small className="inbox-candidate-warning">此候选仍可单独拒绝。</small> : null}
                        </div>
                        {candidateActions(candidate, Boolean(preview), previewError)}
                        {editingCandidateKey === previewKey ? (
                          <DecisionInboxAmendmentEditor
                            key={previewKey}
                            candidate={candidate}
                            data={data}
                            projectId={project.id}
                            disabled={isBusy}
                            onCancel={() => setEditingCandidateKey(null)}
                            onAccept={(amendment) => {
                              setEditingCandidateKey(null)
                              void decideCandidate(candidate, 'accept', amendment)
                            }}
                          />
                        ) : null}
                      </section>
                    )
                  })}
                </div>
              </details>

              {group.riskReasons.length ? <p className="inbox-event-reason">{group.riskReasons.join(' ')}</p> : null}
              </article>
            )
          })}
        </div>
      ) : (
        <section className="inbox-empty">
          <strong>{displayGroups.length ? '当前筛选下没有待确认变化' : '长期设定已处理完毕'}</strong>
          <p>{displayGroups.length ? '切换上方筛选查看其他候选。' : '新章节复盘产生的记忆与角色状态变化会在这里等待确认。'}</p>
        </section>
      )}
    </div>
  )
}
