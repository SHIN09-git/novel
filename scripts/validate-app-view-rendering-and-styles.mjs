import { access, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('.')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function exists(relativePath) {
  try {
    await access(join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function main() {
  const checks = []
  const appSource = await readFile(join(root, 'src/renderer/src/App.tsx'), 'utf-8')
  const mainSource = await readFile(join(root, 'src/renderer/src/main.tsx'), 'utf-8')
  const stylesSource = await readFile(join(root, 'src/renderer/src/styles.css'), 'utf-8')
  const indexCssPath = 'src/renderer/src/styles/index.css'
  const indexCss = await readFile(join(root, indexCssPath), 'utf-8')

  checks.push(
    assert(
      !/const\s+content\s*=\s*\{[\s\S]*\}\s*\[\s*view\s*\]/.test(appSource),
      'App.tsx no longer creates every view element through a content object'
    )
  )

  checks.push(
    assert(
      appSource.includes('function renderCurrentView') &&
        appSource.includes('switch (view)') &&
        appSource.includes('{renderCurrentView(data, currentProject)}'),
      'App.tsx renders only the current view through renderCurrentView switch'
    )
  )

  checks.push(
    assert(!appSource.includes('react-router') && !mainSource.includes('react-router'), 'React Router was not introduced')
  )

  checks.push(
    assert(
      stylesSource.split(/\r?\n/).filter((line) => line.trim()).length <= 3 &&
        !mainSource.includes("import './styles.css'") &&
        mainSource.includes("import './styles/index.css'"),
      'styles.css is no longer the giant entry and main imports styles/index.css'
    )
  )

  checks.push(assert(await exists(indexCssPath), 'styles/index.css exists'))

  for (const importPath of [
    './base.css',
    './app-shell.css',
    './components.css',
    './views/chapters.css',
    './views/generation.css',
    './views/settings.css',
    './views/revision.css',
    './features/run-trace.css'
  ]) {
    checks.push(assert(indexCss.includes(`@import '${importPath}'`) || indexCss.includes(`@import "${importPath}"`), `index.css imports ${importPath}`))
  }

  for (const file of [
    'src/renderer/src/styles/views/generation.css',
    'src/renderer/src/styles/views/settings.css',
    'src/renderer/src/styles/features/run-trace.css'
  ]) {
    const fileStat = await stat(join(root, file)).catch(() => null)
    checks.push(assert(Boolean(fileStat?.isFile()), `${file} exists`))
  }

  const scopedViews = [
    ['src/renderer/src/views/DashboardView.tsx', 'dashboard-view'],
    ['src/renderer/src/views/BibleView.tsx', 'bible-view'],
    ['src/renderer/src/views/ChaptersView.tsx', 'chapters-view'],
    ['src/renderer/src/views/GenerationPipelineView.tsx', 'generation-view'],
    ['src/renderer/src/views/RevisionStudioView.tsx', 'revision-view'],
    ['src/renderer/src/views/SettingsView.tsx', 'settings-view'],
    ['src/renderer/src/views/PromptBuilderView.tsx', 'prompt-view']
  ]

  for (const [file, className] of scopedViews) {
    const source = await readFile(join(root, file), 'utf-8')
    checks.push(assert(source.includes(`className="${className}"`), `${file} has stable root scope class ${className}`))
  }

  checks.push(
    assert(
      appSource.includes('<GenerationPipelineView') &&
        appSource.includes('<RevisionStudioView') &&
        appSource.includes('<SettingsView'),
      'heavy views remain accessible through the switch without changing exports'
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
