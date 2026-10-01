import { access, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

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
  const appShellSource = await readFile(join(root, 'src/renderer/src/components/layoutParts/AppShell.tsx'), 'utf-8')
  const mainSource = await readFile(join(root, 'src/renderer/src/main.tsx'), 'utf-8')
  const promptBuilderSource = await readFile(join(root, 'src/renderer/src/views/PromptBuilderView.tsx'), 'utf-8')
  const promptBudgetPanelSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptBudgetPanel.tsx'), 'utf-8')
  const promptChapterTaskPanelSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptChapterTaskPanel.tsx'), 'utf-8')
  const promptControlPanelSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptControlPanel.tsx'), 'utf-8')
  const promptEditorPanelSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptEditorPanel.tsx'), 'utf-8')
  const promptHistoryPanelsSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptHistoryPanels.tsx'), 'utf-8')
  const promptManualForeshadowingPanelSource = await readFile(join(root, 'src/renderer/src/views/promptBuilder/PromptManualForeshadowingPanel.tsx'), 'utf-8')
  const foreshadowingViewSource = await readFile(join(root, 'src/renderer/src/views/ForeshadowingView.tsx'), 'utf-8')
  const foreshadowingSortSource = await readFile(join(root, 'src/renderer/src/utils/foreshadowingSort.ts'), 'utf-8')
  const readerEmotionSource = await readFile(join(root, 'src/renderer/src/utils/readerEmotionPresets.ts'), 'utf-8')
  const legacyStylesPath = 'src/renderer/src/styles.css'
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
      !(await exists(legacyStylesPath)) &&
        !mainSource.includes("import './styles.css'") &&
        mainSource.includes("import './styles/index.css'"),
      'legacy styles.css shim is removed and main imports styles/index.css'
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

  checks.push(
    assert(
      foreshadowingViewSource.includes("from '../utils/foreshadowingSort'") &&
        foreshadowingViewSource.includes('.sort(compareForeshadowingByStatusWeightUpdatedAt)') &&
        foreshadowingSortSource.includes('archivedForeshadowingRank') &&
        foreshadowingSortSource.includes('FORESHADOWING_WEIGHT_ORDER'),
      'ForeshadowingView sorts through the shared unresolved/weight/archive ordering helper'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes("from '../utils/foreshadowingSort'") &&
        promptBuilderSource.includes('[...scoped.foreshadowings].sort(compareForeshadowingByStatusWeightUpdatedAt)'),
      'PromptBuilderView uses the shared weight/archive ordering for manual foreshadowing selection'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('<PromptBudgetPanel') &&
        promptBudgetPanelSource.includes('<h2>记忆预算调度</h2>') &&
        promptBudgetPanelSource.includes('prompt-budget-panel'),
      'PromptBuilderView renders memory budget scheduling through a dedicated panel component'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('<PromptControlPanel') &&
        promptControlPanelSource.includes('className="panel prompt-controls"') &&
        promptControlPanelSource.includes('<h2>上下文控制</h2>'),
      'PromptBuilderView renders left prompt controls through a dedicated panel component'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('<PromptChapterTaskPanel') &&
        promptChapterTaskPanelSource.includes('<h2>当前章节任务书</h2>') &&
        promptChapterTaskPanelSource.includes('prompt-chapter-task-panel'),
      'PromptBuilderView renders chapter task editing through a dedicated panel component'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('<PromptEditorPanel') &&
        promptEditorPanelSource.includes('<h2>最终 Prompt</h2>') &&
        promptEditorPanelSource.includes('prompt-editor'),
      'PromptBuilderView renders final prompt editing through a dedicated panel component'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.includes('<PromptHistoryPanels') &&
        promptHistoryPanelsSource.includes('<h2>上下文快照</h2>') &&
        promptHistoryPanelsSource.includes('<h2>已保存版本</h2>'),
      'PromptBuilderView renders prompt snapshots and saved versions through a dedicated history component'
    )
  )

  checks.push(
    assert(
      promptBuilderSource.lastIndexOf('<PromptManualForeshadowingPanel') > promptBuilderSource.lastIndexOf('<PromptHistoryPanels') &&
        promptManualForeshadowingPanelSource.includes('<h2>手动选择本章相关伏笔</h2>'),
      'PromptBuilderView renders manual foreshadowing selection at the bottom of the main column'
    )
  )

  checks.push(
    assert(
      readerEmotionSource.includes('function safeLocalStorage()') &&
        readerEmotionSource.includes('return window.localStorage ?? null') &&
        !readerEmotionSource.includes("if (typeof window === 'undefined' || !window.localStorage)") &&
        readerEmotionSource.includes('function stringArray(value: unknown): string[]'),
      'reader emotion presets handle unavailable or dirty localStorage without breaking generation UI'
    )
  )

  checks.push(
    assert(
      appShellSource.includes('function NavIcon') &&
        appShellSource.includes('<svg viewBox="0 0 24 24"') &&
        appShellSource.includes("import appIconUrl from '../../../../../build/icon.png'") &&
        appShellSource.includes('<img src={appIconUrl} alt="" />') &&
        !appShellSource.includes('viewIcons') &&
        ['dashboard', 'inbox', 'bible', 'chapters', 'characters', 'foreshadowings', 'timeline', 'stages', 'direction', 'prompt', 'pipeline', 'revision', 'settings'].every((view) =>
          appShellSource.includes(`case '${view}'`)
        ),
      'Sidebar navigation uses one-to-one inline SVG icons instead of letter placeholders'
    )
  )

  checks.push(
    assert(
      appShellSource.includes("{ label: '写作', items: ['dashboard', 'inbox', 'chapters', 'reader', 'pipeline', 'revision'] }") &&
        appShellSource.includes("{ label: '故事世界', items: ['direction', 'characters', 'foreshadowings', 'hardCanon', 'bible', 'timeline'] }") &&
        appShellSource.includes("{ label: '资料与高级', items: ['stages', 'prompt', 'agentRuns'] }") &&
        appShellSource.includes("group.items.includes(view) ? ' current' : ''"),
      'Sidebar groups primary writing actions ahead of worldbuilding and advanced tools'
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
