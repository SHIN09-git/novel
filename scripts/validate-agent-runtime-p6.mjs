#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf-8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const app = read('src/renderer/src/App.tsx')
const shell = read('src/renderer/src/components/layoutParts/AppShell.tsx')
const viewTypes = read('src/renderer/src/components/layoutParts/types.ts')
const projectData = read('src/renderer/src/utils/projectData.ts')
const agentView = read('src/renderer/src/views/AgentRunsView.tsx')
const versionHistory = read('src/renderer/src/views/chapters/ChapterVersionHistoryPanel.tsx')
const stylesIndex = read('src/renderer/src/styles/index.css')
const agentCss = read('src/renderer/src/styles/views/agent.css')
const runTests = read('scripts/run-tests.mjs')

assert(viewTypes.includes("'agentRuns'"), 'View union must include agentRuns.')
assert(viewTypes.includes("agentRuns: 'Agent 批次'"), 'viewLabels must expose Agent 批次.')
assert(shell.includes("'agentRuns'"), 'Shell navigation must include agentRuns.')
assert(shell.includes("case 'agentRuns'"), 'Shell NavIcon must render an agentRuns icon.')
assert(app.includes('AgentRunsView'), 'App must lazy import AgentRunsView.')
assert(app.includes("case 'agentRuns'"), 'App renderCurrentView must route agentRuns.')
assert(projectData.includes('agentRuns:'), 'projectData must scope agentRuns.')
assert(projectData.includes('agentActionPreviews:'), 'projectData must scope agentActionPreviews.')

assert(agentView.includes('Agent Runs'), 'AgentRunsView must provide the Agent Runs page title.')
assert(agentView.includes('pendingHumanReviewItemIds'), 'AgentRunsView must show pending human review items.')
assert(agentView.includes('createdJobIds'), 'AgentRunsView must show created jobs.')
assert(agentView.includes('createdCommitIds'), 'AgentRunsView must show created commits.')
assert(agentView.includes('agentActionPreviews'), 'AgentRunsView must show action previews.')
assert(agentView.includes('Codex Agent'), 'AgentRunsView must display Codex Agent source labels.')
assert(agentView.includes('ChapterCommitBundle'), 'AgentRunsView must describe chapter commit bundle lineage.')
assert(agentView.includes('RevisionCommitBundle'), 'AgentRunsView must describe revision commit bundle lineage.')

assert(versionHistory.includes('Codex Agent'), 'Version history must show Codex Agent origin labels.')
assert(versionHistory.includes('chapterCommitBundle'), 'Version history must inspect chapter commit links.')
assert(versionHistory.includes('revisionCommitBundle'), 'Version history must inspect revision commit links.')

assert(stylesIndex.includes("./views/agent.css"), 'styles/index.css must import agent.css.')
assert(agentCss.includes('.agent-runs-view'), 'agent.css must scope the Agent Runs page.')
assert(agentCss.includes('.agent-runs-layout'), 'agent.css must define Agent Runs layout.')
assert(runTests.includes('validate-agent-runtime-p6.mjs'), 'npm test must include P6 agent UI validation.')

console.log('Agent Runtime P6 validation passed.')
