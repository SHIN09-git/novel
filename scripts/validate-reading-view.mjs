#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const app = read('src/renderer/src/App.tsx')
const viewTypes = read('src/renderer/src/components/layoutParts/types.ts')
const chapters = read('src/renderer/src/views/ChaptersView.tsx')
const readerPath = 'src/renderer/src/views/ReadingView.tsx'
const reader = read(readerPath)
const readerNavigation = read('src/renderer/src/views/reading/useReaderNavigation.ts')
const readerRevision = read('src/renderer/src/views/reading/useReaderRevisionCommit.ts')
const readerAiRewrite = read('src/renderer/src/views/reading/useReaderAiRewrite.ts')
const readerRail = read('src/renderer/src/views/reading/ReaderChapterRail.tsx')
const readerArticle = read('src/renderer/src/views/reading/ReaderChapterArticle.tsx')
const readerText = read('src/renderer/src/views/reading/readerText.ts')
const rewritePortal = read('src/renderer/src/components/AiRewriteMenuPortal.tsx')
const rewriteModel = read('src/renderer/src/components/aiRewriteMenuModel.ts')
const stylesIndex = read('src/renderer/src/styles/index.css')
const readerCssPath = 'src/renderer/src/styles/views/reader.css'
const readerCss = read(readerCssPath)
const aiRewrite = read('src/renderer/src/components/AiRewriteTextArea.tsx')

assert(existsSync(join(root, readerPath)), 'ReadingView.tsx should exist')
assert(viewTypes.includes("| 'reader'"), 'View union should include reader')
assert(viewTypes.includes('reader:'), 'viewLabels should include reader')
assert(app.includes("import('./views/ReadingView')"), 'App should lazy-load ReadingView')
assert(app.includes("case 'reader'"), 'App should render reader view')
assert(app.includes('readerInitialChapterId'), 'App should preserve focused reader chapter')
assert(app.includes('saveRevisionCommitBundle={saveRevisionCommitBundle}'), 'App should give ReadingView the transactional revision commit path')
assert(chapters.includes('onOpenReader'), 'ChaptersView should expose reader entry')
assert(reader.includes('AiRewriteMenuPortal'), 'ReadingView should reuse the shared AI rewrite menu')
assert(reader.includes('onOpenRewriteMenu') && readerArticle.includes('onContextMenu'), 'ReadingView should support selected-text context menu')
assert(rewritePortal.includes('createPortal'), 'ReadingView rewrite menu should render in a shared portal')
assert(reader.includes('ReaderChapterArticle') && readerArticle.includes('AiRewriteTextArea'), 'ReadingView should delegate inline chapter editing')
assert(reader.includes('reader-continuous-shell'), 'ReadingView should use a centered continuous reading shell')
assert(reader.includes('reader-continuous-scroll'), 'ReadingView should render a continuous scroll container')
assert(reader.includes('ReaderChapterRail') && readerRail.includes('reader-chapter-rail'), 'ReadingView should expose a delegated right-side chapter rail')
assert(reader.includes('ReaderChapterArticle') && readerArticle.includes('data-reader-chapter-id'), 'ReadingView should render multiple chapters with jump anchors')
assert(reader.includes('readerScrollRef'), 'ReadingView should use an independent chapter scroll container')
assert(readerNavigation.includes(".main-panel"), 'Reader navigation should reset outer workspace scroll on entry')
assert(readerNavigation.includes('handleScroll'), 'Reader navigation should update active chapter while reading')
assert(readerNavigation.includes('appliedInitialChapterRef'), 'Reader navigation should apply the initial chapter only once')
assert(readerNavigation.includes('chapterSignature'), 'Reader navigation should not reset when only chapter prose changes')
assert(readerRail.includes('{chapter.order}'), 'Reader rail should show actual chapter order instead of array index')
assert(readerRail.includes('aria-current'), 'Reader rail should expose the active chapter accessibly')
assert(readerText.includes('readerTextRangeFromSelection'), 'Reader selection offsets should be delegated to a focused helper')
assert(reader.includes('confirmDiscardInlineEdit'), 'Reader should guard unsaved inline edits before leaving or switching editors')
assert(reader.includes('undoLastRewrite') && reader.includes('撤销刚才重写'), 'Reader should offer a safe one-step undo after direct AI rewrite')
assert(reader.includes('useReaderRevisionCommit') && readerRevision.includes('buildRevisionCommitBundle') && readerRevision.includes('applyRevisionCommitBundleToAppData'), 'Reader saves should create formal revision commits')
assert(readerAiRewrite.includes("'user_with_ai'"), 'Reader AI rewrites should be identified as user-with-AI revisions')
assert(!reader.includes('chapters: current.chapters.map'), 'Reader should not directly overwrite chapter bodies through a full AppData save')
assert(readerRevision.includes('currentChapter.body !== input.expectedBeforeBody'), 'Reader revision commits should reject stale source text')
assert(reader.includes('editBaseline.current = chapter.body') && reader.includes('expectedBeforeBody: editBaseline.current'), 'Inline saves must use the body captured when editing started')
assert(reader.includes('isSaving={isSaving}') && readerArticle.includes('disabled={isSaving}') && aiRewrite.includes('disabled={disabled}'), 'Pending saves must lock the actual editable textarea to avoid clearing later input')
assert(reader.includes('projectId: project.id') && reader.includes('pendingPosition.current = editingPosition.current'), 'Reader must restore project-local position after inline editing')
assert(reader.includes('ExportService.formatAllChaptersAsText'), 'ReadingView should support copying continuous text')
assert(aiRewrite.includes("export { AI_REWRITE_ACTIONS, menuPositionAtCursor }"), 'AI rewrite actions should remain compatible exports')
assert(rewriteModel.includes('export const AI_REWRITE_ACTIONS'), 'AI rewrite actions should have one canonical definition')
assert(rewriteModel.includes('export function menuPositionAtCursor'), 'AI rewrite menu positioning should have one canonical helper')
assert(stylesIndex.includes("./views/reader.css"), 'styles/index.css should import reader.css')
assert(readerCss.includes('.reader-continuous-shell'), 'reader.css should center the continuous reading layout')
assert(readerCss.includes('.reader-continuous-scroll'), 'reader.css should define independent continuous reading scroll area')
assert(readerCss.includes('.reader-chapter-rail'), 'reader.css should define right-side chapter rail')
assert(readerCss.includes('.reader-rail-bar'), 'reader.css should define compact chapter jump bars')
const readerShellRule = readerCss.match(/\.reader-continuous-shell\s*\{([\s\S]*?)\}/)?.[1] ?? ''
assert(/display:\s*grid/.test(readerShellRule), 'reader layout should use a grid shell')
assert(
  /grid-template-columns:\s*minmax\(56px,\s*1fr\)\s+minmax\(0,\s*min\(920px,\s*calc\(100%\s*-\s*144px\)\)\)\s+minmax\(56px,\s*1fr\)/.test(readerShellRule),
  'reader layout should keep the reading column centered with symmetric responsive rails'
)
assert(/\.reader-continuous-main\s*\{[^}]*grid-column:\s*2/.test(readerCss), 'reader layout should place the reading column in the center track')
assert(/\.reader-chapter-rail\s*\{[^}]*grid-column:\s*3/.test(readerCss), 'reader layout should keep the chapter rail reachable beside the reading column')
assert(/@media\s*\(max-width:\s*1100px\)[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(readerCss), 'reader layout should collapse to one continuous reading column when narrow')

console.log(JSON.stringify({ ok: true, totalChecks: 44 }, null, 2))
