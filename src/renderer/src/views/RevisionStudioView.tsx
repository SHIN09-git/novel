import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppData,
  ID,
  Project,
  RevisionCommitBundle,
  RevisionRequestType
} from '../../../shared/types'
import { canEditRevisionVersionStatus } from '../../../shared/revisionVersionPolicy'
import { resolvePipelineRoleSettings } from '../../../services/PipelineRunContextService'
import {
  latestQualityReportForDraft,
  latestQualityReportForText
} from '../../../services/DraftDiagnosticBindingService'
import { useConfirm } from '../components/ConfirmDialog'
import { Header } from '../components/Layout'
import { useProjectData } from '../hooks/useProjectData'
import { resolveDraftLinkedChapter } from '../utils/revisionWriteback'
import type { SaveDataHandler } from '../utils/saveDataState'
import { RevisionComparisonPanel } from './revision/RevisionComparisonPanel'
import { RevisionStudioSidebar } from './revision/RevisionStudioSidebar'
import { buildRevisionAiContext } from './revision/revisionAiContext'
import { useRevisionRequestRelocation } from './revision/useRevisionRequestRelocation'
import { useRevisionStudioActions } from './revision/useRevisionStudioActions'

interface ProjectProps {
  data: AppData
  project: Project
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: (
    buildCommit: (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }
  ) => Promise<void>
  prefill?: { chapterId: ID | null; draftId: ID | null; requestId: ID } | null
  onPrefillConsumed?: () => void
}

export function RevisionStudioView({
  data,
  project,
  saveData,
  saveRevisionCommitBundle,
  prefill,
  onPrefillConsumed
}: ProjectProps) {
  const confirmAction = useConfirm()
  const scoped = useProjectData(data, project.id)
  const chapters = useMemo(
    () => [...scoped.chapters].sort((a, b) => b.order - a.order),
    [scoped.chapters]
  )
  const drafts = useMemo(
    () => [...scoped.generatedChapterDrafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [scoped.generatedChapterDrafts]
  )
  const requestTypeById = useMemo(
    () => new Map(data.revisionRequests.map((request) => [request.id, request.type] as const)),
    [data.revisionRequests]
  )
  const [sourceKind, setSourceKind] = useState<'chapter' | 'draft'>('chapter')
  const [selectedChapterId, setSelectedChapterId] = useState<ID | null>(chapters[0]?.id ?? null)
  const [selectedDraftId, setSelectedDraftId] = useState<ID | null>(drafts[0]?.id ?? null)
  const [revisionType, setRevisionType] = useState<RevisionRequestType>('reduce_ai_tone')
  const [targetRange, setTargetRange] = useState('')
  const [instruction, setInstruction] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState<ID | null>(null)
  const [revisionViewMode, setRevisionViewMode] = useState<'revised' | 'diff'>('diff')
  const [editableVersionBody, setEditableVersionBody] = useState('')
  const persistedEditorSource = useRef<{ id: ID | null; body: string; inputSequence: number } | null>(null)
  const editorInputSequence = useRef(0)
  const currentEditorVersionId = useRef<ID | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? drafts[0] ?? null
  const linkedDraftChapter = sourceKind === 'draft' ? resolveDraftLinkedChapter(selectedDraft, chapters) : null
  const selectedChapter =
    sourceKind === 'draft'
      ? linkedDraftChapter
      : chapters.find((chapter) => chapter.id === selectedChapterId) ?? chapters[0] ?? null
  const sourceTitle = sourceKind === 'draft' ? selectedDraft?.title ?? '' : selectedChapter?.title ?? ''
  const sourceBody = sourceKind === 'draft' ? selectedDraft?.body ?? '' : selectedChapter?.body ?? ''
  const sourceDraftId = sourceKind === 'draft' ? selectedDraft?.id ?? null : null
  const sourceRun = sourceDraftId
    ? scoped.chapterGenerationJobs.find((job) => job.id === selectedDraft?.jobId) ?? null
    : null
  const getAiService = useCallback(async () => {
    const { AIService } = await import('../../../services/AIService')
    const runSettings = resolvePipelineRoleSettings(sourceRun?.aiRunConfig, data.settings, 'revision')
    return new AIService(runSettings, sourceRun ? { runId: sourceRun.id } : undefined)
  }, [data.settings, sourceRun])
  const sourceSessions = scoped.revisionSessions.filter((session) =>
    sourceDraftId
      ? session.sourceDraftId === sourceDraftId
      : session.chapterId === selectedChapter?.id && session.sourceDraftId === null
  )
  const sessionIds = new Set(sourceSessions.map((session) => session.id))
  const versions = scoped.revisionVersions
    .filter((version) => sessionIds.has(version.sessionId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const hasRevisionVersions = versions.length > 0
  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? versions[0] ?? null
  currentEditorVersionId.current = selectedVersion?.id ?? null
  const selectedVersionCanEdit = selectedVersion ? canEditRevisionVersionStatus(selectedVersion.status) : false
  const selectedVersionForView = selectedVersion
    ? { ...selectedVersion, body: selectedVersionCanEdit ? editableVersionBody : selectedVersion.body }
    : null
  const selectedChapterDraftIds = new Set(
    selectedChapter
      ? scoped.generatedChapterDrafts
          .filter((draft) => draft.chapterId === selectedChapter.id)
          .map((draft) => draft.id)
      : []
  )
  const relatedQualityReports = scoped.qualityGateReports
    .filter((report) =>
      sourceKind === 'draft'
        ? report.draftId === selectedDraft?.id
        : report.chapterId === selectedChapter?.id || Boolean(report.draftId && selectedChapterDraftIds.has(report.draftId))
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const currentSourceQualityReport = sourceKind === 'draft'
    ? selectedDraft
      ? latestQualityReportForDraft(relatedQualityReports, selectedDraft)
      : null
    : selectedChapter
      ? latestQualityReportForText(relatedQualityReports, selectedChapter.body)
      : null
  const hasStaleQualityReports = relatedQualityReports.length > 0 && !currentSourceQualityReport
  const { sourceRequest, relocation, setSourceRequestId } = useRevisionRequestRelocation({
    data, projectId: project.id, prefill, onPrefillConsumed, sourceSessions,
    chapterId: selectedChapter?.id ?? '', sourceDraftId, sourceBody, targetRange,
    setSourceKind, setSelectedChapterId, setSelectedDraftId, setRevisionType,
    setTargetRange, setInstruction
  })

  useEffect(() => {
    if (!selectedChapterId && chapters[0]) setSelectedChapterId(chapters[0].id)
    if (selectedChapterId && !chapters.some((chapter) => chapter.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0]?.id ?? null)
    }
  }, [chapters, selectedChapterId])

  useEffect(() => {
    if (!selectedDraftId && drafts[0]) setSelectedDraftId(drafts[0].id)
    if (selectedDraftId && !drafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(drafts[0]?.id ?? null)
    }
  }, [drafts, selectedDraftId])

  useEffect(() => {
    const previous = persistedEditorSource.current
    const incoming = {
      id: selectedVersion?.id ?? null,
      body: selectedVersion?.body ?? '',
      inputSequence: editorInputSequence.current
    }
    persistedEditorSource.current = incoming
    // A save receipt can arrive after the author has continued typing.
    setEditableVersionBody((localBody) =>
      previous?.id !== incoming.id || !selectedVersionCanEdit ||
        (localBody === previous?.body && previous?.inputSequence === incoming.inputSequence)
        ? incoming.body
        : localBody
    )
  }, [selectedVersion?.id, selectedVersion?.body, selectedVersion?.status])

  function buildRevisionContext(): string {
    return buildRevisionAiContext({
      project,
      bible: scoped.bible,
      chapters,
      characters: scoped.characters,
      foreshadowings: scoped.foreshadowings,
      chapterContinuityBridges: scoped.chapterContinuityBridges,
      redundancyReports: scoped.redundancyReports,
      selectedChapter,
      selectedDraft: sourceKind === 'draft' ? selectedDraft : null
    })
  }

  const {
    generateRevisionFromCurrent,
    relocateSourceRequest,
    acceptVersion,
    persistEditedVersionBody,
    rejectVersion,
    copyRevisionVersion,
    startFromQualityIssue
  } = useRevisionStudioActions({
    project,
    saveData,
    saveRevisionCommitBundle,
    confirmAction,
    getAiService,
    buildRevisionContext,
    sourceKind,
    selectedChapter,
    selectedDraft,
    linkedDraftChapter,
    sourceTitle,
    sourceBody,
    sourceDraftId,
    activeSessions: sourceSessions,
    sourceRequest,
    revisionType,
    targetRange,
    instruction,
    latestQualityReports: relatedQualityReports,
    selectedVersion,
    editableVersionBody,
    setRevisionType,
    setTargetRange,
    setInstruction,
    setSourceRequestId,
    setSelectedVersionId,
    setRevisionViewMode,
    setEditableVersionBody,
    setLoading,
    setMessage
  })

  async function flushEditedVersionBefore(action: () => void): Promise<void> {
    const inputSequence = editorInputSequence.current
    const versionId = selectedVersion?.id ?? null
    if (selectedVersion && editableVersionBody !== selectedVersion.body) {
      if (!(await persistEditedVersionBody())) return
    }
    if (currentEditorVersionId.current !== versionId) return
    if (editorInputSequence.current !== inputSequence) {
      setMessage('保存期间有新的输入，已保留在当前候选中；请完成编辑后再切换。')
      return
    }
    action()
  }

  function changeRevisionSource(action: () => void): Promise<void> {
    return flushEditedVersionBefore(() => {
      action()
      setSourceRequestId(null)
      setTargetRange('')
      setInstruction('')
      setSelectedVersionId(null)
    })
  }

  return (
    <div className="revision-view">
      <Header
        title="修订工作台"
        description={`${sourceKind === 'draft' ? '草稿来源' : '章节来源'} · ${sourceTitle || '未命名'}`}
      />
      <section className={`revision-studio-layout ${hasRevisionVersions ? 'has-versions' : 'no-versions'}`}>
        <RevisionStudioSidebar
          sourceKind={sourceKind}
          chapters={chapters}
          selectedChapter={selectedChapter}
          drafts={drafts}
          selectedDraft={selectedDraft}
          linkedDraftChapter={linkedDraftChapter}
          revisionType={revisionType}
          targetRange={targetRange}
          instruction={instruction}
          sourceBody={sourceBody}
          loading={loading}
          latestQualityReport={currentSourceQualityReport}
          hasStaleQualityReports={hasStaleQualityReports}
          relocation={relocation}
          onSourceKindChange={(value) => {
            if (value !== sourceKind) void changeRevisionSource(() => setSourceKind(value))
          }}
          onChapterChange={(chapterId) => void changeRevisionSource(() => setSelectedChapterId(chapterId))}
          onDraftChange={(draftId) => void changeRevisionSource(() => setSelectedDraftId(draftId))}
          onRevisionTypeChange={setRevisionType}
          onTargetRangeChange={setTargetRange}
          onInstructionChange={setInstruction}
          onApplyQuickPreset={(type, presetInstruction) => {
            setRevisionType(type)
            setInstruction(presetInstruction)
          }}
          onCopySource={() => void copyRevisionVersion({ body: sourceBody })}
          onGenerateRevision={() => void generateRevisionFromCurrent()}
          onQualityIssue={(issue) => void startFromQualityIssue(issue)}
          onRelocateRequest={(mode) => void relocateSourceRequest(mode)}
        />
        <RevisionComparisonPanel
          projectId={project.id}
          sourceBody={sourceBody}
          versions={versions}
          selectedVersion={selectedVersion}
          selectedVersionForView={selectedVersionForView}
          selectedVersionCanEdit={selectedVersionCanEdit}
          revisionViewMode={revisionViewMode}
          revisionType={revisionType}
          instruction={instruction}
          loading={loading}
          requestTypeById={requestTypeById}
          getAiService={getAiService}
          buildRevisionContext={buildRevisionContext}
          onMessage={setMessage}
          onGenerateRevision={(override) => void generateRevisionFromCurrent(override)}
          onSelectVersion={(versionId) => {
            if (versionId !== selectedVersion?.id) {
              void flushEditedVersionBefore(() => setSelectedVersionId(versionId))
            }
          }}
          onViewModeChange={(mode) => {
            void flushEditedVersionBefore(() => setRevisionViewMode(mode))
          }}
          onEditedBodyChange={(body) => {
            editorInputSequence.current += 1
            setEditableVersionBody(body)
          }}
          onApplyRewrite={async (body) => {
            const inputSequence = editorInputSequence.current
            const versionId = selectedVersion?.id ?? null
            const saved = await persistEditedVersionBody(body)
            if (saved && currentEditorVersionId.current === versionId && editorInputSequence.current === inputSequence) {
              setEditableVersionBody(body)
            }
            return saved
          }}
          onPersistEditedBody={() => void persistEditedVersionBody()}
          onCopyVersion={(version) => void copyRevisionVersion(version)}
          onAcceptVersion={(version) => void acceptVersion(version)}
          onRejectVersion={(version) => void rejectVersion(version)}
        />
      </section>
      {message ? <div className="notice revision-message">{message}</div> : null}
    </div>
  )
}
