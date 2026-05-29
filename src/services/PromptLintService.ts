import type { PromptLintIssue, PromptLintResult } from '../shared/types'
import { TokenEstimator } from './TokenEstimator'

interface PromptLintGuardResult {
  guardedPrompt: string
  result: PromptLintResult
}

const PLACEHOLDER_PATTERNS = [
  /待补充/i,
  /暂无/i,
  /未填写/i,
  /未设置/i,
  /暂无与本章需求匹配/i,
  /无匹配/i,
  /无内容/i,
  /无相关/i,
  /无记录/i
]

const AUDIT_OR_DIAGNOSTIC_PATTERNS = [
  /^风险[:：]/,
  /^审稿[:：]/,
  /^审计[:：]/,
  /^建议[:：]/,
  /^复盘建议[:：]/,
  /建议后续章节/,
  /正文可能提前/,
  /超出允许范围/,
  /可能提前泄露/,
  /生成质量评价/,
  /历史风险/,
  /Quality Gate/i,
  /Consistency Review/i,
  /Novelty Audit/i,
  /Redundancy Report/i
]

const ENGLISH_DUPLICATE_GUARDRAIL_PATTERNS = [
  /Novelty guardrail:/i,
  /Rule horror\s*\/\s*infinite-flow constraint:/i,
  /Do not introduce/i,
  /Do not output/i,
  /Do not use markdown/i
]

function excerpt(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed
}

function issue(kind: PromptLintIssue['kind'], lineNumber: number | null, line: string, message: string, action: PromptLintIssue['action']): PromptLintIssue {
  return {
    kind,
    severity: kind === 'duplicate_guardrail' || kind === 'english_duplicate_guardrail' ? 'info' : 'warning',
    lineNumber,
    excerpt: excerpt(line),
    action,
    message
  }
}

function hasPlaceholderOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed)) && trimmed.length <= 40) return true
  const fieldValue = trimmed.split(/[:：]/).slice(1).join(':').trim()
  return Boolean(fieldValue) && PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(fieldValue))
}

function isEmptyLabelLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || /^#{1,6}\s+/.test(trimmed)) return false
  if (!/[:：]\s*$/.test(trimmed)) return false
  return !/(规则|约束|字段|类别|更新|处理|状态|优先级)/.test(trimmed)
}

function isAuditOrDiagnosticLine(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return AUDIT_OR_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function rewriteDiagnosticAsWritingConstraint(text: string): string | null {
  const trimmed = text.trim()
  if (/伏笔|提前回收|提前解释|泄露|越过.*treatmentMode|超出允许范围/.test(trimmed)) {
    return '不得继续解释、揭底或回收未被本章任务书允许的伏笔；只能按 treatmentMode 做轻微暗示或有限推进。'
  }
  if (/新规则|补充条款|临时权限|机械降神|系统面板|管理员|组织层级|核心机制/.test(trimmed)) {
    return '不得把未授权的新规则、新权限、新管理员层级或新核心机制写成既有事实；解决危机必须来自已铺垫线索并带来代价。'
  }
  if (/角色状态|伤势|位置|物品|知识|能力限制|吃书|连续性/.test(trimmed)) {
    return '必须遵守已确认的角色硬状态，不得无解释恢复伤势、跨越位置限制、使用未持有物品或知道未记录信息。'
  }
  return null
}

function isEnglishDuplicateGuardrail(text: string): boolean {
  const trimmed = text.trim()
  return ENGLISH_DUPLICATE_GUARDRAIL_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function isGuardrailLine(text: string): boolean {
  const trimmed = text.trim().replace(/^[-*]\s*/, '')
  return /^(不得|不要|禁止|不可|不应|必须|应当|NoveltyPolicy)/i.test(trimmed)
}

function normalizeGuardrail(text: string): string {
  return text
    .replace(/^[-*]\s*/, '')
    .replace(/[，。；：、,.!?;:\s]/g, '')
    .toLowerCase()
}

function compactBlankLines(lines: string[]): string[] {
  const compacted: string[] = []
  for (const line of lines) {
    if (!line.trim() && !compacted[compacted.length - 1]?.trim()) continue
    compacted.push(line)
  }
  while (compacted.length && !compacted[0].trim()) compacted.shift()
  while (compacted.length && !compacted[compacted.length - 1].trim()) compacted.pop()
  return compacted
}

export class PromptLintService {
  static guardWritingPrompt(rawPrompt: string): PromptLintGuardResult {
    const originalTokenEstimate = TokenEstimator.estimate(rawPrompt)
    const issues: PromptLintIssue[] = []
    const seenGuardrails = new Set<string>()
    const keptLines: string[] = []
    let removedLineCount = 0
    let dedupedLineCount = 0
    let rewrittenLineCount = 0

    rawPrompt.split('\n').forEach((line, index) => {
      const lineNumber = index + 1
      const trimmed = line.trim()
      if (!trimmed) {
        keptLines.push(line)
        return
      }

      if (hasPlaceholderOnly(trimmed)) {
        removedLineCount += 1
        issues.push(issue('placeholder', lineNumber, line, '已移除写作 Prompt 中的占位符或空值说明。', 'removed'))
        return
      }

      if (isEmptyLabelLine(trimmed)) {
        removedLineCount += 1
        issues.push(issue('empty_label', lineNumber, line, '已移除没有有效内容的字段标签。', 'removed'))
        return
      }

      if (isAuditOrDiagnosticLine(trimmed)) {
        const rewritten = rewriteDiagnosticAsWritingConstraint(trimmed)
        if (rewritten) {
          const normalized = normalizeGuardrail(rewritten)
          if (!seenGuardrails.has(normalized)) {
            keptLines.push(rewritten)
            seenGuardrails.add(normalized)
          }
          rewrittenLineCount += 1
          issues.push(issue('audit_tone', lineNumber, line, '已将审稿/诊断文字改写为当前章节可执行的写作限制。', 'rewritten'))
          return
        }
        removedLineCount += 1
        issues.push(issue('audit_tone', lineNumber, line, '已移除审稿/诊断口吻文字，避免混入正文写作指令。', 'removed'))
        return
      }

      if (isEnglishDuplicateGuardrail(trimmed)) {
        removedLineCount += 1
        issues.push(issue('english_duplicate_guardrail', lineNumber, line, '已移除与中文限制重复的英文 guardrail。', 'removed'))
        return
      }

      if (isGuardrailLine(trimmed)) {
        const normalized = normalizeGuardrail(trimmed)
        if (normalized && seenGuardrails.has(normalized)) {
          dedupedLineCount += 1
          issues.push(issue('duplicate_guardrail', lineNumber, line, '已合并完全重复的写作禁令。', 'deduped'))
          return
        }
        seenGuardrails.add(normalized)
      }

      keptLines.push(line)
    })

    const guardedPrompt = compactBlankLines(keptLines).join('\n').trim()
    const guardedTokenEstimate = TokenEstimator.estimate(guardedPrompt)
    const warnings = issues.map((item) => `${item.message}${item.excerpt ? `（${item.excerpt}）` : ''}`)

    return {
      guardedPrompt,
      result: {
        issueCount: issues.length,
        removedLineCount,
        dedupedLineCount,
        rewrittenLineCount,
        originalTokenEstimate,
        guardedTokenEstimate,
        issues,
        warnings
      }
    }
  }
}
