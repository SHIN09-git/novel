#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot

function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function loadReaderPositionModule() {
  const result = await build({
    entryPoints: [join(root, 'src/renderer/src/views/reading/readerPosition.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false
  })
  const source = Buffer.from(result.outputFiles[0].contents).toString('base64')
  return import(`data:text/javascript;base64,${source}`)
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    values
  }
}

async function main() {
  const position = await loadReaderPositionModule()
  const saved = position.createReaderPosition({
    chapterId: 'chapter-2',
    anchorText: '钟楼的灯在雨里闪了一次。',
    anchorOffsetRatio: 0.4,
    chapterProgress: 0.7,
    viewportRatio: 0.25
  })
  const chapters = [
    { id: 'chapter-1', paragraphs: ['开场。'] },
    { id: 'chapter-2', paragraphs: ['前文新增的段落。', '钟楼的灯在雨里闪了一次。', '尾声。'] }
  ]
  const anchored = position.resolveReaderPosition(saved, chapters)
  check(anchored?.kind === 'anchor' && anchored.chapterId === 'chapter-2' && anchored.paragraphIndex === 1,
    'A unique anchor should survive earlier paragraph insertion in the same chapter.')

  const missing = position.resolveReaderPosition(saved, [{ id: 'chapter-2', paragraphs: ['正文已整体改写。'] }])
  check(missing?.kind === 'chapter' && missing.paragraphIndex === null,
    'A missing anchor should conservatively return to the chapter vicinity.')

  const duplicate = position.resolveReaderPosition(saved, [{
    id: 'chapter-2', paragraphs: ['钟楼的灯在雨里闪了一次。', '钟楼的灯在雨里闪了一次。']
  }])
  check(duplicate?.kind === 'chapter' && duplicate.paragraphIndex === null,
    'An ambiguous repeated anchor should not guess a paragraph.')
  check(position.resolveReaderPosition(saved, [{ id: 'chapter-1', paragraphs: ['其他章节。'] }]) === null,
    'A removed chapter should not restore into a different chapter.')

  const storage = memoryStorage()
  position.writeReaderPosition(storage, 'project-a', saved)
  const reentered = position.readReaderPosition(storage, 'project-a')
  check(reentered?.chapterId === 'chapter-2' && reentered.anchorText === saved.anchorText,
    'A re-entered project should recover its saved chapter and text anchor.')
  check(position.readReaderPosition(storage, 'project-b') === null,
    'Reader position storage must remain isolated by project id.')

  const throwingStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  check(position.readReaderPosition(throwingStorage, 'project-a') === null,
    'Storage read failures should not interrupt reading.')
  position.writeReaderPosition(throwingStorage, 'project-a', saved)

  const navigation = await readFile(join(root, 'src/renderer/src/views/reading/useReaderNavigation.ts'), 'utf8')
  const article = await readFile(join(root, 'src/renderer/src/views/reading/ReaderChapterArticle.tsx'), 'utf8')
  check(navigation.includes('capturePosition') && navigation.includes('restorePosition') && navigation.includes('preserveReadingPosition'),
    'Reader navigation must expose position capture and restoration hooks for layout-changing reading actions.')
  check(navigation.includes('window.setTimeout') && navigation.includes('lastCapturedPositionRef') && navigation.includes('useLayoutEffect') && navigation.includes('flushReaderPosition'),
    'Reader position writes must cache the latest scroll position and flush it before unmount.')
  check(navigation.includes('observedInitialChapterRef') && navigation.includes('previousInitialChapterId === initialChapterId'),
    'An unchanged initial chapter must not reapply after later prose updates.')
  check(article.includes('data-reader-segment-id'), 'Reader paragraphs need stable DOM anchors for position recovery.')
  check(!navigation.includes('article.offsetTop') && navigation.includes('offsetWithin(container, article) <= markerTop'),
    'Chapter jumps and active-chapter detection must use the scroll container coordinates, not a CSS-dependent offsetParent.')
  console.log('validate-reading-position: ok')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
