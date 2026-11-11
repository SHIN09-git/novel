import type { ProjectScopedCollectionKey } from './appDataCollections'
import { EMPTY_APP_DATA } from './defaults'
import type { AppData, ID } from './types'

// A save can replace a library-wide array while leaving this book's rows untouched.
export function createBookCollectionSelection(projectId: ID, keys: readonly ('projects' | ProjectScopedCollectionKey)[]) {
  let previous: AppData | undefined
  let scoped = EMPTY_APP_DATA
  return (data: AppData) => {
    let next = scoped
    for (const key of keys) {
      if (previous?.[key] === data[key]) continue
      const rows = data[key].filter(row => ('projectId' in row ? row.projectId : row.id) === projectId)
      const old = scoped[key]
      if (rows.length === old.length && rows.every((row, i) => row === old[i])) continue
      if (next === scoped) next = { ...scoped }
      Object.assign(next, { [key]: rows })
    }
    previous = data
    scoped = next
    return scoped
  }
}
