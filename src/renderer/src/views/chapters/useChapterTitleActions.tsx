import { useRef, useState } from 'react'
import { ListOrdered } from 'lucide-react'
import type { Chapter } from '../../../../shared/types'
import type { RunPersistedStorageOperation, SaveDataOutcome } from '../../utils/saveDataState'
import { ChapterTitleDialog } from './ChapterTitleDialog'

/** A failed field stays pending until that same field has actually been saved. */
function useChapterFormSaves() {
  const outstanding = useRef(new Map<string, symbol>())
  const [unsaved, setUnsaved] = useState(false)
  async function track<T extends SaveDataOutcome | undefined>(keys: string[], save: () => Promise<T>) {
    const token = Symbol()
    for (const key of keys) outstanding.current.set(key, token)
    setUnsaved(true)
    const result = await save()
    if (result?.ok) {
      for (const key of keys) if (outstanding.current.get(key) === token) outstanding.current.delete(key)
      setUnsaved(outstanding.current.size !== 0)
    }
    return result
  }
  return { unsaved, track }
}

export function useChapterTitleActions({ projectId, chapters, run, storageBlocked, editorBusy, onMessage }: {
  projectId: string; chapters: Chapter[]; run?: RunPersistedStorageOperation
  storageBlocked?: boolean; editorBusy: boolean; onMessage: (message: string) => void
}) {
  const [target, setTarget] = useState<{ singleId: string | null } | null>(null)
  const forms = useChapterFormSaves()
  const blocked = !run ? '当前环境不能提交正式章名。'
    : storageBlocked ? '请先处理数据冲突或未确认的写回。'
    : editorBusy || forms.unsaved ? '请先完成当前章节表单的保存，再更改章名。' : ''
  return {
    blocked, track: forms.track, openSingle: (id: string) => setTarget({ singleId: id }),
    batchButton: <button type="button" className="ghost-button" disabled={!chapters.length || Boolean(blocked)}
      title={blocked || '批量更改章名'} onClick={() => setTarget({ singleId: null })}><ListOrdered size={15} />批量更改章名</button>,
    dialog: target && run && <ChapterTitleDialog projectId={projectId} chapters={chapters} singleId={target.singleId}
      blocked={Boolean(blocked)} run={run} onClose={message => { setTarget(null); if (message) onMessage(message) }} />
  }
}
