import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')
const tempRoot = join(repoRoot, 'tmp')
await mkdir(tempRoot, { recursive: true })
const directory = await mkdtemp(join(tempRoot, 'agent-book-reference-'))
const serverPath = join(directory, 'mcp.mjs')
const time = '2026-11-19T00:00:00.000Z'
const primary = 'book-reference-primary'
const other = 'book-reference-other'
const empty = 'book-reference-empty'
const bibleTool = 'agent.getStoryBible'
const summaryTool = 'agent.getStageSummaries'
const testCredential = 'REFERENCE_READ_TEST_NOT_A_SECRET'
const foreignText = '这段只属于另一本书。'
const longPlot = '　开头留下了四枚未登记的石牌。\n\n' + '调查沿着旧河岸继续。'.repeat(42) + '\n　他们最后回到渡口。'
const bible = {
  projectId: primary, updatedAt: time, worldbuilding: '　地图分成三层。\n\n  ' + '渡口只有涨潮时开门。'.repeat(40),
  corePremise: '从遗失的路牌重建路线。'.repeat(30), protagonistDesire: '走出港口。', protagonistFear: '混淆父亲的方向。',
  mainConflict: '每条地图记得不同的路。', powerSystem: '无超自然系统。', bannedTropes: '不能凭空出现捷径。',
  styleSample: '　“往东。”\n\n    父亲没回头。', narrativeTone: '克制，少解释。',
  immutableFacts: '港口从未外迁。'
}

function rpc(method, params) {
  const result = spawnSync(process.execPath, [serverPath], {
    cwd: repoRoot, input: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\n',
    encoding: 'utf8', timeout: 15000, windowsHide: true
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

try {
  const buildOptions = {
    bundle: true, format: 'esm', platform: 'node', target: 'node22',
    external: ['better-sqlite3', 'electron'], logLevel: 'silent'
  }
  const fixturePath = join(directory, 'fixture.mjs')
  await build({ ...buildOptions, outfile: fixturePath, stdin: { resolveDir: repoRoot, contents: [
    "export { normalizeAppData } from './src/shared/defaults';",
    "export { JsonStorageService } from './src/storage/JsonStorageService';",
    "export { SqliteStorageService } from './src/storage/SqliteStorageService';"
  ].join('\n') } })
  await build({ ...buildOptions, outfile: serverPath, entryPoints: [join(repoRoot, 'src/agent/mcp/server.ts')],
    banner: { js: "globalThis.fetch = () => { throw new Error('Network forbidden in book reference fixtures.') }" } })
  const api = await import(pathToFileURL(fixturePath).href)
  const descriptors = rpc('tools/list', {}).result.tools
  for (const name of [bibleTool, summaryTool]) {
    const tool = descriptors.find(item => item.name === name)
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.equal(tool.inputSchema.additionalProperties, false)
  }
  const stage = (id, projectId, chapterStart, chapterEnd, fields) =>
    ({ id, projectId, chapterStart, chapterEnd, createdAt: time, updatedAt: time, ...fields })
  const seed = api.normalizeAppData({
    projects: [[primary, '参考资料样书'], [other, '另一本书'], [empty, '空参考资料样书']]
      .map(([id, name]) => ({ id, name, createdAt: time, updatedAt: time })),
    storyBibles: [
      { ...bible, transportState: { token: testCredential } },
      { ...bible, projectId: other, worldbuilding: foreignText }
    ],
    stageSummaries: [
      stage('older', primary, 1, 3, { plotProgress: '这是从旧字段读取的压缩剧情。', characterRelations: '曾在渡口相识。' }),
      stage('long', primary, 4, 8, {
        compressedPlotSummary: longPlot, irreversibleChanges: '石牌已经交换。', endingCarryoverState: '夜潮仍未退。',
        emotionalAftertaste: '疑心未消。', pacingState: '换场前停顿。', secrets: '旧稿保留的秘密长注。'.repeat(40),
        unresolvedQuestions: '谁刻下第三行？', nextStageDirection: '早期记录的下一阶段备注。',
        foreshadowingPlanted: '石牌边缘刻着旧路名。', foreshadowingResolved: '归还了第一块石牌。'
      }),
      stage('same-range-a', primary, 9, 12, { compressedPlotSummary: `末段剧情。Authorization: Bearer ${testCredential}` }),
      stage('same-range-b', primary, 9, 12, { compressedPlotSummary: '本段的另一个作者版本。' }),
      stage('foreign-summary', other, 9, 15, { compressedPlotSummary: foreignText })
    ],
    chapters: [{ id: 'unrelated-chapter', projectId: primary, order: 1, body: '不要随参考资料返回这份完整正文。' }]
  })
  for (const [source, Storage] of [['json', api.JsonStorageService], ['sqlite', api.SqliteStorageService]]) {
    const userDataPath = join(directory, source)
    const storagePath = join(userDataPath, `reference.${source}`)
    await mkdir(userDataPath)
    const writer = new Storage(storagePath)
    try { await writer.save(seed) } finally { writer.close?.() }
    if (source === 'sqlite') {
      const db = new Database(storagePath, { fileMustExist: true })
      try { db.pragma('journal_mode = DELETE') } finally { db.close() }
    }
    const before = await readFile(storagePath)
    const beforeFiles = await readdir(userDataPath)
    const scope = { storagePath, userDataPath }
    const project = { projectId: primary }
    const request = (name, args) => rpc('tools/call', { name, arguments: { ...scope, ...args } })
    const call = (name, args) => {
      const response = request(name, args)
      assert.equal(response.error, undefined, JSON.stringify(response.error))
      const output = response.result.structuredContent
      assert.deepEqual(JSON.parse(response.result.content[0].text), output)
      assert.equal(output.storage.source, source)
      assert.doesNotMatch(JSON.stringify(output.data), /REFERENCE_READ_TEST_NOT_A_SECRET|不要随参考资料返回/)
      return output.data
    }

    const index = call(bibleTool, { project: '参考资料样书' })
    assert.equal(index.projectId, primary)
    assert.equal(index.bible.worldbuilding, undefined)
    assert.ok(index.bible.populatedFields.includes('styleSample'))
    assert.ok(index.bible.corePremise.length < bible.corePremise.length)
    const fullBible = call(index.fullRead.tool, index.fullRead.arguments)
    assert.deepEqual(fullBible.bible, bible)
    assert.equal(fullBible.fullRead, undefined)
    assert.equal(call(bibleTool, { projectId: empty, detail: 'full' }).bible, null)
    assert.equal(call(bibleTool, { projectId: other, detail: 'full' }).bible.worldbuilding, foreignText)

    const compact = call(summaryTool, { ...project, fromChapter: 8, toChapter: 9, limit: 2 })
    assert.deepEqual(compact.summaries.map(item => item.id), ['same-range-a', 'same-range-b'])
    assert.equal(compact.total, 3)
    assert.equal(compact.nextOffset, 2)
    assert.match(compact.summaries[0].excerpt, /\[REDACTED\]/)
    const page2 = call(summaryTool, { ...project, fromChapter: 8, toChapter: 9, limit: 2, offset: compact.nextOffset })
    assert.equal(page2.nextOffset, null)
    assert.equal(page2.summaries[0].id, 'long')
    assert.ok(page2.summaries[0].excerpt.length < longPlot.length)
    assert.equal(page2.summaries[0].secrets, undefined)
    const ref = page2.summaries[0].fullRead
    const full = call(ref.tool, ref.arguments)
    assert.equal(full.total, 1)
    assert.deepEqual(full.summaries[0], seed.stageSummaries.find(item => item.id === 'long'))
    const legacy = call(summaryTool, { ...project, summaryId: 'older', detail: 'full' }).summaries[0]
    assert.equal(legacy.compressedPlotSummary, legacy.plotProgress)
    assert.equal(legacy.characterRelations, '曾在渡口相识。')
    assert.equal(call(summaryTool, { ...project, summaryId: 'foreign-summary', detail: 'full' }).total, 0)
    assert.deepEqual(call(summaryTool, { projectId: empty }).summaries, [])
    assert.match(request(summaryTool, { ...project, fromChapter: 9, toChapter: 3 }).error.message, /must not exceed/)
    assert.match(request(summaryTool, { ...project, limit: 51 }).error.message, /Invalid limit/)
    assert.match(request(bibleTool, { ...project, patch: {} }).error.message, /Unsupported/)
    assert.match(request(bibleTool, { ...project, detail: 'headline' }).error.message, /detail must/)
    assert.match(request(bibleTool, { ...project, storagePath: join(userDataPath, 'missing.sqlite') }).error.message, /not found/)
    assert.deepEqual(await readFile(storagePath), before)
    assert.deepEqual(await readdir(userDataPath), beforeFiles)
    console.log(`PASS ${source}: project scope, exact full Bible/summary, legacy notes, range/paging links, redaction, unchanged storage via MCP`)
  }
} finally {
  const child = relative(tempRoot, directory)
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('Refusing to clean outside the isolated test root.')
  await rm(directory, { recursive: true, force: true })
}
