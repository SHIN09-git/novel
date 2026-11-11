import type {
  CancelAiCallResult,
  ChatCompletionRequest,
  ChatCompletionResult
} from '../../shared/ipc/ipcTypes'
import type { ProjectUsageContext, UsagePhase } from '../../shared/projectUsage'

export function projectUsageContext(projectId?: string, phase: UsagePhase = 'other'): ProjectUsageContext | undefined {
  return projectId === undefined ? undefined : { projectId, phase }
}

export interface AIChatCompletionTransport {
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  isManagedEndpoint?(baseUrl: string): Promise<boolean>
  cancelCall?(runId: string, callId: string): Promise<CancelAiCallResult>
}

export type AIJsonTransport = Pick<AIChatCompletionTransport, 'chatCompletion' | 'isManagedEndpoint'>

export class MissingAITransportBridgeError extends Error {
  constructor() {
    super('AI 桥接未加载，请重新启动应用或检查安装包。')
    this.name = 'MissingAITransportBridgeError'
  }
}

export function createRendererAITransport(): AIChatCompletionTransport {
  return {
    async isManagedEndpoint(baseUrl) {
      if (typeof window === 'undefined' || !window.novelDirector?.credentials?.hasApiKey) return false
      return Boolean((await window.novelDirector.credentials.hasApiKey(baseUrl)).keyEnv)
    },
    async chatCompletion(request) {
      const bridge = window.novelDirector
      if (!bridge?.ai?.chatCompletion) {
        throw new MissingAITransportBridgeError()
      }

      // Validation anchor: this transport is the single renderer-side call site for window.novelDirector.ai.chatCompletion.
      return bridge.ai.chatCompletion(request)
    },
    async cancelCall(runId, callId) {
      const cancelCall = window.novelDirector?.ai?.cancelCall
      if (!cancelCall) return { ok: true, cancelled: false }
      return cancelCall(runId, callId)
    }
  }
}
