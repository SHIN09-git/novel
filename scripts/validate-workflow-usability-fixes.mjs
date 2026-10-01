import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'workflow-usability-fixes')

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`)
}

async function loadPrimaryAction() {
  await mkdir(outDir, { recursive: true })
  const entry = join(outDir, 'entry.ts')
  const outfile = join(outDir, 'bundle.mjs')
  await writeFile(entry, "export * from '../../src/renderer/src/views/generation/usePipelinePrimaryAction'\n", 'utf8')
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function baseArgs(overrides = {}) {
  const calls = []
  return {
    calls,
    args: {
      selectedJob: { id: 'job-11', status: 'completed', targetChapterOrder: 11 },
      selectedSteps: [],
      latestDraft: { id: 'draft-11', status: 'draft' },
      latestQualityReport: { id: 'quality-11', pass: false },
      isPipelineRunning: false,
      onStartPipeline: () => calls.push('start'),
      onStartNextChapter: () => calls.push('next'),
      onRetryStep: () => calls.push('retry'),
      onAcceptDraft: () => calls.push('accept'),
      onActiveArtifactTabChange: (tab) => calls.push(`tab:${tab}`),
      ...overrides
    }
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  const { usePipelinePrimaryAction } = await loadPrimaryAction()

  const blocked = baseArgs()
  const blockedAction = usePipelinePrimaryAction(blocked.args)
  assert(blockedAction.primaryActionLabel === '审核后接受草稿', '未通过报告仍应提供人工审核后的采纳入口。')
  blockedAction.runPrimaryAction()
  assert(blocked.calls.join(',') === 'accept', '确认记忆候选后，主操作仍必须路由到草稿采纳。', blocked.calls)

  const accepted = baseArgs({ latestDraft: { id: 'draft-11', status: 'accepted' } })
  const acceptedAction = usePipelinePrimaryAction(accepted.args)
  assert(acceptedAction.primaryActionLabel === '生成第 12 章', '采纳成功后必须直接提供下一章动作。')
  acceptedAction.runPrimaryAction()
  assert(accepted.calls.join(',') === 'next', '采纳后的主操作必须启动下一章。', accepted.calls)

  const view = await readFile(join(repoRoot, 'src/renderer/src/views/GenerationPipelineView.tsx'), 'utf8')
  const memory = await readFile(join(repoRoot, 'src/renderer/src/views/generation/useMemoryCandidates.ts'), 'utf8')
  const sqlite = await readFile(join(repoRoot, 'src/storage/SqliteStorageService.ts'), 'utf8')
  const agentRuntime = await readFile(join(repoRoot, 'src/agent/AgentRuntime.ts'), 'utf8')
  const revisionView = await readFile(join(repoRoot, 'src/renderer/src/views/RevisionStudioView.tsx'), 'utf8')
  const revisionSidebar = await readFile(join(repoRoot, 'src/renderer/src/views/revision/RevisionStudioSidebar.tsx'), 'utf8')
  const revisionCompare = await readFile(join(repoRoot, 'src/renderer/src/views/revision/RevisionComparisonPanel.tsx'), 'utf8')
  const revisionActions = await readFile(join(repoRoot, 'src/renderer/src/views/revision/revisionVersionActions.ts'), 'utf8')
  const dashboard = await readFile(join(repoRoot, 'src/renderer/src/views/DashboardView.tsx'), 'utf8')
  const dashboardService = await readFile(join(repoRoot, 'src/services/DirectorNextActionService.ts'), 'utf8')

  assert(view.includes('runPipeline({ targetChapterOrder: nextOrder, forceAutoContext: true })'), '下一章必须以新章序和自动上下文启动。')
  assert(memory.includes('章节草稿仍可继续审核和接受'), '候选应用后应明确提示草稿仍可采纳。')
  assert(sqlite.includes('loadSqliteSnapshotReadonly') && sqlite.includes('readonly: true') && sqlite.includes("query_only = ON"), 'Agent 只读工具必须以 SQLite 只读模式加载。')
  assert(agentRuntime.includes('loadSqliteSnapshotReadonly(sqlitePath)'), 'AgentRuntime 读取路径必须使用只读 SQLite 快照。')
  assert(revisionView.includes('.sort((a, b) => b.order - a.order)'), '修订工作台应优先显示最新章节。')
  assert(revisionSidebar.includes('revisionQuickPresets') && revisionSidebar.includes('只修改某一段（可选）'), '修订工作台应提供快捷意图并收起局部高级选项。')
  assert(revisionCompare.includes('修订候选') && revisionCompare.includes('revision-source-disclosure') && !revisionCompare.includes("onViewModeChange('original')"), '对比区应优先显示候选，将原文保留在独立折叠区。')
  assert(revisionView.includes('latestQualityReportForText') && revisionSidebar.includes('历史质量报告不再适用于这份文本'), '修订工作台必须标明旧报告已失效。')
  assert(revisionActions.includes('latestQualityReportForText(context.latestQualityReports, version.body)'), '接受修订时必须按候选正文 hash 选择质量报告。')
  assert(
    dashboard.includes('getDirectorDashboard') &&
      dashboardService.includes('latestQualityReportForDraft') &&
      dashboardService.includes('latestDraft'),
    'Dashboard 必须通过导演行动服务把质量报告绑定到当前草稿。'
  )

  console.log(JSON.stringify({ ok: true, verified: ['draft-accept-after-memory', 'next-chapter-action', 'agent-readonly-sqlite', 'revision-three-step-flow', 'revision-report-binding', 'dashboard-run-binding'] }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
