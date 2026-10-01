import type { RuntimeInfo } from '../../../shared/runtimeInfo'

export interface RuntimeInfoBridge {
  app?: {
    getRuntimeInfo?: () => Promise<RuntimeInfo>
  }
}

export async function loadRuntimeInfo(bridge: RuntimeInfoBridge | undefined): Promise<RuntimeInfo | null> {
  const getRuntimeInfo = bridge?.app?.getRuntimeInfo
  if (typeof getRuntimeInfo !== 'function') return null
  return getRuntimeInfo()
}
