import { useState, type ReactNode } from 'react'
import type { AppSettings, PromptMode } from '../../../../shared/types'
import { Field, NumberInput, SelectField, TextInput, Toggle } from '../../components/FormFields'
import { getNovelDirectorAiApi } from '../../platform/novelDirectorBridge'
import type { SaveDataOutcome } from '../../utils/saveDataState'
import type { SettingsCredentialController } from './useSettingsCredentials'

interface SettingsCorePanelsProps {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => Promise<SaveDataOutcome>
  credentials: SettingsCredentialController
  workflowModelProfileSettings?: ReactNode
}

export function SettingsCorePanels({ settings, updateSettings, credentials, workflowModelProfileSettings }: SettingsCorePanelsProps) {
  const [codexStatus, setCodexStatus] = useState('')
  const [checkingCodex, setCheckingCodex] = useState(false)
  const isCodexCli = settings.apiProvider === 'codex_cli'

  const checkCodexCli = async () => {
    setCheckingCodex(true)
    setCodexStatus('正在检测 Codex CLI…')
    try {
      const result = await getNovelDirectorAiApi().getCodexCliStatus(settings.codexCliPath || 'codex')
      const details = [result.version, result.resolvedPath].filter(Boolean).join(' · ')
      setCodexStatus(details ? `${result.message}\n${details}` : result.message)
    } catch (error) {
      setCodexStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setCheckingCodex(false)
    }
  }

  return (
    <>
      <section className="panel settings-section">
        <h2>AI 模型接入</h2>
        <div className="form-grid compact">
          <SelectField<AppSettings['apiProvider']>
            label="Provider"
            value={settings.apiProvider}
            onChange={(apiProvider) =>
              updateSettings({
                apiProvider,
                requestTimeoutMs:
                  apiProvider === 'codex_cli'
                    ? Math.max(settings.requestTimeoutMs, 300_000)
                    : settings.requestTimeoutMs
              })
            }
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'compatible', label: 'Compatible API' },
              { value: 'local', label: 'Local Model' },
              { value: 'codex_cli', label: 'Codex CLI（订阅登录）' }
            ]}
          />
          {isCodexCli ? (
            <>
              <TextInput
                label="Codex CLI 命令或路径"
                value={settings.codexCliPath}
                placeholder="codex"
                debounceMs={500}
                bufferKey="codex-cli-path"
                onChange={(codexCliPath) => updateSettings({ codexCliPath })}
              />
              <TextInput
                label="Codex 模型（可选）"
                value={settings.codexCliModel}
                placeholder="留空则使用 Codex CLI 默认模型"
                debounceMs={500}
                bufferKey="codex-cli-model"
                onChange={(codexCliModel) => updateSettings({ codexCliModel })}
              />
              <Field label="本机登录状态" hint="工作台只调用本机 CLI，不读取或保存 Codex/ChatGPT 登录凭据。">
                <div className="credential-field">
                  <div className="muted">
                    先在终端安装 Codex CLI 并运行 <code>codex login</code>，再检测连接。
                  </div>
                  <div className="row-actions">
                    <button className="ghost-button" type="button" disabled={checkingCodex} onClick={() => void checkCodexCli()}>
                      {checkingCodex ? '检测中…' : '检测 Codex CLI'}
                    </button>
                  </div>
                  {codexStatus ? <div className="notice" style={{ whiteSpace: 'pre-wrap' }}>{codexStatus}</div> : null}
                </div>
              </Field>
            </>
          ) : (
            <>
              <TextInput
                label="Base URL"
                value={settings.baseUrl}
                debounceMs={500}
                bufferKey="ai-base-url"
                onChange={(baseUrl) => updateSettings({ baseUrl })}
              />
              <TextInput
                label="Model Name"
                value={settings.modelName}
                debounceMs={500}
                bufferKey="ai-model-name"
                onChange={(modelName) => updateSettings({ modelName })}
              />
              <Field label="API Key">
                <div className="credential-field">
                  <div className="muted">
                    {credentials.hasStoredApiKey
                      ? '已保存 API Key。出于安全原因不会回显完整密钥。'
                      : settings.apiProvider === 'local'
                        ? '本地模型模式不需要远程 API Key。'
                        : '未保存 API Key。'}
                  </div>
                  <input
                    type="password"
                    value={credentials.apiKeyInput}
                    placeholder={credentials.hasStoredApiKey ? '输入新 key 可替换当前保存项' : '输入 API Key 后点击保存'}
                    onChange={(event) => credentials.setApiKeyInput(event.target.value)}
                  />
                  <div className="row-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      disabled={credentials.credentialBusy}
                      onClick={() => void credentials.storeApiKey()}
                    >
                      {credentials.hasStoredApiKey ? '更换 Key' : '保存 Key'}
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      disabled={!credentials.hasStoredApiKey || credentials.credentialBusy}
                      onClick={() => void credentials.clearApiKey()}
                    >
                      删除 Key
                    </button>
                  </div>
                  {credentials.credentialMessage ? <div className="notice">{credentials.credentialMessage}</div> : null}
                </div>
              </Field>
              <Field label="Temperature">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={settings.temperature}
                  onChange={(event) => void updateSettings({ temperature: Number(event.target.value) })}
                />
              </Field>
            </>
          )}
          <NumberInput
            label={isCodexCli ? '输出长度参考（Tokens）' : 'Max Tokens'}
            value={settings.maxTokens}
            hint={isCodexCli ? 'Codex CLI 不提供完全等价的 max_tokens 参数；工作台会把它作为输出长度约束写入任务。' : undefined}
            onChange={(maxTokens) => updateSettings({ maxTokens: maxTokens ?? 8000 })}
          />
          <NumberInput
            label="单次 AI 调用超时（秒）"
            value={Math.round(settings.requestTimeoutMs / 1000)}
            min={5}
            max={900}
            hint={isCodexCli ? '包含 CLI 启动和模型生成时间，默认 300 秒。' : '覆盖连接、响应正文读取与兼容性降级；默认 300 秒，最长 900 秒。'}
            onChange={(seconds) => updateSettings({ requestTimeoutMs: Math.min(900, Math.max(5, seconds ?? 300)) * 1000 })}
          />
        </div>
        <div className="checkbox-grid">
          <Toggle
            label="启用 AI 自动总结"
            checked={settings.enableAutoSummary}
            onChange={(enableAutoSummary) => updateSettings({ enableAutoSummary })}
          />
          <Toggle
            label="启用 AI 章节诊断"
            checked={settings.enableChapterDiagnostics}
            onChange={(enableChapterDiagnostics) => updateSettings({ enableChapterDiagnostics })}
          />
        </div>
        {workflowModelProfileSettings}
      </section>

      <section className="panel settings-section">
        <h2>Prompt 与偏好</h2>
        <div className="form-grid compact">
          <NumberInput
            label="默认 token 预算"
            value={settings.defaultTokenBudget}
            onChange={(defaultTokenBudget) => updateSettings({ defaultTokenBudget: defaultTokenBudget ?? 16000 })}
          />
          <SelectField<PromptMode>
            label="默认 Prompt 模式"
            value={settings.defaultPromptMode}
            onChange={(defaultPromptMode) => updateSettings({ defaultPromptMode })}
            options={[
              { value: 'light', label: '轻量模式' },
              { value: 'standard', label: '标准模式' },
              { value: 'full', label: '完整模式' }
            ]}
          />
          <SelectField
            label="主题"
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' }
            ]}
          />
        </div>
      </section>
    </>
  )
}
