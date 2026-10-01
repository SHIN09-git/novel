import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../../shared/types'
import { getUserFriendlyError } from '../../../../shared/errorUtils'
import { useConfirm } from '../../components/ConfirmDialog'
import { deleteApiKey, getApiKeyState, saveApiKey } from '../../settings/credentialApi'
import type { SaveDataOutcome } from '../../utils/saveDataState'

interface UseSettingsCredentialsOptions {
  settings: AppSettings
  updateSettings: (patch: Partial<AppSettings>) => Promise<SaveDataOutcome>
}

export function useSettingsCredentials({ settings, updateSettings }: UseSettingsCredentialsOptions) {
  const confirmAction = useConfirm()
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasStoredApiKey, setHasStoredApiKey] = useState(Boolean(settings.hasApiKey))
  const [credentialMessage, setCredentialMessage] = useState('')
  const [credentialBusy, setCredentialBusy] = useState(false)

  useEffect(() => {
    let active = true
    getApiKeyState()
      .then((hasApiKey) => {
        if (!active) return
        setHasStoredApiKey(hasApiKey)
        if (hasApiKey !== settings.hasApiKey || settings.apiKey) {
          void updateSettings({ apiKey: '', hasApiKey }).then((saved) => {
            if (!saved.ok && active) {
              setCredentialMessage(`安全存储状态已读取，但本地设置同步失败：${saved.errorMessage}`)
            }
          })
        }
      })
      .catch((error) => {
        if (active) setCredentialMessage(`读取 API Key 安全存储状态失败：${getUserFriendlyError(error)}`)
      })
    return () => {
      active = false
    }
    // Secure storage is checked once when this controller is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function storeApiKey() {
    setCredentialMessage('')
    if (!apiKeyInput.trim()) {
      setCredentialMessage('请输入新的 API Key。')
      return
    }
    setCredentialBusy(true)
    try {
      const hasApiKey = await saveApiKey(apiKeyInput)
      setApiKeyInput('')
      setHasStoredApiKey(hasApiKey)
      const saved = await updateSettings({ apiKey: '', hasApiKey })
      setCredentialMessage(
        saved.ok
          ? 'API Key 已加密保存。'
          : `API Key 已写入安全存储，但本地状态同步失败：${saved.errorMessage}`
      )
    } catch (error) {
      setCredentialMessage(`API Key 保存失败：${getUserFriendlyError(error)}`)
    } finally {
      setCredentialBusy(false)
    }
  }

  async function clearApiKey() {
    const confirmed = await confirmAction({
      title: '删除 API Key',
      message: '确定删除已保存的 API Key 吗？删除后远程 AI 调用会不可用，直到重新保存。',
      confirmLabel: '删除密钥',
      tone: 'danger'
    })
    if (!confirmed) return
    setCredentialBusy(true)
    try {
      const hasApiKey = await deleteApiKey()
      setApiKeyInput('')
      setHasStoredApiKey(hasApiKey)
      const saved = await updateSettings({ apiKey: '', hasApiKey })
      setCredentialMessage(
        saved.ok
          ? 'API Key 已删除。'
          : `API Key 已从安全存储删除，但本地状态同步失败：${saved.errorMessage}`
      )
    } catch (error) {
      setCredentialMessage(`API Key 删除失败：${getUserFriendlyError(error)}`)
    } finally {
      setCredentialBusy(false)
    }
  }

  return {
    apiKeyInput,
    clearApiKey,
    credentialBusy,
    credentialMessage,
    hasStoredApiKey,
    setApiKeyInput,
    storeApiKey
  }
}

export type SettingsCredentialController = ReturnType<typeof useSettingsCredentials>
