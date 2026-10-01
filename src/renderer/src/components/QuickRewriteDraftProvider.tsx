import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppData } from '../../../shared/types'
import { resolveSaveDataInput, type SaveDataHandler } from '../utils/saveDataState'
import { createQuickRewriteDraftStore, type QuickRewriteDraftStore } from './quickRewriteDraftStore'

const Context = createContext<{ store: QuickRewriteDraftStore; revision: number } | null>(null)

export function QuickRewriteDraftProvider({ getCurrentData, saveData, isCurrentStorage, children }: {
  getCurrentData: () => AppData; saveData: SaveDataHandler; isCurrentStorage: () => boolean; children: ReactNode
}) {
  const latest = useRef({ getCurrentData, saveData, isCurrentStorage })
  latest.current = { getCurrentData, saveData, isCurrentStorage }
  const [store] = useState(() => createQuickRewriteDraftStore(() => latest.current.getCurrentData(), (input) => latest.current.saveData((data) => {
    if (!latest.current.isCurrentStorage()) throw new Error('保存位置已变化，原位置的候选未写入新位置。')
    return resolveSaveDataInput(data, input)
  })))
  const [revision, setRevision] = useState(0)
  useEffect(() => store.subscribe(() => setRevision((value) => value + 1)), [store])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.hasPending()) return
      void store.flush()
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('beforeunload', beforeUnload); store.dispose() }
  }, [store])
  return <Context.Provider value={{ store, revision }}>{children}</Context.Provider>
}

export function useQuickRewriteDraftStore() { return useContext(Context)?.store ?? null }
