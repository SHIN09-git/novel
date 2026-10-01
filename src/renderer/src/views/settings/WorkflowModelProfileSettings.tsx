import type { AppSettings, PipelineAIModelConfig, PipelineAIRole, PipelineAIRoleConfigs } from '../../../../shared/types'
import type { ApiProvider } from '../../../../shared/types/base'
import { Field, NumberInput, SelectField, TextInput, Toggle } from '../../components/FormFields'

interface WorkflowRoleDefinition {
  id: PipelineAIRole
  title: string
  description: string
}

const WORKFLOW_ROLES: WorkflowRoleDefinition[] = [
  { id: 'planner', title: '章节规划', description: '生成任务书、判断本章推进方向。' },
  { id: 'prose', title: '正文创作', description: '依据任务书与上下文写出章节正文。' },
  { id: 'extraction', title: '信息提取', description: '从正文整理候选记忆、角色状态与伏笔变化。' },
  { id: 'reviewer', title: '审稿与质量门禁', description: '检查连续性、新设定风险与可采纳性。' },
  { id: 'revision', title: '修订协作', description: '根据明确意见生成或辅助处理修订。' }
]

function defaultOverride(settings: AppSettings): PipelineAIModelConfig {
  return {
    apiProvider: settings.apiProvider,
    baseUrl: settings.baseUrl,
    modelName: settings.modelName,
    codexCliPath: settings.codexCliPath,
    codexCliModel: settings.codexCliModel,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    requestTimeoutMs: settings.requestTimeoutMs,
    retryEnabled: settings.retryEnabled,
    maxRetries: settings.maxRetries
  }
}

function providerOptions() {
  return [
    { value: 'openai', label: 'OpenAI' },
    { value: 'compatible', label: 'Compatible API' },
    { value: 'local', label: 'Local Model' },
    { value: 'codex_cli', label: 'Codex CLI（订阅登录）' }
  ] satisfies Array<{ value: ApiProvider; label: string }>
}

export function WorkflowModelProfileSettings({
  settings,
  profile,
  onChange
}: {
  settings: AppSettings
  profile: PipelineAIRoleConfigs
  onChange: (profile: PipelineAIRoleConfigs) => void | Promise<unknown>
}) {
  const updateRole = (role: PipelineAIRole, patch: Partial<PipelineAIModelConfig>) => {
    const current = profile[role] ?? defaultOverride(settings)
    void onChange({ ...profile, [role]: { ...current, ...patch } })
  }

  const setInheritance = (role: PipelineAIRole, inheritsDefault: boolean) => {
    const next = { ...profile }
    if (inheritsDefault) delete next[role]
    else next[role] = defaultOverride(settings)
    void onChange(next)
  }

  return (
    <details className="workflow-model-profile-settings">
      <summary>
        <span>
          <strong>高级：按工作环节分配模型</strong>
          <small>默认全部继承上方模型。这里只保存模型与调用参数，不显示或保存密钥。</small>
        </span>
        <span className="workflow-model-profile-summary">5 个环节</span>
      </summary>
      <div className="workflow-model-profile-intro">
        给需要更强推理或更快响应的环节单独选模型。覆盖只影响该环节，不会改变默认模型。
      </div>
      <div className="workflow-model-role-list">
        {WORKFLOW_ROLES.map((role) => {
          const override = profile[role.id]
          const inheritsDefault = !override
          const effective = { ...defaultOverride(settings), ...override }
          const isCodexCli = effective.apiProvider === 'codex_cli'
          return (
            <section className="workflow-model-role" key={role.id}>
              <div className="workflow-model-role-heading">
                <div>
                  <h3>{role.title}</h3>
                  <p>{role.description}</p>
                </div>
                <label className="workflow-model-mode">
                  <select
                    aria-label={`${role.title}模型设置方式`}
                    value={inheritsDefault ? 'inherit' : 'override'}
                    onChange={(event) => setInheritance(role.id, event.target.value === 'inherit')}
                  >
                    <option value="inherit">继承默认</option>
                    <option value="override">单独设置</option>
                  </select>
                </label>
              </div>
              {inheritsDefault ? (
                <p className="workflow-model-inherited">
                  当前使用：{settings.apiProvider === 'codex_cli' ? (settings.codexCliModel || 'Codex CLI 默认模型') : settings.modelName || '未指定模型'}
                </p>
              ) : (
                <div className="workflow-model-role-fields">
                  <div className="form-grid compact">
                    <SelectField<ApiProvider>
                      label="Provider"
                      value={effective.apiProvider}
                      options={providerOptions()}
                      onChange={(apiProvider) => updateRole(role.id, { apiProvider })}
                    />
                    {isCodexCli ? (
                      <>
                        <TextInput
                          label="Codex CLI 命令或路径"
                          value={effective.codexCliPath}
                          placeholder="codex"
                          debounceMs={500}
                          bufferKey={`${role.id}-codex-cli-path`}
                          onChange={(codexCliPath) => updateRole(role.id, { codexCliPath })}
                        />
                        <TextInput
                          label="Codex 模型（可选）"
                          value={effective.codexCliModel}
                          placeholder="留空则使用 Codex CLI 默认模型"
                          debounceMs={500}
                          bufferKey={`${role.id}-codex-cli-model`}
                          onChange={(codexCliModel) => updateRole(role.id, { codexCliModel })}
                        />
                      </>
                    ) : (
                      <>
                        <TextInput
                          label="Base URL"
                          value={effective.baseUrl}
                          debounceMs={500}
                          bufferKey={`${role.id}-base-url`}
                          onChange={(baseUrl) => updateRole(role.id, { baseUrl })}
                        />
                        <TextInput
                          label="Model Name"
                          value={effective.modelName}
                          debounceMs={500}
                          bufferKey={`${role.id}-model-name`}
                          onChange={(modelName) => updateRole(role.id, { modelName })}
                        />
                      </>
                    )}
                    <Field label="Temperature">
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="2"
                        value={effective.temperature}
                        onChange={(event) => updateRole(role.id, { temperature: Number(event.target.value) })}
                      />
                    </Field>
                    <NumberInput
                      label={isCodexCli ? '输出长度参考（Tokens）' : 'Max Tokens'}
                      value={effective.maxTokens}
                      min={256}
                      max={128000}
                      onChange={(maxTokens) => updateRole(role.id, { maxTokens: maxTokens ?? settings.maxTokens })}
                    />
                    <NumberInput
                      label="单次调用超时（秒）"
                      value={Math.round(effective.requestTimeoutMs / 1000)}
                      min={5}
                      max={900}
                      onChange={(seconds) => updateRole(role.id, {
                        requestTimeoutMs: Math.min(900, Math.max(5, seconds ?? 300)) * 1000
                      })}
                    />
                    <NumberInput
                      label="最多重试次数"
                      value={effective.maxRetries}
                      min={0}
                      max={8}
                      onChange={(maxRetries) => updateRole(role.id, { maxRetries: Math.min(8, Math.max(0, maxRetries ?? 0)) })}
                    />
                  </div>
                  <Toggle
                    label="允许临时网络错误自动重试"
                    checked={effective.retryEnabled}
                    onChange={(retryEnabled) => updateRole(role.id, { retryEnabled })}
                  />
                </div>
              )}
            </section>
          )
        })}
      </div>
    </details>
  )
}
