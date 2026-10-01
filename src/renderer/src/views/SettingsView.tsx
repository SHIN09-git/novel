import { useCallback } from 'react'
import type { AppData, AppSettings, PipelineAIRoleConfigs } from '../../../shared/types'
import type { RunPersistedStorageOperation } from '../utils/saveDataState'
import { Header } from '../components/Layout'
import type { ProjectProps } from './viewTypes'
import type { ImportDataHandler } from './viewTypes'
import { SettingsCorePanels } from './settings/SettingsCorePanels'
import { SettingsDataDisclosure } from './settings/SettingsDataPanels'
import { SettingsRuntimeInfoPanel } from './settings/SettingsRuntimeInfoPanel'
import { WorkflowModelProfileSettings } from './settings/WorkflowModelProfileSettings'
import { useSettingsBackupAndLogs } from './settings/useSettingsBackupAndLogs'
import { useSettingsCredentials } from './settings/useSettingsCredentials'
import { useSettingsStorage } from './settings/useSettingsStorage'

export function SettingsView({
  data,
  project,
  saveData,
  storagePath,
  setStoragePath,
  setStatus,
  importData,
  runPersistedStorageOperation,
  getCurrentData
}: ProjectProps & {
  storagePath: string
  setStoragePath: (path: string) => void
  setStatus: (message: string) => void
  importData: ImportDataHandler
  runPersistedStorageOperation: RunPersistedStorageOperation
  getCurrentData: () => AppData
}) {
  const updateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      return saveData((current) => ({
        ...current,
        settings: {
          ...current.settings,
          ...patch,
          apiKey: ''
        }
      }))
    },
    [saveData]
  )

  const credentials = useSettingsCredentials({
    settings: data.settings,
    updateSettings
  })
  const storage = useSettingsStorage({
    storagePath,
    setStoragePath,
    setStatus,
    importData,
    runPersistedStorageOperation,
    getCurrentData
  })
  const backupAndLogs = useSettingsBackupAndLogs({ runPersistedStorageOperation })
  const workflowModelProfile = data.settings.pipelineModelRoles ?? {}
  const updateWorkflowModelProfile = useCallback(
    (profile: PipelineAIRoleConfigs) => {
      return saveData((current) => ({
        ...current,
        settings: {
          ...current.settings,
          pipelineModelRoles: profile,
          apiKey: ''
        }
      }))
    },
    [saveData]
  )

  return (
    <div className="settings-view">
      <Header title="设置" description={`当前项目：${project.name}`} />
      <div className="settings-grid">
        <div className="settings-primary">
          <SettingsCorePanels
            settings={data.settings}
            updateSettings={updateSettings}
            credentials={credentials}
            workflowModelProfileSettings={
              <WorkflowModelProfileSettings
                settings={data.settings}
                profile={workflowModelProfile}
                onChange={updateWorkflowModelProfile}
              />
            }
          />
          <SettingsRuntimeInfoPanel storagePath={storagePath} />
        </div>

        <SettingsDataDisclosure storagePath={storagePath} storage={storage} backupAndLogs={backupAndLogs} />
      </div>
    </div>
  )
}
