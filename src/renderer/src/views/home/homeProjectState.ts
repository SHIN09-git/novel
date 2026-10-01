import type { Project } from '../../../../shared/types'

export type ProjectFields = Pick<
  Project,
  'name' | 'genre' | 'description' | 'targetReaders' | 'coreAppeal' | 'style'
>

export const emptyProjectFields = (): ProjectFields => ({
  name: '',
  genre: '',
  description: '',
  targetReaders: '',
  coreAppeal: '',
  style: ''
})

export function projectFieldsFrom(project: Project): ProjectFields {
  const { name, genre, description, targetReaders, coreAppeal, style } = project
  return { name, genre, description, targetReaders, coreAppeal, style }
}

export function applyProjectFields(project: Project, fields: ProjectFields, updatedAt: string): Project {
  return {
    ...project,
    ...fields,
    name: fields.name.trim(),
    updatedAt
  }
}

export function projectMatchesSearch(project: Project, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalizedQuery) return true
  return [
    project.name,
    project.genre,
    project.description,
    project.targetReaders,
    project.coreAppeal,
    project.style
  ].some((value) => value.toLocaleLowerCase('zh-CN').includes(normalizedQuery))
}

export function projectsByRecentOpen(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const bTime = b.lastOpenedAt || b.updatedAt || b.createdAt
    const aTime = a.lastOpenedAt || a.updatedAt || a.createdAt
    return bTime.localeCompare(aTime)
  })
}
