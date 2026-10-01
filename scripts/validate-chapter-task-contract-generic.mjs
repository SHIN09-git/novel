#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'chapter-contract-generic-test')

function assert(condition, message, details) {
  if (condition) return
  throw new Error(`${message}${details ? `\n${JSON.stringify(details, null, 2)}` : ''}`)
}

function task(overrides = {}) {
  return {
    goal: '',
    conflict: '',
    suspenseToKeep: '',
    allowedPayoffs: '',
    forbiddenPayoffs: '',
    endingHook: '',
    readerEmotion: '',
    targetWordCount: '',
    styleRequirement: '',
    ...overrides
  }
}

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const outfile = join(outDir, 'contract-service.mjs')
await build({
  entryPoints: [join(repoRoot, 'src/services/ChapterTaskContractService.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'silent'
})
const { ChapterTaskContractService } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)

const evaluate = (body, overrides, title = '') => ChapterTaskContractService.evaluate({
  body,
  title,
  chapterTask: task(overrides)
})

const explicitLengthFailure = evaluate('甲'.repeat(119), { targetWordCount: '120-180 字' })
assert(!explicitLengthFailure.pass && explicitLengthFailure.issues.some((issue) => issue.type === 'chapter_task_length'),
  '明确篇幅下限必须硬失败。', explicitLengthFailure)
assert(evaluate('甲'.repeat(120), { targetWordCount: '120-180 字' }).pass, '明确篇幅边界值必须通过。')

for (const wording of ['目标字数 100 字', '正文约 100 字', '控制在 100 字左右']) {
  const result = evaluate('甲'.repeat(79), { targetWordCount: wording })
  assert(result.measurements.expectedCharacterRange?.[0] === 80 && !result.pass,
    `常见单一目标写法必须沿用产品 80% 明显不足策略：${wording}`, result)
}

const explicitPhraseTask = {
  targetWordCount: '100-300 字',
  allowedPayoffs: '短语“白色风铃”全文只出现一次，并且首次出现位置不得早于正文80%。',
  endingHook: '短语“白色风铃”出现后不得超过20字。'
}
const latePhraseBody = `${'甲'.repeat(100)}白色风铃${'乙'.repeat(10)}`
assert(evaluate(latePhraseBody, explicitPhraseTask).pass, '明确短语次数、位置和尾长同时满足时必须通过。')
const earlyPhrase = evaluate(`白色风铃${'甲'.repeat(110)}`, explicitPhraseTask)
assert(earlyPhrase.issues.some((issue) => issue.type === 'chapter_task_phrase_position'), '明确短语位置违规必须硬失败。', earlyPhrase)

const quotedBan = evaluate('潮湿空气里传来金属回声。', {
  targetWordCount: '10-100 字',
  styleRequirement: '禁止使用词语“金属回声”。'
})
assert(quotedBan.issues.some((issue) => issue.type === 'chapter_task_style_forbidden_term'), '明确引号禁词必须硬失败。', quotedBan)
const listBan = evaluate('潮湿空气里有霓虹和血雾。', {
  targetWordCount: '10-100 字',
  styleRequirement: '禁止短语：霓虹、血雾。'
})
assert(listBan.issues.filter((issue) => issue.type === 'chapter_task_style_forbidden_term').length === 2,
  '明确禁词列表中的每个词都必须检查。', listBan)
const suffixBan = evaluate('潮湿空气里又传来白色风铃。', {
  targetWordCount: '10-100 字',
  styleRequirement: '“白色风铃”在全文不得出现。'
})
assert(suffixBan.issues.some((issue) => issue.type === 'chapter_task_style_forbidden_term'),
  '紧邻引号短语的明确后置禁令必须硬失败。', suffixBan)

const semanticStoryTask = {
  targetWordCount: '10-200 字',
  conflict: '秦川不能答应顾遥次日远航，也不要让顾遥离开实验舱。',
  suspenseToKeep: '秦川不追问信号来源。'
}
const semanticStoryResult = evaluate('顾遥问明天是否远航，秦川点头。随后顾遥走出实验舱，追问信号来自哪里。', semanticStoryTask)
assert(semanticStoryResult.pass && semanticStoryResult.retryReason === null && semanticStoryResult.warnings.length > 0,
  '人物动作和专属情节只能进入语义复核，不得触发本地硬失败或重试。', semanticStoryResult)

for (const wording of [
  '如果节奏合适，短语“白色风铃”只出现一次。',
  '视篇幅，短语“白色风铃”首次出现位置不得早于正文80%。',
  '尽可能让短语“白色风铃”出现后不超过20字。',
  '建议优先避免使用词语“白色风铃”。'
]) {
  const result = evaluate(`白色风铃${'甲'.repeat(50)}白色风铃${'乙'.repeat(50)}`, {
    targetWordCount: '10-200 字',
    styleRequirement: wording
  })
  assert(result.pass && result.retryReason === null, `不确定建议不得强制重试：${wording}`, result)
}

const nearbyBinding = evaluate('样例引文在这里，真正的血腥情节并未发生。', {
  targetWordCount: '10-200 字',
  forbiddenPayoffs: '“样例引文”只是说明对象，但不得出现血腥情节。'
})
assert(nearbyBinding.pass && nearbyBinding.retryReason === null,
  '引号后的剧情禁令不得倒绑为对前述引文的字面禁令。', nearbyBinding)

const serviceSource = await readFile(join(repoRoot, 'src/services/ChapterTaskContractService.ts'), 'utf8')
const helperSource = await readFile(join(repoRoot, 'src/services/chapterTaskContractPhrases.ts'), 'utf8')
for (const legacyType of ['chapter_task_forbidden_source_inquiry', 'chapter_task_forbidden_outing_decision', 'chapter_task_post_return_presence_break']) {
  assert(!serviceSource.includes(legacyType) && !helperSource.includes(legacyType), `通用合同服务不得再产生作品专属问题类型：${legacyType}`)
}

console.log('Generic ChapterTask contract validation passed.')
