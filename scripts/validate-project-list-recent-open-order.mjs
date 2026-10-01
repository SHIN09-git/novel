#!/usr/bin/env node
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf-8')
}

const projectTypes = read('src/shared/types/project.ts')
const homeView = read('src/renderer/src/views/HomeView.tsx')
const appDataNormalizer = read('src/shared/normalizers/appData.ts')
const projectData = read('src/renderer/src/utils/projectData.ts')
const projectLifecycle = read('src/services/ProjectLifecycleService.ts')
const generationPipelineView = read('src/renderer/src/views/GenerationPipelineView.tsx')
const selectedPipelineJobHook = read('src/renderer/src/views/generation/useSelectedPipelineJob.ts')

const checks = [
  {
    ok: /lastOpenedAt\?:\s*string\s*\|\s*null/.test(projectTypes),
    message: 'Project type includes optional lastOpenedAt'
  },
  {
    ok: /projectsByRecentOpen\s*=\s*useMemo/.test(homeView),
    message: 'HomeView derives a sorted project list'
  },
  {
    ok: /lastOpenedAt\s*\|\|\s*[\w.]+updatedAt\s*\|\|\s*[\w.]+createdAt/.test(homeView),
    message: 'Project sorting falls back to updatedAt/createdAt for old data'
  },
  {
    ok:
      /markProjectOpened/.test(homeView) &&
      /lastOpenedAt:\s*openedAt/.test(projectLifecycle),
    message: 'Opening a project records lastOpenedAt'
  },
  {
    ok: /onClick=\{\(\)\s*=>\s*void openProject\(project\.id\)\}/.test(homeView),
    message: 'Project list enter button uses openProject'
  },
  {
    ok: /projectsByRecentOpen\.map\(\(project\)/.test(homeView),
    message: 'Project list renders the recent-open sorted list'
  },
  {
    ok: /最近打开/.test(homeView),
    message: 'Project row labels the displayed timestamp as recent open time'
  },
  {
    ok: /lastOpenedAt:\s*timestamp/.test(homeView) && /projects:\s*\[project,\s*\.\.\.current\.projects\]/.test(homeView),
    message: 'New projects start with a recent-open timestamp'
  },
  {
    ok: /function normalizeProject/.test(appDataNormalizer) && /lastOpenedAt:\s*stringValue\(project\.lastOpenedAt\)\s*\|\|\s*null/.test(appDataNormalizer),
    message: 'normalizeAppData preserves lastOpenedAt for persisted and imported projects'
  },
  {
    ok: /arrayOrEmpty<Project>\(raw\.projects\)\.map\(normalizeProject\)/.test(appDataNormalizer),
    message: 'AppData normalization applies project normalization'
  },
  {
    ok:
      /removeProjectFromAppData/.test(homeView) &&
      /for \(const collection of PROJECT_SCOPED_COLLECTIONS\)/.test(projectLifecycle),
    message: 'Project deletion delegates all direct project collections to shared lifecycle metadata'
  },
  {
    ok:
      /chapterGenerationSteps:\s*data\.chapterGenerationSteps\.filter\(\(item\)\s*=>\s*!jobIds\.has\(item\.jobId\)\)/.test(projectLifecycle) &&
      /revisionRequests:\s*data\.revisionRequests\.filter\(\(item\)\s*=>\s*!revisionSessionIds\.has\(item\.sessionId\)\)/.test(projectLifecycle),
    message: 'Project deletion removes relation-scoped generation and revision records'
  },
  {
    ok: /PROJECT_SCOPED_COLLECTIONS/.test(projectLifecycle) && /agentRuns/.test(read('src/shared/appDataCollections.ts')),
    message: 'Agent Runtime records participate in the shared project ownership boundary'
  },
  {
    ok:
      /selectProjectScopedCollections/.test(projectData) &&
      /chapterGenerationSteps:\s*data\.chapterGenerationSteps\.filter\(\(item\)\s*=>\s*jobIds\.has\(item\.jobId\)\)/.test(projectLifecycle),
    message: 'projectData scopes generation steps through project jobs'
  },
  {
    ok:
      /revisionRequests:\s*data\.revisionRequests\.filter\(\(item\)\s*=>\s*revisionSessionIds\.has\(item\.sessionId\)\)/.test(projectLifecycle) &&
      /revisionVersions:\s*data\.revisionVersions\.filter\(\(item\)\s*=>\s*revisionSessionIds\.has\(item\.sessionId\)\)/.test(projectLifecycle),
    message: 'projectData scopes revision requests and versions through project sessions'
  },
  {
    ok: /contextNeedPlans:\s*scoped\.contextNeedPlans/.test(projectData),
    message: 'projectData exposes scoped context need plans'
  },
  {
    ok:
      /useSelectedPipelineJob\(scoped,\s*selectedJobId,\s*preparingNewTask\)/.test(generationPipelineView) &&
      /selectedJob\s*\?\s*scoped\.chapterGenerationSteps/.test(selectedPipelineJobHook),
    message: 'GenerationPipelineView delegates selected step lookup through scoped project data'
  },
  {
    ok: /selectedJob\s*=\s*preparingNewTask\s*\?\s*null\s*:/.test(selectedPipelineJobHook),
    message: 'Preparing a new task does not silently select the most recent existing job'
  }
]

const failed = checks.filter((check) => !check.ok)
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
