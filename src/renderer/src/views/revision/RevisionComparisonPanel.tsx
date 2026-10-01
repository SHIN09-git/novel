import type { AIService } from '../../../../services/AIService'
import {
  canAcceptRevisionVersionStatus,
  canRejectRevisionVersionStatus
} from '../../../../shared/revisionVersionPolicy'
import type { ID, RevisionRequestType, RevisionVersion } from '../../../../shared/types'
import { AiRewriteTextArea } from '../../components/AiRewriteTextArea'
import { EmptyState } from '../../components/FormFields'
import { SectionCard } from '../../components/UI'
import { RevisionDiffView } from './RevisionDiffView'
import type { RevisionGenerationOverride } from './revisionStudioActionTypes'
import { revisionTypeName, revisionVersionStatusLabel } from './revisionTypeCatalog'

interface RevisionComparisonPanelProps {
  projectId: ID
  sourceBody: string
  versions: RevisionVersion[]
  selectedVersion: RevisionVersion | null
  selectedVersionForView: RevisionVersion | null
  selectedVersionCanEdit: boolean
  revisionViewMode: 'revised' | 'diff'
  revisionType: RevisionRequestType
  instruction: string
  loading: boolean
  requestTypeById: ReadonlyMap<ID, RevisionRequestType>
  getAiService: () => Promise<AIService>
  buildRevisionContext: () => string
  onMessage: (message: string) => void
  onGenerateRevision: (override?: RevisionGenerationOverride) => void
  onSelectVersion: (versionId: ID) => void
  onViewModeChange: (mode: 'revised' | 'diff') => void
  onEditedBodyChange: (body: string) => void
  onApplyRewrite: (body: string) => Promise<boolean>
  onPersistEditedBody: () => void
  onCopyVersion: (version: Pick<RevisionVersion, 'body'>) => void
  onAcceptVersion: (version: RevisionVersion) => void
  onRejectVersion: (version: RevisionVersion) => void
}

export function RevisionComparisonPanel({
  projectId,
  sourceBody,
  versions,
  selectedVersion,
  selectedVersionForView,
  selectedVersionCanEdit,
  revisionViewMode,
  revisionType,
  instruction,
  loading,
  requestTypeById,
  getAiService,
  buildRevisionContext,
  onMessage,
  onGenerateRevision,
  onSelectVersion,
  onViewModeChange,
  onEditedBodyChange,
  onApplyRewrite,
  onPersistEditedBody,
  onCopyVersion,
  onAcceptVersion,
  onRejectVersion
}: RevisionComparisonPanelProps) {
  const hasVersions = versions.length > 0
  const selectedType = selectedVersionForView
    ? requestTypeById.get(selectedVersionForView.requestId) ?? revisionType
    : revisionType
  const sourceEditor = sourceBody.trim() ? (
    <AiRewriteTextArea
      className="revision-textarea original"
      value={sourceBody}
      readOnly
      rows={hasVersions ? 10 : 18}
      onStatusChange={onMessage}
      onRewriteRequest={({ action, selectedText, customInstruction }) =>
        onGenerateRevision({
          type: action.type,
          targetRange: selectedText,
          instruction: customInstruction || action.instruction
        })
      }
    />
  ) : (
    <EmptyState title="暂无可修订正文" description="请选择已有章节或带正文的生成草稿。" />
  )
  const sourceContent = hasVersions ? (
    <details className="revision-source-disclosure">
      <summary>
        <span>当前原文</span>
        <small>{sourceBody.replace(/\s/g, '').length.toLocaleString()} 字</small>
      </summary>
      {sourceEditor}
    </details>
  ) : (
    <section className="revision-source-reader" aria-label="当前原文">
      <div className="revision-reader-heading">
        <h2>当前原文</h2>
        <span>{sourceBody.replace(/\s/g, '').length.toLocaleString()} 字</span>
      </div>
      {sourceEditor}
    </section>
  )

  return (
    <main
      className={`revision-compare ${hasVersions ? 'has-versions' : 'no-versions'}`}
    >
      {hasVersions ? (
        <SectionCard
          title="修订候选"
          description={selectedVersionForView ? `${revisionTypeName(selectedType)} · ${revisionVersionStatusLabel(selectedVersionForView.status)}` : '选择一个版本查看'}
          className="revision-candidate-panel"
          actions={selectedVersionForView ? (
            <div className="revision-candidate-primary-actions" aria-label="候选操作">
              <button
                className="ghost-button"
                disabled={loading}
                onClick={() =>
                  onGenerateRevision({
                    sourceText: selectedVersionForView.body,
                    instruction: `在该修订版本基础上继续修改：${instruction || selectedVersionForView.changedSummary}`
                  })
                }
              >
                继续修改
              </button>
              <button
                className="primary-button"
                disabled={!canAcceptRevisionVersionStatus(selectedVersionForView.status)}
                onClick={() => onAcceptVersion(selectedVersionForView)}
              >
                {selectedVersionForView.responseScope === 'broader_than_requested' ? '作为整章版本接受' : '接受版本'}
              </button>
              <button className="ghost-button" onClick={() => onCopyVersion(selectedVersionForView)}>复制版本</button>
              <button
                className="danger-button"
                disabled={!canRejectRevisionVersionStatus(selectedVersionForView.status)}
                onClick={() => onRejectVersion(selectedVersionForView)}
              >
                拒绝版本
              </button>
            </div>
          ) : undefined}
        >
          <div className="version-tabs" aria-label="候选历史">
            {versions.map((version) => (
              <button
                key={version.id}
                className={version.id === selectedVersion?.id ? 'active' : ''}
                onClick={() => onSelectVersion(version.id)}
              >
                {revisionTypeName(requestTypeById.get(version.requestId) ?? 'custom')}
                <small>{revisionVersionStatusLabel(version.status)}</small>
              </button>
            ))}
          </div>
          {selectedVersionForView ? (
            <>
              {selectedVersionForView.responseScope === 'broader_than_requested' ? (
                <p className="notice">结果超出原选区，已保留为整章候选；原文未变。</p>
              ) : null}
              <div className="segmented-control revision-view-switch">
                <button
                  className={revisionViewMode === 'revised' ? 'active' : ''}
                  aria-pressed={revisionViewMode === 'revised'}
                  onClick={() => onViewModeChange('revised')}
                >
                  修订后
                </button>
                <button
                  className={revisionViewMode === 'diff' ? 'active' : ''}
                  aria-pressed={revisionViewMode === 'diff'}
                  onClick={() => onViewModeChange('diff')}
                >
                  差异对比
                </button>
              </div>
              {revisionViewMode === 'revised' ? (
                <>
                  {!selectedVersionCanEdit ? (
                    <p className="notice">该版本已进入历史状态，正文只读；继续调整会创建新版本。</p>
                  ) : null}
                  <AiRewriteTextArea
                    className="revision-textarea revised"
                    value={selectedVersionForView.body}
                    getAiService={selectedVersionCanEdit ? getAiService : undefined}
                    context={buildRevisionContext}
                    scopeKey={selectedVersionForView.id}
                    rewriteTarget={selectedVersionCanEdit ? { projectId, kind: 'revision_version', targetId: selectedVersionForView.id } : undefined}
                    onApplyRewrite={onApplyRewrite}
                    rows={18}
                    readOnly={!selectedVersionCanEdit}
                    disabled={!selectedVersionCanEdit}
                    onStatusChange={onMessage}
                    onChange={selectedVersionCanEdit ? onEditedBodyChange : undefined}
                    onBlur={selectedVersionCanEdit ? onPersistEditedBody : undefined}
                  />
                </>
              ) : null}
              {revisionViewMode === 'diff' ? (
                <RevisionDiffView originalText={sourceBody} revisedText={selectedVersionForView.body} />
              ) : null}
              <details className="revision-version-meta">
                <summary>修改摘要与审稿提示</summary>
                <p><strong>修改摘要：</strong>{selectedVersionForView.changedSummary || '暂无'}</p>
                <p><strong>风险提示：</strong>{selectedVersionForView.risks || '暂无'}</p>
                <p><strong>保留事实：</strong>{selectedVersionForView.preservedFacts || '暂无'}</p>
              </details>
            </>
          ) : <EmptyState title="未选择修订版本" description="从上方选择一个版本后查看正文和差异。" />}
        </SectionCard>
      ) : null}
      {sourceContent}
    </main>
  )
}
