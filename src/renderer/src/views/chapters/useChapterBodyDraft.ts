import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData, Chapter, ID } from '../../../../shared/types'
import { now } from '../../utils/format'
import type { SaveDataHandler } from '../../utils/saveDataState'
import { updateProjectTimestamp } from '../viewTypes'
import { decideChapterBodySync, type ChapterBodySaveStatus } from './chapterBodyDraftModel'

export interface ChapterBodyConflict {
  chapterId: ID
  externalBody: string
  localBody: string
}

interface UseChapterBodyDraftInput {
  selected: Chapter | null
  projectId: ID
  saveData: SaveDataHandler
  onStatusMessage: (message: string) => void
  delayMs?: number
}

interface DraftStateRef {
  chapterId: ID | null
  baseBody: string
  draftBody: string
  dirty: boolean
}

function updateChapterBody(current: AppData, projectId: ID, chapterId: ID, body: string): AppData {
  const timestamp = now()
  return {
    ...current,
    projects: updateProjectTimestamp(current, projectId),
    chapters: current.chapters.map((chapter) =>
      chapter.id === chapterId ? { ...chapter, body, updatedAt: timestamp } : chapter
    )
  }
}

export function useChapterBodyDraft({
  selected,
  projectId,
  saveData,
  onStatusMessage,
  delayMs = 500
}: UseChapterBodyDraftInput) {
  const [bodyDraft, setBodyDraftState] = useState(selected?.body ?? '')
  const [saveStatus, setSaveStatus] = useState<ChapterBodySaveStatus>('saved')
  const [conflict, setConflict] = useState<ChapterBodyConflict | null>(null)
  const stateRef = useRef<DraftStateRef>({
    chapterId: selected?.id ?? null,
    baseBody: selected?.body ?? '',
    draftBody: selected?.body ?? '',
    dirty: false
  })
  const conflictRef = useRef<ChapterBodyConflict | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveDataRef = useRef(saveData)
  const projectIdRef = useRef(projectId)
  const onStatusMessageRef = useRef(onStatusMessage)
  const mountedRef = useRef(true)

  saveDataRef.current = saveData
  projectIdRef.current = projectId
  onStatusMessageRef.current = onStatusMessage

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const presentConflict = useCallback((chapterId: ID, externalBody: string) => {
    clearTimer()
    const nextConflict = {
      chapterId,
      externalBody,
      localBody: stateRef.current.draftBody
    }
    conflictRef.current = nextConflict
    if (mountedRef.current) {
      setConflict(nextConflict)
      setSaveStatus('conflict')
      onStatusMessageRef.current('当前章节正文已被其他流程更新。请选择使用最新正文，或明确保留本地编辑。')
    }
  }, [clearTimer])

  const persistBody = useCallback(async (chapterId: ID, body: string): Promise<boolean> => {
    clearTimer()
    const expectedBaseBody = stateRef.current.baseBody
    let externalBody: string | null = null
    if (mountedRef.current) setSaveStatus('saving')

    const result = await saveDataRef.current((current) => {
      const currentChapter = current.chapters.find((chapter) => chapter.id === chapterId)
      if (!currentChapter) throw new Error('当前章节已不存在，无法保存正文。')
      if (currentChapter.body !== expectedBaseBody && currentChapter.body !== body) {
        externalBody = currentChapter.body
        throw new Error('章节正文已被其他流程更新。')
      }
      return updateChapterBody(current, projectIdRef.current, chapterId, body)
    })

    if (!result.ok) {
      if (stateRef.current.chapterId === chapterId) stateRef.current.dirty = true
      if (externalBody !== null) {
        if (stateRef.current.chapterId === chapterId) presentConflict(chapterId, externalBody)
      } else if (mountedRef.current && stateRef.current.chapterId === chapterId) {
        setSaveStatus('error')
        onStatusMessageRef.current(`正文保存失败：${result.errorMessage}`)
      }
      return false
    }

    if (stateRef.current.chapterId !== chapterId) return true
    stateRef.current.baseBody = body
    if (stateRef.current.draftBody === body) {
      stateRef.current.dirty = false
      conflictRef.current = null
      if (mountedRef.current) {
        setConflict(null)
        setSaveStatus('saved')
      }
    } else if (mountedRef.current) {
      stateRef.current.dirty = true
      setSaveStatus('dirty')
    }
    return true
  }, [clearTimer, presentConflict])

  const scheduleSave = useCallback((chapterId: ID, body: string) => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (conflictRef.current || stateRef.current.chapterId !== chapterId || stateRef.current.draftBody !== body) return
      void persistBody(chapterId, body)
    }, delayMs)
  }, [clearTimer, delayMs, persistBody])

  const updateBodyDraft = useCallback((body: string) => {
    const state = stateRef.current
    state.draftBody = body
    state.dirty = body !== state.baseBody
    setBodyDraftState(body)

    if (conflictRef.current) {
      const nextConflict = { ...conflictRef.current, localBody: body }
      conflictRef.current = nextConflict
      setConflict(nextConflict)
      setSaveStatus('conflict')
      return
    }
    if (!state.dirty || !state.chapterId) {
      clearTimer()
      setSaveStatus('saved')
      return
    }
    setSaveStatus('dirty')
    scheduleSave(state.chapterId, body)
  }, [clearTimer, scheduleSave])

  const flushBody = useCallback(async (): Promise<boolean> => {
    const state = stateRef.current
    if (conflictRef.current) {
      onStatusMessageRef.current('请先处理正文版本冲突，再继续当前操作。')
      return false
    }
    if (!state.chapterId || !state.dirty) return true
    return persistBody(state.chapterId, state.draftBody)
  }, [persistBody])

  const useExternalBody = useCallback(() => {
    const currentConflict = conflictRef.current
    if (!currentConflict) return
    clearTimer()
    stateRef.current = {
      chapterId: currentConflict.chapterId,
      baseBody: currentConflict.externalBody,
      draftBody: currentConflict.externalBody,
      dirty: false
    }
    conflictRef.current = null
    setBodyDraftState(currentConflict.externalBody)
    setConflict(null)
    setSaveStatus('saved')
    onStatusMessageRef.current('已载入其他流程保存的最新正文。')
  }, [clearTimer])

  const keepLocalBody = useCallback(async (): Promise<boolean> => {
    const currentConflict = conflictRef.current
    if (!currentConflict) return true
    stateRef.current.baseBody = currentConflict.externalBody
    stateRef.current.dirty = stateRef.current.draftBody !== currentConflict.externalBody
    conflictRef.current = null
    setConflict(null)
    return persistBody(currentConflict.chapterId, stateRef.current.draftBody)
  }, [persistBody])

  const replaceWithPersistedBody = useCallback((body: string) => {
    clearTimer()
    stateRef.current.baseBody = body
    stateRef.current.draftBody = body
    stateRef.current.dirty = false
    conflictRef.current = null
    setBodyDraftState(body)
    setConflict(null)
    setSaveStatus('saved')
  }, [clearTimer])

  useEffect(() => {
    const incomingId = selected?.id ?? null
    const incomingBody = selected?.body ?? ''
    const state = stateRef.current
    if (state.chapterId !== incomingId) {
      clearTimer()
      stateRef.current = { chapterId: incomingId, baseBody: incomingBody, draftBody: incomingBody, dirty: false }
      conflictRef.current = null
      setBodyDraftState(incomingBody)
      setConflict(null)
      setSaveStatus('saved')
      return
    }
    if (!incomingId) return

    const decision = decideChapterBodySync({
      incomingBody,
      baseBody: state.baseBody,
      draftBody: state.draftBody,
      dirty: state.dirty
    })
    if (decision === 'acknowledge-save') {
      state.baseBody = incomingBody
      state.dirty = false
      conflictRef.current = null
      setConflict(null)
      setSaveStatus('saved')
    } else if (decision === 'adopt-external') {
      state.baseBody = incomingBody
      state.draftBody = incomingBody
      setBodyDraftState(incomingBody)
      setSaveStatus('saved')
    } else if (decision === 'conflict') {
      presentConflict(incomingId, incomingBody)
    }
  }, [clearTimer, presentConflict, selected?.body, selected?.id])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimer()
      const state = stateRef.current
      if (state.chapterId && state.dirty && !conflictRef.current) {
        void persistBody(state.chapterId, state.draftBody)
      }
    }
  }, [clearTimer, persistBody])

  return {
    bodyDraft,
    saveStatus,
    conflict,
    updateBodyDraft,
    flushBody,
    useExternalBody,
    keepLocalBody,
    replaceWithPersistedBody
  }
}
