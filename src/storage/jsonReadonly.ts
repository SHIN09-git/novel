import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { normalizeAppData } from '../shared/defaults'
import type { AppData } from '../shared/types'
import type { StorageSnapshot } from './StorageService'

/** Queries must not initialize a missing book or run the legacy corruption-recovery writer. */
export async function loadJsonSnapshotReadonly(path: string): Promise<StorageSnapshot> {
  const raw = await readFile(path, 'utf8')
  return { data: normalizeAppData(JSON.parse(raw) as Partial<AppData>),
    revision: createHash('sha256').update(raw).digest('hex') }
}
