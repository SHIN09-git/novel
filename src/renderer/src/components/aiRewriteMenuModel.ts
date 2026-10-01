import type { CSSProperties } from 'react'
import type { RevisionRequestType } from '../../../shared/types'

export interface AiRewriteAction {
  id: string
  label: string
  type: RevisionRequestType
  instruction: string
  requiresCustomInstruction?: boolean
}

export interface AiRewriteCallControl {
  runId: string
  callId: string
}

export class AiRewriteRequestGate {
  private readonly runId: string
  private active: AiRewriteCallControl | null = null

  constructor(private readonly createId: () => string = () => crypto.randomUUID()) {
    this.runId = `rewrite:${createId()}`
  }

  begin(): AiRewriteCallControl {
    const control = { runId: this.runId, callId: createIdSafe(this.createId) }
    this.active = control
    return control
  }

  isCurrent(control: AiRewriteCallControl): boolean {
    return this.active?.runId === control.runId && this.active.callId === control.callId
  }

  cancel(control: AiRewriteCallControl): boolean {
    if (!this.isCurrent(control)) return false
    this.active = null
    return true
  }

  finish(control: AiRewriteCallControl): boolean {
    return this.cancel(control)
  }
}

export class AiRewriteRequestGeneration {
  private value = 0

  next(): number {
    this.value += 1
    return this.value
  }

  invalidate(): void {
    this.value += 1
  }

  isCurrent(value: number): boolean {
    return this.value === value
  }
}

export function isAiRewriteSourceCurrent(
  sourceText: string,
  currentText: string,
  selection: Pick<RewriteTextRange, 'start' | 'end' | 'text'>
): boolean {
  return sourceText === currentText && sourceText.slice(selection.start, selection.end) === selection.text
}

export function isAiRewriteScopeCurrent(sourceScopeKey: unknown, currentScopeKey: unknown): boolean {
  return Object.is(sourceScopeKey, currentScopeKey)
}

interface RewriteTextRange {
  start: number
  end: number
  text: string
}

function createIdSafe(createId: () => string): string {
  const id = createId()
  if (!id) throw new Error('AI rewrite call ID must not be empty.')
  return id
}

export const AI_REWRITE_ACTIONS: AiRewriteAction[] = [
  {
    id: 'blank',
    label: '空白重写',
    type: 'rewrite_section',
    instruction: '在不改变剧情事实、角色状态和伏笔状态的前提下，重新写这段文字。保留原本信息量，不额外解释。'
  },
  {
    id: 'reduce-ai-tone',
    label: '去 AI 味（白名单）',
    type: 'reduce_ai_tone',
    instruction: '按 lieflat-less-ai-tone 白名单做最小改写；未命中规则的文字原样保留，不新增动作、细节、潜台词或剧情事实。'
  },
  {
    id: 'polish-style',
    label: '润色文风',
    type: 'polish_style',
    instruction: '提升句子节奏、画面感和叙事质感，但不要改变事件、人物意图或设定事实。'
  },
  {
    id: 'improve-dialogue',
    label: '对白更有潜台词',
    type: 'improve_dialogue',
    instruction: '如果这段包含对白，减少直白说明，增强潜台词和人物关系张力；没有对白时只做轻度润色。'
  },
  {
    id: 'compress',
    label: '压缩拖沓',
    type: 'compress_pacing',
    instruction: '删去重复解释和无效铺陈，保留关键动作、情绪转折、信息点和伏笔。'
  },
  {
    id: 'strengthen-conflict',
    label: '加强冲突',
    type: 'strengthen_conflict',
    instruction: '强化人物目标阻力、场面压力和选择代价，但不得新增未铺垫规则或改变既有事实。'
  },
  {
    id: 'custom',
    label: '自定义需求...',
    type: 'custom',
    instruction: '',
    requiresCustomInstruction: true
  }
]

export function menuPositionAtCursor(x: number, y: number, width = 300, height = 360): CSSProperties {
  const margin = 12
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const preferredLeft = x + 6
  const preferredTop = y + 6
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const maxTop = Math.max(margin, viewportHeight - height - margin)
  const left = Math.min(Math.max(margin, preferredLeft), maxLeft)
  const top = preferredTop + height <= viewportHeight - margin
    ? preferredTop
    : Math.min(maxTop, Math.max(margin, y - height - 6))
  return { left, top }
}
