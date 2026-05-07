import type { AppData, ID, Project } from '../../../shared/types'
import type { SaveDataInput } from '../hooks/useAppData'
import { now } from '../utils/format'

export interface PersistProps {
  data: AppData
  saveData: (next: SaveDataInput) => Promise<void>
}

export interface ProjectProps extends PersistProps {
  project: Project
}

export function updateProjectTimestamp(data: AppData, projectId: ID): Project[] {
  return data.projects.map((project) => (project.id === projectId ? { ...project, updatedAt: now() } : project))
}
