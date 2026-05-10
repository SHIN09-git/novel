import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'memory-patch-structure-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function compileTsModule(relativePath, replacements = []) {
  let source = await read(relativePath)
  for (const [from, to] of replacements) {
    source = source.replace(from, to)
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return outPath
}

async function loadTsModule(relativePath, replacements = []) {
  const outPath = await compileTsModule(relativePath, replacements)
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

async function main() {
  const checks = []
  const typesSource = await read('src/shared/types.ts')
  const treatmentPath = await compileTsModule('src/shared/foreshadowingTreatment.ts')
  const defaults = await loadTsModule('src/shared/defaults.ts', [
    ["from './foreshadowingTreatment'", `from '${pathToFileURL(treatmentPath).href}'`]
  ])
  const runnerSource = await read('src/renderer/src/views/generation/usePipelineRunner.ts')
  const memorySource = await read('src/renderer/src/views/generation/useMemoryCandidates.ts')
  const uiSource = await read('src/renderer/src/views/GenerationPipelineView.tsx')
  const memoryPanelSource = await read('src/renderer/src/components/pipeline/PipelineMemoryCandidatesPanel.tsx')

  checks.push(
    assert(
      typesSource.includes('export type MemoryUpdatePatch') &&
        typesSource.includes('proposedPatch: MemoryUpdatePatch') &&
        !typesSource.includes('proposedPatch: string'),
      'MemoryUpdateCandidate.proposedPatch is a structured union, not string'
    )
  )

  checks.push(
    assert(
      runnerSource.includes("kind: 'chapter_review_update'") &&
        runnerSource.includes("kind: 'character_state_update'") &&
        runnerSource.includes("kind: 'foreshadowing_create'") &&
        runnerSource.includes("kind: 'foreshadowing_status_update'") &&
        !runnerSource.includes('proposedPatch: serializeOutput'),
      'new pipeline memory candidates create structured proposedPatch objects'
    )
  )

  checks.push(
    assert(
      !memorySource.includes('parseCandidateOutput') &&
        !memorySource.includes('safeParseJson') &&
        memorySource.includes('patch.kind ===') &&
        memorySource.includes('patchMatchesCandidate') &&
        memorySource.includes('normalizeMemoryUpdatePatch(patch.rawText'),
      'applyCandidate primary path branches on patch.kind and keeps legacy fallback'
    )
  )

  checks.push(
    assert(
      memorySource.includes('applyAllPendingCandidates') &&
        memorySource.includes('confirmQualityGateBypass') &&
        memoryPanelSource.includes('onAcceptAll') &&
        memoryPanelSource.includes('一键通过待确认'),
      'memory candidate panel supports one-click accepting pending structured candidates with the same confirmation guard'
    )
  )

  checks.push(
    assert(
      (uiSource.includes('renderMemoryPatchDetails') &&
        uiSource.includes("patch.kind === 'character_state_update'") &&
        uiSource.includes("patch.kind === 'foreshadowing_create'") &&
        !uiSource.includes('candidate.proposedPatch.slice')) ||
        (memoryPanelSource.includes('renderMemoryPatchDetails') &&
          memoryPanelSource.includes("patch.kind === 'character_state_update'") &&
          memoryPanelSource.includes("patch.kind === 'foreshadowing_create'") &&
          !memoryPanelSource.includes('candidate.proposedPatch.slice')),
      'GenerationPipelineView renders structured patch details instead of slicing raw JSON'
    )
  )

  const oldData = defaults.normalizeAppData({
    schemaVersion: 2,
    projects: [],
    memoryUpdateCandidates: [
      {
        id: 'review-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'chapter_review',
        targetId: null,
        proposedPatch: JSON.stringify({
          summary: '本章推进主角怀疑。',
          newInformation: '钥匙来自旧城。',
          characterChanges: '主角更谨慎。',
          newForeshadowing: '银色钥匙。',
          resolvedForeshadowing: '',
          endingHook: '门后有人。',
          riskWarnings: '不要立刻揭底。'
        }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'character-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'character',
        targetId: 'char-1',
        proposedPatch: JSON.stringify({ characterId: 'char-1', changeSummary: '她开始怀疑主角。' }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'new-foreshadowing',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'foreshadowing',
        targetId: null,
        proposedPatch: JSON.stringify({
          kind: 'new',
          candidate: { title: '银色钥匙', description: '钥匙会打开旧城门。', suggestedWeight: 'high', expectedPayoff: '第 5 章', relatedCharacterIds: [], notes: '' }
        }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'status-foreshadowing',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'foreshadowing',
        targetId: 'foreshadowing-1',
        proposedPatch: JSON.stringify({ kind: 'status', change: { foreshadowingId: 'foreshadowing-1', suggestedStatus: 'partial', evidenceText: '钥匙出现。' } }),
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      },
      {
        id: 'raw-candidate',
        projectId: 'project-1',
        jobId: 'job-1',
        type: 'character',
        targetId: null,
        proposedPatch: 'not-json',
        evidence: '',
        confidence: 0.5,
        status: 'pending',
        createdAt: 't',
        updatedAt: 't'
      }
    ]
  })

  const byId = new Map(oldData.memoryUpdateCandidates.map((candidate) => [candidate.id, candidate.proposedPatch]))
  checks.push(assert(byId.get('review-candidate')?.kind === 'chapter_review_update', 'old chapter review string converts to chapter_review_update'))
  checks.push(assert(byId.get('character-candidate')?.kind === 'character_state_update', 'old character string converts to character_state_update'))
  checks.push(assert(byId.get('new-foreshadowing')?.kind === 'foreshadowing_create', 'old new foreshadowing string converts to foreshadowing_create'))
  checks.push(assert(byId.get('status-foreshadowing')?.kind === 'foreshadowing_status_update', 'old status foreshadowing string converts to foreshadowing_status_update'))
  checks.push(
    assert(
      byId.get('raw-candidate')?.kind === 'legacy_raw' && byId.get('raw-candidate')?.rawText === 'not-json',
      'unrecognized old string becomes legacy_raw without losing rawText'
    )
  )

  checks.push(
    assert(
      memorySource.includes('记忆候选类型与补丁类型不匹配') &&
        memorySource.includes('已跳过') &&
        memorySource.includes("patch.kind === 'legacy_raw'"),
      'legacy_raw failures and type/kind mismatches are blocked before applying'
    )
  )

  const failed = checks.filter((check) => !check.ok)
  const report = { ok: failed.length === 0, totalChecks: checks.length, failed }
  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
