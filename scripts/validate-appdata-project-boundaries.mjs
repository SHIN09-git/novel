#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'appdata-project-boundaries-test')

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

function assert(condition, message, details = undefined) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : ''
    throw new Error(`${message}${suffix}`)
  }
}

function unique(values) {
  return [...new Set(values)]
}

function extractArrayKeysFromAppData(source) {
  const match = source.match(/export interface AppData\s*\{([\s\S]*?)\n\}/)
  assert(match, 'Could not find AppData interface.')
  return unique(
    [...match[1].matchAll(/^\s+([A-Za-z0-9_]+):\s+[A-Za-z0-9_<>,\s|]+\[\]/gm)]
      .map((entry) => entry[1])
  )
}

function extractStringArray(source, constName) {
  const match = source.match(new RegExp(`export const ${constName} = \\[([\\s\\S]*?)\\] as const`))
  assert(match, `Could not parse ${constName}.`)
  return unique([...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]))
}

function extractObjectKeys(source, constName) {
  const match = source.match(new RegExp(`export const ${constName} = \\{([\\s\\S]*?)\\n\\} satisfies`))
  assert(match, `Could not parse ${constName}.`)
  return unique([...match[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((entry) => entry[1]))
}

async function bundle(relativePath, outfileName) {
  await mkdir(outDir, { recursive: true })
  const outfile = join(outDir, outfileName)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function makeFixture(arrayKeys, projectScopedCollections) {
  const data = {
    schemaVersion: 3,
    settings: { theme: 'system', marker: 'settings-must-survive' }
  }
  for (const key of arrayKeys) data[key] = []
  data.projects = [
    { id: 'project-a', name: '项目 A', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 'project-b', name: '项目 B', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
  ]
  for (const collection of projectScopedCollections) {
    data[collection] = [
      { id: `a-${collection}`, projectId: 'project-a' },
      { id: `b-${collection}`, projectId: 'project-b' }
    ]
  }
  data.chapterGenerationSteps = [
    { id: 'step-a', jobId: 'a-chapterGenerationJobs' },
    { id: 'step-b', jobId: 'b-chapterGenerationJobs' }
  ]
  data.revisionRequests = [
    { id: 'request-a', sessionId: 'a-revisionSessions' },
    { id: 'request-b', sessionId: 'b-revisionSessions' }
  ]
  data.revisionVersions = [
    { id: 'version-a', sessionId: 'a-revisionSessions' },
    { id: 'version-b', sessionId: 'b-revisionSessions' }
  ]
  return data
}

async function main() {
  await rm(outDir, { recursive: true, force: true })

  const appDataTypes = await read('src/shared/types/appData.ts')
  const metadataSource = await read('src/shared/appDataCollections.ts')
  const mergeFacade = await read('src/main/dataMerge/mergeCollections.ts')
  const referenceRemapping = await read('src/main/dataMerge/referenceRemapping.ts')
  const sqliteTypes = await read('src/storage/sqlite/sqliteTypes.ts')
  const sqliteEntityMapper = await read('src/storage/sqlite/sqliteEntityMapper.ts')
  const projectDataSource = await read('src/renderer/src/utils/projectData.ts')
  const homeView = await read('src/renderer/src/views/HomeView.tsx')

  const arrayKeys = extractArrayKeysFromAppData(appDataTypes)
  const projectScopedCollections = extractStringArray(metadataSource, 'PROJECT_SCOPED_COLLECTIONS')
  const dependentCollections = extractStringArray(metadataSource, 'DEPENDENT_COLLECTIONS')
  const labels = extractObjectKeys(metadataSource, 'APP_DATA_COLLECTION_LABELS')
  const expectedProjectScoped = arrayKeys.filter(
    (key) => key !== 'projects' && !dependentCollections.includes(key)
  )

  assert(
    expectedProjectScoped.every((key) => projectScopedCollections.includes(key)) &&
      projectScopedCollections.every((key) => expectedProjectScoped.includes(key)),
    'Shared project collection metadata must cover every direct project-scoped AppData collection.',
    { expectedProjectScoped, projectScopedCollections }
  )
  assert(
    ['chapterGenerationSteps', 'revisionRequests', 'revisionVersions']
      .every((key) => dependentCollections.includes(key)),
    'Shared metadata must declare all relation-scoped dependent collections.',
    { dependentCollections }
  )
  assert(
    arrayKeys.every((key) => labels.includes(key)),
    'Every AppData collection must have one user-facing shared label.',
    { missingLabels: arrayKeys.filter((key) => !labels.includes(key)) }
  )
  assert(
    mergeFacade.includes("from '../../shared/appDataCollections'") &&
      referenceRemapping.includes("from '../../shared/appDataCollections'") &&
      sqliteTypes.includes("from '../../shared/appDataCollections'") &&
      sqliteEntityMapper.includes('ALL_ENTITY_COLLECTIONS'),
    'Merge and SQLite boundaries must consume the shared collection metadata.'
  )
  assert(
    projectDataSource.includes('selectProjectScopedCollections') &&
      !projectDataSource.includes('projectJobIds') &&
      !projectDataSource.includes('projectRevisionSessionIds'),
    'projectData() must delegate project ownership and dependency scoping to ProjectLifecycleService.'
  )
  assert(
    homeView.includes('getProjectDeletionSummary') &&
      homeView.includes('formatProjectDeletionImpact') &&
      homeView.includes('removeProjectFromAppData') &&
      !homeView.includes('projectJobIds') &&
      !homeView.includes('projectRevisionSessionIds'),
    'HomeView must show a deletion impact summary and delegate cascade deletion to the lifecycle service.'
  )

  const metadata = await bundle('src/shared/appDataCollections.ts', 'appdata-collections.mjs')
  const lifecycle = await bundle('src/services/ProjectLifecycleService.ts', 'project-lifecycle.mjs')
  const fixture = makeFixture(arrayKeys, metadata.PROJECT_SCOPED_COLLECTIONS)
  const originalSettings = JSON.stringify(fixture.settings)

  const scoped = lifecycle.selectProjectScopedCollections(fixture, 'project-a')
  for (const collection of metadata.PROJECT_SCOPED_COLLECTIONS) {
    assert(
      scoped[collection].length === 1 && scoped[collection][0].projectId === 'project-a',
      `Project scope returned incorrect ${collection} records.`
    )
  }
  assert(scoped.chapterGenerationSteps[0]?.id === 'step-a', 'Project scope must follow job references for steps.')
  assert(scoped.revisionRequests[0]?.id === 'request-a', 'Project scope must follow session references for requests.')
  assert(scoped.revisionVersions[0]?.id === 'version-a', 'Project scope must follow session references for versions.')

  const summary = lifecycle.getProjectDeletionSummary(fixture, 'project-a')
  const expectedRelatedCount = metadata.PROJECT_SCOPED_COLLECTIONS.length + metadata.DEPENDENT_COLLECTIONS.length
  assert(summary.totalRelatedRecords === expectedRelatedCount, 'Deletion summary must count every related record.', {
    summary,
    expectedRelatedCount
  })
  assert(
    lifecycle.formatProjectDeletionImpact(summary).includes('章节 1 条'),
    'Deletion impact must explain meaningful author-facing collections.'
  )

  const removed = lifecycle.removeProjectFromAppData(fixture, 'project-a')
  assert(removed.projects.length === 1 && removed.projects[0].id === 'project-b', 'Deletion must retain other projects.')
  for (const collection of metadata.PROJECT_SCOPED_COLLECTIONS) {
    assert(
      removed[collection].length === 1 && removed[collection][0].projectId === 'project-b',
      `Deletion leaked or removed the wrong ${collection} records.`
    )
  }
  assert(removed.chapterGenerationSteps[0]?.id === 'step-b', 'Deletion must remove only the target project steps.')
  assert(removed.revisionRequests[0]?.id === 'request-b', 'Deletion must remove only target project requests.')
  assert(removed.revisionVersions[0]?.id === 'version-b', 'Deletion must remove only target project versions.')
  assert(JSON.stringify(removed.settings) === originalSettings, 'Deletion must preserve settings.')
  assert(fixture.projects.length === 2, 'Deletion service must not mutate its AppData input.')
  assert(
    JSON.stringify(lifecycle.removeProjectFromAppData(removed, 'project-a')) === JSON.stringify(removed),
    'Repeated project deletion must be idempotent.'
  )

  const opened = lifecycle.markProjectOpened(fixture, 'project-b', '2026-07-16T00:00:00.000Z')
  assert(
    opened.projects.find((project) => project.id === 'project-b')?.lastOpenedAt === '2026-07-16T00:00:00.000Z' &&
      !fixture.projects.find((project) => project.id === 'project-b')?.lastOpenedAt,
    'Opening a project must update recent-open state without mutating the input.'
  )

  console.log(JSON.stringify({
    ok: true,
    totalAppDataCollections: arrayKeys.length,
    directProjectScopedCollections: projectScopedCollections.length,
    dependentCollections: dependentCollections.length,
    deletionSummaryRecords: summary.totalRelatedRecords
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
