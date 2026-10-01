import { getAiCallModelLabel, getAiCallProgressCopy, formatAiCallElapsed } from './aiCallProgressModel'
import { useAiCallProgress } from './useAiCallProgress'
import './AiCallProgress.css'

interface AiCallProgressProps {
  isRunning: boolean
  runId?: string | null
  callId?: string | null
  startedAt?: string | null
}

export function AiCallProgress({ isRunning, runId, callId, startedAt }: AiCallProgressProps) {
  const { progress, elapsedMs } = useAiCallProgress({ isRunning, runId, callId, startedAt })
  const copy = getAiCallProgressCopy(progress)
  const modelLabel = getAiCallModelLabel(progress)

  return (
    <div className="ai-call-progress" data-ai-call-progress data-running={isRunning || undefined}>
      <div className="ai-call-progress-primary">
        <strong>{copy.label}</strong>
        <span>已耗时 {formatAiCallElapsed(elapsedMs)}</span>
        <span>{modelLabel ? `模型：${modelLabel}` : '模型信息待服务提供'}</span>
      </div>
      <small>{copy.detail}</small>
    </div>
  )
}
