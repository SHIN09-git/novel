import type { ForeshadowingStatus, ForeshadowingTreatmentMode, ForeshadowingWeight, ID, PromptMode } from '../../../shared/types'
import { treatmentLabel } from '../../../shared/foreshadowingTreatment'

export function newId(): ID {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function now(): string {
  return new Date().toISOString()
}

export function formatDate(value: string): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN')
}

export function clampNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

export function statusLabel(status: ForeshadowingStatus): string {
  return {
    unresolved: '未回收',
    partial: '部分推进',
    resolved: '已回收',
    abandoned: '废弃'
  }[status]
}

export function weightLabel(weight: ForeshadowingWeight): string {
  return {
    low: '低',
    medium: '中',
    high: '高',
    payoff: '回收'
  }[weight]
}

export function treatmentModeLabel(mode: ForeshadowingTreatmentMode): string {
  return treatmentLabel(mode)
}

export function modeLabel(mode: PromptMode): string {
  return {
    light: '轻量模式',
    standard: '标准模式',
    full: '完整模式'
  }[mode]
}
