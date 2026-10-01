import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const files = {
  facade: 'src/services/AIService.ts',
  client: 'src/services/ai/AIClient.ts',
  transport: 'src/services/ai/AITransport.ts',
  templates: 'src/services/ai/AIPromptTemplates.ts',
  normalizer: 'src/services/ai/AIResponseNormalizer.ts',
  chapterReview: 'src/services/ai/ChapterReviewAI.ts',
  generationPipeline: 'src/services/ai/GenerationPipelineAI.ts',
  qualityGate: 'src/services/ai/QualityGateAI.ts',
  revision: 'src/services/ai/RevisionAI.ts'
}

const facadeMethods = [
  'generateChapterReview',
  'generatePostDraftAnalysis',
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

const rendererAiConsumers = [
  'src/renderer/src/views/generation/usePipelineRunnerCore.ts',
  'src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts',
  'src/renderer/src/views/RevisionStudioView.tsx',
  'src/renderer/src/views/chapters/useChapterAiDrafts.ts',
  'src/renderer/src/views/ReadingView.tsx',
  'src/renderer/src/views/StoryDirectionView.tsx',
  'src/renderer/src/views/StageSummaryView.tsx'
]

const lazyRendererAiConsumers = [
  'src/renderer/src/views/generation/usePipelineRunnerCore.ts',
  'src/renderer/src/views/generation/pipelineRevisionActionHandlers.ts',
  'src/renderer/src/views/StageSummaryView.tsx',
  'src/renderer/src/views/StoryDirectionView.tsx',
  'src/renderer/src/views/ReadingView.tsx',
  'src/renderer/src/views/chapters/useChapterAiDrafts.ts',
  'src/renderer/src/views/RevisionStudioView.tsx'
]

function push(checks, ok, message) {
  checks.push({ ok, message })
}

async function readProjectFile(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function listProjectFiles(relativeDir, extensions = new Set(['.ts', '.tsx'])) {
  const absoluteDir = join(root, relativeDir)
  const entries = await readdir(absoluteDir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`.replaceAll('\\', '/')
    if (entry.isDirectory()) {
      files.push(...(await listProjectFiles(relativePath, extensions)))
      continue
    }
    if ([...extensions].some((extension) => entry.name.endsWith(extension))) {
      files.push(relativePath)
    }
  }
  return files
}

async function main() {
  const checks = []
  const contents = {}

  for (const [name, relativePath] of Object.entries(files)) {
    const info = await stat(join(root, relativePath)).catch(() => null)
    push(checks, Boolean(info?.isFile()), `${name} module exists`)
    contents[name] = info?.isFile() ? await readProjectFile(relativePath) : ''
  }
  const normalizerModules = await Promise.all([
    'src/services/ai/responseNormalizers/primitives.ts',
    'src/services/ai/responseNormalizers/characterState.ts',
    'src/services/ai/responseNormalizers/chapter.ts',
    'src/services/ai/responseNormalizers/quality.ts',
    'src/services/ai/responseNormalizers/postDraft.ts'
  ].map(readProjectFile))
  const normalizerImplementation = normalizerModules.join('\n')
  push(
    checks,
    contents.normalizer.includes("export * from './responseNormalizers/primitives'") &&
      contents.normalizer.includes("export * from './responseNormalizers/chapter'") &&
      contents.normalizer.includes("export * from './responseNormalizers/quality'"),
    'AIResponseNormalizer remains a compatibility facade over domain normalizers'
  )

  for (const method of facadeMethods) {
    push(checks, contents.facade.includes(`${method}(`), `AIService facade keeps ${method}`)
  }

  push(checks, contents.templates.includes('export const REVIEW_SYSTEM_PROMPT = ['), 'review system prompt is exported')
  push(checks, contents.templates.includes('export const REVISION_SYSTEM_PROMPT = ['), 'revision system prompt is exported')
  push(checks, contents.templates.length > 500, 'prompt templates are non-empty')

  for (const exportName of [
    'ensureChapterReview',
    'ensurePostDraftAnalysis',
    'ensureCharacterSuggestions',
    'ensureForeshadowingExtraction',
    'ensureChapterPlan',
    'ensureChapterDraft',
    'ensureConsistencyReview',
    'ensureQualityGateEvaluation',
    'ensureRevisionResult'
  ]) {
    push(checks, normalizerImplementation.includes(`export function ${exportName}`), `normalizer exports ${exportName}`)
  }

  push(
    checks,
    contents.client.includes('AIChatCompletionTransport') &&
      contents.client.includes('this.transport.chatCompletion') &&
      !contents.client.includes('window.novelDirector'),
    'AIClient delegates chat completion through an injectable transport'
  )
  push(
    checks,
    contents.transport.includes('window.novelDirector') &&
      contents.transport.includes('bridge?.ai?.chatCompletion') &&
      contents.transport.includes('MissingAITransportBridgeError') &&
      contents.transport.includes('AI 桥接未加载'),
    'renderer AI transport owns and guards the preload AI bridge call'
  )
  const businessModules = ['chapterReview', 'generationPipeline', 'qualityGate', 'revision']
  for (const name of businessModules) {
    push(checks, !contents[name].includes('window.novelDirector'), `${name} does not call preload directly`)
  }

  for (const relativePath of rendererAiConsumers) {
    const source = await readProjectFile(relativePath)
    push(
      checks,
      !source.includes('new AIService()') &&
        (/new AIService\((?:data\.settings|settings|runSettings)(?:,|\))/.test(source)),
      `${relativePath} constructs AIService with explicit or frozen run settings (and optional run context)`
    )
  }
  for (const relativePath of lazyRendererAiConsumers) {
    const source = await readProjectFile(relativePath)
    push(
      checks,
      !source.includes("import { AIService }") && source.includes("await import(") && source.includes('services/AIService'),
      `${relativePath} lazy-loads AIService instead of statically importing it`
    )
  }
  const rendererRuntimeFiles = [
    ...(await listProjectFiles('src/renderer/src/views')),
    ...(await listProjectFiles('src/renderer/src/components')),
    ...(await listProjectFiles('src/renderer/src/hooks'))
  ]
  const runtimeAiImports = []
  for (const relativePath of rendererRuntimeFiles) {
    const source = await readProjectFile(relativePath)
    if (/import\s+\{\s*AIService\s*\}\s+from\s+['"][^'"]*services\/AIService['"]/.test(source)) {
      runtimeAiImports.push(relativePath)
    }
  }
  push(
    checks,
    runtimeAiImports.length === 0,
    runtimeAiImports.length
      ? `renderer runtime files must not statically import AIService: ${runtimeAiImports.join(', ')}`
      : 'renderer runtime files avoid static AIService imports'
  )

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
