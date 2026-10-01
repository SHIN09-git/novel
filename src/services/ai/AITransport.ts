import type {
  CancelAiCallResult,
  ChatCompletionRequest,
  ChatCompletionResult
} from '../../shared/ipc/ipcTypes'

export interface AIChatCompletionTransport {
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>
  cancelCall?(runId: string, callId: string): Promise<CancelAiCallResult>
}

export class MissingAITransportBridgeError extends Error {
  constructor() {
    super('AI 桥接未加载，请重新启动应用或检查安装包。')
    this.name = 'MissingAITransportBridgeError'
  }
}

export function createRendererAITransport(): AIChatCompletionTransport {
  return {
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
