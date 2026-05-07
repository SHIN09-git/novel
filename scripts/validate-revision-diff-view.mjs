import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const root = resolve('.')
const outDir = join(root, 'tmp', 'revision-diff-view-test')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadTsModule(relativePath) {
  const source = await readFile(join(root, relativePath), 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  const outPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function hasSegment(result, type) {
  return result.segments.some((segment) => segment.type === type)
}

async function main() {
  const checks = []
  const { createTextDiff } = await loadTsModule('src/renderer/src/utils/textDiff.ts')
  const diffViewSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'revision', 'RevisionDiffView.tsx'), 'utf-8')
  const studioSource = await readFile(join(root, 'src', 'renderer', 'src', 'views', 'RevisionStudioView.tsx'), 'utf-8')
  const writebackSource = await readFile(join(root, 'src', 'renderer', 'src', 'utils', 'revisionWriteback.ts'), 'utf-8')
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'))

  const insertDiff = createTextDiff('林默推开门。\n', '林默推开门。\n门后多了一道冷光。\n')
  checks.push(
    assert(hasSegment(insertDiff, 'insert') && insertDiff.stats.insertedChars > 0, 'createTextDiff detects inserted text', insertDiff)
  )

  const deleteDiff = createTextDiff('林默推开门。\n门后多了一道冷光。\n', '林默推开门。\n')
  checks.push(
    assert(hasSegment(deleteDiff, 'delete') && deleteDiff.stats.deletedChars > 0, 'createTextDiff detects deleted text', deleteDiff)
  )

  const replaceDiff = createTextDiff('林默推门。\n', '林默推开铁门。\n')
  checks.push(
    assert(hasSegment(replaceDiff, 'replace') && replaceDiff.stats.replacedChars > 0, 'createTextDiff detects replaced text', replaceDiff)
  )

  const chineseReadableDiff = createTextDiff(
    '林默站在门前，指节贴着冰冷的铜环。\n雨声从走廊尽头漫过来。\n',
    '林默停在门前，指节贴着冰冷的铜环。\n雨声从走廊尽头漫过来。\n'
  )
  const replaceSegment = chineseReadableDiff.segments.find((segment) => segment.type === 'replace')
  checks.push(
    assert(
      Boolean(replaceSegment) &&
        (replaceSegment?.originalText?.trim().length ?? 0) > 1 &&
        (replaceSegment?.revisedText?.trim().length ?? 0) > 1 &&
        chineseReadableDiff.segments.length <= 4,
      'Chinese text diff stays readable instead of splitting into single-character noise',
      chineseReadableDiff
    )
  )

  const longOriginal = Array.from({ length: 1800 }, (_, index) => `第${index}段：旧句子。`).join('\n')
  const longRevised = `${longOriginal}\n结尾新增一段。`
  const startedAt = Date.now()
  const longDiff = createTextDiff(longOriginal, longRevised)
  const elapsedMs = Date.now() - startedAt
  checks.push(
    assert(
      elapsedMs < 1000 && longDiff.segments.length > 0 && longDiff.stats.insertedChars > 0,
      'long text diff uses a bounded fallback and remains responsive',
      { elapsedMs, segmentCount: longDiff.segments.length, stats: longDiff.stats }
    )
  )

  checks.push(
    assert(
      diffViewSource.includes('useMemo(() => createTextDiff(originalText, revisedText)') &&
        diffViewSource.includes('revision-diff-${segment.type}') &&
        diffViewSource.includes('revision-diff-replace'),
      'RevisionDiffView memoizes diff computation and renders insert/delete/replace states'
    )
  )

  checks.push(
    assert(
      studioSource.includes("useState<'original' | 'revised' | 'diff'>") &&
        studioSource.includes('revisionViewMode') &&
        studioSource.includes("setRevisionViewMode('original')") &&
        studioSource.includes("setRevisionViewMode('revised')") &&
        studioSource.includes("setRevisionViewMode('diff')") &&
        studioSource.includes('<RevisionDiffView originalText={sourceBody} revisedText={editableVersionBody} />'),
      'RevisionStudioView exposes original/revised/diff switching without removing the editable revised text path'
    )
  )

  checks.push(
    assert(
        writebackSource.includes('function chapterSnapshot') &&
        writebackSource.includes("source: 'revision_accept'") &&
        writebackSource.includes('chapterVersions: [snapshot, ...base.chapterVersions]'),
      'accepted chapter revisions still preserve the previous chapter body as ChapterVersion'
    )
  )

  checks.push(
    assert(
      studioSource.includes('applyAcceptedRevisionWriteback(current, project.id, currentWritebackSource, version, timestamp)') &&
        !studioSource.includes('createTextDiff('),
      'Diff view does not change the accept revision writeback path'
    )
  )

  checks.push(
    assert(
      packageJson.scripts?.test?.includes('validate-revision-diff-view.mjs'),
      'npm test includes validate-revision-diff-view.mjs'
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
