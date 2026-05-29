import type {
  DiagnosticsAnalyzeRedundancyRequest,
  DiagnosticsAuditNoveltyRequest,
  DiagnosticsEvaluateQualityGateRequest
} from '../../../shared/ipc/ipcTypes'
import type { NoveltyAuditResult, QualityGateReport, RedundancyReport } from '../../../shared/types'

function missingDiagnosticsApi(method: string): never {
  throw new Error(`诊断服务不可用：preload 未暴露 window.novelDirector.diagnostics.${method}。请重启应用或重新安装当前版本。`)
}

export async function analyzeRedundancyDiagnostic(request: DiagnosticsAnalyzeRedundancyRequest): Promise<RedundancyReport> {
  const api = window.novelDirector?.diagnostics?.analyzeRedundancy
  if (api) return api(request)
  return missingDiagnosticsApi('analyzeRedundancy')
}

export async function auditNoveltyDiagnostic(request: DiagnosticsAuditNoveltyRequest): Promise<NoveltyAuditResult> {
  const api = window.novelDirector?.diagnostics?.auditNovelty
  if (api) return api(request)
  return missingDiagnosticsApi('auditNovelty')
}

export async function evaluateQualityGateDiagnostic(request: DiagnosticsEvaluateQualityGateRequest): Promise<QualityGateReport> {
  const api = window.novelDirector?.diagnostics?.evaluateQualityGate
  if (api) return api(request)
  return missingDiagnosticsApi('evaluateQualityGate')
}
