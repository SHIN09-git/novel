import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIResult,
  AppSettings,
  Chapter,
  ChapterReviewDraft,
  Character,
  CharacterStateSuggestion,
  Foreshadowing,
  ForeshadowingExtractionResult,
  NextChapterSuggestions
} from '../../../../shared/types'

interface UseChapterAiDraftsInput {
  settings: AppSettings
  selected: Chapter | null
  characters: Character[]
  foreshadowings: Foreshadowing[]
  chapterText: () => string
  chapterContext: () => string
  flushBody: () => Promise<boolean>
  setMessage: (message: string) => void
}

export function useChapterAiDrafts({
  settings,
  selected,
  characters,
  foreshadowings,
  chapterText,
  chapterContext,
  flushBody,
  setMessage
}: UseChapterAiDraftsInput) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null)
  const [rawAIText, setRawAIText] = useState('')
  const [reviewDraft, setReviewDraft] = useState<ChapterReviewDraft | null>(null)
  const [characterSuggestions, setCharacterSuggestions] = useState<CharacterStateSuggestion[]>([])
  const [foreshadowingDraft, setForeshadowingDraft] = useState<ForeshadowingExtractionResult | null>(null)
  const [nextSuggestions, setNextSuggestions] = useState<NextChapterSuggestions | null>(null)
  const selectedIdRef = useRef(selected?.id ?? null)
  const actionTokenRef = useRef(0)
  const runningActionRef = useRef(false)
  selectedIdRef.current = selected?.id ?? null

  const getAiService = useCallback(async () => {
    const { AIService } = await import('../../../../services/AIService')
    return new AIService(settings)
  }, [settings])

  useEffect(() => {
    actionTokenRef.current += 1
    runningActionRef.current = false
    setLoadingAction(null)
    setRawAIText('')
    setReviewDraft(null)
    setCharacterSuggestions([])
    setForeshadowingDraft(null)
    setNextSuggestions(null)
  }, [selected?.id])

  const handleResult = useCallback(<T,>(result: AIResult<T>, onData: (data: T) => void) => {
    setRawAIText(result.rawText ?? '')
    if (result.data) onData(result.data)
    if (result.parseError) {
      setMessage(`解析失败，可手动复制。${result.parseError}`)
      return
    }
    setMessage(result.error || (result.usedAI ? 'AI 草稿已生成，请预览后再应用。' : '未配置 API Key，已生成本地结构化模板。'))
  }, [setMessage])

  const runAction = useCallback(async <T,>(
    label: string,
    action: () => Promise<AIResult<T>>,
    onData: (data: T) => void
  ) => {
    if (!selected || runningActionRef.current) return
    const chapterId = selected.id
    const actionToken = actionTokenRef.current + 1
    actionTokenRef.current = actionToken
    runningActionRef.current = true
    setLoadingAction(label)
    setMessage('')
    try {
      if (!(await flushBody())) {
        setMessage('当前正文保存失败，本次 AI 操作已取消。')
        return
      }
      const result = await action()
      if (actionToken !== actionTokenRef.current || selectedIdRef.current !== chapterId) return
      handleResult(result, onData)
    } catch (error) {
      if (actionToken === actionTokenRef.current && selectedIdRef.current === chapterId) {
        setMessage(error instanceof Error ? error.message : 'AI 操作失败，请稍后重试。')
      }
    } finally {
      if (actionToken === actionTokenRef.current) {
        runningActionRef.current = false
        setLoadingAction(null)
      }
    }
  }, [flushBody, handleResult, selected, setMessage])

  const actions = useMemo(() => ({
    generateReview: () => runAction(
      'review',
      async () => (await getAiService()).generateChapterReview(chapterText(), chapterContext()),
      setReviewDraft
    ),
    extractCharacters: () => runAction(
      'characters',
      async () => (await getAiService()).updateCharacterStates(chapterText(), characters, chapterContext()),
      setCharacterSuggestions
    ),
    extractForeshadowing: () => runAction(
      'foreshadowing',
      async () => (await getAiService()).extractForeshadowing(chapterText(), foreshadowings, chapterContext(), characters),
      setForeshadowingDraft
    ),
    generateNextRisk: () => selected
      ? runAction(
          'next',
          async () => (await getAiService()).generateNextChapterSuggestions(selected, chapterContext()),
          setNextSuggestions
        )
      : Promise.resolve()
  }), [chapterContext, chapterText, characters, foreshadowings, getAiService, runAction, selected])

  return {
    loadingAction,
    rawAIText,
    reviewDraft,
    characterSuggestions,
    foreshadowingDraft,
    nextSuggestions,
    hasOutput: Boolean(rawAIText || reviewDraft || characterSuggestions.length || foreshadowingDraft || nextSuggestions),
    getAiService,
    setReviewDraft,
    setCharacterSuggestions,
    setNextSuggestions,
    actions
  }
}
