import type { PipelineAIModelConfig } from '../../../../shared/types'
import { effectiveCompletionTokens, isReasoningEffort, type ReasoningEffort } from '../../../../shared/reasoningEffort'
import { Field } from '../../components/FormFields'

export function ReasoningEffortField({ config, onChange }: {
  config: Pick<PipelineAIModelConfig, 'reasoningEffort' | 'maxTokens' | 'apiProvider'>
  onChange: (effort: ReasoningEffort | null) => void
}) {
  const effort = config.reasoningEffort
  const hint = !effort ? '不指定时沿用当前模型的调用方式。'
    : config.apiProvider === 'codex_cli' ? '仅本次 CLI 调用生效；输出长度仍是正文长度参考。'
    : `本次请求上限 ${effectiveCompletionTokens(config.maxTokens, effort).toLocaleString('zh-CN')} token，包含推理和正文。模型需支持所选档位和上限。`
  return (
    <Field label="推理强度" hint={hint}>
      <select value={effort ?? ''} onChange={event => {
        const value = event.target.value
        onChange(isReasoningEffort(value) ? value : null)
      }}>
        <option value="">不指定</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
      </select>
    </Field>
  )
}
