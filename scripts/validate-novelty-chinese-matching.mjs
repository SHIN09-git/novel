#!/usr/bin/env node
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'novelty-chinese-matching-test')

async function loadTsModule(relativePath) {
  await mkdir(outDir, { recursive: true })
  const outputPath = join(outDir, `${relativePath.replace(/[\\/.:]/g, '-')}.mjs`)
  await build({
    entryPoints: [join(root, relativePath)],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`)
}

function assert(condition, message, details) {
  if (!condition) {
    console.error(`✗ ${message}`)
    if (details !== undefined) console.error(JSON.stringify(details, null, 2))
    process.exitCode = 1
    return
  }
  console.log(`✓ ${message}`)
}

function noveltyFindings(audit) {
  return [
    ...audit.newWorldRules,
    ...audit.newSystemMechanics,
    ...audit.newOrganizationsOrRanks,
    ...audit.majorLoreReveals,
    ...audit.suspiciousDeusExRules
  ]
}

const strictPlan = {
  chapterTitle: '中文分词回归章',
  chapterGoal: '只使用既有规则调查走廊',
  conflictToPush: '门禁倒计时继续',
  characterBeats: '',
  foreshadowingToUse: '',
  foreshadowingNotToReveal: '',
  endingHook: '',
  readerEmotionTarget: '紧张',
  estimatedWordCount: '3000',
  openingContinuationBeat: '',
  carriedPhysicalState: '',
  carriedEmotionalState: '',
  unresolvedMicroTensions: '',
  forbiddenResets: '',
  allowedNovelty: '无',
  forbiddenNovelty: '禁止新增救命规则、系统权限、管理员和重大设定'
}

async function main() {
  const { NoveltyDetector } = await loadTsModule('src/services/NoveltyDetector.ts')
  const { keywordOccurrences } = await loadTsModule('src/services/novelty/noveltyText.ts')
  const { collectNoveltyReviewFindings } = await loadTsModule('src/shared/noveltyReview.ts')

  const truePositiveMatrix = [
    ['系统面板突然弹出附加条款：主角获得临时权限，门禁立即强制放行。', '附加条款'],
    ['【区域管理员－０３】首次接管此区，并授予队伍紧急权限。', '区域管理员'],
    ['广播宣布：“补充条款已经生效，核心单元可携带协同单元脱困。”', '补充条款'],
    ['档案揭示完整真相：意识剥离后的记忆会进入冗余池。', '完整真相']
  ]
  for (const [text, expectedKeyword] of truePositiveMatrix) {
    const audit = NoveltyDetector.audit({ generatedText: text, context: '', chapterPlan: strictPlan })
    assert(noveltyFindings(audit).some((finding) => finding.text === expectedKeyword), `真阳性：${expectedKeyword}`, audit)
  }

  const negativeMatrix = [
    ['管理员工位旁的灯坏了。', '“管理员”不会从“管理员工位”中误命中'],
    ['总部署完成后，值班员离开会议室。', '“总部”不会从“总部署”中误命中'],
    ['回收站台旁堆着废纸箱。', '“回收站”不会从“回收站台”中误命中'],
    ['她走进源头书店，买下了题为《系统核心》的小说。', '专名和书名不会被当作世界观揭示'],
    ['这里没有附加条款，也不存在临时权限，更不可能获得豁免。', '否定句不会生成规则 finding'],
    ['广播复述了“区域管理员-03拥有强制放行权”的传言，记录员注明该说法不成立。', '被否认的引用不会生成 finding'],
    ['五米范围只是走廊的物理长度，不代表共享身份或保护机制。', '普通物理范围不会生成机制 finding'],
    ['她没有立刻伸手，只是退后半步。', '“她没有”不会被识别为新增命名角色'],
    ['然后她伸手关掉台灯。', '“然后她”不会被识别为新增命名角色'],
    ['我伸手接住杯子。', '“我伸手”不会被识别为新增命名角色']
  ]
  for (const [text, message] of negativeMatrix) {
    const audit = NoveltyDetector.audit({ generatedText: text, context: '', chapterPlan: strictPlan })
    assert(noveltyFindings(audit).length === 0, message, noveltyFindings(audit))
    assert(collectNoveltyReviewFindings(audit).length === 0, `${message}，且不会在审稿/Trace 聚合层复活`, collectNoveltyReviewFindings(audit))
  }

  const explicitNameAudit = NoveltyDetector.audit({
    generatedText: '门外的人摘下帽子：“我叫顾临川”。',
    context: '',
    chapterPlan: strictPlan,
    knownCharacterNames: []
  })
  assert(
    explicitNameAudit.newNamedCharacters.some((finding) => finding.text === '顾临川' && finding.confidence === 'high'),
    '明确自我介绍仍能识别新命名角色',
    explicitNameAudit.newNamedCharacters
  )

  const lowConfidenceAudit = NoveltyDetector.audit({
    generatedText: '顾临川伸手挡住门。',
    context: '',
    chapterPlan: strictPlan,
    knownCharacterNames: []
  })
  assert(
    lowConfidenceAudit.newNamedCharacters.every((finding) => finding.confidence !== 'low' || finding.severity !== 'fail'),
    '低置信度动作归属人名最多为 warning，不能阻断采纳',
    lowConfidenceAudit.newNamedCharacters
  )

  const closedOpeningPlan = {
    ...strictPlan,
    forbiddenNovelty: {
      forbiddenNewCharacters: ['不得新增 ChapterTask 未明确提供的带专名人物或有剧情功能的新人物'],
      forbiddenNewRules: [],
      forbiddenSystemMechanics: [],
      forbiddenOrganizationsOrRanks: [],
      forbiddenLoreReveals: [],
      notes: ''
    }
  }
  const surnameAliasAudit = NoveltyDetector.audit({
    generatedText: '我走到卖鸡蛋的老周摊位前。老周正跟旁边的人聊天。保安老周说今天人多。小王喊我让一让，阿李递来纸袋。',
    context: '',
    chapterPlan: closedOpeningPlan,
    knownCharacterNames: ['陈航', '林雯']
  })
  for (const alias of ['老周', '小王', '阿李']) {
    assert(
      surnameAliasAudit.newNamedCharacters.some(
        (finding) => finding.text === alias && ['medium', 'high'].includes(finding.confidence) && finding.severity === 'fail'
      ),
      `封闭首章识别并阻断未授权姓氏称呼：${alias}`,
      surnameAliasAudit.newNamedCharacters
    )
  }
  assert(surnameAliasAudit.severity === 'fail', '结构化禁写文案会把未授权姓氏称呼升级为 fail', surnameAliasAudit)

  const everydayRoleAliasAudit = NoveltyDetector.audit({
    generatedText: '我走到老张头摊位前，老张头正理货。回家路上又碰见张阿姨遛狗。',
    context: '',
    chapterPlan: closedOpeningPlan,
    knownCharacterNames: ['陈航', '林雯']
  })
  for (const alias of ['老张头', '张阿姨']) {
    assert(
      everydayRoleAliasAudit.newNamedCharacters.some(
        (finding) => finding.text === alias && finding.confidence === 'medium' && finding.severity === 'fail'
      ),
      `封闭首章识别并阻断日常姓氏称呼：${alias}`,
      everydayRoleAliasAudit.newNamedCharacters
    )
  }

  const knownSurnameAliasAudit = NoveltyDetector.audit({
    generatedText: '保安喊了一声：“小陈，鸡蛋拿稳。”小陈点点头。',
    context: '',
    chapterPlan: closedOpeningPlan,
    knownCharacterNames: ['陈航', '林雯']
  })
  assert(
    knownSurnameAliasAudit.newNamedCharacters.every((finding) => finding.text !== '小陈'),
    '已知角色陈航的姓氏别称“小陈”不会误报',
    knownSurnameAliasAudit.newNamedCharacters
  )

  const surnameAliasNoiseAudit = NoveltyDetector.audit({
    generatedText: '这个小周末我不出门，阿房宫模型放在老周边地图旁，小陈列柜已经擦干净。太阳已经升得老高，晒得人后背发烫。然后她伸手关灯。',
    context: '',
    chapterPlan: closedOpeningPlan,
    knownCharacterNames: []
  })
  assert(
    surnameAliasNoiseAudit.newNamedCharacters.length === 0,
    '姓氏称呼规则不会把普通词、代词或副词识别成人名',
    surnameAliasNoiseAudit.newNamedCharacters
  )

  const offsetText = '前文正常。系统提示：【附加条款】立即生效。'
  const [offsetOccurrence] = keywordOccurrences(offsetText, ['附加条款'])
  assert(
    offsetOccurrence?.index === offsetText.indexOf('附加条款') &&
      offsetText.slice(offsetOccurrence.index, offsetOccurrence.matchEnd) === '附加条款' &&
      offsetOccurrence.evidenceExcerpt.includes('附加条款'),
    '原文 offset、matchEnd 和证据片段保持一致',
    offsetOccurrence
  )

  const [fullWidthOccurrence] = keywordOccurrences('ＡＰＩ 权限', ['API'])
  assert(fullWidthOccurrence?.index === 0, 'NFKC 支持全角/半角拉丁字符并保留原文 offset', fullWidthOccurrence)
  assert(keywordOccurrences('臨時權限已開放', ['臨時權限']).length === 1, '繁体词条在词典显式提供时遵守同一中文边界规则')

  const longBenignText = '管理员工位旁的旧钟响了。这里没有附加条款，也不存在临时权限。她走进源头书店。'.repeat(4_000)
  NoveltyDetector.audit({ generatedText: longBenignText, context: '', chapterPlan: strictPlan })
  const durations = []
  let finalAudit = null
  for (let index = 0; index < 5; index += 1) {
    const startedAt = performance.now()
    finalAudit = NoveltyDetector.audit({ generatedText: longBenignText, context: '', chapterPlan: strictPlan })
    durations.push(performance.now() - startedAt)
  }
  const p95 = [...durations].sort((left, right) => left - right)[Math.ceil(durations.length * 0.95) - 1]
  assert(noveltyFindings(finalAudit).length === 0, '长文本重复扫描仍保持零误报', noveltyFindings(finalAudit))
  assert(p95 < 1_500, `长文本 Novelty Audit 算法预算通过（p95 ${p95.toFixed(1)}ms < 1500ms）`, durations)

  if (process.exitCode) process.exit(process.exitCode)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
