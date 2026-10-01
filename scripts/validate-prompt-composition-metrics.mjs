#!/usr/bin/env node
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const tempDir = join(root, 'tmp', 'validation', 'prompt-composition-metrics')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function makeBlock(id, title, kind, priority, source, included = true) {
  return {
    id,
    title,
    kind,
    priority,
    tokenEstimate: 0,
    source,
    sourceIds: [],
    included,
    compressed: false,
    forced: id === 'bridge',
    omittedReason: included ? null : 'fixture omitted',
    reason: 'validation fixture'
  }
}

async function loadService() {
  await rm(tempDir, { recursive: true, force: true })
  await mkdir(tempDir, { recursive: true })
  const bundlePath = join(tempDir, 'PromptCompositionMetricsService.mjs')
  await build({
    entryPoints: [join(root, 'src', 'services', 'PromptCompositionMetricsService.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  const normalizerPath = join(tempDir, 'runTraceNormalizer.mjs')
  await build({
    entryPoints: [join(root, 'src', 'shared', 'normalizers', 'runTrace.ts')],
    outfile: normalizerPath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  const cacheKey = Date.now()
  return {
    service: await import(`${pathToFileURL(bundlePath).href}?t=${cacheKey}`),
    normalizer: await import(`${pathToFileURL(normalizerPath).href}?t=${cacheKey}`)
  }
}

async function main() {
  const { service, normalizer } = await loadService()
  const { calculatePromptCompositionMetrics } = service
  const blocks = [
    makeBlock('bridge', '2. 上一章结尾衔接 Bridge', 'continuity_bridge', 2, 'continuity_service'),
    makeBlock('task', '3. 本章任务契约', 'chapter_task', 3, 'prompt_config'),
    makeBlock('state', '4. 当前角色硬状态', 'character_state', 4, 'state_ledger'),
    makeBlock('novelty', '12. 禁止事项与 NoveltyPolicy', 'forbidden_and_novelty', 12, 'task'),
    makeBlock('review', '审稿诊断信息', 'quality_review', 14, 'review'),
    makeBlock('omitted', '低相关回顾', 'recent_chapters', 7, 'chapters', false)
  ]
  const prompt = [
    '# 第 18 章写作 Prompt',
    '## 2. 上一章结尾衔接 Bridge',
    '周烬仍站在门禁前，倒计时继续。',
    '## 3. 本章任务契约',
    '本章目标：沿用已有线索推进调查。',
    '## 4. 当前角色硬状态',
    '周烬右臂骨裂，现金余额 5000 元。',
    '## 12. 禁止事项与 NoveltyPolicy',
    '不得新增未铺垫救命规则。',
    '不得新增没有铺垫的救命规则。',
    '## 审稿诊断信息',
    '风险：这只是后台诊断，不应进入写作 Prompt。'
  ].join('\n')
  const metrics = calculatePromptCompositionMetrics(prompt, blocks)

  assert(metrics.totalTokenEstimate > 0, '应计算最终 Prompt 总 token。')
  assert(metrics.blockMetrics.length === blocks.length, '每个 promptBlockOrder 都应有指标。')
  assert(metrics.blockMetrics.find((block) => block.id === 'bridge')?.category === 'factual_context', 'Bridge 应归入事实上下文。')
  assert(metrics.blockMetrics.find((block) => block.id === 'task')?.category === 'positive_task', '任务契约应归入正向任务。')
  assert(metrics.blockMetrics.find((block) => block.id === 'novelty')?.category === 'constraints', 'NoveltyPolicy 应归入约束。')
  assert(metrics.blockMetrics.find((block) => block.id === 'review')?.category === 'review_tone', '审稿块应归入审稿口吻。')
  assert(metrics.blockMetrics.find((block) => block.id === 'omitted')?.tokenEstimate === 0, '未纳入 block 不应计 token。')
  assert(metrics.categoryTokenEstimates.positive_task > 0, '正向任务分类应有 token。')
  assert(metrics.categoryTokenEstimates.factual_context > 0, '事实上下文分类应有 token。')
  assert(metrics.categoryTokenEstimates.constraints > 0, '约束分类应有 token。')
  assert(metrics.categoryTokenEstimates.review_tone > 0, '审稿口吻分类应有 token。')
  assert(metrics.repeatedSentences.length === 0, '不同句子不应误报为重复句。')
  assert(metrics.similarConstraints.length === 1, '应识别一组高相似中文禁令。')
  assert(!JSON.stringify(metrics).includes('不得新增未铺垫救命规则'), '告警只应保存指纹，不应复制 Prompt 原句。')
  assert(metrics.alerts.every((alert) => !('prompt' in alert)), '结果不得复制完整 Prompt。')
  assert(!JSON.stringify(metrics).includes(prompt), '结果不得包含完整 Prompt。')
  assert(metrics.summary.includes('token'), '结果应提供可读的测量摘要。')

  const duplicateTitleBlocks = [
    makeBlock('one', '重复标题', 'chapter_task', 1, 'task'),
    { ...makeBlock('two', '重复标题', 'chapter_task', 2, 'task'), tokenEstimate: 999 },
    { ...makeBlock('stale', '不存在的区块', 'chapter_task', 3, 'task'), tokenEstimate: 999 }
  ]
  const duplicateMetrics = calculatePromptCompositionMetrics('## 重复标题\n本章继续调查。', duplicateTitleBlocks)
  assert(duplicateMetrics.blockMetrics.filter((block) => block.tokenEstimate > 0).length === 1, '同一 section 只能归因给一个 block。')
  assert(duplicateMetrics.attributedTokenEstimate <= duplicateMetrics.totalTokenEstimate, '已归因 token 不得超过最终 Prompt 总 token。')

  const oldTrace = normalizer.normalizeGenerationRunTrace({ id: 'old-trace', projectId: 'project', jobId: 'job' })
  assert(oldTrace.promptCompositionMetrics === null, '缺少指标的旧 trace 应规范化为 null。')
  const normalizedLegacy = normalizer.normalizeGenerationRunTrace({
    id: 'legacy-trace',
    projectId: 'project',
    jobId: 'job',
    finalPromptTokenEstimate: 10,
    promptCompositionMetrics: {
      totalTokenEstimate: 10,
      attributedTokenEstimate: 99,
      blockMetrics: [
        { id: 'same', tokenEstimate: 8, category: 'constraints' },
        { id: 'same', tokenEstimate: 8, category: 'constraints' }
      ],
      repeatedSentences: [{ kind: 'repeated_sentence', sample: '这是不得持久化的原始提示词片段', relatedBlockIds: ['same'], occurrences: 2 }]
    }
  })
  assert(normalizedLegacy.promptCompositionMetrics?.blockMetrics.length === 1, '旧指标中的重复 block 应去重。')
  assert((normalizedLegacy.promptCompositionMetrics?.attributedTokenEstimate ?? 0) <= 10, '旧指标归因应与总 token 对账。')
  assert(!JSON.stringify(normalizedLegacy).includes('这是不得持久化的原始提示词片段'), '旧指标中的原始 Prompt 片段应被指纹化。')
  const [traceTypeSource, contextStepSource, rebuildStepSource, traceSummarySource] = await Promise.all([
    readFile(join(root, 'src', 'shared', 'types', 'trace.ts'), 'utf8'),
    readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineSteps', 'contextPlanning.ts'), 'utf8'),
    readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineSteps', 'chapterGeneration.ts'), 'utf8'),
    readFile(join(root, 'src', 'renderer', 'src', 'views', 'generation', 'runTraceSummary.ts'), 'utf8')
  ])
  assert(traceTypeSource.includes('promptCompositionMetrics: PromptCompositionMetrics | null'), 'Run Trace 应保存结构化 Prompt 构成指标。')
  assert(contextStepSource.includes('PromptCompositionMetricsService.calculate(state.context, promptBlockOrder, finalPromptTokenEstimate)'), '首次上下文构建应复用最终 Prompt token 并记录指标。')
  assert(rebuildStepSource.includes('PromptCompositionMetricsService.calculate(state.context, promptBlockOrder, finalPromptTokenEstimate)'), '计划后二次重建应覆盖为正文实际使用的 Prompt 指标。')
  assert(traceSummarySource.includes('alertCounts:'), 'Run Trace 摘要应只暴露紧凑 Prompt 构成告警计数。')
  console.log('Prompt composition metrics validation passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
