import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { repoRoot } from './utils/repo-root.mjs'

const workspace = await mkdtemp(join(repoRoot, 'tmp', 'novel-agent-authorization-ui-'))

function transpile(source, target, replacements, jsx = false) {
  let code = source
  for (const [from, to] of replacements) {
    assert(code.includes(from), `Missing replacement source: ${from}`)
    code = code.replaceAll(from, to)
  }
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
      esModuleInterop: true
    }
  })
  return writeFile(join(workspace, target), result.outputText, 'utf8')
}

try {
  const panelSource = await readFile(join(repoRoot, 'src/renderer/src/views/agent/AgentProjectAuthorizationPanel.tsx'), 'utf8')
  await writeFile(join(workspace, 'ui-stubs.mjs'), `
    export const AGENT_AUTHORIZATION_ACTIONS = ['edit_world', 'accept_high_risk_candidates', 'accept_unreviewed_draft', 'accept_draft', 'apply_revision', 'manage_chapters', 'edit_chapter_task'];
    export function useConfirm() { return async () => false; }
    export function getNovelDirectorAgentAuthorizationApi() { return globalThis.testAuthorizationApi ?? null; }
    export function formatDate(value) { return value || '-'; }
  `, 'utf8')
  await transpile(panelSource, 'panel.mjs', [
    ["'../../components/ConfirmDialog'", "'./ui-stubs.mjs'"],
    ["'../../platform/novelDirectorBridge'", "'./ui-stubs.mjs'"],
    ["'../../../../shared/types/agentAuthorization'", "'./ui-stubs.mjs'"],
    ["'../../utils/format'", "'./ui-stubs.mjs'"]
  ], true)
  const {
    AgentProjectAuthorizationPanel,
    formatAuthorizationRange,
    isAuthorizationContextCurrent,
    parseAuthorizationRange,
    toggleAuthorizationAction,
    validateAuthorizationSelection
  } = await import(pathToFileURL(join(workspace, 'panel.mjs')).href)

  assert.deepEqual(parseAuthorizationRange('all', '', ''), { ok: true, chapterStart: null, chapterEnd: null })
  assert.deepEqual(parseAuthorizationRange('range', '2', '4'), { ok: true, chapterStart: 2, chapterEnd: 4 })
  assert.equal(parseAuthorizationRange('range', '', '4').ok, false)
  assert.equal(parseAuthorizationRange('range', '4', '2').ok, false)
  assert.equal(parseAuthorizationRange('range', '1.5', '2').ok, false)
  assert.deepEqual(toggleAuthorizationAction([], 'accept_unreviewed_draft'), ['accept_unreviewed_draft', 'accept_draft'])
  assert.deepEqual(toggleAuthorizationAction(['accept_unreviewed_draft', 'accept_draft'], 'accept_draft'), [])
  assert.deepEqual(toggleAuthorizationAction([], 'accept_draft'), ['accept_draft'])
  assert.equal(validateAuthorizationSelection(['edit_world'], 'range'), '“编辑世界观与长期设定”是项目全局资料，请将章节范围改为“全部章节”后再授予。')
  assert.equal(validateAuthorizationSelection(['edit_world'], 'all'), null)
  assert.equal(validateAuthorizationSelection(['accept_draft'], 'range'), null)
  const identityA = {}
  const identityB = {}
  assert.equal(isAuthorizationContextCurrent({ projectId: 'project-a', dataIdentity: identityA }, { projectId: 'project-a', dataIdentity: identityA }), true)
  assert.equal(isAuthorizationContextCurrent({ projectId: 'project-b', dataIdentity: identityA }, { projectId: 'project-a', dataIdentity: identityA }), false)
  assert.equal(isAuthorizationContextCurrent({ projectId: 'project-a', dataIdentity: identityB }, { projectId: 'project-a', dataIdentity: identityA }), false)
  assert.equal(formatAuthorizationRange({ chapterStart: null, chapterEnd: 4 }), '截至第 4 章')
  assert.equal(formatAuthorizationRange({ chapterStart: 5, chapterEnd: null }), '第 5 章起')

  const bridgeSource = await readFile(join(repoRoot, 'src/renderer/src/platform/novelDirectorBridge.ts'), 'utf8')
  await transpile(bridgeSource, 'bridge.mjs', [])
  const { getNovelDirectorAgentAuthorizationApi } = await import(pathToFileURL(join(workspace, 'bridge.mjs')).href)
  delete globalThis.window
  assert.equal(getNovelDirectorAgentAuthorizationApi(), null)
  globalThis.window = { novelDirector: { agentAuthorization: { list: 'invalid', grant() {}, revoke() {} } } }
  assert.equal(getNovelDirectorAgentAuthorizationApi(), null)
  const bridgeApi = { list() {}, grant() {}, revoke() {} }
  globalThis.window = { novelDirector: { agentAuthorization: bridgeApi } }
  assert.equal(getNovelDirectorAgentAuthorizationApi(), bridgeApi)
  delete globalThis.window

  globalThis.testAuthorizationApi = null
  const unavailableMarkup = renderToStaticMarkup(createElement(AgentProjectAuthorizationPanel, {
    projectId: 'project-a', chapterOrders: [], dataIdentity: {}
  }))
  assert.match(unavailableMarkup, /项目授权/)
  assert.match(unavailableMarkup, /授权接口不可用/)
  assert.match(unavailableMarkup, /收起|展开/)
  assert.match(unavailableMarkup, /授权范围内可连续执行，超出范围再由作者决定；撤回不删除已提交版本。/)
  assert.doesNotMatch(unavailableMarkup, /type="checkbox"/)

  const ipcSource = await readFile(join(repoRoot, 'src/main/ipc/agentAuthorizationIpcHandlers.ts'), 'utf8')
  await writeFile(join(workspace, 'ipc-stubs.mjs'), `
    export const AGENT_AUTHORIZATION_ACTIONS = ['edit_world', 'accept_high_risk_candidates', 'accept_unreviewed_draft', 'accept_draft', 'apply_revision', 'manage_chapters', 'edit_chapter_task'];
    export const calls = new Map();
    export const ipcMain = { handle(channel, handler) { calls.set(channel, handler); } };
    export const app = { getPath() { return '/trusted/user-data'; } };
    export const IPC_CHANNELS = {
      AGENT_AUTHORIZATION_LIST: 'agent-authorization:list',
      AGENT_AUTHORIZATION_GRANT: 'agent-authorization:grant',
      AGENT_AUTHORIZATION_REVOKE: 'agent-authorization:revoke'
    };
    export class AgentAuthorizationService {}
    export function safeIpcHandler(handler) {
      return async (event, ...args) => {
        try { return await handler(event, ...args); }
        catch (error) { return { ok: false, error: error.message, code: error.code }; }
      };
    }
  `, 'utf8')
  await transpile(ipcSource, 'ipc-handlers.mjs', [
    ["'electron'", "'./ipc-stubs.mjs'"],
    ["'../../shared/ipc/ipcChannels'", "'./ipc-stubs.mjs'"],
    ["'../../shared/ipc/ipcTypes'", "'./ipc-stubs.mjs'"],
    ["'../../shared/types/agentAuthorization'", "'./ipc-stubs.mjs'"],
    ["'../services/AgentAuthorizationService'", "'./ipc-stubs.mjs'"],
    ["'./safeIpcHandler'", "'./ipc-stubs.mjs'"]
  ])
  const { registerAgentAuthorizationIpcHandlers } = await import(pathToFileURL(join(workspace, 'ipc-handlers.mjs')).href)
  const { calls } = await import(pathToFileURL(join(workspace, 'ipc-stubs.mjs')).href)
  let storagePath = '/trusted/current.sqlite'
  const serviceCalls = []
  const service = {
    list(path, projectId) { serviceCalls.push(['list', path, projectId]); return [] },
    grant(input) { serviceCalls.push(['grant', input]); return { id: 'grant-1', ...input } },
    revoke(id, path, projectId) { serviceCalls.push(['revoke', id, path, projectId]); return null }
  }
  const context = {
    getStorage() {
      return {
        getStoragePath() { return storagePath },
        async load() { return { projects: [{ id: 'project-a' }] } }
      }
    }
  }
  registerAgentAuthorizationIpcHandlers(context, service)
  const list = calls.get('agent-authorization:list')
  const grant = calls.get('agent-authorization:grant')
  const revoke = calls.get('agent-authorization:revoke')
  const forgedList = await list({}, { projectId: 'project-a', storagePath: '/attacker.sqlite', userDataPath: '/attacker-user-data' })
  assert.equal(forgedList.ok, false)
  assert.equal(forgedList.code, 'AGENT_AUTHORIZATION_INVALID_INPUT')
  assert.equal(serviceCalls.length, 0)
  const listResult = await list({}, { projectId: 'project-a' })
  assert.deepEqual(listResult, [])
  assert.deepEqual(serviceCalls.at(-1), ['list', '/trusted/current.sqlite', 'project-a'])

  const zeroActions = await grant({}, { projectId: 'project-a', actions: [], chapterStart: null, chapterEnd: null })
  assert.equal(zeroActions.ok, false)
  assert.equal(zeroActions.code, 'AGENT_AUTHORIZATION_INVALID_INPUT')
  const invalidRange = await grant({}, { projectId: 'project-a', actions: ['edit_world'], chapterStart: 5, chapterEnd: 2 })
  assert.equal(invalidRange.ok, false)
  assert.equal(invalidRange.code, 'AGENT_AUTHORIZATION_INVALID_INPUT')
  const forgedGrant = await grant({}, { projectId: 'project-a', actions: ['edit_world'], chapterStart: null, chapterEnd: null, storagePath: '/attacker.sqlite' })
  assert.equal(forgedGrant.ok, false)
  assert.equal(forgedGrant.code, 'AGENT_AUTHORIZATION_INVALID_INPUT')
  assert.deepEqual(serviceCalls.at(-1), ['list', '/trusted/current.sqlite', 'project-a'])
  const created = await grant({}, { projectId: 'project-a', actions: ['edit_world'], chapterStart: null, chapterEnd: null })
  assert.equal(created.id, 'grant-1')
  assert.deepEqual(serviceCalls.at(-1), ['grant', {
    storagePath: '/trusted/current.sqlite', projectId: 'project-a', actions: ['edit_world'], chapterStart: null, chapterEnd: null
  }])
  const missingProject = await list({}, { projectId: 'missing' })
  assert.equal(missingProject.ok, false)
  storagePath = '/trusted/next.sqlite'
  const forgedRevoke = await revoke({}, { projectId: 'project-a', grantId: 'grant-1', storagePath: '/attacker.sqlite' })
  assert.equal(forgedRevoke.ok, false)
  assert.equal(forgedRevoke.code, 'AGENT_AUTHORIZATION_INVALID_INPUT')
  await revoke({}, { projectId: 'project-a', grantId: 'grant-1' })
  assert.deepEqual(serviceCalls.at(-1), ['revoke', 'grant-1', '/trusted/next.sqlite', 'project-a'])

  const agentViewSource = await readFile(join(repoRoot, 'src/renderer/src/views/AgentRunsView.tsx'), 'utf8')
  await writeFile(join(workspace, 'agent-view-stubs.mjs'), `
    import { createElement } from 'react';
    export function latestQualityReportForDraft() { return null; }
    export function Header({ title, actions }) { return createElement('header', null, title, actions); }
    export function SectionCard() { return null; }
    export function StatCard() { return null; }
    export function StatusBadge() { return null; }
    export function useProjectData(data) {
      return {
        agentRuns: data.agentRuns ?? [],
        agentActionPreviews: data.agentActionPreviews ?? [],
        chapterCommitBundles: data.chapterCommitBundles ?? [],
        revisionCommitBundles: data.revisionCommitBundles ?? [],
        allChapters: []
      };
    }
    export function getNovelDirectorClipboardApi() { return { writeText: async () => undefined }; }
    export function formatDate(value) { return value || '-'; }
    export function AgentProjectAuthorizationPanel() { return null; }
  `, 'utf8')
  await transpile(agentViewSource, 'agent-runs-view.mjs', [
    ["'../../../services/DraftDiagnosticBindingService'", "'./agent-view-stubs.mjs'"],
    ["'../components/Layout'", "'./agent-view-stubs.mjs'"],
    ["'../components/UI'", "'./agent-view-stubs.mjs'"],
    ["'../hooks/useProjectData'", "'./agent-view-stubs.mjs'"],
    ["'../platform/novelDirectorBridge'", "'./agent-view-stubs.mjs'"],
    ["'../utils/format'", "'./agent-view-stubs.mjs'"],
    ["'./agent/AgentProjectAuthorizationPanel'", "'./agent-view-stubs.mjs'"],
    ["'./viewTypes'", "'./agent-view-stubs.mjs'"]
  ], true)
  const { AgentRunsView, isAgentCommit } = await import(pathToFileURL(join(workspace, 'agent-runs-view.mjs')).href)
  assert.equal(isAgentCommit({ acceptedBy: 'user', commitNote: 'Applied by Agent' }), false)
  assert.equal(isAgentCommit({ acceptedBy: 'agent', commitNote: 'ordinary note' }), true)
  assert.equal(isAgentCommit({ acceptedBy: 'user', actor: { kind: 'agent' } }), true)
  assert.equal(isAgentCommit({ revisedBy: 'user', revisionNote: 'Codex legacy note' }), false)
  assert.equal(isAgentCommit({ revisionNote: 'Codex legacy note' }), true)
  const agentViewMarkup = renderToStaticMarkup(createElement(AgentRunsView, {
    data: { agentRuns: [], agentActionPreviews: [], chapterCommitBundles: [], revisionCommitBundles: [] },
    project: { id: 'project-a' },
    saveData: async () => ({ ok: true }),
    onReload: async () => ({ ok: true })
  }))
  assert.match(agentViewMarkup, /读取最新结果/)

  console.log(JSON.stringify({ ok: true, checks: 28 }, null, 2))
} finally {
  await rm(workspace, { recursive: true, force: true })
}
