import type { AppData, QuickRewriteDraft, QuickRewriteTarget } from '../../../shared/types'
import { getQuickRewriteDraft, quickRewriteTargetKey, removeQuickRewriteDraft, upsertQuickRewriteDraft } from '../../../services/QuickRewriteDraftService'
import type { SaveDataHandler } from '../utils/saveDataState'

interface PendingWrite {
  target: QuickRewriteTarget
  draft: QuickRewriteDraft | null
  retainedDraft: QuickRewriteDraft | null
  error: string | null
}

// Overlay survives view changes. The existing full/bundle save queue remains the only writer.
export function createQuickRewriteDraftStore(getData: () => AppData, save: SaveDataHandler) {
  const pending = new Map<string, PendingWrite>()
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let active: Promise<void> | null = null
  const notify = () => { for (const listener of listeners) listener() }
  const cancelTimer = () => { if (timer) clearTimeout(timer); timer = null }

  function flush(): Promise<void> {
    cancelTimer()
    if (active) return active
    active = (async () => {
      for (;;) {
        const selected = [...pending.entries()].find(([, item]) => !item.error)
        if (!selected) return
        const [key, entry] = selected
        let error: string | null = null
        try {
          const outcome = await save((data) => entry.draft
            ? upsertQuickRewriteDraft(data, entry.draft) : removeQuickRewriteDraft(data, entry.target))
          if (!outcome.ok) error = outcome.errorMessage
        } catch { error = '候选暂存失败，请检查本地保存状态后重试。' }
        // A late write may never acknowledge or erase a newer edit.
        if (pending.get(key) === entry) {
          if (error) entry.error = error
          else pending.delete(key)
        }
        notify()
      }
    })().finally(() => { active = null })
    return active
  }

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    read(target: QuickRewriteTarget) {
      const entry = pending.get(quickRewriteTargetKey(target))
      return entry ? entry.error ? entry.draft ?? entry.retainedDraft : entry.draft : getQuickRewriteDraft(getData(), target)
    },
    status(target: QuickRewriteTarget): 'saving' | 'failed' | 'saved' {
      const entry = pending.get(quickRewriteTargetKey(target))
      return entry ? entry.error ? 'failed' : 'saving' : 'saved'
    },
    write(target: QuickRewriteTarget, draft: QuickRewriteDraft | null, immediate = false) {
      const key = quickRewriteTargetKey(target)
      const previous = pending.get(key)
      const retainedDraft = draft ?? previous?.draft ?? previous?.retainedDraft ?? getQuickRewriteDraft(getData(), target)
      pending.set(key, { target, draft, retainedDraft, error: null })
      notify()
      cancelTimer()
      if (immediate) void flush()
      else timer = setTimeout(() => void flush(), 300)
    },
    retry(target: QuickRewriteTarget) {
      const entry = pending.get(quickRewriteTargetKey(target))
      if (entry) entry.error = null
      notify()
      return flush()
    },
    hasPending: () => pending.size > 0,
    flush,
    dispose() { cancelTimer(); listeners.clear() }
  }
}

export type QuickRewriteDraftStore = ReturnType<typeof createQuickRewriteDraftStore>
