import { useEffect, useRef, useState } from 'react'
import type { AIService } from '../../../services/AIService'
import type { QuickRewriteTarget } from '../../../shared/types'
import { useQuickRewriteDraftStore } from './QuickRewriteDraftProvider'
import { restoreQuickRewriteCandidate, toQuickRewriteDraft } from './quickRewriteDraftAdapter'
import { useConfirm } from './ConfirmDialog'
import { useAiRewriteRequest } from './useAiRewriteRequest'
import type { AiRewriteAction } from './aiRewriteMenuModel'
import {
  classifyRewriteResult, composeRewriteResult, findRewriteRange, retargetRewriteCandidate, validRewriteRange,
  type AiRewriteCandidate, type RewriteRange, type RewriteResultScope, type RewriteTargetKey
} from './aiRewriteResultModel'

interface RewriteCandidateInput {
  scopeKey: RewriteTargetKey
  getCurrentBody: (key: RewriteTargetKey) => string | undefined
  getAiService: () => Promise<AIService | null>
  onApply: (candidate: AiRewriteCandidate, body: string) => Promise<boolean> | boolean
  onStatusChange?: (message: string) => void
  persistenceTarget?: QuickRewriteTarget
  getContextForTarget?: (key: RewriteTargetKey) => string
  retainDraftAfterApply?: boolean
}
interface RewriteStart {
  targetKey: RewriteTargetKey
  sourceBody: string
  selection: RewriteRange
  context: string
  instruction: string
}

export function useAiRewriteCandidate(input: RewriteCandidateInput) {
  const [candidate, setCandidate] = useState<AiRewriteCandidate | null>(null)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState('')
  const candidateRef = useRef(candidate)
  const inputRef = useRef(input)
  const applyingRef = useRef(false)
  candidateRef.current = candidate
  inputRef.current = input
  const confirm = useConfirm()
  const draftStore = useQuickRewriteDraftStore()
  const request = useAiRewriteRequest(input.onStatusChange, {
    cancelled: '已取消本次 AI 重写；已返回的候选仍保留。',
    legacyBridge: '已停止等待；当前桥接未中止网络请求，迟到结果不会自动应用。',
    signalFailed: '已停止等待；取消信号发送失败，迟到结果不会自动应用。'
  }, input.scopeKey)

  function targetFor(candidate: AiRewriteCandidate): QuickRewriteTarget | null {
    const target = inputRef.current.persistenceTarget
    return target && typeof candidate.targetKey === 'string' ? { ...target, targetId: candidate.targetKey } : null
  }
  function retain(next: AiRewriteCandidate | null, persist = true, immediate = false) {
    candidateRef.current = next
    setCandidate(next)
    const target = next && targetFor(next)
    if (persist && next && target && draftStore) draftStore.write(target, toQuickRewriteDraft(next, target, draftStore.read(target)), immediate)
  }
  function report(value: string) {
    setMessage(value)
    inputRef.current.onStatusChange?.(value)
  }
  useEffect(() => {
    const target = inputRef.current.persistenceTarget
    const saved = target && draftStore?.read(target)
    retain(saved ? restoreQuickRewriteCandidate(saved, inputRef.current.getContextForTarget?.(target!.targetId) ?? '') : null, false)
    setMessage(saved ? '已恢复暂存候选，尚未修改原文。' : '')
  }, [input.scopeKey, input.persistenceTarget?.projectId, input.persistenceTarget?.kind, input.persistenceTarget?.targetId])

  async function clearRetained(current: AiRewriteCandidate, successMessage: string) {
    const target = targetFor(current)
    if (draftStore && target) {
      draftStore.write(target, null, true)
      await draftStore.flush()
      if (draftStore.status(target) === 'failed') return report('正文未被删除，但候选清理未保存。请重试暂存或复制后处理本地保存问题。')
    }
    if (candidateRef.current === current) { retain(null, false); report(successMessage) }
  }

  async function generate(action: AiRewriteAction, start: RewriteStart, refining = false) {
    if (applyingRef.current) return
    if (!validRewriteRange(start.sourceBody, start.selection)) return report('选区已变化，请重新选择。')
    const previous = candidateRef.current
    if (previous && !refining && !(await confirm({ title: '替换当前重写候选',
      message: '当前候选尚未应用。新结果返回前会保留它；新请求成功后将替换候选。', confirmLabel: '生成新候选' }))) return
    if (!refining && inputRef.current.getCurrentBody(start.targetKey) !== start.sourceBody) return report('原文已变化，请在当前正文重新选择后生成。')
    const control = request.begin(action.id)
    if (!control) return
    report(refining ? '正在继续修改候选，可取消本次。' : 'AI 正在重写选中文本，可取消本次等待。')
    try {
      const service = await inputRef.current.getAiService()
      if (!request.isCurrent(control)) return
      if (!service) return report('当前文本区未接入 AI 重写。')
      if (!request.attachService(control, service)) return
      const result = await service.generateRevision({
        type: action.type, revisionScope: 'local', fullChapterText: start.sourceBody,
        targetRange: start.selection.text, instruction: start.instruction || action.instruction
      }, start.context, { runId: control.runId, clientCallId: control.callId })
      if (!request.isCurrent(control)) return
      if (!result.usedAI) return report(result.error || '本次没有生成 AI 修订，原文和已有候选未修改。请检查模型配置后重试。')
      const text = result.data?.revisedText?.trim()
      if (!text) return report(result.error || 'AI 没有返回候选正文；原文和已有候选未修改。')
      if (refining && candidateRef.current !== previous) return report('候选已被编辑，本次返回未覆盖当前候选。')
      const next: AiRewriteCandidate = refining && previous
        ? { ...previous, text, usedAI: previous.usedAI || result.usedAI,
            scope: previous.scope === 'chapter' ? 'chapter' : classifyRewriteResult(previous.sourceBody, previous.selection, text) }
        : { ...start, text, usedAI: result.usedAI, label: action.label,
            scope: classifyRewriteResult(start.sourceBody, start.selection, text) }
      retain(next, true, true)
      const currentBody = inputRef.current.getCurrentBody(next.targetKey)
      report(currentBody !== next.sourceBody
        ? '原文已变化，重写候选已保留，可重新定位后应用。'
        : next.scope === 'chapter' ? 'AI 返回了较大范围的内容，已保留为整章候选。' : '重写候选已返回，尚未修改原文。')
    } catch (error) {
      if (request.isCurrent(control)) report(error instanceof Error ? error.message : 'AI 重写失败，已有候选仍保留。')
    } finally { request.finish(control) }
  }

  async function apply() {
    const current = candidateRef.current
    if (!current || applyingRef.current || request.busyActionId) return
    const body = inputRef.current.getCurrentBody(current.targetKey)
    if (body === undefined) return report('目标正文已不存在，候选仍保留，可复制后重新选择目标。')
    let nextBody: string
    try { nextBody = composeRewriteResult(current, body) }
    catch (error) { return report(error instanceof Error ? error.message : '无法应用候选。') }
    if (nextBody === body) return report('候选与当前正文相同，无需创建新版本。')
    applyingRef.current = true
    setApplying(true)
    const applyingScopeKey = inputRef.current.scopeKey
    try {
      if (current.scope === 'chapter' && !(await confirm({ title: '采用整章候选',
        message: '将用候选替换这一章的全部正文，而不是原先的选区。请先检查候选是否完整。', confirmLabel: '确认采用整章' }))) return
      if (candidateRef.current !== current || inputRef.current.getCurrentBody(current.targetKey) !== body) {
        return report('确认期间原文或候选发生变化，请检查后重新应用。')
      }
      const saved = await inputRef.current.onApply(current, nextBody)
      if (!saved) return report('应用未完成，候选仍保留；请处理保存提示后重试。')
      if (inputRef.current.scopeKey === applyingScopeKey) {
        if (inputRef.current.retainDraftAfterApply) { retain(null, false); report('已放入编辑器；保存正文前，候选仍在本地暂存。') }
        else await clearRetained(current, `已应用：${current.label}`)
      }
    } catch (error) {
      if (inputRef.current.scopeKey === applyingScopeKey) report(error instanceof Error ? error.message : '保存失败，候选仍保留。')
    }
    finally { applyingRef.current = false; setApplying(false) }
  }

  function retarget(range?: RewriteRange) {
    const current = candidateRef.current
    if (!current || applyingRef.current || request.busyActionId) return
    const body = inputRef.current.getCurrentBody(current.targetKey)
    if (body === undefined) return report('目标正文已不存在。')
    const target = range ?? findRewriteRange(body, current.selection.text)
    if (!target) return report('原片段缺失或出现多次，请收起候选，在正文重新选择后点击“使用当前选区”。')
    try { retain(retargetRewriteCandidate(current, body, target)); report('已定位到当前正文，请检查候选后应用。') }
    catch (error) { report(error instanceof Error ? error.message : '重新定位失败，候选仍保留。') }
  }

  return {
    candidate, message, applying, busyActionId: request.busyActionId, activeCall: request.activeCall,
    persistenceStatus: candidate && targetFor(candidate) && draftStore ? draftStore.status(targetFor(candidate)!) : null,
    saveCandidate: () => { const c = candidateRef.current; const target = c && targetFor(c); if (target && draftStore) return draftStore.retry(target) },
    stale: Boolean(candidate && input.getCurrentBody(candidate.targetKey) !== candidate.sourceBody),
    run: generate, apply, retarget,
    cancel: () => { const cancelled = request.cancel(); if (cancelled) report('已取消本次重写，已有候选仍保留。'); return cancelled },
    edit: (text: string) => { const c = candidateRef.current; if (c && !applyingRef.current && !request.busyActionId) retain({ ...c, text }) },
    setScope: (scope: RewriteResultScope) => { const c = candidateRef.current; if (c && !applyingRef.current && !request.busyActionId) retain({ ...c, scope }) },
    discard: () => { const c = candidateRef.current; if (c && !applyingRef.current && !request.busyActionId) void clearRetained(c, '已放弃候选，原文未修改。') },
    refine: (instruction: string) => {
      const c = candidateRef.current
      if (!c || !instruction.trim()) return
      void generate({ id: 'refine', label: c.label, type: 'custom', instruction }, {
        targetKey: c.targetKey, sourceBody: c.text, selection: { start: 0, end: c.text.length, text: c.text },
        context: c.context, instruction
      }, true)
    }
  }
}
