import { useMemo, useRef, useState } from 'react'
import type { ID, StateFactCategory } from '../../../../shared/types'
import type { CharacterStateFactDraft } from '../../../../services/CharacterStateService'
import type { SaveDataOutcome } from '../../utils/saveDataState'
import type { CharacterLogSaveMode } from './CharacterStateLogPanel'
import { STATE_TEMPLATES } from './characterStateUi'

interface CharacterForms {
  fact: { template: string; category: StateFactCategory; label: string; value: string }
  log: { note: string; chapter: number | null; mode: CharacterLogSaveMode }
  conversion: { logId: ID | null; draft: CharacterStateFactDraft | null }
}

type FormKind = keyof CharacterForms
interface CharacterDraftEntry {
  forms: CharacterForms
  saving: Partial<Record<FormKind, boolean>>
  messages: Partial<Record<FormKind, string>>
}

// These are unsubmitted, page-local inputs, not character facts or persisted memory.
export function useCharacterWorkspaceDraft(projectId: ID, characterId: ID | null, chapterOrder: number | null) {
  const key = JSON.stringify([projectId, characterId])
  const fallback = useMemo<CharacterDraftEntry>(() => ({
    forms: {
      fact: { template: STATE_TEMPLATES[0].key, category: STATE_TEMPLATES[0].category, label: STATE_TEMPLATES[0].label, value: '' },
      log: { note: '', chapter: chapterOrder, mode: 'log_only' },
      conversion: { logId: null, draft: null }
    },
    saving: {}, messages: {}
  }), [key, chapterOrder])
  const [entries, setEntries] = useState<Record<string, CharacterDraftEntry>>({})
  const pending = useRef(new Set<string>())
  const entry = entries[key] ?? fallback

  function update<K extends FormKind>(kind: K, change: (previous: CharacterForms[K]) => CharacterForms[K]) {
    setEntries((current) => {
      const previous = current[key] ?? fallback
      return { ...current, [key]: { ...previous,
        forms: { ...previous.forms, [kind]: change(previous.forms[kind]) },
        messages: { ...previous.messages, [kind]: '' }
      } }
    })
  }

  async function save<K extends FormKind>(
    kind: K,
    operation: () => Promise<SaveDataOutcome>,
    clear: (submitted: CharacterForms[K]) => CharacterForms[K],
    successMessage: string
  ) {
    const operationKey = JSON.stringify([key, kind])
    if (pending.current.has(operationKey)) return
    pending.current.add(operationKey)
    const submitted = entry.forms[kind]
    setEntries((current) => {
      const previous = current[key] ?? entry
      return { ...current, [key]: { ...previous, saving: { ...previous.saving, [kind]: true },
        messages: { ...previous.messages, [kind]: '保存中…' } } }
    })
    let outcome: SaveDataOutcome
    try {
      outcome = await operation()
    } catch {
      outcome = { ok: false, errorMessage: '保存失败' }
    } finally {
      pending.current.delete(operationKey)
    }
    setEntries((current) => {
      const previous = current[key] ?? entry
      // Scope and object identity protect later edits, including A -> B -> A navigation.
      const unchanged = previous.forms[kind] === submitted
      return { ...current, [key]: { ...previous,
        forms: outcome.ok && unchanged ? { ...previous.forms, [kind]: clear(submitted) } : previous.forms,
        saving: { ...previous.saving, [kind]: false },
        messages: { ...previous.messages, [kind]: outcome.ok
          ? unchanged ? successMessage : '上一笔已保存，当前输入尚未保存。'
          : '保存失败，输入已保留，请重试。' }
      } }
    })
  }

  return { ...entry, key, update, save }
}
