import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { normalizeAppData } from '../shared/defaults'
import type { AppData } from '../shared/types'
import type { StorageSnapshot } from './StorageService'
import { decodeLibraryText } from './libraryValidation'

/** Queries must not initialize a missing book or run the legacy corruption-recovery writer. */
export async function loadJsonSnapshotReadonly(path: string): Promise<StorageSnapshot> {
  const bytes = await readFile(path)
  return { data: normalizeAppData(JSON.parse(decodeLibraryText(bytes)) as Partial<AppData>),
    revision: createHash('sha256').update(bytes).digest('hex') }
}
