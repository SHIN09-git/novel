import type {
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsEvaluateQualityGateRequest
} from '../../shared/ipc/ipcTypes'
import type { RedundancyReport, NoveltyAuditResult, QualityGateReport } from '../../shared/types'
import type { IAIService } from './AIService'

export class DiagnosticsService {
  constructor(private readonly aiTransport: IAIService) {}

  async analyzeRedundancy(request: DiagnosticsAnalyzeRedundancyRequest): Promise<RedundancyReport> {
    const { analyzeRedundancy } = await import('../../services/RedundancyService')
    return analyzeRedundancy(request)
  }

  async auditNovelty(request: DiagnosticsAuditNoveltyRequest): Promise<NoveltyAuditResult> {
    const { NoveltyDetector } = await import('../../services/NoveltyDetector')
    return NoveltyDetector.audit(request)
  }

  evaluateQualityGate(request: DiagnosticsEvaluateQualityGateRequest): Promise<QualityGateReport> {
    return this.evaluateQualityGateLazy(request)
  }

  private async evaluateQualityGateLazy(request: DiagnosticsEvaluateQualityGateRequest): Promise<QualityGateReport> {
    const [{ QualityGateService }, { QualityGateAI }, { MainAIJsonClient }] = await Promise.all([
      import('../../services/QualityGateService'),
      import('../../services/ai/QualityGateAI'),
      import('./MainAIJsonClient')
    ])
    const aiClient = new MainAIJsonClient(request.settings, this.aiTransport, request.runId)
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
        noveltyAuditResult: request.noveltyAuditResult ?? null,
        redundancyReport: request.redundancyReport ?? null,
        characterStateFacts: request.characterStateFacts,
        characters: request.characters ?? [],
        promptContextSnapshotId: request.promptContextSnapshotId ?? null,
        contextSource: request.contextSource,
        targetChapterOrder: request.targetChapterOrder,
        hasAuthoritativeChapterTask: request.hasAuthoritativeChapterTask,
        chapterTask: request.chapterTask ?? null,
        aiService: qualityGateAI
      })
  }
}
