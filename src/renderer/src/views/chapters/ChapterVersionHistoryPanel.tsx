import { useMemo, useState } from 'react'
import type { AppData, Chapter } from '../../../../shared/types'
import {
  getChapterVersionChain,
  getChapterVersionDetail,
  getChapterVersionProtectionReason,
  type ChapterVersionChainEntry
} from '../../../../services/ChapterVersionChainService'
import { formatDate } from '../../utils/format'
import { RevisionDiffView } from '../revision/RevisionDiffView'

interface ChapterVersionHistoryPanelProps {
  data: AppData
  selected: Chapter
  onCopyVersion: (entry: ChapterVersionChainEntry) => void
  onRestoreVersion: (entry: ChapterVersionChainEntry) => void
  onDeleteVersion: (entry: ChapterVersionChainEntry) => void
}

type VersionDetailTab = 'preview' | 'diff' | 'links'

function textLength(text: string): string {
  return text.replace(/\s/g, '').length.toLocaleString()
}

function linkValue(value: string | null | undefined): string {
  return value || '无关联记录'
}

function isCodexAgentVersion(detail: ReturnType<typeof getChapterVersionDetail>): boolean {
  const chapterCommit = detail?.chapterCommitBundle
  const revisionCommit = detail?.revisionCommitBundle
  const raw = JSON.stringify({
    chapterCommitId: chapterCommit?.commitId,
    chapterCommitNote: chapterCommit?.commitNote,
    revisionCommitId: revisionCommit?.revisionCommitId,
    revisionNote: revisionCommit?.revisionNote,
    revisionReason: revisionCommit?.revisionReason
  }).toLowerCase()
  return raw.includes('agent') || raw.includes('codex')
}

export function ChapterVersionHistoryPanel({
  data,
  selected,
  onCopyVersion,
  onRestoreVersion,
  onDeleteVersion
}: ChapterVersionHistoryPanelProps) {
  const entries = useMemo(() => getChapterVersionChain(data, selected.id), [data, selected.id])
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(entries[0]?.id ? String(entries[0].id) : null)
  const [tab, setTab] = useState<VersionDetailTab>('preview')
  const selectedEntry = entries.find((entry) => String(entry.id) === selectedEntryId) ?? entries[0] ?? null
  const detail = useMemo(() => (selectedEntry ? getChapterVersionDetail(data, selectedEntry.id) : null), [data, selectedEntry])
  const savedVersionCount = entries.filter((entry) => entry.sourceKind !== 'current').length
  const canRestore = Boolean(selectedEntry && !selectedEntry.isCurrent && selectedEntry.body !== selected.body)
  const versionProtectionReason = selectedEntry?.version
    ? getChapterVersionProtectionReason(data, selectedEntry.id)
    : null
  const canDelete = Boolean(
    selectedEntry?.version &&
    data.chapterVersions.some((version) => version.id === selectedEntry.id) &&
    !versionProtectionReason
  )
  const isAgentVersion = isCodexAgentVersion(detail)

  return (
    <div className="version-history-panel">
      <div className="panel-title-row">
        <h3>版本历史</h3>
        <span className="muted">{savedVersionCount} 个已保存版本</span>
      </div>
      {savedVersionCount === 0 ? (
        <p className="muted">暂无历史版本。接受 AI 草稿、正式修订或恢复历史版本后，这里会形成可追溯的版本链。</p>
      ) : null}
      <div className="version-chain-layout">
        <div className="version-history-list">
          {entries.map((entry) => {
            const entryDetail = getChapterVersionDetail(data, entry.id)
            return (
              <button
                key={entry.id}
                className={`version-history-item ${selectedEntry?.id === entry.id ? 'active' : ''}`}
                type="button"
                onClick={() => {
                  setSelectedEntryId(String(entry.id))
                  setTab('preview')
                }}
              >
                <div>
                  <strong>{entry.title || `第 ${selected.order} 章`}</strong>
                  <p>
                    {entry.sourceLabel} · {formatDate(entry.createdAt)} · {textLength(entry.body)} 字
                  </p>
                </div>
                <div className="row-actions">
                  {entryDetail?.chapterCommitBundle?.acceptanceReview?.mode === 'unreviewed' ? <span className="status-badge warning">未审稿采纳</span> : null}
                  {isCodexAgentVersion(entryDetail) ? <span className="status-badge info">Codex Agent</span> : null}
                  {entry.isCurrent ? <span className="status-pill">当前使用</span> : null}
                </div>
              </button>
            )
          })}
        </div>

        {selectedEntry ? (
          <div className="version-detail-panel">
            <div className="panel-title-row">
              <div>
                <h4>{selectedEntry.sourceLabel}</h4>
                {isAgentVersion ? <span className="status-badge info">Codex Agent</span> : null}
                <p className="muted">
                  {formatDate(selectedEntry.createdAt)} · {textLength(selectedEntry.body)} 字
                </p>
              </div>
              <div className="row-actions">
                <button className="ghost-button" onClick={() => onCopyVersion(selectedEntry)}>
                  复制
                </button>
                <button className="primary-button" disabled={!canRestore} onClick={() => onRestoreVersion(selectedEntry)}>
                  恢复此版本
                </button>
                {canDelete ? (
                  <button className="danger-button" onClick={() => onDeleteVersion(selectedEntry)}>
                    删除记录
                  </button>
                ) : null}
              </div>
            </div>
            {detail?.chapterCommitBundle?.acceptanceReview?.mode === 'unreviewed' ? (
              <p className="notice">本版本由作者在审稿未完成时明确采纳。该决定不代表审稿通过，采纳时已有的诊断仍可在关联记录中查看。</p>
            ) : null}
            <div className="tab-row">
              <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>
                正文预览
              </button>
              <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>
                与当前对比
              </button>
              <button className={tab === 'links' ? 'active' : ''} onClick={() => setTab('links')}>
                关联记录
              </button>
            </div>
            {tab === 'preview' ? <pre className="version-preview-text">{selectedEntry.body}</pre> : null}
            {tab === 'diff' ? <RevisionDiffView originalText={selected.body} revisedText={selectedEntry.body} /> : null}
            {tab === 'links' ? (
              <div className="version-links-grid">
                <span>草稿采纳提交</span>
                <strong>{linkValue(detail?.chapterCommitBundle?.commitId)}</strong>
                <span>修订提交</span>
                <strong>{linkValue(detail?.revisionCommitBundle?.revisionCommitId)}</strong>
                <span>生成追踪</span>
                <strong>{linkValue(detail?.generationRunTrace?.id)}</strong>
                <span>质量门禁</span>
                <strong>{linkValue(detail?.qualityGateReport?.id)}</strong>
                <span>一致性审稿</span>
                <strong>{linkValue(detail?.consistencyReviewReport?.id)}</strong>
                <span>来源</span>
                <strong>{isAgentVersion ? 'Codex Agent' : '人工 / 工作台'}</strong>
              </div>
            ) : null}
            {!canRestore && !selectedEntry.isCurrent ? (
              <p className="muted">该版本正文已经与当前正文一致，因此不会重复创建恢复提交。</p>
            ) : null}
            {versionProtectionReason && !selectedEntry.isCurrent ? (
              <p className="muted">{versionProtectionReason}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
