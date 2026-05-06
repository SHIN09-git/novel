import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')
const files = {
  facade: 'src/services/AIService.ts',
  client: 'src/services/ai/AIClient.ts',
  templates: 'src/services/ai/AIPromptTemplates.ts',
  normalizer: 'src/services/ai/AIResponseNormalizer.ts',
  chapterReview: 'src/services/ai/ChapterReviewAI.ts',
  generationPipeline: 'src/services/ai/GenerationPipelineAI.ts',
  qualityGate: 'src/services/ai/QualityGateAI.ts',
  revision: 'src/services/ai/RevisionAI.ts'
}

const facadeMethods = [
  'generateChapterReview',
  'generateChapterPlan',
  'generateChapterDraft',
  'generateStageSummary',
  'updateCharacterStates',
  'extractForeshadowing',
  'generateNextChapterSuggestions',
  'generateConsistencyReview',
  'generateQualityGateReport',
  'generateRevisionCandidate',
  'generateRevision',
  'reduceAITone',
  'improveDialogue',
  'strengthenConflict',
  'compressPacing',
  'buildNextChapterPrompt'
]

function push(checks, ok, message) {
  checks.push({ ok, message })
}

async function readProjectFile(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function main() {
  const checks = []
  const contents = {}

  for (const [name, relativePath] of Object.entries(files)) {
    const info = await stat(join(root, relativePath)).catch(() => null)
    push(checks, Boolean(info?.isFile()), `${name} module exists`)
    contents[name] = info?.isFile() ? await readProjectFile(relativePath) : ''
  }

  for (const method of facadeMethods) {
    push(checks, contents.facade.includes(`${method}(`), `AIService facade keeps ${method}`)
  }

  push(checks, contents.templates.includes('export const REVIEW_SYSTEM_PROMPT = ['), 'review system prompt is exported')
  push(checks, contents.templates.includes('export const REVISION_SYSTEM_PROMPT = ['), 'revision system prompt is exported')
  push(checks, contents.templates.length > 500, 'prompt templates are non-empty')

  for (const exportName of [
    'ensureChapterReview',
    'ensureCharacterSuggestions',
    'ensureForeshadowingExtraction',
    'ensureChapterPlan',
    'ensureChapterDraft',
    'ensureConsistencyReview',
    'ensureQualityGateEvaluation',
    'ensureRevisionResult'
  ]) {
    push(checks, contents.normalizer.includes(`export function ${exportName}`), `normalizer exports ${exportName}`)
  }

  push(checks, contents.client.includes('window.novelDirector.ai.chatCompletion'), 'only AIClient talks to preload AI API')
  const businessModules = ['chapterReview', 'generationPipeline', 'qualityGate', 'revision']
  for (const name of businessModules) {
    push(checks, !contents[name].includes('window.novelDirector'), `${name} does not call preload directly`)
  }

  const report = {
    ok: checks.every((check) => check.ok),
    totalChecks: checks.length,
    failed: checks.filter((check) => !check.ok)
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
