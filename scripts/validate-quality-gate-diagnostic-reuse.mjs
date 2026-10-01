import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [join(repoRoot, relativePath)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent'
  })
  const source = result.outputFiles[0]?.text
  if (!source) throw new Error(`Unable to bundle ${relativePath}`)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

const [{ buildLocalQualityEvaluation }, qualitySource, diagnosticsSource, ipcSource] = await Promise.all([
  loadModule('src/services/qualityGate/localQualityRules.ts'),
  readFile(join(repoRoot, 'src/services/QualityGateService.ts'), 'utf8'),
  readFile(join(repoRoot, 'src/main/services/DiagnosticsService.ts'), 'utf8'),
  readFile(join(repoRoot, 'src/shared/ipc/ipcTypes.ts'), 'utf8')
])

const body = Array.from({ length: 180 }, (_, index) => `第${index + 1}步继续推进现场行动，角色作出新的选择。`).join('\n')
const precomputed = {
  id: 'redundancy-current-draft',
  projectId: 'project-1',
  jobId: 'job-1',
  chapterId: null,
  draftId: 'draft-1',
  draftContentHash: 'hash-1',
  repeatedPhrases: [],
  repeatedSceneDescriptions: [],
  repeatedExplanations: [],
  overusedIntensifiers: [],
  redundantParagraphs: [],
  compressionSuggestions: [],
  overallRedundancyScore: 5,
  createdAt: '2026-09-06T00:00:00.000Z'
}

const evaluation = buildLocalQualityEvaluation(
  { title: '复用诊断', body },
  null,
  '',
  undefined,
  [],
  null,
  precomputed
)

assert(evaluation.dimensions.redundancyControl === 77, 'quality gate must reuse the supplied redundancy score')
assert(!evaluation.issues.some((issue) => issue.type === 'redundancy_control'), 'a low-risk supplied report must not be replaced by a second scan')
assert(qualitySource.includes('options.redundancyReport'), 'QualityGateService must forward the precomputed report')
assert(diagnosticsSource.includes('redundancyReport: request.redundancyReport'), 'main diagnostics must preserve the supplied report')
assert(ipcSource.includes('redundancyReport?: RedundancyReport | null'), 'diagnostics IPC must support a precomputed report')

console.log('validate-quality-gate-diagnostic-reuse: all checks passed')
