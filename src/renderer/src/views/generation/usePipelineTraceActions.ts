import type {
  AppData,
  ConsistencyReviewReport,
  GenerationRunTrace,
  QualityGateReport
} from '../../../../shared/types'
import { getNovelDirectorClipboardApi } from '../../platform/novelDirectorBridge'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { buildRunTraceSummary } from './runTraceSummary'

interface UsePipelineTraceActionsArgs {
  consistencyReport: ConsistencyReviewReport | null
  qualityReport: QualityGateReport | null
  saveData: SaveDataHandler
  setPipelineMessage: (message: string) => void
}

export function usePipelineTraceActions({
  consistencyReport,
  qualityReport,
  saveData,
  setPipelineMessage
}: UsePipelineTraceActionsArgs) {
  async function copyRunTrace(trace: GenerationRunTrace) {
    await getNovelDirectorClipboardApi().writeText(JSON.stringify(buildRunTraceSummary(trace, consistencyReport, qualityReport), null, 2))
    setPipelineMessage('已复制生成追踪摘要。')
  }

  async function generateAuthorSummary(trace: GenerationRunTrace) {
    const { buildRunTraceAuthorSummary, upsertRunTraceAuthorSummaryToAppData } = await import(
      '../../../../services/RunTraceAuthorSummaryService'
    )
    const saved = await saveData((current: AppData) => {
      const summary = buildRunTraceAuthorSummary(current, { traceId: trace.id })
      return upsertRunTraceAuthorSummaryToAppData(current, summary)
    })
    if (!saved.ok) {
      setPipelineMessage(`诊断摘要保存失败：${saved.errorMessage}`)
      return
    }
    setPipelineMessage('已生成章节诊断摘要。')
  }

  return {
    copyRunTrace,
    generateAuthorSummary
  }
}
