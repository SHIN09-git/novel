#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const checks = []

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

function check(name, ok, details = '') {
  checks.push({ name, ok, details })
}

const component = read('src/renderer/src/components/AiRewriteTextArea.tsx')
const candidateHook = read('src/renderer/src/components/useAiRewriteCandidate.ts')
const resultModel = read('src/renderer/src/components/aiRewriteResultModel.ts')
const menuPortal = read('src/renderer/src/components/AiRewriteMenuPortal.tsx')
const menuModel = read('src/renderer/src/components/aiRewriteMenuModel.ts')
const chapterEditor = read('src/renderer/src/views/chapters/ChapterEditorPanel.tsx')
const chaptersView = read('src/renderer/src/views/ChaptersView.tsx')
const revisionStudio = [
  read('src/renderer/src/views/RevisionStudioView.tsx'),
  read('src/renderer/src/views/revision/RevisionComparisonPanel.tsx')
].join('\n')
const styles = read('src/renderer/src/styles/components.css')
const runTests = read('scripts/run-tests.mjs')

check('AI rewrite textarea component exists with context menu handler', /export function AiRewriteTextArea/.test(component) && /onContextMenu=\{openMenu\}/.test(component))
check('AI rewrite menu renders through a shared body portal for stable viewport positioning', /AiRewriteMenuPortal/.test(component) && /createPortal/.test(menuPortal) && /document\.body/.test(menuPortal) && /menuPositionAtCursor/.test(menuPortal))
check('component sends explicit selection offsets into the shared candidate workflow', /selectionStart/.test(component) && /selectionEnd/.test(component) && /selection: selected/.test(component) && /targetRange: start\.selection\.text/.test(candidateHook))
check(
  'component provides blank rewrite and evidence-backed AI-tone rewrite actions',
  /空白重写/.test(menuModel) &&
    /去 AI 味（白名单）/.test(menuModel) &&
    /lieflat-less-ai-tone 白名单/.test(menuModel) &&
    /未命中规则的文字原样保留/.test(menuModel)
)
check('shared menu provides custom instruction textbox', /自定义需求/.test(menuPortal) && /ai-rewrite-custom-input/.test(menuPortal))
check('explicit application composes only the bound range and retains stale results', /composeRewriteResult\(current, body\)/.test(candidateHook) && /candidate.sourceBody !== currentBody/.test(resultModel) && /slice\(0, candidate.selection.start\)/.test(resultModel) && /slice\(candidate.selection.end\)/.test(resultModel))
check('component can lazy-load AI service for rewrite actions', /getAiService\?: \(\) => Promise<AIService>/.test(component) && /aiService \?\? \(getAiService \? await getAiService\(\) : null\)/.test(component))
check('chapter editor uses AI rewrite textarea for manuscript body', /AiRewriteTextArea/.test(chapterEditor) && /label="正文稿纸"/.test(chapterEditor))
check('chapters view passes lazy AI service getter and chapter context into editor', /getAiService=\{chapterAi\.getAiService\}/.test(chaptersView) && /aiRewriteContext=\{buildChapterContext\}/.test(chaptersView))
check('revision studio imports AI rewrite textarea', /AiRewriteTextArea/.test(revisionStudio))
check('revision original text can send selected text into local revision generation', /onRewriteRequest=\{\(\{ action, selectedText, customInstruction \}\)/.test(revisionStudio) && /targetRange: selectedText/.test(revisionStudio))
check(
  'editable revision versions can rewrite selected text in place',
  /value=\{selectedVersionForView\.body\}/.test(revisionStudio) &&
    /onChange=\{selectedVersionCanEdit \? onEditedBodyChange : undefined\}/.test(revisionStudio) &&
    /onEditedBodyChange=\{\(body\) => \{\s*editorInputSequence\.current \+= 1\s*setEditableVersionBody\(body\)\s*\}\}/.test(revisionStudio) &&
    /getAiService=\{selectedVersionCanEdit \? getAiService : undefined\}/.test(revisionStudio)
)
check(
  'terminal revision versions keep their text selectable but disable in-place rewrite',
  /readOnly=\{!selectedVersionCanEdit\}/.test(revisionStudio) &&
    /disabled=\{!selectedVersionCanEdit\}/.test(revisionStudio) &&
    /该版本已进入历史状态，正文只读/.test(revisionStudio)
)
check('context menu has scoped CSS', /\.ai-rewrite-menu/.test(styles) && /\.ai-rewrite-textarea-wrap/.test(styles))
check('npm test runs AI rewrite context menu validation', /validate-ai-rewrite-context-menu\.mjs/.test(runTests))

const failed = checks.filter((item) => !item.ok)
if (failed.length > 0) {
  console.error(JSON.stringify({ ok: false, failed }, null, 2))
  process.exit(1)
}

console.log(JSON.stringify({ ok: true, totalChecks: checks.length }, null, 2))
