import { useEffect, useState } from 'react'
import type { RuntimeInfo } from '../../../../shared/runtimeInfo'
import { loadRuntimeInfo } from '../../platform/runtimeInfoBridge'

interface SettingsRuntimeInfoPanelProps {
  storagePath: string
}

function modeLabel(mode: RuntimeInfo['mode']): string {
  if (mode === 'development') return '开发模式'
  if (mode === 'preview') return '预览模式'
  return '桌面发行版'
}

export function SettingsRuntimeInfoPanel({ storagePath }: SettingsRuntimeInfoPanelProps) {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    setUnavailable(false)
    void loadRuntimeInfo(window.novelDirector)
      .then((info) => {
        if (!active) return
        setRuntimeInfo(info)
        setUnavailable(!info)
      })
      .catch(() => {
        if (!active) return
        setRuntimeInfo(null)
        setUnavailable(true)
      })
    return () => {
      active = false
    }
  }, [])

  const value = (text: string | undefined) => text || (runtimeInfo || unavailable ? '暂不可用' : '读取中')

  return (
    <details className="settings-runtime-info">
      <summary>
        <div className="settings-runtime-info-heading">
          <strong>运行信息</strong>
          <small>版本、构建和本机运行环境</small>
        </div>
        <span className="settings-data-disclosure-action">展开</span>
      </summary>
      <div className="settings-runtime-info-content">
        <div className="settings-runtime-info-grid">
          <div>
            <span>应用版本</span>
            <strong>{value(runtimeInfo?.version)}</strong>
          </div>
          <div>
            <span>运行方式</span>
            <strong>{runtimeInfo ? modeLabel(runtimeInfo.mode) : value(undefined)}</strong>
          </div>
          <div>
            <span>构建时间（UTC）</span>
            <strong>{value(runtimeInfo?.buildTime)}</strong>
          </div>
          <div>
            <span>Electron</span>
            <strong>{value(runtimeInfo?.electronVersion)}</strong>
          </div>
          <div className="settings-runtime-info-wide">
            <span>程序位置</span>
            <code title={runtimeInfo?.execPath}>{value(runtimeInfo?.execPath)}</code>
          </div>
          <div className="settings-runtime-info-wide">
            <span>当前数据路径</span>
            <code title={storagePath}>{storagePath || '暂不可用'}</code>
          </div>
        </div>
      </div>
    </details>
  )
}
