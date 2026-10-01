import { existsSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'prompt-authority-alignment-test')

function assert(condition, message, details = {}) {
  return { ok: Boolean(condition), message, details }
}

function resolveLocalImport(fromPath, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(fromPath), specifier)
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
}

async function collectSourceTree(entryPath) {
  const sources = new Map()
  async function visit(filePath) {
    if (sources.has(filePath)) return
    const source = await readFile(filePath, 'utf-8')
    sources.set(filePath, source)
    const imports = ts.preProcessFile(source, true, true).importedFiles
    await Promise.all(imports.map(async ({ fileName }) => {
      const dependency = resolveLocalImport(filePath, fileName)
      if (dependency) await visit(dependency)
    }))
  }
  await visit(entryPath)
  return sources
}

function outputPathFor(sourcePath) {
  return join(outDir, relative(root, sourcePath)).replace(/\.tsx?$/, '.mjs')
}

function rewriteRelativeImports(output, sourcePath) {
  return output.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (match, prefix, specifier, suffix) => {
    const dependency = resolveLocalImport(sourcePath, specifier)
    if (!dependency) return match
    let emittedSpecifier = relative(dirname(outputPathFor(sourcePath)), outputPathFor(dependency)).replace(/\\/g, '/')
    if (!emittedSpecifier.startsWith('.')) emittedSpecifier = `./${emittedSpecifier}`
    return `${prefix}${emittedSpecifier}${suffix}`
  })
}

async function loadPromptBuilder() {
  const entryPath = join(root, 'src', 'services', 'PromptBuilderService.ts')
  const sources = await collectSourceTree(entryPath)
  await rm(outDir, { recursive: true, force: true })
  await Promise.all([...sources.entries()].map(async ([sourcePath, source]) => {
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        useDefineForClassFields: true
      }
    })
    const outPath = outputPathFor(sourcePath)
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, rewriteRelativeImports(compiled.outputText, sourcePath), 'utf-8')
  }))
  return import(`${pathToFileURL(outputPathFor(entryPath)).href}?t=${Date.now()}`)
}

const timestamp = '2026-09-05T00:00:00.000Z'

function makeChapter(order, summary) {
  return {
    id: `chapter-${order}`,
    projectId: 'project-authority',
    order,
    title: `第 ${order} 章`,
    body: '',
    summary,
    newInformation: '门牌编号会改变站台权限。',
    characterChanges: '林默右臂伤势加重。',
    newForeshadowing: '黑票副作用。',
    resolvedForeshadowing: '',
    endingHook: '门后传来第二个人的呼吸声。',
    riskWarnings: '',
    includedInStageSummary: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function buildFixture() {
  const project = {
    id: 'project-authority',
    name: '权威顺序测试稿',
    genre: '规则怪谈',
    description: '用于验证正文 Prompt 的作者权威顺序。',
    targetReaders: '悬疑读者',
    coreAppeal: '规则压力与人物互信',
    style: '克制、清晰',
    createdAt: timestamp,
    updatedAt: timestamp
  }
  const chapters = [makeChapter(1, '站台规则被首次发现。'), makeChapter(2, '门后呼吸声打断了离开尝试。')]
  return {
    project,
    bible: {
      projectId: project.id,
      worldbuilding: '旧交通系统构成副本。',
      corePremise: '幸存者必须承担选择代价。',
      protagonistDesire: '离开站台。',
      protagonistFear: '自己也是规则的一部分。',
      mainConflict: '互信与自保冲突。',
      powerSystem: '权限只能通过已公告规则变化。',
      bannedTropes: '禁止机械降神。',
      styleSample: '雨水沿着站牌往下滑。',
      narrativeTone: '冷峻、压迫。',
      immutableFacts: '未知管理员不能直接干预现实空间。',
      updatedAt: timestamp
    },
    chapters,
    characters: [{
      id: 'char-main', projectId: project.id, name: '林默', role: '主角', surfaceGoal: '打开站台门。', deepDesire: '证明自己不是牺牲者。', coreFear: '同伴发现他的秘密。', selfDeception: '相信自己只是在求生。', knownInformation: '知道门牌编号影响权限。', unknownInformation: '不知道女主看过管理员记录。', protagonistRelationship: '与女主互信但有裂缝。', emotionalState: '警惕、疲惫。', nextActionTendency: '先护住同伴再开门。', forbiddenWriting: '不得突然信任系统。', lastChangedChapter: 2, isMain: true, createdAt: timestamp, updatedAt: timestamp
    }],
    characterStateLogs: [],
    characterStateFacts: [{
      id: 'fact-arm', projectId: project.id, characterId: 'char-main', category: 'physical', key: 'right-arm', label: '右臂刺痛', valueType: 'text', value: '右臂刺痛，不能持续用力。', unit: '', linkedCardFields: ['weaknessAndCost'], trackingLevel: 'hard', promptPolicy: 'always', status: 'active', sourceChapterId: 'chapter-2', sourceChapterOrder: 2, evidence: '第 2 章受伤。', confidence: 1, createdAt: timestamp, updatedAt: timestamp
    }],
    foreshadowings: [{
      id: 'fs-ticket', projectId: project.id, title: '黑票副作用', firstChapterOrder: 1, description: '黑票会改变持有者的站台权限。', status: 'unresolved', weight: 'payoff', treatmentMode: 'advance', expectedPayoff: '第 4 章', payoffMethod: '以选择代价兑现。', relatedCharacterIds: ['char-main'], relatedMainPlot: '站台规则', notes: '', actualPayoffChapter: null, createdAt: timestamp, updatedAt: timestamp
    }],
    timelineEvents: [{
      id: 'timeline-1', projectId: project.id, chapterId: 'chapter-2', chapterOrder: 2, narrativeOrder: 1, storyTime: '第一个雨夜', title: '站台门被打开', result: '门后传来呼吸声。', downstreamImpact: '下一章必须直接承接。', createdAt: timestamp, updatedAt: timestamp
    }],
    stageSummaries: [{
      id: 'summary-1', projectId: project.id, chapterStart: 1, chapterEnd: 1, coveredChapterRange: '第 1 章', compressedPlotSummary: '林默发现站台规则。', irreversibleChanges: '黑票出现。', endingCarryoverState: '站台门尚未打开。', emotionalAftertaste: '压迫感。', pacingState: '推进', plotProgress: '', characterRelations: '', secrets: '', foreshadowingPlanted: '', foreshadowingResolved: '', unresolvedQuestions: '', nextStageDirection: '', createdAt: timestamp, updatedAt: timestamp
    }],
    chapterContinuityBridges: [{
      id: 'bridge-2-3', projectId: project.id, fromChapterId: 'chapter-2', toChapterOrder: 3, lastSceneLocation: '旧站台门口', lastPhysicalState: '右臂刺痛', lastEmotionalState: '警惕', lastUnresolvedAction: '刚握住门把手', lastDialogueOrThought: '门后为什么有人？', immediateNextBeat: '从门后呼吸声继续。', mustContinueFrom: '开门前后的数秒。', mustNotReset: '不得重讲站台规则。', openMicroTensions: '林默没有告诉女主听见了呼吸声。', createdAt: timestamp, updatedAt: timestamp
    }],
    hardCanonPack: {
      id: 'hard-canon-pack-project-authority', projectId: project.id, title: '不可违背设定包', description: '', maxPromptTokens: 500, schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp,
      items: [{ id: 'canon-1', projectId: project.id, category: 'system_rule', title: '系统规则不能临时救命', content: '系统不得弹出无代价的救命补充条款。', priority: 'must', status: 'active', sourceType: 'manual', sourceId: null, relatedCharacterIds: [], relatedForeshadowingIds: [], relatedTimelineEventIds: [], createdAt: timestamp, updatedAt: timestamp }]
    },
    storyDirectionGuide: {
      id: 'guide-1', projectId: project.id, title: '站台阶段', status: 'active', source: 'ai_generated', horizonChapters: 5, startChapterOrder: 3, endChapterOrder: 7, userRawIdea: '', userPolishedIdea: '', aiGuidance: '让门后人推动互信危机。', strategicTheme: '互信的代价', coreDramaticPromise: '门后人迫使林默选择。', emotionalCurve: '紧张上升', characterArcDirectives: '林默开始怀疑女主。', foreshadowingDirectives: '推进黑票副作用。', constraints: '不得解释管理员真相。', forbiddenTurns: '不得提前回收站台源头。', generatedFromStageSummaryIds: [], generatedFromChapterIds: [], warnings: [], createdAt: timestamp, updatedAt: timestamp,
      chapterBeats: [{ id: 'beat-3', chapterOffset: 1, chapterOrder: 3, goal: '确认门后人身份', conflict: '开门会暴露林默', characterFocus: '林默和女主', foreshadowingToUse: '黑票副作用', foreshadowingNotToReveal: '管理员真相', suspenseToKeep: '门后人是否真实', endingHook: '门后人叫出林默旧名', readerEmotion: '紧张', mustAvoid: '不要新增规则', notes: '' }]
    },
    explicitContextSelection: {
      selectedStoryBibleFields: [], selectedChapterIds: chapters.map((chapter) => chapter.id), selectedStageSummaryIds: ['summary-1'], selectedCharacterIds: ['char-main'], selectedForeshadowingIds: ['fs-ticket'], selectedTimelineEventIds: ['timeline-1'], estimatedTokens: 1200, omittedItems: [], compressionRecords: [], warnings: []
    },
    config: {
      projectId: project.id, targetChapterOrder: 3, mode: 'standard', useContinuityBridge: true,
      modules: { bible: true, progress: true, recentChapters: true, characters: true, foreshadowing: true, stageSummaries: true, timeline: true, chapterTask: true, forbidden: true, outputFormat: true },
      task: { goal: '打开站台门并确认呼吸声来源。', conflict: '保护同伴会暴露林默。', suspenseToKeep: '门后人是否真实。', allowedPayoffs: '允许推进黑票副作用。', forbiddenPayoffs: '禁止解释管理员真实身份。', endingHook: '门后人叫出林默旧名。', readerEmotion: '紧张和怀疑。', targetWordCount: '3000', styleRequirement: '冷静克制，少解释。' },
      selectedCharacterIds: ['char-main'], selectedForeshadowingIds: ['fs-ticket'], foreshadowingTreatmentOverrides: {}
    }
  }
}

function headingIndex(prompt, title) {
  return prompt.indexOf(`## ${title}`)
}

function sectionBody(prompt, title) {
  const start = headingIndex(prompt, title)
  if (start < 0) return ''
  const next = prompt.indexOf('\n## ', start + 1)
  return prompt.slice(start, next < 0 ? prompt.length : next)
}

async function main() {
  const source = await readFile(join(root, 'src/services/PromptBuilderService.ts'), 'utf-8')
  const checks = []
  checks.push(assert(!source.includes("id: 'legacy-story-bible-hard-canon'"), 'new prose prompts no longer carry the disabled legacy Story Bible placeholder block'))

  const { PromptBuilderService } = await loadPromptBuilder()
  const result = PromptBuilderService.buildResult(buildFixture())
  const prompt = result.finalPrompt
  const expectedTitles = [
    '0. 上下文冲突优先级规则', '1. 写作任务声明', '2. 上一章结尾衔接 Bridge', '3. 本章任务契约',
    '4. 不可违背设定 HardCanonPack', '5. 当前角色硬状态', '6. 本章伏笔操作规则', '7. 中期剧情导向 StoryDirectionGuide',
    '8. 当前剧情状态', '9. 最近章节详细回顾', '10. 远期压缩摘要', '11. 时间线事件', '12. 风格要求 StyleEnvelope',
    '13. 写作限制与 NoveltyPolicy', '14. 输出格式要求'
  ]
  const headingPositions = expectedTitles.map((title) => headingIndex(prompt, title))
  checks.push(assert(headingPositions.every((position) => position >= 0), 'final prose prompt renders every authority block in the aligned fixture', { headingPositions }))
  checks.push(assert(headingPositions.every((position, index) => index === 0 || position > headingPositions[index - 1]), 'final prose prompt physical order follows the authority sequence', { headingPositions }))

  const included = result.promptBlockOrder.filter((block) => block.included)
  checks.push(assert(included.map((block) => block.title).join('|') === expectedTitles.join('|'), 'promptBlockOrder mirrors the final prompt order', { titles: included.map((block) => block.title) }))
  checks.push(assert(included.map((block) => block.priority).join('|') === Array.from({ length: 15 }, (_, index) => index).join('|'), 'included block priorities are unique and continuous', { priorities: included.map((block) => block.priority) }))
  checks.push(assert(new Set(included.map((block) => block.priority)).size === included.length, 'promptBlockOrder has no duplicate priority values'))
  checks.push(assert(
    headingIndex(prompt, '2. 上一章结尾衔接 Bridge') < headingIndex(prompt, '4. 不可违背设定 HardCanonPack') &&
      headingIndex(prompt, '3. 本章任务契约') < headingIndex(prompt, '4. 不可违背设定 HardCanonPack'),
    'Bridge and chapter task appear before HardCanonPack'
  ))
  checks.push(assert(prompt.includes('写作任务声明只说明本次产出范围') && prompt.includes('1. 上一章结尾衔接 Bridge') && prompt.includes('3. HardCanonPack 不可违背硬设定'), 'priority rule text states the same authority order'))

  const noveltyPhrase = '不得新增任务未授权的人物、地点、组织、规则、机制或关键道具。'
  checks.push(assert((prompt.match(new RegExp(noveltyPhrase, 'g')) ?? []).length === 1, 'the complete Chinese novelty constraint appears once in the final prompt'))
  checks.push(assert(!sectionBody(prompt, '14. 输出格式要求').includes('不得新增任务未授权'), 'output-format block no longer duplicates novelty restrictions'))
  checks.push(assert(!prompt.includes('## 中期剧情导向 StoryDirectionGuide\n状态：'), 'story direction does not inject a second nested prompt section heading'))

  const failed = checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, totalChecks: checks.length, failed }, null, 2))
  if (failed.length) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
