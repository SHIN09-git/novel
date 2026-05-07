const STORAGE_PREFIX = 'novel-director.reader-emotions'

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
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function readStoredState(projectId: string): Partial<ReaderEmotionPresetState> {
  if (typeof window === 'undefined' || !window.localStorage) return {}
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<ReaderEmotionPresetState>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStoredState(projectId: string, state: ReaderEmotionPresetState): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(state))
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
