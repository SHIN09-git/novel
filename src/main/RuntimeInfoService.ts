import type { RuntimeInfo, RuntimeMode } from '../shared/runtimeInfo'

export interface RuntimeInfoSource {
  version: string
  buildTime: string
  electronVersion: string
  execPath: string
  isPackaged: boolean
  rendererUrl?: string
}

export function resolveRuntimeMode(source: Pick<RuntimeInfoSource, 'isPackaged' | 'rendererUrl'>): RuntimeMode {
  if (source.isPackaged) return 'packaged'
  return source.rendererUrl ? 'development' : 'preview'
}

export function collectRuntimeInfo(source: RuntimeInfoSource): RuntimeInfo {
  return {
    version: source.version || 'unknown',
    buildTime: source.buildTime || 'unknown',
    electronVersion: source.electronVersion || 'unknown',
    execPath: source.execPath || 'unknown',
    mode: resolveRuntimeMode(source)
  }
}

export function formatRuntimeMode(mode: RuntimeMode): string {
  if (mode === 'development') return '开发模式'
  if (mode === 'preview') return '预览模式'
  return '桌面发行版'
}

declare const __NOVEL_DIRECTOR_BUILD_TIME__: string

export function collectCurrentRuntimeInfo(appState: { getVersion: () => string; isPackaged: boolean }): RuntimeInfo {
  return collectRuntimeInfo({
    version: appState.getVersion(),
    buildTime: typeof __NOVEL_DIRECTOR_BUILD_TIME__ === 'string' ? __NOVEL_DIRECTOR_BUILD_TIME__ : 'unknown',
    electronVersion: process.versions.electron ?? 'unknown',
    execPath: process.execPath,
    isPackaged: appState.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL
  })
}
