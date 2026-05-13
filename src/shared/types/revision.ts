import type { ID } from './base'
import type { GeneratedChapterDraft } from './generation'
import type { Chapter } from './project'
import type { GenerationRunTrace } from './trace'

export type RevisionCandidateStatus = 'pending' | 'accepted' | 'rejected'

export type RevisionCandidateContextSource = 'reused_current_job_context' | 'rebuilt_from_explicit_selection' | 'fallback_legacy'

export type RevisionSessionStatus = 'active' | 'completed' | 'abandoned' | 'cancelled' | 'failed'

export type RevisionRequestType =
  | 'polish_style'
  | 'reduce_ai_tone'
  | 'strengthen_conflict'
  | 'improve_dialogue'
  | 'compress_pacing'
  | 'enhance_emotion'
  | 'fix_ooc'
  | 'fix_continuity'
  | 'fix_worldbuilding'
  | 'fix_character_knowledge'
  | 'fix_foreshadowing'
  | 'fix_plot_logic'
  | 'improve_continuity'
  | 'reduce_redundancy'
  | 'compress_description'
  | 'remove_repeated_explanation'
  | 'strengthen_chapter_transition'
  | 'rewrite_section'
  | 'custom'

export type RevisionScope = 'full' | 'local'

export type RevisionVersionStatus = 'pending' | 'draft' | 'accepted' | 'rejected' | 'superseded'

export interface RevisionGenerationRequest {
  type: RevisionRequestType
  instruction: string
  revisionScope: RevisionScope
  fullChapterText: string
  targetRange?: string
}

export interface RevisionCommitBundle {
  schemaVersion: number
  id: ID
  revisionCommitId: ID
  projectId: ID
  chapterId: ID
  baseChapterVersionId?: ID | null
  newChapterVersionId: ID
  revisionSessionId?: ID | null
  revisionVersionId?: ID | null
  revisedAt: string
  revisedBy: 'user' | 'ai' | 'user_with_ai'
  beforeText?: string
  afterText: string
  chapter: Chapter
  chapterVersion: ChapterVersion
  generatedDraft?: GeneratedChapterDraft
  revisionSession?: RevisionSession
  revisionVersion?: RevisionVersion
  revisionReason?: string
  revisionNote?: string
  linkedGenerationRunTraceId?: ID | null
  linkedChapterCommitId?: ID | null
  generationRunTrace?: GenerationRunTrace
  affectedCharacterIds?: ID[]
  affectedForeshadowingIds?: ID[]
  affectedTimelineEventIds?: ID[]
}

export interface RevisionCandidate {
  id: ID
  projectId: ID
  jobId: ID
  draftId: ID
  sourceReportId: ID
  targetIssue: string
  revisionInstruction: string
  revisedText: string
  status: RevisionCandidateStatus
  contextSource?: RevisionCandidateContextSource
  contextWarnings?: string[]
  createdAt: string
  updatedAt: string
}

export interface RevisionSession {
  id: ID
  projectId: ID
  chapterId: ID
  sourceDraftId: ID | null
  status: RevisionSessionStatus
  createdAt: string
  updatedAt: string
}

export interface RevisionRequest {
  id: ID
  sessionId: ID
  type: RevisionRequestType
  targetRange: string
  instruction: string
  createdAt: string
}

export interface RevisionResult {
  revisedText: string
  changedSummary: string
  risks: string
  preservedFacts: string
}

export interface RevisionVersion {
  id: ID
  sessionId: ID
  requestId: ID
  title: string
  body: string
  changedSummary: string
  risks: string
  preservedFacts: string
  status: RevisionVersionStatus
  createdAt: string
  updatedAt: string
}

export interface ChapterVersion {
  id: ID
  projectId: ID
  chapterId: ID
  source: string
  title: string
  body: string
  note: string
  createdAt: string
  linkedRevisionCommitId?: ID | null
  linkedGenerationRunTraceId?: ID | null
  linkedChapterCommitId?: ID | null
  baseChapterVersionId?: ID | null
}
