import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function readSource(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function listFiles(directory, suffix) {
  const entries = await readdir(join(root, directory))
  const files = []
  for (const entry of entries) {
    const relativePath = `${directory}/${entry}`
    const entryStat = await stat(join(root, relativePath))
    if (entryStat.isDirectory()) {
      files.push(...(await listFiles(relativePath, suffix)))
    } else if (relativePath.endsWith(suffix)) {
      files.push(relativePath)
    }
  }
  return files
}

async function main() {
  const checks = []
  const targets = [
    {
      file: 'src/renderer/src/views/ForeshadowingView.tsx',
      minimumFunctionalSaves: 3,
      requiredSnippets: ['foreshadowings: [...current.foreshadowings, item]', 'current.foreshadowings.map', 'current.foreshadowings.filter']
    },
    {
      file: 'src/renderer/src/views/TimelineView.tsx',
      minimumFunctionalSaves: 3,
      requiredSnippets: ['timelineEvents: [...current.timelineEvents, event]', 'current.timelineEvents.map', 'current.timelineEvents.filter']
    },
    {
      file: 'src/renderer/src/views/StageSummaryView.tsx',
      minimumFunctionalSaves: 3,
      requiredSnippets: [
        'stageSummaries: [...current.stageSummaries, summary]',
        'current.stageSummaries.map',
        'const remaining = current.stageSummaries.filter',
        'chapters: current.chapters.map'
      ]
    }
  ]

  const viewFiles = await listFiles('src/renderer/src/views', '.tsx')
  const componentFiles = await listFiles('src/renderer/src/components', '.tsx')
  const hookFiles = await listFiles('src/renderer/src/views/generation', '.ts')

  for (const file of viewFiles) {
    const source = await readSource(file)
    checks.push(
      assert(!/saveData\s*\(\s*\{/.test(source), `${file} does not use stale-closure saveData({...data}) writes`)
    )
  }

  for (const file of [...viewFiles, ...hookFiles]) {
    const source = await readSource(file)
    checks.push(
      assert(!/\bconfirm\s*\(/.test(source), `${file} uses ConfirmDialog instead of native confirm()`)
    )
  }

  const confirmDialogSource = await readSource('src/renderer/src/components/ConfirmDialog.tsx')
  const mainSource = await readSource('src/renderer/src/main.tsx')
  checks.push(assert(confirmDialogSource.includes('export function ConfirmProvider'), 'ConfirmProvider is available for shared dangerous-operation confirmation'))
  checks.push(assert(mainSource.includes('<ConfirmProvider>'), 'renderer root is wrapped in ConfirmProvider'))
  checks.push(
    assert(
      componentFiles.includes('src/renderer/src/components/ConfirmDialog.tsx'),
      'ConfirmDialog component is part of renderer components'
    )
  )

  for (const target of targets) {
    const source = await readSource(target.file)
    const legacyObjectSaveMatches = source.match(/saveData\s*\(\s*\{/g) ?? []
    const functionalSaveMatches = source.match(/saveData\s*\(\s*\(\s*current\s*\)/g) ?? []

    checks.push(
      assert(
        legacyObjectSaveMatches.length === 0,
        `${target.file} does not use stale-closure saveData({...data}) writes`,
        { legacyObjectSaveMatches: legacyObjectSaveMatches.length }
      )
    )
    checks.push(
      assert(
        functionalSaveMatches.length >= target.minimumFunctionalSaves,
        `${target.file} uses functional saveData for core mutations`,
        { functionalSaveMatches: functionalSaveMatches.length }
      )
    )

    for (const snippet of target.requiredSnippets) {
      checks.push(assert(source.includes(snippet), `${target.file} keeps ${snippet} based on current AppData`))
    }
  }

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
