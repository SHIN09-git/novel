import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

async function load(relativePath) {
  const result = await build({ entryPoints: [join(repoRoot, relativePath)], bundle: true, write: false,
    platform: 'node', format: 'esm', target: 'node22', external: ['electron'], logLevel: 'silent' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

const { normalizeAppData } = await load('src/shared/defaults.ts')
const { generateRevisionFromCurrent } = await load('src/renderer/src/views/revision/revisionGenerationActions.ts')
const { acceptVersion } = await load('src/renderer/src/views/revision/revisionVersionActions.ts')
const { getChapterVersionChain, getChapterVersionDetail, buildRestoreRevisionCommitBundle } = await load('src/services/ChapterVersionChainService.ts')
const { applyRevisionCommitBundleToAppData } = await load('src/services/RevisionCommitBundleService.ts')
const target = '她把钥匙留在门边。'
const source = `雨水沿着外墙流下。${target}走廊的灯依次亮起。远处仍然没有人回答。`
const replacement = '她将钥匙挂回门边的钩子。'
const fullResponse = source.replace(target, replacement)
const timestamp = '2026-09-06T00:00:00.000Z'
let checks = 0
function check(condition, message) { assert.ok(condition, message); checks++; console.log(`PASS ${message}`) }

function fixture(response, targetRange = target) {
  let data = normalizeAppData({
    projects: [{ id: 'preserve-project', name: 'Synthetic revision preservation', createdAt: timestamp, updatedAt: timestamp }],
    chapters: [{ id: 'preserve-chapter', projectId: 'preserve-project', order: 1, title: 'Synthetic chapter',
      body: source, createdAt: timestamp, updatedAt: timestamp }]
  })
  let calls = 0
  let confirmed = false
  const confirmations = []
  const messages = []
  const context = {
    project: data.projects[0], sourceKind: 'chapter', selectedChapter: data.chapters[0], selectedDraft: null,
    linkedDraftChapter: null, sourceBody: source, sourceTitle: 'Synthetic chapter', sourceDraftId: null,
    sourceRequest: null, activeSessions: [], selectedVersion: null, editableVersionBody: '',
    targetRange, revisionType: 'rewrite_section', instruction: '保留钥匙的位置，改写动作。',
    latestQualityReports: [], buildRevisionContext: () => '',
    getAiService: async () => ({ generateRevision: async () => {
      calls++
      return { usedAI: true, data: { revisedText: response, changedSummary: '改写动作', risks: '', preservedFacts: '钥匙留在门边' } }
    } }),
    saveData: async (update) => {
      try { data = typeof update === 'function' ? update(data) : update; return { ok: true } }
      catch (error) { return { ok: false, errorMessage: error.message } }
    },
    confirmAction: async (input) => { confirmations.push(input); return confirmed },
    setLoading: () => {}, setMessage: (message) => messages.push(message), setSelectedVersionId: () => {},
    setRevisionViewMode: () => {}, setEditableVersionBody: () => {}, setRevisionType: () => {}, setInstruction: () => {}
  }
  return { context, data: () => data, calls: () => calls, confirmations, messages,
    allowAcceptance: () => { confirmed = true },
    currentContext: () => ({ ...context, activeSessions: data.revisionSessions,
      selectedVersion: data.revisionVersions[0], editableVersionBody: data.revisionVersions[0]?.body ?? '' }) }
}

const local = fixture(replacement)
await generateRevisionFromCurrent(local.context)
check(local.calls() === 1 && local.data().revisionVersions.length === 1, 'normal local revision generates one candidate')
check(local.data().revisionVersions[0].body === fullResponse, 'normal local revision changes only the selected passage')
check(!local.data().revisionVersions[0].responseScope && local.data().chapters[0].body === source,
  'normal candidates do not acquire a scope warning or change the manuscript')

const broader = fixture(fullResponse)
await generateRevisionFromCurrent(broader.context)
const candidate = broader.data().revisionVersions[0]
check(broader.calls() === 1 && candidate?.body === fullResponse, 'a full-chapter response to a local request is retained exactly once')
check(candidate.responseScope === 'broader_than_requested' && candidate.status === 'pending',
  'the retained response is explicitly marked as a broader pending candidate')
check(broader.data().chapters[0].body === source && broader.data().chapterVersions.length === 0,
  'preserving the AI output never automatically edits or commits the chapter')
check(broader.data().revisionRequests[0].targetRange === target && Boolean(candidate.sourceContentHash),
  'the original selection and source binding survive response preservation')
check(broader.messages.some((message) => message.includes('结果已保留为整章候选')),
  'the author is told the result was retained rather than asked to pay for an unnecessary retry')
const roundtrip = normalizeAppData(JSON.parse(JSON.stringify(broader.data())))
check(roundtrip.revisionVersions[0].responseScope === 'broader_than_requested', 'legacy-compatible normalization retains scope metadata')

await acceptVersion(broader.currentContext(), candidate)
check(broader.confirmations.length === 1 && broader.confirmations[0].message.includes('不仅替换原选区'),
  'acceptance explicitly explains the whole-chapter replacement in one confirmation')
check(broader.data().chapters[0].body === source && broader.data().revisionVersions[0].status === 'pending',
  'cancelling acceptance keeps both the original and the retained candidate')
broader.allowAcceptance()
await acceptVersion(broader.currentContext(), candidate)
check(broader.data().chapters[0].body === fullResponse && broader.data().revisionCommitBundles.length === 1,
  'explicit author acceptance commits the exact whole candidate through RevisionCommitBundle')
const baseline = getChapterVersionChain(broader.data(), 'preserve-chapter').find((version) => version.body === source)
check(baseline?.sourceKind === 'pre_revision_snapshot', 'the first revision exposes the original manuscript in version history even without an earlier snapshot')
check(getChapterVersionDetail(broader.data(), baseline.id)?.entry.body === source, 'the original manuscript is readable through the version-detail API')
const restore = buildRestoreRevisionCommitBundle({ appData: broader.data(), projectId: 'preserve-project', chapterId: 'preserve-chapter',
  sourceVersionId: baseline.id, revisionCommitId: 'restore-baseline', newChapterVersionId: 'restored-version',
  restoredAt: '2026-09-07T00:00:00.000Z' })
const restored = applyRevisionCommitBundleToAppData(broader.data(), restore)
check(restored.chapters[0].body === source && restored.revisionCommitBundles.length === 2,
  'restoring the original manuscript creates a new commit without removing the broader revision')
check(getChapterVersionChain(restored, 'preserve-chapter').filter((version) => version.body === source).length === 1,
  'a persisted restoration replaces the virtual baseline without duplicate history entries')
const linkedVersionData = structuredClone(broader.data())
linkedVersionData.chapterVersions[0].linkedChapterCommitId = 'original-draft-commit'
check(getChapterVersionChain(linkedVersionData, 'preserve-chapter').find((entry) => entry.isCurrent)?.sourceKind === 'user_with_ai_revision',
  'an AI-assisted revision remains a revision when it also links to the original draft commit')
const foreignData = structuredClone(broader.data())
foreignData.revisionCommitBundles.push({ ...foreignData.revisionCommitBundles[0], projectId: 'foreign-project',
  revisionCommitId: 'foreign-before', beforeText: 'Other project manuscript' })
check(!getChapterVersionChain(foreignData, 'preserve-chapter').some((entry) => entry.body === 'Other project manuscript'),
  'virtual baselines never expose another project sharing the same chapter ID')

const missing = fixture(fullResponse, '这个片段并不存在。')
await generateRevisionFromCurrent(missing.context)
check(missing.calls() === 0 && missing.data().revisionVersions.length === 0, 'missing source selection is caught before a paid request')
console.log(JSON.stringify({ ok: true, totalChecks: checks }))
