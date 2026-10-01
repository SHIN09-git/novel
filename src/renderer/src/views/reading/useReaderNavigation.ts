import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Chapter, ID } from '../../../../shared/types'
import {
  createReaderPosition,
  readReaderPosition,
  resolveReaderPosition,
  type ReaderPosition,
  type ReaderPositionStorage,
  writeReaderPosition
} from './readerPosition'

function findChapterArticle(container: HTMLElement, chapterId: ID): HTMLElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLElement>('[data-reader-chapter-id]')).find(
      (article) => article.dataset.readerChapterId === chapterId
    ) ?? null
  )
}

function offsetWithin(container: HTMLElement, element: HTMLElement): number {
  return element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

function sessionStorageOrNull(): ReaderPositionStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export interface ReaderNavigationOptions {
  projectId?: ID | null
  positionStorage?: ReaderPositionStorage | null
}

interface CapturedReaderPosition {
  projectId: ID | null
  position: ReaderPosition
}

export function useReaderNavigation(
  chapters: Chapter[],
  initialChapterId?: ID | null,
  { projectId = null, positionStorage }: ReaderNavigationOptions = {}
) {
  const readerScrollRef = useRef<HTMLDivElement | null>(null)
  const appliedInitialChapterRef = useRef<ID | null>(null)
  const activeChapterIdRef = useRef<ID | null>(null)
  const manualNavigationRef = useRef(false)
  const restoredProjectRef = useRef<ID | null | undefined>(undefined)
  const observedInitialChapterRef = useRef<ID | null>(initialChapterId ?? null)
  const projectIdRef = useRef<ID | null>(projectId)
  const lastCapturedPositionRef = useRef<CapturedReaderPosition | null>(null)
  const pendingSaveRef = useRef<number | null>(null)
  projectIdRef.current = projectId
  const chapterSignature = useMemo(
    () => chapters.map((chapter) => `${chapter.id}:${chapter.order}`).join('|'),
    [chapters]
  )
  const [activeChapterId, setActiveChapterId] = useState<ID | null>(initialChapterId ?? chapters[0]?.id ?? null)

  useEffect(() => {
    activeChapterIdRef.current = activeChapterId
  }, [activeChapterId])

  const storage = useCallback(() => positionStorage ?? sessionStorageOrNull(), [positionStorage])

  const restorePositionNow = useCallback((position: ReaderPosition): boolean => {
    const container = readerScrollRef.current
    if (!container) return false
    const article = findChapterArticle(container, position.chapterId)
    if (!article) return false
    const paragraphs = Array.from(article.querySelectorAll<HTMLElement>('[data-reader-segment-id]'))
    const resolution = resolveReaderPosition(position, [{
      id: position.chapterId,
      paragraphs: paragraphs.map((paragraph) => paragraph.textContent ?? '')
    }])
    if (!resolution) return false
    const articleTop = offsetWithin(container, article)
    let targetTop = articleTop
    if (resolution.kind === 'anchor' && resolution.paragraphIndex !== null) {
      const paragraph = paragraphs[resolution.paragraphIndex]
      if (paragraph) {
        const paragraphTop = offsetWithin(container, paragraph)
        targetTop = paragraphTop + paragraph.offsetHeight * resolution.anchorOffsetRatio - container.clientHeight * resolution.viewportRatio
      }
    } else {
      targetTop = articleTop + Math.min(96, article.offsetHeight * position.chapterProgress)
    }
    container.scrollTo({ top: Math.max(0, Math.min(targetTop, container.scrollHeight - container.clientHeight)), behavior: 'auto' })
    activeChapterIdRef.current = resolution.chapterId
    setActiveChapterId(resolution.chapterId)
    return true
  }, [])

  const capturePosition = useCallback((): ReaderPosition | null => {
    const container = readerScrollRef.current
    const chapterId = activeChapterIdRef.current
    if (!container || !chapterId) return null
    const article = findChapterArticle(container, chapterId)
    if (!article) return null
    const viewportRatio = 0.25
    const markerTop = container.scrollTop + container.clientHeight * viewportRatio
    const articleTop = offsetWithin(container, article)
    const paragraphs = Array.from(article.querySelectorAll<HTMLElement>('[data-reader-segment-id]'))
    let anchor = paragraphs[0] ?? null
    for (const paragraph of paragraphs) {
      if (offsetWithin(container, paragraph) <= markerTop) anchor = paragraph
      else break
    }
    const anchorTop = anchor ? offsetWithin(container, anchor) : articleTop
    const position = createReaderPosition({
      chapterId,
      anchorText: anchor?.textContent ?? null,
      anchorOffsetRatio: anchor ? (markerTop - anchorTop) / Math.max(anchor.offsetHeight, 1) : 0,
      chapterProgress: (markerTop - articleTop) / Math.max(article.offsetHeight, 1),
      viewportRatio
    })
    lastCapturedPositionRef.current = { projectId: projectIdRef.current, position }
    return position
  }, [])

  const restorePosition = useCallback((position: ReaderPosition | null | undefined) => {
    if (!position) return
    requestAnimationFrame(() => { restorePositionNow(position) })
  }, [restorePositionNow])

  const preserveReadingPosition = useCallback(() => {
    const position = capturePosition()
    restorePosition(position)
    return position
  }, [capturePosition, restorePosition])

  const flushReaderPosition = useCallback(() => {
    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }
    if (!projectId) return
    const position = lastCapturedPositionRef.current?.projectId === projectId
      ? lastCapturedPositionRef.current.position : capturePosition()
    if (position) writeReaderPosition(storage(), projectId, position)
  }, [capturePosition, projectId, storage])

  const schedulePositionSave = useCallback(() => {
    if (!projectId || pendingSaveRef.current !== null) return
    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null
      const position = lastCapturedPositionRef.current?.projectId === projectId
        ? lastCapturedPositionRef.current.position : capturePosition()
      if (position) writeReaderPosition(storage(), projectId, position)
    }, 240)
  }, [capturePosition, projectId, storage])

  const jumpToChapter = useCallback((chapterId: ID, behavior: ScrollBehavior = 'smooth') => {
    manualNavigationRef.current = true
    activeChapterIdRef.current = chapterId
    setActiveChapterId(chapterId)
    window.getSelection()?.removeAllRanges()
    requestAnimationFrame(() => {
      const container = readerScrollRef.current
      if (!container) return
      const article = findChapterArticle(container, chapterId)
      if (!article) return
      container.scrollTo({ top: offsetWithin(container, article), behavior })
    })
  }, [])

  useEffect(() => {
    document.querySelector<HTMLElement>('.main-panel')?.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  useEffect(() => {
    const container = readerScrollRef.current
    if (!container || !chapters.length || restoredProjectRef.current === projectId) return
    if (restoredProjectRef.current !== undefined && restoredProjectRef.current !== projectId) {
      manualNavigationRef.current = false
      appliedInitialChapterRef.current = null
    }
    const frame = requestAnimationFrame(() => {
      if (manualNavigationRef.current) return
      const saved = projectId ? readReaderPosition(storage(), projectId) : null
      const initialExists = Boolean(initialChapterId && chapters.some((chapter) => chapter.id === initialChapterId))
      const explicitDifferentChapter = Boolean(initialChapterId && initialChapterId !== saved?.chapterId)
      if (initialExists && (explicitDifferentChapter || !saved)) {
        appliedInitialChapterRef.current = initialChapterId ?? null
        activeChapterIdRef.current = initialChapterId ?? null
        setActiveChapterId(initialChapterId ?? null)
        const article = initialChapterId ? findChapterArticle(container, initialChapterId) : null
        if (article) container.scrollTo({ top: offsetWithin(container, article), behavior: 'auto' })
      } else if (saved) {
        restorePositionNow(saved)
      }
      restoredProjectRef.current = projectId
    })
    return () => cancelAnimationFrame(frame)
  }, [chapterSignature, chapters, initialChapterId, projectId, restorePositionNow, storage])

  useEffect(() => {
    const previousInitialChapterId = observedInitialChapterRef.current
    if (previousInitialChapterId === initialChapterId) return
    observedInitialChapterRef.current = initialChapterId ?? null
    if (!initialChapterId || restoredProjectRef.current !== projectId) return
    if (!chapters.some((chapter) => chapter.id === initialChapterId)) return
    appliedInitialChapterRef.current = initialChapterId
    jumpToChapter(initialChapterId, 'auto')
  }, [chapterSignature, chapters, initialChapterId, jumpToChapter, projectId])

  useEffect(() => {
    if ((!activeChapterId || !chapters.some((chapter) => chapter.id === activeChapterId)) && chapters[0]) {
      setActiveChapterId(chapters[0].id)
    }
  }, [activeChapterId, chapterSignature, chapters])

  useEffect(() => {
    const container = readerScrollRef.current
    if (!container) return
    const handleScroll = () => {
      const articles = Array.from(container.querySelectorAll<HTMLElement>('[data-reader-chapter-id]'))
      const markerTop = container.scrollTop + 120
      let current = articles[0]?.dataset.readerChapterId ?? null
      for (const article of articles) {
        if (offsetWithin(container, article) <= markerTop) current = article.dataset.readerChapterId ?? current
      }
      if (current) {
        activeChapterIdRef.current = current
        setActiveChapterId((previous) => (previous === current ? previous : current))
      }
      capturePosition()
      schedulePositionSave()
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => container.removeEventListener('scroll', handleScroll)
  }, [chapterSignature, schedulePositionSave])

  useLayoutEffect(() => () => flushReaderPosition(), [flushReaderPosition])

  return {
    activeChapterId,
    readerScrollRef,
    jumpToChapter,
    capturePosition,
    restorePosition,
    preserveReadingPosition,
    flushReaderPosition
  }
}
