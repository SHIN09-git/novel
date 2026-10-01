import { app } from 'electron'
import { stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path'
import { validateFilePath } from '../../shared/validation'
import { SQLITE_DATA_FILE_NAME } from '../../storage/StorageService'

export const localDataFileExtensions = new Set(['.sqlite', '.db', '.json'])

export function isPathInsideOrSame(childPath: string, parentPath: string): boolean {
  const parent = resolve(parentPath)
  const child = resolve(childPath)
  const relationship = relative(parent, child)
  return relationship === '' || (!!relationship && !relationship.startsWith('..') && !isAbsolute(relationship))
}

export function getForbiddenStorageRoots(): string[] {
  const roots = [
    process.env.SystemRoot,
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData
  ]

  if (app.isPackaged) {
    roots.push(dirname(process.execPath), app.getAppPath())
  }

  return roots.filter((root): root is string => Boolean(root?.trim()))
}

export function assertSafeDataStoragePath(candidatePath: string): string {
  const candidate = resolve(candidatePath)
  const extension = extname(candidate).toLowerCase()
  if (!localDataFileExtensions.has(extension)) {
    throw new Error('Data storage path must end with .sqlite, .db, or .json.')
  }

  const targetDir = dirname(candidate)
  if (parse(targetDir).root === targetDir) {
    throw new Error('Data storage path cannot be a filesystem root directory.')
  }

  for (const forbiddenRoot of getForbiddenStorageRoots()) {
    if (isPathInsideOrSame(candidate, forbiddenRoot)) {
      throw new Error('Data storage path cannot be inside a protected system or application directory.')
    }
  }

  return candidate
}

export async function resolveDataStoragePath(rawPath: string): Promise<string> {
  const trimmed = validateFilePath(rawPath, 'Data storage path')
  const absolutePath = resolve(trimmed)
  let candidatePath = ''

  try {
    const info = await stat(absolutePath)
    if (info.isDirectory()) candidatePath = join(absolutePath, SQLITE_DATA_FILE_NAME)
  } catch {
    // Non-existing paths are allowed if they end with a known local-data extension; otherwise treat them as folders.
  }

  if (!candidatePath) {
    const extension = extname(absolutePath).toLowerCase()
    if (extension) {
      if (!localDataFileExtensions.has(extension)) {
        throw new Error('Data storage path must end with .sqlite, .db, or .json.')
      }
      candidatePath = absolutePath
    } else {
      candidatePath = join(absolutePath, SQLITE_DATA_FILE_NAME)
    }
  }

  return assertSafeDataStoragePath(candidatePath)
}
