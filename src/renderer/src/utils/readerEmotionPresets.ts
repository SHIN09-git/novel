const STORAGE_PREFIX = 'novel-director.reader-emotions'
const MAX_CUSTOM_PRESETS = 24

export const DEFAULT_READER_EMOTION_PRESETS = [
  '期待、紧张、好奇',
  '压抑、悬疑、不安',
  '爽快、释放、燃',
  '心疼、共情、牵挂',
  '浪漫、暧昧、心动',
  '惊讶、反转、恍然',
  '愤怒、复仇、宣泄',
  '恐惧、窒息、未知',
  '悲伤、失落、余韵',
  '希望、温暖、治愈'
]

export interface ReaderEmotionPresetState {
  presets: string[]
  lastTarget: string
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}.${projectId}`
}

function uniquePresets(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, DEFAULT_READER_EMOTION_PRESETS.length + MAX_CUSTOM_PRESETS)
}

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readStoredState(projectId: string): Partial<ReaderEmotionPresetState> {
  const storage = safeLocalStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(storageKey(projectId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      presets: stringArray(parsed.presets),
      lastTarget: typeof parsed.lastTarget === 'string' ? parsed.lastTarget : ''
    }
  } catch {
    return {}
  }
}

function writeStoredState(projectId: string, state: ReaderEmotionPresetState): void {
  const storage = safeLocalStorage()
  if (!storage) return
  try {
    storage.setItem(storageKey(projectId), JSON.stringify(state))
  } catch {
    // Presets are a convenience layer; generation should keep working even if localStorage is unavailable.
  }
}

export function loadReaderEmotionState(projectId: string): ReaderEmotionPresetState {
  const stored = readStoredState(projectId)
  return {
    presets: uniquePresets([...DEFAULT_READER_EMOTION_PRESETS, ...(stored.presets ?? [])]),
    lastTarget: typeof stored.lastTarget === 'string' ? stored.lastTarget : ''
  }
}

export function rememberReaderEmotionTarget(projectId: string, target: string): ReaderEmotionPresetState {
  const current = loadReaderEmotionState(projectId)
  const lastTarget = target.trim()
  const next = {
    presets: uniquePresets([...current.presets, lastTarget]),
    lastTarget
  }
  writeStoredState(projectId, next)
  return next
}

export function addReaderEmotionPreset(projectId: string, preset: string): ReaderEmotionPresetState {
  return rememberReaderEmotionTarget(projectId, preset)
}
