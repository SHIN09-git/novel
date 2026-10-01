#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const scannedRoots = [
  'src/renderer/src/components',
  'src/renderer/src/hooks',
  'src/renderer/src/platform',
  'src/renderer/src/settings',
  'src/renderer/src/utils',
  'src/renderer/src/views'
]

const allowedFiles = new Set([
  // This helper intentionally treats placeholder text as empty context before sending it to AI.
  'src/renderer/src/views/revision/revisionAiContext.ts'
])

const forbiddenPatterns = [
  { pattern: /待补充/g, label: '待补充' },
  { pattern: /暂无与本章需求匹配/g, label: '暂无与本章需求匹配' },
  { pattern: /随便发挥/g, label: '随便发挥' }
]

function listSourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    const stat = statSync(absolute)
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(absolute))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(absolute)
    }
  }
  return files
}

const failures = []
for (const root of scannedRoots) {
  const absoluteRoot = join(repoRoot, root)
  for (const file of listSourceFiles(absoluteRoot)) {
    const path = relative(repoRoot, file).replace(/\\/g, '/')
    if (allowedFiles.has(path)) continue
    const source = readFileSync(file, 'utf8')
    for (const { pattern, label } of forbiddenPatterns) {
      const matches = [...source.matchAll(pattern)]
      for (const match of matches) {
        const line = source.slice(0, match.index).split(/\r?\n/).length
        failures.push(`${path}:${line} contains user-facing placeholder text "${label}"`)
      }
    }
  }
}

if (failures.length) {
  console.error('UI placeholder hygiene validation failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`validate-ui-placeholder-hygiene: ok (${scannedRoots.length} renderer roots scanned)`)
