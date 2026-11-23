import type { ApiRegistry } from '../main/services/ApiRegistry'
import { redactSensitiveText } from '../shared/errorUtils'
import type { ApiProvider } from '../shared/types/base'

const http = 'compatible' satisfies ApiProvider
const cli = 'codex_cli' satisfies ApiProvider

export type ResolvedAgentModelChannel =
  | { id: string; apiProvider: typeof http; baseUrl: string; modelName: string }
  | { id: string; apiProvider: typeof cli }

export type AgentModelChannel =
  | { registryServiceId: string; provider: typeof http; model: string }
  | { registryServiceId: string; provider: typeof cli; model: null }

function validId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id) &&
    id !== 'prototype' && !Object.hasOwn(Object.prototype, id) &&
    !/^[A-Z][A-Z0-9_]*_API_KEY$/.test(id) && redactSensitiveText(id) === id
}

function channelIndex(registry: ApiRegistry): Map<string, ResolvedAgentModelChannel | null> {
  const channels = new Map<string, ResolvedAgentModelChannel | null>([[cli, { id: cli, apiProvider: cli }]])
  for (const route of registry.values()) {
    const { id } = route
    // A registry service cannot claim the built-in local login ID.
    if (id === cli) {
      channels.set(cli, null)
    } else if (!channels.has(id) && validId(id)) {
      const chat = route.agentChat
      channels.set(id, chat ? { id, apiProvider: http, baseUrl: chat.baseUrl, modelName: chat.modelName } : null)
    }
  }
  return channels
}

export function listAgentModelChannels(registry: ApiRegistry): { channels: AgentModelChannel[] } {
  const channels: AgentModelChannel[] = []
  for (const channel of channelIndex(registry).values()) {
    if (channel?.apiProvider === http) {
      channels.push({ registryServiceId: channel.id, provider: http, model: channel.modelName })
    } else if (channel?.apiProvider === cli) {
      channels.push({ registryServiceId: channel.id, provider: cli, model: null })
    }
  }
  return { channels }
}

export function resolveAgentModelChannel(registry: ApiRegistry, id: string): ResolvedAgentModelChannel {
  if (!validId(id)) throw new Error('模型通道 ID 无效或属于保留名称。')
  const channel = channelIndex(registry).get(id)
  if (channel === undefined) throw new Error('未知的模型通道 ID。')
  if (channel === null) {
    if (id === cli) throw new Error('codex_cli 是本机登录的保留 ID，不能作为 HTTP 服务 ID。')
    throw new Error('该服务未配置标准的聊天补全接口或有效的默认模型。')
  }
  return channel
}
