import type {
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsEvaluateQualityGateRequest
} from '../../shared/ipc/ipcTypes'
import type { RedundancyReport, NoveltyAuditResult, QualityGateReport } from '../../shared/types'
import { analyzeRedundancy } from '../../services/RedundancyService'
import { NoveltyDetector } from '../../services/NoveltyDetector'
import { QualityGateService } from '../../services/QualityGateService'
import { QualityGateAI } from '../../services/ai/QualityGateAI'
import type { IAIService } from './AIService'
import { MainAIJsonClient } from './MainAIJsonClient'

export class DiagnosticsService {
  constructor(private readonly aiTransport: IAIService) {}

  analyzeRedundancy(request: DiagnosticsAnalyzeRedundancyRequest): RedundancyReport {
    return analyzeRedundancy(request)
  }

  auditNovelty(request: DiagnosticsAuditNoveltyRequest): NoveltyAuditResult {
    return NoveltyDetector.audit(request)
  }

  evaluateQualityGate(request: DiagnosticsEvaluateQualityGateRequest): Promise<QualityGateReport> {
    const aiClient = new MainAIJsonClient(request.settings, this.aiTransport)
    const qualityGateAI = new QualityGateAI(aiClient)
    return QualityGateService.evaluateChapterDraft({
      projectId: request.projectId,
      jobId: request.jobId,
      chapterId: request.chapterId,
      draftId: request.draftId,
      chapterDraft: request.chapterDraft,
      context: request.context,
      chapterPlan: request.chapterPlan,
      consistencyReports: request.consistencyReports ?? [],
      promptContextSnapshotId: request.promptContextSnapshotId ?? null,
      contextSource: request.contextSource,
      aiService: qualityGateAI
    })
  }
}
