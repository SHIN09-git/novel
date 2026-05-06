import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve('.')
const sourcePath = join(root, 'src', 'renderer', 'src', 'utils', 'revisionMerge.ts')
const outDir = join(root, 'tmp', 'revision-merge-test')
const outPath = join(outDir, 'revisionMerge.mjs')

function assert(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function loadModule() {
  const source = await readFile(sourcePath, 'utf-8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true
    }
  })
  await mkdir(outDir, { recursive: true })
  await writeFile(outPath, compiled.outputText, 'utf-8')
  return import(`${pathToFileURL(outPath).href}?t=${Date.now()}`)
}

function expectThrows(fn, code) {
  try {
    fn()
    return false
  } catch (error) {
    return error?.code === code
  }
}

async function main() {
  const { looksLikeFullChapterRevision, mergeLocalRevisionSafely } = await loadModule()
  const checks = []

  checks.push(
    assert(
      mergeLocalRevisionSafely('开头。目标片段。结尾。', '目标片段。', '新片段。') === '开头。新片段。结尾。',
      '精确匹配时只替换目标片段'
    )
  )

  checks.push(
    assert(
      mergeLocalRevisionSafely('第一句。\n\n目标  片段\n下一句。', ' 目标 片段 下一句。 ', '修订段。') === '第一句。\n\n修订段。',
      '首尾空白和换行差异可以唯一匹配并安全替换'
    )
  )

  checks.push(
    assert(
      expectThrows(() => mergeLocalRevisionSafely('完整第一段。完整第二段。', '不存在的局部段落。', '只有局部修订。'), 'target_not_found'),
      'targetRange 不存在时抛错'
    )
  )

  checks.push(
    assert(
      expectThrows(() => mergeLocalRevisionSafely('目标片段。中间。目标片段。', '目标片段。', '新片段。'), 'target_not_unique'),
      'targetRange 出现多次时抛错'
    )
  )

  let unsafeResult = '完整第一段。完整第二段。'
  try {
    unsafeResult = mergeLocalRevisionSafely(unsafeResult, '不存在的局部段落。', '只有局部修订。')
  } catch {
    // Expected: matching failure must not produce a replacement body.
  }
  checks.push(
    assert(
      unsafeResult !== '只有局部修订。',
      '不匹配时不会把局部 revisedText 保存成整章 body'
    )
  )

  checks.push(
    assert(
      looksLikeFullChapterRevision(
        'Opening paragraph. Target paragraph. Closing paragraph.',
        'Target paragraph.',
        'Opening paragraph. Revised target paragraph. Closing paragraph.'
      ),
      'local mode can detect an AI response that looks like a full chapter'
    )
  )

  checks.push(
    assert(
      !looksLikeFullChapterRevision(
        'Opening paragraph. Target paragraph. Closing paragraph.',
        'Target paragraph.',
        'Revised target paragraph with better rhythm.'
      ),
      'local mode does not reject a normal revised fragment'
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
