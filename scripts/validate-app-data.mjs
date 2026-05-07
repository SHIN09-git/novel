import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requiredArrays = [
  'projects',
  'storyBibles',
  'chapters',
  'characters',
  'characterStateLogs',
  'foreshadowings',
  'timelineEvents',
  'stageSummaries',
  'promptVersions',
  'promptContextSnapshots',
  'chapterContinuityBridges',
  'chapterGenerationJobs',
  'chapterGenerationSteps',
  'generatedChapterDrafts',
  'memoryUpdateCandidates',
  'consistencyReviewReports',
  'contextBudgetProfiles',
  'qualityGateReports',
  'generationRunTraces',
  'redundancyReports',
  'revisionCandidates',
  'revisionSessions',
  'revisionRequests',
  'revisionVersions',
  'chapterVersions'
]

const allowedCandidateStatuses = new Set(['pending', 'accepted', 'rejected'])
const allowedDraftStatuses = new Set(['draft', 'accepted', 'rejected'])
const allowedForeshadowingTreatmentModes = new Set(['hidden', 'hint', 'advance', 'mislead', 'pause', 'payoff'])
const allowedConsistencyIssueStatuses = new Set(['open', 'ignored', 'converted_to_revision', 'resolved'])
const allowedPipelineContextSources = new Set(['auto', 'prompt_snapshot'])

function pushCheck(checks, ok, message) {
  checks.push({ ok, message })
}

function validateAppData(data) {
  const checks = []

  pushCheck(checks, data && typeof data === 'object' && !Array.isArray(data), 'AppData 是对象')
  pushCheck(checks, data.settings && typeof data.settings === 'object', 'settings 存在')
  pushCheck(checks, !data.settings?.apiKey, 'settings.apiKey 不持久化明文')

  for (const key of requiredArrays) {
    pushCheck(checks, Array.isArray(data[key]), `${key} 是数组`)
  }

  for (const chapter of data.chapters ?? []) {
    pushCheck(checks, typeof chapter.id === 'string' && Boolean(chapter.id), `章节 ${chapter.title ?? chapter.id} 有 id`)
    pushCheck(checks, typeof chapter.projectId === 'string' && Boolean(chapter.projectId), `章节 ${chapter.id} 有 projectId`)
    pushCheck(checks, Number.isFinite(chapter.order), `章节 ${chapter.id} 有有效 order`)
  }

  for (const item of data.foreshadowings ?? []) {
    pushCheck(
      checks,
      allowedForeshadowingTreatmentModes.has(item.treatmentMode),
      `伏笔 ${item.id ?? '<missing-id>'} treatmentMode 有效`
    )
  }

  for (const snapshot of data.promptContextSnapshots ?? []) {
    pushCheck(checks, typeof snapshot.id === 'string' && Boolean(snapshot.id), `上下文快照 ${snapshot.id ?? '<missing-id>'} 有 id`)
    pushCheck(checks, snapshot.contextSelectionResult && typeof snapshot.contextSelectionResult === 'object', `上下文快照 ${snapshot.id ?? '<missing-id>'} 有选择结果`)
    pushCheck(checks, typeof snapshot.finalPrompt === 'string', `上下文快照 ${snapshot.id ?? '<missing-id>'} 有 finalPrompt`)
  }

  for (const job of data.chapterGenerationJobs ?? []) {
    pushCheck(
      checks,
      allowedPipelineContextSources.has(job.contextSource ?? 'auto'),
      `流水线任务 ${job.id ?? '<missing-id>'} contextSource 有效`
    )
  }

  for (const bridge of data.chapterContinuityBridges ?? []) {
    pushCheck(checks, typeof bridge.fromChapterId === 'string' && Boolean(bridge.fromChapterId), `衔接桥 ${bridge.id ?? '<missing-id>'} 有 fromChapterId`)
    pushCheck(checks, Number.isFinite(bridge.toChapterOrder), `衔接桥 ${bridge.id ?? '<missing-id>'} 有有效 toChapterOrder`)
  }

  for (const report of data.redundancyReports ?? []) {
    pushCheck(checks, typeof report.id === 'string' && Boolean(report.id), `冗余报告 ${report.id ?? '<missing-id>'} 有 id`)
    pushCheck(checks, Number.isFinite(report.overallRedundancyScore), `冗余报告 ${report.id ?? '<missing-id>'} 有冗余分`)
    pushCheck(checks, Array.isArray(report.compressionSuggestions), `冗余报告 ${report.id ?? '<missing-id>'} 有压缩建议数组`)
  }

  for (const report of data.consistencyReviewReports ?? []) {
    pushCheck(checks, Array.isArray(report.issues), `一致性审稿 ${report.id ?? '<missing-id>'} issues 是数组`)
    for (const issue of report.issues ?? []) {
      pushCheck(checks, typeof issue.id === 'string' && Boolean(issue.id), `一致性 issue ${issue.title ?? '<missing-title>'} 有 id`)
      pushCheck(checks, allowedConsistencyIssueStatuses.has(issue.status), `一致性 issue ${issue.id ?? '<missing-id>'} 状态有效`)
    }
  }

  for (const candidate of data.memoryUpdateCandidates ?? []) {
    pushCheck(
      checks,
      allowedCandidateStatuses.has(candidate.status),
      `记忆候选 ${candidate.id ?? '<missing-id>'} 状态有效`
    )
  }

  for (const draft of data.generatedChapterDrafts ?? []) {
    pushCheck(checks, allowedDraftStatuses.has(draft.status), `章节草稿 ${draft.id ?? '<missing-id>'} 状态有效`)
  }

  for (const trace of data.generationRunTraces ?? []) {
    pushCheck(checks, allowedPipelineContextSources.has(trace.contextSource ?? 'auto'), `生成追踪 ${trace.id ?? '<missing-id>'} contextSource 有效`)
    pushCheck(checks, Array.isArray(trace.selectedCharacterIds), `生成追踪 ${trace.id ?? '<missing-id>'} 有角色选择数组`)
    pushCheck(checks, Array.isArray(trace.selectedForeshadowingIds), `生成追踪 ${trace.id ?? '<missing-id>'} 有伏笔选择数组`)
    pushCheck(checks, Array.isArray(trace.continuityWarnings ?? []), `生成追踪 ${trace.id ?? '<missing-id>'} 有衔接警告数组`)
  }

  const projectIds = new Set((data.projects ?? []).map((project) => project.id))
  for (const listName of requiredArrays.filter((key) => key !== 'projects')) {
    for (const item of data[listName] ?? []) {
      if ('projectId' in item) {
        pushCheck(checks, projectIds.has(item.projectId), `${listName} 记录 ${item.id ?? item.projectId} 关联项目存在`)
      }
    }
  }

  return checks
}

async function main() {
  const inputPath = process.argv[2] ?? 'tmp/rc-regression/novel-director-data.json'
  const absolutePath = resolve(inputPath)
  const raw = await readFile(absolutePath, 'utf-8')
  const data = JSON.parse(raw)
  const checks = validateAppData(data)
  const failed = checks.filter((check) => !check.ok)
  const report = {
    ok: failed.length === 0,
    path: absolutePath,
    totalChecks: checks.length,
    failed
  }

  console.log(JSON.stringify(report, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
