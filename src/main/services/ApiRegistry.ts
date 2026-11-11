import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface ApiRoute {
  id: string
  keyEnv: string
  backupKeyEnv?: string
  legacyDesktopKey: boolean
}

export type ApiRegistry = ReadonlyMap<string, ApiRoute>

export function apiEndpoint(value: string): string {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return ''
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readApiRegistry(): Promise<ApiRegistry> {
  const path = process.env.NOVEL_DIRECTOR_API_REGISTRY || join(homedir(), '.config', 'ai', 'api-registry.json')
  const routes = new Map<string, ApiRoute>()
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return routes
    throw new Error(`无法读取 API 清单 ${path}`)
  }
  let config: unknown
  try {
    config = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`API 清单不是有效的 JSON：${path}`)
  }
  if (!isRecord(config) || config.version !== 1 || !isRecord(config.apis)) {
    throw new Error('API 清单需要 version: 1 和 apis 对象。')
  }
  if (config.desktopSavedKeyFor != null &&
      (typeof config.desktopSavedKeyFor !== 'string' || !Object.hasOwn(config.apis, config.desktopSavedKeyFor))) {
    throw new Error('desktopSavedKeyFor 必须是清单中的一个服务 ID。')
  }
  for (const [id, item] of Object.entries(config.apis)) {
    const keyName = /^[A-Z][A-Z0-9_]*_API_KEY$/
    if (!isRecord(item) || typeof item.baseUrl !== 'string' || typeof item.keyEnv !== 'string' ||
        !keyName.test(item.keyEnv) || (item.aliases !== undefined && !Array.isArray(item.aliases)) ||
        (item.backupKeyEnv !== undefined && (typeof item.backupKeyEnv !== 'string' ||
          !keyName.test(item.backupKeyEnv) || item.backupKeyEnv === item.keyEnv))) {
      throw new Error(`请检查 API 清单中 ${id} 的 baseUrl、keyEnv、backupKeyEnv 和 aliases。`)
    }
    const route: ApiRoute = { id, keyEnv: item.keyEnv, backupKeyEnv: item.backupKeyEnv, legacyDesktopKey: id === config.desktopSavedKeyFor }
    const base = apiEndpoint(item.baseUrl)
    for (const address of [item.baseUrl, ...(item.aliases ?? [])]) {
      const endpoint = typeof address === 'string' ? apiEndpoint(address) : ''
      const url = endpoint ? new URL(endpoint) : undefined
      if (!base || !url || url.origin !== new URL(base).origin ||
          (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) || routes.has(endpoint)) {
        throw new Error(`API 清单中 ${id} 的服务地址无效或重复。别名必须属于同一来源。`)
      }
      routes.set(endpoint, route)
    }
  }
  return routes
}

export function sameApiEndpoint(registry: ApiRegistry, left: string, right: string): boolean {
  const a = apiEndpoint(left)
  const b = apiEndpoint(right)
  return Boolean(a && b && (a === b || (registry.has(a) && registry.get(a) === registry.get(b))))
}

export function routeKey(route: ApiRoute): string {
  return process.env[route.keyEnv]?.trim() || (route.backupKeyEnv && process.env[route.backupKeyEnv]?.trim()) || ''
}

export function backupKeyAfterRejection(registry: ApiRegistry, baseUrl: string, rejected: string): string {
  const route = registry.get(apiEndpoint(baseUrl))
  if (!route?.backupKeyEnv || !rejected || process.env[route.keyEnv]?.trim() !== rejected) return ''
  const backup = process.env[route.backupKeyEnv]?.trim()
  return backup && backup !== rejected ? backup : ''
}

export function agentApiKey(registry: ApiRegistry, baseUrl: string, defaultBaseUrl: string): string {
  const route = registry.get(apiEndpoint(baseUrl))
  if (route) return routeKey(route)
  if (registry.size && !sameApiEndpoint(registry, baseUrl, defaultBaseUrl)) return ''
  return process.env.NOVEL_DIRECTOR_API_KEY?.trim() ?? ''
}
