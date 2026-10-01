import type { AppData, ID, Project } from '../../../shared/types'
import type { ImportDataResult, ImportDataStrategy } from '../../../shared/ipc/ipcTypes'
import type { SaveDataHandler } from '../utils/saveDataState'
import { now } from '../utils/format'

export interface PersistProps {
  data: AppData
  saveData: SaveDataHandler
}

export type ImportDataHandler = (strategy: ImportDataStrategy) => Promise<ImportDataResult>

export interface ProjectProps extends PersistProps {
  project: Project
}

export function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}
