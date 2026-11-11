import type { AppSettings, Project } from '../../../../shared/types'
import { estimateProjectUsage, type PreparedUsageInput, type ProjectUsageEstimate } from '../../../../services/ProjectUsagePricing'

const amountFormat = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 7 })
export const formatUsageAmount = (n: number) => amountFormat.format(n)

export function estimateForSettings(settings: AppSettings, project: Project, messages: PreparedUsageInput['messages']) {
  return estimateProjectUsage({ provider: settings.apiProvider, endpoint: settings.baseUrl,
    model: settings.apiProvider === 'codex_cli' ? settings.codexCliModel : settings.modelName,
    rates: project.modelRates, messages, maxTokens: settings.maxTokens })
}

export function usageEstimateText(estimate: ProjectUsageEstimate, subject: string): string {
  const range = (value: ProjectUsageEstimate['inputTokens']) => value
    ? `${value.min.toLocaleString('zh-CN')} 至 ${value.max.toLocaleString('zh-CN')} token` : '未知'
  const cost = estimate.cost
  const amount = cost ? `${cost.currency} ${formatUsageAmount(cost.min)} 至 ${formatUsageAmount(cost.max)}`
    : estimate.pricing === 'subscription' ? '订阅调用，不折算金额'
    : estimate.pricing === 'no_rate' ? '未知（未匹配本书价目）' : '未知'
  return [subject, `预计输入：${range(estimate.inputTokens)}`, `预计输出：${range(estimate.outputTokens)}`,
    `按本书当前价目：${amount}`, '',
    estimate.pricing === 'subscription' ? '输入只估已准备的消息文本；订阅通道没有可核实的单次输出硬上限。'
      : '输入按已准备的消息文本粗估，不含服务端包装；输出按单次生成上限，不是目标字数。',
    '仅估一次请求，不含后续环节、重试或修复。整条流水线与全书预算未知；估算不是账单或消费限额。'].join('\n')
}
