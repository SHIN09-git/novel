import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function read(relativePath) {
  return readFile(join(root, relativePath), 'utf-8')
}

async function exists(relativePath) {
  const fileStat = await stat(join(root, relativePath)).catch(() => null)
  return Boolean(fileStat?.isFile())
}

async function main() {
  const checks = []
  const appSource = await read('src/renderer/src/App.tsx')
  const viteConfigSource = await read('electron.vite.config.ts')
  const pipelineConsoleSource = await read('src/renderer/src/views/generation/GenerationPipelineConsole.tsx')
  const generationViewSource = await read('src/renderer/src/views/GenerationPipelineView.tsx')
  const foreshadowingViewSource = await read('src/renderer/src/views/ForeshadowingView.tsx')
  const foreshadowingRecommendationsSource = await read('src/renderer/src/utils/foreshadowingRecommendations.ts')
  const chaptersViewSource = await read('src/renderer/src/views/ChaptersView.tsx')
  const chapterVersionActionsSource = await read('src/renderer/src/views/chapters/useChapterVersionActions.ts')
  const chapterCharacterActionsSource = await read('src/renderer/src/views/chapters/useChapterCharacterActions.ts')
  const chapterForeshadowingActionsSource = await read('src/renderer/src/views/chapters/useChapterForeshadowingActions.ts')
  const traceActionsSource = await read('src/renderer/src/views/generation/usePipelineTraceActions.ts')
  const pipelineTracePanelSource = await read('src/renderer/src/components/pipeline/PipelineTracePanel.tsx')
  const mainSource = await read('src/renderer/src/main.tsx')
  const generationCss = await read('src/renderer/src/styles/views/generation.css')
  const settingsCss = await read('src/renderer/src/styles/views/settings.css')
  const revisionCss = await read('src/renderer/src/styles/views/revision.css')
  const runTraceCss = await read('src/renderer/src/styles/features/run-trace.css')
  const revisionDiffCss = await read('src/renderer/src/styles/features/revision-diff.css')
  const memoryCandidateCss = await read('src/renderer/src/styles/features/memory-candidates.css')

  checks.push(assert(/import\s+\{[^}]*\blazy\b[^}]*\bSuspense\b[^}]*\}\s+from\s+['"]react['"]/.test(appSource), 'App.tsx imports lazy and Suspense from React'))

  for (const [viewName, importPath] of [
    ['HomeView', './views/HomeView'],
    ['DashboardView', './views/DashboardView'],
    ['BibleView', './views/BibleView'],
    ['CharactersView', './views/CharactersView'],
    ['ForeshadowingView', './views/ForeshadowingView'],
    ['TimelineView', './views/TimelineView'],
    ['StageSummaryView', './views/StageSummaryView'],
    ['GenerationPipelineView', './views/GenerationPipelineView'],
    ['RevisionStudioView', './views/RevisionStudioView'],
    ['SettingsView', './views/SettingsView']
  ]) {
    checks.push(
      assert(
        appSource.includes(`const ${viewName} = lazy`) && appSource.includes(`import('${importPath}')`),
        `${viewName} uses React.lazy with dynamic import`
      )
    )
  }

  checks.push(
    assert(
      appSource.includes('const ChaptersView = lazy') && appSource.includes("import('./views/ChaptersView')"),
      'ChaptersView is lazy-loaded because it is a heavier editor surface'
    )
  )

  checks.push(assert(appSource.includes('<Suspense fallback={<div className="view-loading">'), 'App.tsx wraps current view in a stable Suspense fallback'))
  checks.push(assert(appSource.includes('function renderCurrentView') && appSource.includes('switch (view)'), 'App.tsx still renders through renderCurrentView switch'))
  checks.push(assert(!/const\s+content\s*=\s*\{[\s\S]*\}\s*\[\s*view\s*\]/.test(appSource), 'App.tsx does not recreate all views through a content object'))
  checks.push(assert(!appSource.includes('react-router') && !mainSource.includes('react-router'), 'React Router was not introduced'))
  checks.push(assert(mainSource.includes("import './styles/index.css'"), 'Renderer entry still loads styles/index.css'))
  checks.push(assert(viteConfigSource.includes('manualChunks(id)') && viteConfigSource.includes("'vendor-react'"), 'Renderer build splits React vendor code out of the main entry chunk'))
  checks.push(assert(pipelineConsoleSource.includes("import('../../components/pipeline/PipelineDiagnosticsPanel')"), 'Pipeline diagnostics panel is lazy-loaded inside the console'))
  checks.push(assert(pipelineConsoleSource.includes("import('../../components/pipeline/PipelineMemoryCandidatesPanel')"), 'Pipeline memory candidates panel is lazy-loaded inside the console'))
  checks.push(assert(pipelineConsoleSource.includes("import('../../components/pipeline/PipelineTracePanel')"), 'Pipeline trace panel is lazy-loaded inside the console'))
  checks.push(assert(!generationViewSource.includes('RunTracePanel'), 'GenerationPipelineView does not import the full RunTracePanel component'))
  checks.push(assert(chaptersViewSource.includes("import('./chapters/ChapterAIDraftPanels')"), 'Chapter AI result panels load only after an AI result exists'))
  checks.push(assert(chaptersViewSource.includes("import('./chapters/ChapterVersionHistoryPanel')"), 'Chapter version history loads only when the author opens it'))
  checks.push(assert(chaptersViewSource.includes("import('./chapters/ChapterReviewPanel')"), 'Chapter review fields load only when the author opens the review panel'))
  checks.push(assert(chaptersViewSource.includes('chapterAi.hasOutput ?'), 'Chapter AI result chunk is not rendered before a result exists'))
  checks.push(assert(chaptersViewSource.includes('showReviewPanel ?'), 'Chapter review panel remains explicitly author-controlled'))
  checks.push(assert(chapterVersionActionsSource.includes("import('./chapterVersionActionHandlers')"), 'Chapter version mutations load on demand'))
  checks.push(assert(chapterCharacterActionsSource.includes("import('./chapterAiCandidateActionHandlers')"), 'Character candidate mutations load on demand'))
  checks.push(assert(chapterForeshadowingActionsSource.includes("import('./chapterAiCandidateActionHandlers')"), 'Foreshadowing candidate mutations load on demand'))
  checks.push(assert(traceActionsSource.includes("from './runTraceSummary'"), 'Run Trace summary utility is imported only by the trace actions hook'))
  checks.push(assert(pipelineTracePanelSource.includes("from '../../views/generation/runTraceSummary'"), 'PipelineTracePanel avoids importing the full RunTracePanel component'))
  checks.push(
    assert(
      !foreshadowingViewSource.includes("from '../utils/promptContext'") &&
        foreshadowingViewSource.includes("from '../utils/foreshadowingRecommendations'") &&
        foreshadowingRecommendationsSource.includes("from '../../../shared/chapterText'"),
      'ForeshadowingView does not pull PromptBuilder and ContextBudgetManager through promptContext'
    )
  )

  checks.push(assert(generationCss.includes('.generation-view .pipeline-workbench'), 'generation styles are scoped under .generation-view'))
  checks.push(assert(generationCss.includes('.generation-view .pipeline-step'), 'pipeline step styles are scoped under .generation-view'))
  checks.push(assert(settingsCss.includes('.settings-view .settings-grid'), 'settings layout styles are scoped under .settings-view'))
  checks.push(assert(settingsCss.includes('.settings-view .local-data-section .storage-path'), 'storage path styles are scoped under .settings-view'))
  checks.push(assert(revisionCss.includes('.revision-view .revision-studio-layout'), 'revision layout styles are scoped under .revision-view'))
  checks.push(assert(revisionCss.includes('.revision-view .quality-issue'), 'quality issue styles are scoped under .revision-view'))
  checks.push(assert(runTraceCss.includes('.generation-view .run-trace-panel'), 'run trace feature styles have a generation-view scope'))
  checks.push(assert(revisionDiffCss.includes('.revision-view .revision-diff'), 'revision diff feature styles have a revision-view scope'))
  checks.push(assert(memoryCandidateCss.includes('.generation-view .candidate-card') && memoryCandidateCss.includes('.chapters-view .candidate-card'), 'memory candidate styles are scoped to generation and chapters views'))

  for (const file of [
    'src/renderer/src/styles/views/generation.css',
    'src/renderer/src/styles/views/settings.css',
    'src/renderer/src/styles/views/revision.css',
    'src/renderer/src/styles/features/run-trace.css',
    'src/renderer/src/styles/features/revision-diff.css'
  ]) {
    checks.push(assert(await exists(file), `${file} exists`))
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
