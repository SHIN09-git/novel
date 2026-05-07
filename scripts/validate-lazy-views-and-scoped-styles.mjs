import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

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
  const mainSource = await read('src/renderer/src/main.tsx')
  const generationCss = await read('src/renderer/src/styles/views/generation.css')
  const settingsCss = await read('src/renderer/src/styles/views/settings.css')
  const revisionCss = await read('src/renderer/src/styles/views/revision.css')
  const runTraceCss = await read('src/renderer/src/styles/features/run-trace.css')
  const revisionDiffCss = await read('src/renderer/src/styles/features/revision-diff.css')
  const memoryCandidateCss = await read('src/renderer/src/styles/features/memory-candidates.css')

  checks.push(assert(/import\s+\{\s*lazy\s*,\s*Suspense\s*,\s*useState\s*\}\s+from\s+['"]react['"]/.test(appSource), 'App.tsx imports lazy and Suspense from React'))

  for (const [viewName, importPath] of [
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
