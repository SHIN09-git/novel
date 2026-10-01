#!/usr/bin/env node
import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { repoRoot } from './utils/repo-root.mjs'

const outDir = join(repoRoot, 'tmp', 'unified-post-draft-analysis-test')
const outFile = join(outDir, 'chapter-review-ai.mjs')

function check(condition, message, details = {}) {
  return condition ? { ok: true, message } : { ok: false, message, details }
}

async function main() {
  await mkdir(outDir, { recursive: true })
  await build({
    entryPoints: [join(repoRoot, 'src', 'services', 'ai', 'ChapterReviewAI.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'silent'
  })
  const { ChapterReviewAI } = await import(`${pathToFileURL(outFile).href}?t=${Date.now()}`)
  let requestCount = 0
  const raw = {
    chapterReview: {
      summary: '主角离开旧站台。',
      newInformation: '旧钥匙会在门边发热。',
      characterChanges: '主角对同伴的怀疑加深。',
      newForeshadowing: '门后的呼吸声。',
      resolvedForeshadowing: '',
      endingHook: '门后有人叫出主角名字。',
      riskWarnings: '',
      continuityBridgeSuggestion: {
        lastSceneLocation: '铁门前',
        lastPhysicalState: '右臂灼痛',
        lastEmotionalState: '警惕',
        lastUnresolvedAction: '手仍搭在门把上',
        lastDialogueOrThought: '门后的人为何知道我的名字',
        immediateNextBeat: '从推门动作继续',
        mustContinueFrom: '门后的呼吸声',
        mustNotReset: '不得让右臂伤势消失',
        openMicroTensions: '同伴尚未回答问题'
      },
      characterStateChangeSuggestions: [
        {
          characterId: 'character-1',
          category: 'physical',
          key: 'right_arm_injury',
          label: '右臂灼痛',
          changeType: 'update_fact',
          beforeValue: '轻微',
          afterValue: '加剧',
          delta: null,
          evidence: '右臂灼痛明显加剧。',
          confidence: 0.9,
          riskLevel: 'high',
          suggestedTransactionType: 'update',
          linkedCardFields: ['weaknessAndCost']
        }
      ]
    },
    characterSuggestions: [
      {
        characterId: 'character-1',
        changeSummary: '对同伴的怀疑加深',
        newCurrentEmotionalState: '警惕',
        newRelationshipWithProtagonist: '',
        newNextActionTendency: '先验证线索',
        relatedChapterId: null,
        confidence: 0.8
      }
    ],
    foreshadowingExtraction: {
      newForeshadowingCandidates: [],
      advancedForeshadowingIds: ['foreshadowing-1'],
      resolvedForeshadowingIds: [],
      abandonedForeshadowingCandidates: [],
      statusChanges: [
        {
          foreshadowingId: 'foreshadowing-1',
          suggestedStatus: 'partial',
          recommendedTreatmentMode: 'advance',
          evidenceText: '旧钥匙在门边发热。',
          notes: '',
          confidence: 0.8
        }
      ]
    }
  }
  const client = {
    async requestJson(_systemPrompt, userPrompt, normalize, _fallback, _parseFallback, validate) {
      requestCount += 1
      const validation = validate?.(raw)
      if (validation && !validation.ok) {
        throw new Error(JSON.stringify(validation.issues))
      }
      return {
        ok: true,
        usedAI: true,
        data: normalize(raw),
        rawText: JSON.stringify(raw)
      }
    }
  }
  const result = await new ChapterReviewAI(client).generatePostDraftAnalysis(
    '右臂灼痛明显加剧。旧钥匙在铁门边发热。',
    '本章应承接铁门前的动作。',
    [{ id: 'character-1', name: '周烬', role: '主角' }],
    [{ id: 'foreshadowing-1', title: '旧钥匙发热', status: 'unresolved', weight: 'high', treatmentMode: 'advance', description: '接近异常门时发热。' }]
  )

  const pipelineSource = (
    await Promise.all([
      'postDraftAnalysis.ts',
      'memoryExtraction.ts'
    ].map((file) => readFile(
      join(repoRoot, 'src', 'renderer', 'src', 'views', 'generation', 'pipelineSteps', file),
      'utf-8'
    )))
  ).join('\n')
  const checks = [
    check(requestCount === 1, 'unified post-draft analysis uses one model request', { requestCount }),
    check(Boolean(result.data?.chapterReview.summary), 'chapter review is returned from the unified response'),
    check(result.data?.characterSuggestions.length === 1, 'soft character updates are returned from the unified response'),
    check(result.data?.foreshadowingExtraction.statusChanges.length === 1, 'foreshadowing updates are returned from the unified response'),
    check(
      pipelineSource.includes('postDraftAnalysisFromWorking') &&
        pipelineSource.includes('sharedAnalysis.characterSuggestions') &&
        pipelineSource.includes('sharedAnalysis.foreshadowingExtraction'),
      'later pipeline steps reuse the completed unified analysis'
    ),
    check(
      pipelineSource.includes('aiService.updateCharacterStates') && pipelineSource.includes('aiService.extractForeshadowing'),
      'legacy split-call fallback remains available for old jobs and partial retries'
    ),
    check(
      pipelineSource.includes('fallbackAnalysis(review, fallbackWarning)') &&
        pipelineSource.includes('角色与伏笔候选保持为空，避免重复发送整章'),
      'a malformed unified response falls back once without replaying all legacy extraction calls'
    )
  ]
  const report = { ok: checks.every((item) => item.ok), totalChecks: checks.length, failed: checks.filter((item) => !item.ok) }
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
