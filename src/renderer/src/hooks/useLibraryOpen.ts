import { useEffect, useRef, useState } from 'react'
import { getUserFriendlyError } from '../../../shared/errorUtils'
import type { LibraryRecoveryAction, StorageGetResult } from '../../../shared/ipc/ipcTypes'
import { getNovelDirectorBridge, getNovelDirectorDataApi } from '../platform/novelDirectorBridge'

export interface LibraryRecoveryState {
  error: string
  pending: LibraryRecoveryAction | 'loading' | null
  feedback: string
}

type OpenSession = { phase: 'initial' | 'unavailable' | 'recovering' | 'ready' }

export function useLibraryOpen(onLoaded: (result: StorageGetResult) => void, onUnavailable: () => void) {
  const [recovery, setRecovery] = useState<LibraryRecoveryState | null>(null)
  const mounted = useRef(false)
  const current = useRef<OpenSession>({ phase: 'initial' })
  const session = current.current
  const isCurrent = () => mounted.current && current.current === session

  function blockLibrary(error: unknown) {
    if (!isCurrent()) return
    // Invalidate callbacks and queued writes captured for the previous library.
    current.current = { phase: 'unavailable' }
    onUnavailable()
    setRecovery({ error: getUserFriendlyError(error), pending: null, feedback: '' })
  }

  async function openLibrary() {
    const loaded = await getNovelDirectorDataApi().load()
    if (!isCurrent()) return
    onLoaded(loaded)
    session.phase = 'ready'
    setRecovery(null)
  }

  useEffect(() => {
    mounted.current = true
    let active = true
    // StrictMode can restart this effect before the first IPC read should begin.
    queueMicrotask(() => {
      if (active) void openLibrary().catch(blockLibrary)
    })
    return () => {
      active = false
      mounted.current = false
    }
  }, [])

  async function recoverLibrary(action: LibraryRecoveryAction) {
    if (!recovery || !isCurrent() || session.phase !== 'unavailable') return
    session.phase = 'recovering'
    setRecovery({ ...recovery, pending: action, feedback: '' })
    let feedback = '已取消。'
    try {
      const app = getNovelDirectorBridge().app
      if (typeof app?.recoverLibrary !== 'function') throw new Error('书库恢复功能未加载，请重新启动应用。')
      const result = await app.recoverLibrary(action)
      if (isCurrent() && !result.cancelled) {
        setRecovery({ ...recovery, pending: 'loading', feedback: '' })
        await openLibrary()
      }
    } catch (error) {
      feedback = `本次操作失败：${getUserFriendlyError(error)}`
    } finally {
      if (isCurrent() && session.phase === 'recovering') {
        session.phase = 'unavailable'
        setRecovery({ ...recovery, pending: null, feedback })
      }
    }
  }

  function assertLibraryAccess(mode: 'read' | 'write') {
    // The synchronous getter can be polled during the initial load, but not after a failed open.
    if (isCurrent() && (session.phase === 'ready' || (mode === 'read' && session.phase === 'initial'))) return
    throw new Error('书库未打开。')
  }

  return { recovery, recoverLibrary, blockLibrary, assertLibraryAccess }
}
