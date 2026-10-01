import { useMemo } from 'react'
import type { AppData, ID } from '../../../shared/types'
import { projectData } from '../utils/projectData'

export function useProjectData(data: AppData, projectId: ID) {
  return useMemo(() => projectData(data, projectId), [data, projectId])
}
