import type {
  Chapter,
  GeneratedChapterDraft,
  QualityGateIssue,
  QualityGateReport,
  RevisionRequestType
} from '../../../../shared/types'
import { Field, SelectField, TextArea } from '../../components/FormFields'
import { SectionCard } from '../../components/UI'
import { revisionQuickPresets, revisionTypeOptions } from './revisionTypeCatalog'

const DRAFT_STATUS_LABELS: Record<GeneratedChapterDraft['status'], string> = {
  draft: '待审阅',
  accepted: '已采纳',
  rejected: '已放弃'
}

interface RevisionStudioSidebarProps {
  sourceKind: 'chapter' | 'draft'
  chapters: Chapter[]
  selectedChapter: Chapter | null
  drafts: GeneratedChapterDraft[]
  selectedDraft: GeneratedChapterDraft | null
  linkedDraftChapter: Chapter | null
  revisionType: RevisionRequestType
  targetRange: string
  instruction: string
  sourceBody: string
  loading: boolean
  latestQualityReport: QualityGateReport | null
  hasStaleQualityReports: boolean
  relocation?: {
    status: 'unique' | 'missing' | 'ambiguous' | 'full_chapter'
    canRelocateSelection: boolean
  } | null
  onSourceKindChange: (value: 'chapter' | 'draft') => void
  onChapterChange: (chapterId: string) => void
  onDraftChange: (draftId: string) => void
  onRevisionTypeChange: (type: RevisionRequestType) => void
  onTargetRangeChange: (value: string) => void
  onInstructionChange: (value: string) => void
  onApplyQuickPreset: (type: RevisionRequestType, instruction: string) => void
  onCopySource: () => void
  onGenerateRevision: () => void
  onQualityIssue: (issue: QualityGateIssue) => void
  onRelocateRequest: (mode: 'selection' | 'full_chapter') => void
}

export function RevisionStudioSidebar({
  sourceKind,
  chapters,
  selectedChapter,
  drafts,
  selectedDraft,
  linkedDraftChapter,
  revisionType,
  targetRange,
  instruction,
  sourceBody,
  loading,
  latestQualityReport,
  hasStaleQualityReports,
  relocation,
  onSourceKindChange,
  onChapterChange,
  onDraftChange,
  onRevisionTypeChange,
  onTargetRangeChange,
  onInstructionChange,
  onApplyQuickPreset,
  onCopySource,
  onGenerateRevision,
  onQualityIssue,
  onRelocateRequest
}: RevisionStudioSidebarProps) {
  return (
    <aside className="revision-sidebar">
      <SectionCard title="正文来源" className="revision-source-card">
        <div className="segmented-control">
          <button className={sourceKind === 'chapter' ? 'active' : ''} onClick={() => onSourceKindChange('chapter')}>
            章节
          </button>
          <button className={sourceKind === 'draft' ? 'active' : ''} onClick={() => onSourceKindChange('draft')}>
            草稿
          </button>
        </div>
        {sourceKind === 'chapter' ? (
          <Field label="章节">
            <select value={selectedChapter?.id ?? ''} onChange={(event) => onChapterChange(event.target.value)}>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  第 {chapter.order} 章 {chapter.title || '未命名'}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <>
            <Field label="草稿">
              <select value={selectedDraft?.id ?? ''} onChange={(event) => onDraftChange(event.target.value)}>
                {drafts.map((draft) => (
                  <option key={draft.id} value={draft.id}>
                    {draft.title || '未命名草稿'} · {DRAFT_STATUS_LABELS[draft.status]}
                  </option>
                ))}
              </select>
            </Field>
            {selectedDraft?.chapterId ? (
              <p className="revision-linked-chapter">
                <span>写回章节</span>
                <strong>{linkedDraftChapter ? `第 ${linkedDraftChapter.order} 章 ${linkedDraftChapter.title || '未命名'}` : '关联章节已丢失'}</strong>
              </p>
            ) : <p className="revision-linked-chapter muted">该草稿未关联章节，接受修订只更新草稿。</p>}
          </>
        )}
      </SectionCard>
      <SectionCard title="修改方向" className="revision-requirements-card">
        <SelectField<RevisionRequestType>
          label="修订类型"
          value={revisionType}
          onChange={onRevisionTypeChange}
          options={revisionTypeOptions}
        />
        <TextArea
          label="修改要求"
          value={instruction}
          rows={3}
          placeholder="例如：保留事实，但让对话更有潜台词，减少解释。"
          onChange={onInstructionChange}
        />
        <div className="revision-generation-actions">
          <button type="button" className="ghost-button" disabled={!sourceBody.trim()} onClick={onCopySource}>
            复制原文
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={loading || !sourceBody.trim() || Boolean(relocation)}
            onClick={onGenerateRevision}
          >
            {loading ? '修订中...' : '生成修订版本'}
          </button>
        </div>
        {relocation ? (
          <div className="notice warning">
            <strong>原要求对应的正文已更新。</strong>
            <span>
              {relocation.status === 'unique'
                ? '原选区仍可唯一找到，可以重新定位。'
                : relocation.status === 'missing'
                  ? '原选区已找不到，请重新选择段落或转为整章。'
                  : relocation.status === 'ambiguous'
                    ? '原选区出现多次，请选择更完整的段落或转为整章。'
                    : '这条整章要求需要重新绑定最新正文。'}
            </span>
            <div className="row-actions">
              {relocation.status !== 'full_chapter' ? (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!relocation.canRelocateSelection}
                  onClick={() => onRelocateRequest('selection')}
                >
                  在最新正文重新定位
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button"
                onClick={() => onRelocateRequest('full_chapter')}
              >
                {relocation.status === 'full_chapter' ? '在最新正文重新定位' : '转为整章'}
              </button>
            </div>
          </div>
        ) : null}
        <details className="revision-quick-presets-details">
          <summary>常用方向</summary>
          <div className="revision-quick-presets" aria-label="常用修订方向">
            {revisionQuickPresets.map((preset) => (
              <button
                key={preset.type}
                type="button"
                className={revisionType === preset.type ? 'active' : ''}
                onClick={() => onApplyQuickPreset(preset.type, preset.instruction)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </details>
        <details className="revision-advanced-options" open={Boolean(relocation)}>
          <summary>只修改某一段（可选）</summary>
          <TextArea
            label="局部修订文本"
            value={targetRange}
            rows={6}
            placeholder="把要局部修订的段落粘贴到这里；留空则全文修订。"
            onChange={onTargetRangeChange}
          />
        </details>
      </SectionCard>
      {latestQualityReport || hasStaleQualityReports ? (
        <details className="revision-sidebar-details">
          <summary>审稿详情</summary>
          {!latestQualityReport ? (
            hasStaleQualityReports ? (
              <p className="notice warning">当前正文已变化，历史质量报告不再适用于这份文本。请重新审稿后再使用问题定向修订。</p>
            ) : (
              <p className="muted">当前章节暂无质量门禁报告。</p>
            )
          ) : (
            <div className="quality-issue-list">
              {latestQualityReport.issues.map((issue, index) => (
                <button
                  key={`${issue.type}-${index}`}
                  className={`quality-issue ${issue.severity}`}
                  onClick={() => onQualityIssue(issue)}
                >
                  <strong>{issue.type}</strong>
                  <span>{issue.description || issue.suggestedFix}</span>
                </button>
              ))}
            </div>
          )}
        </details>
      ) : null}
    </aside>
  )
}
