import { useEffect, useMemo, useState } from 'react'
import type { AgentActionPreview, AgentDecision, AgentRun, AppData, ChapterCommitBundle, RevisionCommitBundle } from '../../../shared/types'
import { latestQualityReportForDraft } from '../../../services/DraftDiagnosticBindingService'
import { Header } from '../components/Layout'
import { SectionCard, StatCard, StatusBadge, type BadgeTone } from '../components/UI'
import { useProjectData } from '../hooks/useProjectData'
import { getNovelDirectorClipboardApi } from '../platform/novelDirectorBridge'
import { formatDate } from '../utils/format'
import { AgentProjectAuthorizationPanel } from './agent/AgentProjectAuthorizationPanel'
import type { ProjectProps } from './viewTypes'

type AgentReloadResult = { ok: boolean; errorMessage?: string }

interface AgentRunsViewProps extends ProjectProps {
  onReload: () => Promise<AgentReloadResult>
}

function statusTone(status: string): BadgeTone {
  if (status === 'completed' || status === 'applied') return 'success'
  if (status === 'running' || status === 'approved') return 'accent'
  if (status === 'paused' || status === 'pending') return 'warning'
  if (status === 'failed' || status === 'cancelled' || status === 'dismissed') return 'danger'
  return 'neutral'
}

function riskTone(risk: string): BadgeTone {
  if (risk === 'high') return 'danger'
  if (risk === 'medium') return 'warning'
  if (risk === 'low') return 'success'
  return 'neutral'
}

function rangeLabel(values: number[]): string {
  if (!values.length) return '-'
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return `第 ${sorted[0]} 章`
  return `第 ${sorted[0]}-${sorted[sorted.length - 1]} 章`
}

function latestDecision(run: AgentRun): AgentDecision | null {
  return [...run.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

export function isAgentCommit(commit: ChapterCommitBundle | RevisionCommitBundle): boolean {
  if ('acceptedBy' in commit) {
    if (commit.actor?.kind === 'agent') return true
    return commit.acceptedBy === 'agent'
  }
  if (commit.actor?.kind === 'agent') return true
  if (commit.revisedBy) return commit.revisedBy === 'agent'
  const legacy = commit as unknown as Record<string, unknown>
  const raw = JSON.stringify({
    id: legacy.commitId ?? legacy.revisionCommitId,
    note: legacy.commitNote ?? legacy.revisionNote,
    reason: legacy.revisionReason
  }).toLowerCase()
  return raw.includes('agent') || raw.includes('codex')
}

function commitLabel(commit: ChapterCommitBundle | RevisionCommitBundle): string {
  if ('commitId' in commit) return `草稿采纳 ${commit.commitId}`
  return `修订提交 ${commit.revisionCommitId}`
}

function findRunJobChapters(data: AppData, run: AgentRun): Array<{ jobId: string; chapterOrder: number; status: string; draftCount: number; qualityScore: number | null }> {
  return run.createdJobIds.map((jobId) => {
    const job = data.chapterGenerationJobs.find((item) => item.id === jobId)
    const drafts = data.generatedChapterDrafts.filter((draft) => draft.jobId === jobId)
    const latestDraft = [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    const quality = latestDraft
      ? latestQualityReportForDraft(data.qualityGateReports.filter((report) => report.jobId === jobId), latestDraft)
      : null
    return {
      jobId,
      chapterOrder: job?.targetChapterOrder ?? 0,
      status: job?.status ?? 'missing',
      draftCount: drafts.length,
      qualityScore: quality?.overallScore ?? null
    }
  }).filter((item) => item.chapterOrder > 0 || item.jobId).sort((a, b) => a.chapterOrder - b.chapterOrder || a.jobId.localeCompare(b.jobId))
}

export function AgentRunsView({ data, project, onReload }: AgentRunsViewProps) {
  const scoped = useProjectData(data, project.id)
  const runs = useMemo(() => [...scoped.agentRuns].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [scoped.agentRuns])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runs[0]?.id ?? null)
  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null, [runs, selectedRunId])

  useEffect(() => {
    if (!selectedRunId && runs[0]) setSelectedRunId(runs[0].id)
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null)
    }
  }, [runs, selectedRunId])
  const previews = useMemo(
    () => (selectedRun ? scoped.agentActionPreviews.filter((preview) => preview.agentRunId === selectedRun.id) : []),
    [scoped.agentActionPreviews, selectedRun]
  )
  const pendingPreviews = useMemo(() => previews.filter((preview) => preview.status === 'pending'), [previews])
  const decisions = useMemo(
    () => (selectedRun ? [...selectedRun.decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []),
    [selectedRun]
  )
  const jobChapters = useMemo(() => (selectedRun ? findRunJobChapters(data, selectedRun) : []), [data, selectedRun])
  // Older Agent commits used acceptedBy=user. Their run links remain usable
  // provenance without guessing from an author's free-text commit note.
  const runCommitIds = useMemo(() => new Set(runs.flatMap((run) => run.createdCommitIds)), [runs])
  const agentChapterCommits = useMemo(() => scoped.chapterCommitBundles.filter((commit) =>
    isAgentCommit(commit) || runCommitIds.has(commit.commitId)), [scoped.chapterCommitBundles, runCommitIds])
  const agentRevisionCommits = useMemo(() => scoped.revisionCommitBundles.filter((commit) =>
    isAgentCommit(commit) || runCommitIds.has(commit.revisionCommitId)), [scoped.revisionCommitBundles, runCommitIds])
  const relatedCommits = useMemo(
    () =>
      selectedRun
        ? [...agentChapterCommits, ...agentRevisionCommits].filter((commit) => selectedRun.createdCommitIds.includes('commitId' in commit ? commit.commitId : commit.revisionCommitId))
        : [],
    [agentChapterCommits, agentRevisionCommits, selectedRun]
  )
  const runningCount = useMemo(() => runs.filter((run) => run.status === 'running').length, [runs])
  const pendingReviewCount = useMemo(() => runs.reduce((sum, run) => sum + run.pendingHumanReviewItemIds.length, 0), [runs])
  const completedCount = useMemo(() => runs.filter((run) => run.status === 'completed').length, [runs])
  const [setupMessage, setSetupMessage] = useState('')
  const [isReloading, setIsReloading] = useState(false)
  const [reloadError, setReloadError] = useState('')

  async function reloadLatestData() {
    setIsReloading(true)
    setReloadError('')
    try {
      const result = await onReload()
      if (!result.ok) setReloadError(result.errorMessage ?? '重新加载失败，请稍后重试。')
    } catch (error) {
      setReloadError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsReloading(false)
    }
  }

  function copyCodexSetupCommand() {
    void getNovelDirectorClipboardApi()
      .writeText('npm.cmd run agent:setup:codex')
      .then(() => setSetupMessage('接入命令已复制。请在项目根目录运行，随后重新打开 Codex 任务。'))
      .catch((error) => setSetupMessage(`复制失败：${error instanceof Error ? error.message : String(error)}`))
  }

  return (
    <div className="agent-runs-view">
      <Header
        title="Agent Runs"
        description="查看 Codex / Agent 批次、章节进度、决策、待审项和正式提交记录。"
        actions={<button className="ghost-button" type="button" disabled={isReloading} onClick={() => void reloadLatestData()}>{isReloading ? '正在读取...' : '读取最新结果'}</button>}
      />
      {reloadError ? <p className="notice danger">读取最新结果失败：{reloadError}</p> : null}

      <AgentProjectAuthorizationPanel
        projectId={project.id}
        chapterOrders={scoped.allChapters.map((chapter) => chapter.order)}
        dataIdentity={data}
      />

      <section className="agent-connect-strip">
        <div>
          <strong>让 Codex 直接连接工作台数据</strong>
          <p>注册 MCP 后，Codex 可直接读取项目、版本链和诊断，不必再用 Computer Use 点击界面。</p>
        </div>
        <button className="primary-button" type="button" onClick={copyCodexSetupCommand}>复制一键接入命令</button>
      </section>
      {setupMessage ? <p className="notice">{setupMessage}</p> : null}

      <section className="metric-grid agent-run-metrics">
        <StatCard label="批次数" value={runs.length} detail={`${runningCount} 个运行中 / ${completedCount} 个已完成`} tone="accent" />
        <StatCard label="待人工审查" value={pendingReviewCount} detail="未获授权的高风险预览、候选记忆或状态变更仍需作者确认" tone={pendingReviewCount ? 'warning' : 'success'} />
        <StatCard label="Agent 草稿提交" value={agentChapterCommits.length} detail="通过 ChapterCommitBundle 写入版本链" tone="info" />
        <StatCard label="Agent 修订提交" value={agentRevisionCommits.length} detail="通过 RevisionCommitBundle 写入版本链" tone="neutral" />
      </section>

      {runs.length === 0 ? (
        <section className="empty-state">
          <h2>暂无 Agent 批次</h2>
          <p>通过 `npm.cmd run agent` 或 `npm.cmd run agent:tools` 创建批次后，这里会显示 Codex 的目标、进度和提交记录。</p>
        </section>
      ) : (
        <section className="agent-runs-layout">
          <aside className="agent-runs-list">
            {runs.map((run) => {
              const decision = latestDecision(run)
              return (
                <button
                  key={run.id}
                  type="button"
                  className={`agent-run-list-item ${selectedRun?.id === run.id ? 'active' : ''}`}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div>
                    <strong>{rangeLabel(run.targetChapterOrders)}</strong>
                    <p>{run.goal || '未填写批次目标'}</p>
                  </div>
                  <div className="agent-run-list-meta">
                    <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                    {decision ? <StatusBadge tone={riskTone(decision.riskLevel)}>{decision.action}</StatusBadge> : null}
                  </div>
                </button>
              )
            })}
          </aside>

          {selectedRun ? (
            <div className="agent-run-detail">
              <SectionCard
                title={`${rangeLabel(selectedRun.targetChapterOrders)} · ${selectedRun.mode}`}
                description={selectedRun.summary || selectedRun.goal || '这个批次尚未生成摘要。'}
                actions={<StatusBadge tone={statusTone(selectedRun.status)}>{selectedRun.status}</StatusBadge>}
              >
                <div className="agent-run-overview-grid">
                  <div>
                    <span>安全模式</span>
                    <strong>{selectedRun.safetyMode}</strong>
                  </div>
                  <div>
                    <span>开始时间</span>
                    <strong>{formatDate(selectedRun.startedAt)}</strong>
                  </div>
                  <div>
                    <span>更新时间</span>
                    <strong>{formatDate(selectedRun.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>目标章节</span>
                    <strong>{selectedRun.targetChapterOrders.join(', ') || '-'}</strong>
                  </div>
                </div>
                {selectedRun.warnings.length ? (
                  <div className="notice warning">
                    {selectedRun.warnings.slice(0, 3).map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
              </SectionCard>

              <SectionCard title="章节进度" description="Agent 可以连续推进多章，但每一章仍按人类导演同等流程生成、审稿、决策和提交。">
                <div className="agent-chapter-grid">
                  {jobChapters.length ? jobChapters.map((item) => (
                    <article key={item.jobId} className="agent-chapter-card">
                      <div>
                        <StatusBadge tone={statusTone(item.status)}>{item.status}</StatusBadge>
                        <strong>{item.chapterOrder ? `第 ${item.chapterOrder} 章` : '未知章节'}</strong>
                      </div>
                      <p>Job: {item.jobId}</p>
                      <p>草稿 {item.draftCount} 个{item.qualityScore !== null ? ` · 质量 ${item.qualityScore}` : ''}</p>
                    </article>
                  )) : <p className="muted">这个批次尚未创建章节 Job。</p>}
                </div>
              </SectionCard>

              <SectionCard title="待审预览" description="这里显示 Agent 准备好的动作；未获项目授权的高风险内容仍需作者决定。">
                {previews.length ? (
                  <div className="agent-preview-list">
                    {previews.map((preview: AgentActionPreview) => (
                      <article key={preview.id} className="agent-preview-card">
                        <div className="panel-title-row">
                          <div>
                            <h3>{preview.summary}</h3>
                            <p className="muted">{preview.reason}</p>
                          </div>
                          <div className="row-actions">
                            <StatusBadge tone={statusTone(preview.status)}>{preview.status}</StatusBadge>
                            <StatusBadge tone={riskTone(preview.riskLevel)}>{preview.riskLevel}</StatusBadge>
                          </div>
                        </div>
                        <p className="muted">动作：{preview.actionType} · 建议：{preview.recommendation} · {preview.requiresHumanApproval ? '需要确认' : '低风险可提交'}</p>
                        {preview.diffSummary.length ? (
                          <ul>
                            {preview.diffSummary.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
                          </ul>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">暂无动作预览。</p>
                )}
                {pendingPreviews.length ? <p className="notice warning">当前有 {pendingPreviews.length} 个待处理预览，需要通过 Agent Tool API 或后续 UI 操作确认。</p> : null}
              </SectionCard>

              <SectionCard title="决策记录" description="Agent 的接受、修订、重跑或暂停判断都会留在这里。">
                {decisions.length ? (
                  <div className="agent-decision-list">
                    {decisions.map((decision) => (
                      <article key={decision.id}>
                        <div>
                          <StatusBadge tone={riskTone(decision.riskLevel)}>{decision.riskLevel}</StatusBadge>
                          <strong>{decision.action}</strong>
                          <span>{formatDate(decision.createdAt)}</span>
                        </div>
                        <p>{decision.reason}</p>
                        {decision.evidence.length ? <small>{decision.evidence.slice(0, 3).join(' / ')}</small> : null}
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">暂无决策记录。</p>
                )}
              </SectionCard>

              <SectionCard title="正式提交" description="Agent 写入正文时必须进入版本链；这里列出已关联到当前批次的提交。">
                {relatedCommits.length ? (
                  <div className="agent-commit-list">
                    {relatedCommits.map((commit) => (
                      <article key={'commitId' in commit ? commit.commitId : commit.revisionCommitId}>
                        <StatusBadge tone="info">Codex Agent</StatusBadge>
                        <strong>{commitLabel(commit)}</strong>
                        <p className="muted">{'acceptedAt' in commit ? formatDate(commit.acceptedAt) : formatDate(commit.revisedAt)}</p>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="muted">这个批次尚未形成正式提交。</p>
                )}
              </SectionCard>
            </div>
          ) : null}
        </section>
      )}
    </div>
  )
}
