import type { Dispatch, SetStateAction } from 'react'
import type { AIService } from '../../../../services/AIService'
import type {
  AppData,
  Chapter,
  GeneratedChapterDraft,
  ID,
  Project,
  QualityGateReport,
  RevisionCommitBundle,
  RevisionRequest,
  RevisionRequestType,
  RevisionSession,
  RevisionVersion
} from '../../../../shared/types'
import type { ConfirmFn } from '../../components/ConfirmDialog'
import type { SaveDataHandler } from '../../utils/saveDataState'

export interface RevisionGenerationOverride {
  type?: RevisionRequestType
  instruction?: string
  targetRange?: string
  sourceText?: string
}

export interface RevisionStudioActionContext {
  project: Project
  saveData: SaveDataHandler
  saveRevisionCommitBundle?: (buildCommit: (currentData: AppData) => { next: AppData; bundle: RevisionCommitBundle }) => Promise<void>
  confirmAction: ConfirmFn
  getAiService: () => Promise<AIService>
  buildRevisionContext: () => string
  sourceKind: 'chapter' | 'draft'
  selectedChapter: Chapter | null
  selectedDraft: GeneratedChapterDraft | null
  linkedDraftChapter: Chapter | null
  sourceTitle: string
  sourceBody: string
  sourceDraftId: ID | null
  activeSessions: RevisionSession[]
  sourceRequest?: RevisionRequest | null
  revisionType: RevisionRequestType
  targetRange: string
  instruction: string
  latestQualityReports: QualityGateReport[]
  selectedVersion: RevisionVersion | null
  editableVersionBody: string
  setRevisionType: Dispatch<SetStateAction<RevisionRequestType>>
  setTargetRange: Dispatch<SetStateAction<string>>
  setInstruction: Dispatch<SetStateAction<string>>
  setSourceRequestId: Dispatch<SetStateAction<ID | null>>
  setSelectedVersionId: Dispatch<SetStateAction<ID | null>>
  setRevisionViewMode: Dispatch<SetStateAction<'revised' | 'diff'>>
  setEditableVersionBody: Dispatch<SetStateAction<string>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setMessage: Dispatch<SetStateAction<string>>
}
