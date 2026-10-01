import type {
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsEvaluateQualityGateRequest
} from '../../../shared/ipc/ipcTypes'
import type { NoveltyAuditResult, QualityGateReport, RedundancyReport } from '../../../shared/types'
import { getNovelDirectorDiagnosticsApi } from '../platform/novelDirectorBridge'

export async function analyzeRedundancyDiagnostic(request: DiagnosticsAnalyzeRedundancyRequest): Promise<RedundancyReport> {
  return getNovelDirectorDiagnosticsApi().analyzeRedundancy(request)
}

export async function auditNoveltyDiagnostic(request: DiagnosticsAuditNoveltyRequest): Promise<NoveltyAuditResult> {
  return getNovelDirectorDiagnosticsApi().auditNovelty(request)
}

export async function evaluateQualityGateDiagnostic(request: DiagnosticsEvaluateQualityGateRequest): Promise<QualityGateReport> {
  return getNovelDirectorDiagnosticsApi().evaluateQualityGate(request)
}
