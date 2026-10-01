import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep validation scripts independent of the caller's current working directory.
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
