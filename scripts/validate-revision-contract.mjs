import { mkdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const templateSourcePath = join(root, 'src', 'services', 'ai', 'AIPromptTemplates.ts')
const studioSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'RevisionStudioView.tsx')
const comparisonSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'revision', 'RevisionComparisonPanel.tsx')
const generationActionSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'revision', 'revisionGenerationActions.ts')
const versionActionSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'revision', 'revisionVersionActions.ts')
const sessionModelSourcePath = join(root, 'src', 'renderer', 'src', 'views', 'revision', 'revisionSessionModel.ts')
const versionPolicySourcePath = join(root, 'src', 'shared', 'revisionVersionPolicy.ts')
const outDir = join(root, 'tmp', 'revision-contract-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function bundleModule(entryPoint, fileName) {
  await mkdir(outDir, { recursive: true })
  const outfile = join(outDir, fileName)
  await build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['react', 'react-dom', 'electron', 'better-sqlite3'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${fileName}`)
}

async function main() {
  const [{ buildRevisionUserPrompt }, { findReusableRevisionSession }, {
    canAcceptRevisionVersionStatus,
    canEditRevisionVersionStatus,
    canRejectRevisionVersionStatus
  }] = await Promise.all([
    bundleModule(templateSourcePath, 'ai-prompt-templates.mjs'),
    bundleModule(sessionModelSourcePath, 'revision-session-model.mjs'),
    bundleModule(versionPolicySourcePath, 'revision-version-policy.mjs')
  ])
  const studioSource = (
    await Promise.all(
      [studioSourcePath, comparisonSourcePath, generationActionSourcePath, versionActionSourcePath].map((sourcePath) =>
        readFile(sourcePath, 'utf-8')
      )
    )
  ).join('\n')
  const checks = []

  const localPrompt = buildRevisionUserPrompt(
    {
      type: 'polish_style',
      instruction: 'Polish only the selected fragment.',
      revisionScope: 'local',
      fullChapterText: 'Full chapter opening. Target fragment. Full chapter ending.',
      targetRange: 'Target fragment.'
    },
    'Project context'
  )
  checks.push(
    assert(
      localPrompt.includes('revisionScope') &&
        localPrompt.includes('local') &&
        localPrompt.includes('fullChapterText') &&
        localPrompt.includes('Full chapter opening') &&
        localPrompt.includes('targetRange') &&
        localPrompt.includes('Target fragment') &&
        localPrompt.includes('revisedText'),
      'local revision prompt includes fullChapterText, targetRange, and explicit local scope'
    )
  )

  checks.push(
    assert(
      ['pending', 'draft'].every(
        (status) =>
          canEditRevisionVersionStatus(status) &&
          canAcceptRevisionVersionStatus(status) &&
          canRejectRevisionVersionStatus(status)
      ) &&
        ['accepted', 'rejected', 'superseded'].every(
          (status) =>
            !canEditRevisionVersionStatus(status) &&
            !canAcceptRevisionVersionStatus(status) &&
            !canRejectRevisionVersionStatus(status)
        ),
      'revision version policy keeps terminal history immutable while pending/draft versions remain decidable'
    )
  )

  checks.push(
    assert(
      studioSource.includes('readOnly={!selectedVersionCanEdit}') &&
        studioSource.includes('disabled={!selectedVersionCanEdit}') &&
        studioSource.includes('onChange={selectedVersionCanEdit ? onEditedBodyChange : undefined}') &&
        studioSource.includes('onEditedBodyChange={(body) => {') &&
        studioSource.includes('editorInputSequence.current += 1') &&
        studioSource.includes('setEditableVersionBody(body)') &&
        studioSource.includes('disabled={!canAcceptRevisionVersionStatus(selectedVersionForView.status)}') &&
        studioSource.includes('disabled={!canRejectRevisionVersionStatus(selectedVersionForView.status)}'),
      'RevisionStudioView renders terminal revision versions read-only and disables invalid accept/reject actions'
    )
  )

  const reusableSession = findReusableRevisionSession([
    { id: 'completed-newer', status: 'completed', updatedAt: '2026-01-03T00:00:00.000Z' },
    { id: 'active-older', status: 'active', updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'active-newer', status: 'active', updatedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'cancelled', status: 'cancelled', updatedAt: '2026-01-04T00:00:00.000Z' }
  ])
  checks.push(
    assert(
      reusableSession?.id === 'active-newer' &&
        findReusableRevisionSession([{ id: 'completed', status: 'completed', updatedAt: '2026-01-01T00:00:00.000Z' }]) === null &&
        studioSource.includes('activeSessions: sourceSessions') &&
        studioSource.includes('selectRevisionSession(') &&
        studioSource.includes('context.activeSessions') &&
        !studioSource.includes('?? activeSessions[0]'),
      'revision workbench reuses only the latest active session and never reopens completed history'
    )
  )

  const fullPrompt = buildRevisionUserPrompt(
    {
      type: 'reduce_ai_tone',
      instruction: '',
      revisionScope: 'full',
      fullChapterText: 'Full chapter body.'
    },
    'Project context'
  )
  checks.push(
    assert(
      fullPrompt.includes('revisionScope') &&
        fullPrompt.includes('full') &&
        fullPrompt.includes('fullChapterText') &&
        fullPrompt.includes('targetRange') &&
        fullPrompt.includes('<none>') &&
        fullPrompt.includes('revisedText') &&
        fullPrompt.includes('lieflat-less-ai-tone 白名单式改写合同') &&
        fullPrompt.includes('未命中规则的文字必须逐字保留') &&
        fullPrompt.includes('不得新增或删减事实') &&
        fullPrompt.includes('问句、设问、问句小标题') &&
        fullPrompt.includes('changedSummary 列出实际命中的规则编号'),
      'full reduce_ai_tone prompt declares full scope and enforces the evidence-backed whitelist contract'
    )
  )

  checks.push(
    assert(
      !localPrompt.includes('lieflat-less-ai-tone 白名单式改写合同'),
      'non-AI-tone revision prompts do not pay the skill token cost or inherit its narrow rewrite boundary'
    )
  )

  const missingInputPrompt = buildRevisionUserPrompt(
    {
      type: 'rewrite_section',
      instruction: '',
      revisionScope: 'local',
      fullChapterText: '',
      targetRange: ''
    },
    ''
  )
  checks.push(
    assert(
      !missingInputPrompt.includes('暂无正文') &&
        !missingInputPrompt.includes('暂无局部目标') &&
        !missingInputPrompt.includes('项目上下文：\n暂无') &&
        missingInputPrompt.includes('不要凭空生成章节内容') &&
        missingInputPrompt.includes('不要凭空生成局部修订'),
      'revision prompt templates use explicit missing-input instructions instead of fake placeholder text'
    )
  )

  checks.push(
    assert(
      studioSource.includes('revisionScope') &&
        studioSource.includes('fullChapterText') &&
        studioSource.includes('mergeLocalRevisionSafely') &&
        studioSource.includes('looksLikeFullChapterRevision') &&
        studioSource.includes('revisedText') &&
        studioSource.includes('revisedText 为空'),
      'RevisionStudioView sends explicit scope and keeps local merge in the UI layer'
    )
  )

  checks.push(
    assert(
      studioSource.includes('const finalBody = isLocalRevision') &&
        studioSource.includes('mergeLocalRevisionSafely(fullChapterText, rawTarget, result.data.revisedText)') &&
        !studioSource.includes('aiService.generateRevision(requestPayload, targetText, context)'),
      'full revisions bypass local merge while local revisions must use safe merge'
    )
  )

  checks.push(
    assert(
      studioSource.includes('await persistEditedVersionBody(context)') &&
        studioSource.includes('async function flushEditedVersionBefore') &&
        studioSource.includes('if (!(await persistEditedVersionBody())) return') &&
        studioSource.includes('void flushEditedVersionBefore(() => setSelectedVersionId(versionId))'),
      'edited revision text is persisted before accept, version switches, and source/view changes'
    )
  )

  checks.push(
    assert(
      studioSource.includes('await getNovelDirectorClipboardApi().writeText(version.body)') &&
        studioSource.includes('复制失败：${error.message}'),
      'clipboard bridge failures are reported in the revision workbench instead of becoming unhandled promises'
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
