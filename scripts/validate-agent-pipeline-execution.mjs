#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { repoRoot } from './utils/repo-root.mjs'

const root = repoRoot
const outDir = join(root, 'tmp', 'agent-pipeline-execution')

function assert(condition, message, details = {}) {
  if (!condition) throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`)
}

function occurrenceCount(text, value) {
  if (!value) return 0
  return text.split(value).length - 1
}

function chapterTaskFixture(marker) {
  return {
    goal: `${marker}：从敲门后的早餐准备写起，让日常动作自然承接危机。`,
    conflict: `${marker}_CONFLICT：周宁一边煮粥一边判断门外的人是否仍在。`,
    suspenseToKeep: `${marker}_SUSPENSE：保留第三封信寄件人的身份。`,
    allowedPayoffs: `${marker}_ALLOWED：只允许确认敲门声来自同一层走廊。`,
    forbiddenPayoffs: `${marker}_FORBIDDEN、FUTURE_CANON_PLOT_MUST_BE_ISOLATED、FUTURE_CHARACTER_SECRET_MUST_BE_ISOLATED、FUTURE_STATE_SECRET_MUST_BE_ISOLATED、FUTURE_BIBLE_TROPE_MUST_BE_ISOLATED、FUTURE_BIBLE_TRUTH_MUST_BE_ISOLATED：不得揭示匿名信幕后主使。`,
    endingHook: `${marker}_HOOK：粥煮好时门缝下出现一张超市小票。`,
    readerEmotion: `${marker}_EMOTION：先松弛、后微妙不安。`,
    targetWordCount: '2400-3000',
    styleRequirement: `${marker}_STYLE：生活化、轻快，不预先渲染压抑。`
  }
}

async function loadHarness() {
  const entry = join(outDir, 'entry.ts')
  const outfile = join(outDir, 'bundle.mjs')
  await writeFile(
    entry,
    [
      "export { executeAgentChapterPipeline } from '../../src/agent/AgentPipelineExecutor'",
      "export { AgentRunService, AGENT_PIPELINE_STEP_ORDER } from '../../src/agent/AgentRunService'",
      "export { AgentExecutionControlService } from '../../src/agent/AgentExecutionControlService'",
      "export { loadAgentRuntimeData } from '../../src/agent/AgentRuntime'",
      "export { normalizeAppData } from '../../src/shared/normalizers/appData'",
      "export { assertChapterTaskPresentInPrompt } from '../../src/renderer/src/views/generation/pipelineUtils'",
      "export { GenerationPipelineAI } from '../../src/services/ai/GenerationPipelineAI'",
      "export { QualityGateAI } from '../../src/services/ai/QualityGateAI'",
      "export { guardOpeningChapterPlanForDraft } from '../../src/services/OpeningChapterPlanGuardService'",
      "export { draftContentHash, noveltyAuditMatchesDraft } from '../../src/services/DraftDiagnosticBindingService'"
    ].join('\n'),
    'utf8'
  )
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['better-sqlite3', 'electron'],
    logLevel: 'silent'
  })
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`)
}

function fixture(h) {
  const timestamp = '2026-08-13T00:00:00.000Z'
  const data = h.normalizeAppData({
    schemaVersion: 3,
    projects: [
      {
        id: 'project-agent-pipeline',
        name: 'Agent Pipeline Fixture',
        genre: '悬疑',
        description: '隔离测试项目。',
        targetReaders: '',
        coreAppeal: '',
        style: '克制、连续场景推进。',
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    storyBibles: [
      {
        projectId: 'project-agent-pipeline',
        worldbuilding: '隔离测试世界观。',
        corePremise: '隔离测试核心前提。',
        protagonistDesire: '保持日常生活。',
        protagonistFear: '无法区分记忆与现实。',
        mainConflict: '旧事与当下生活的冲突。',
        powerSystem: '',
        bannedTropes: 'FUTURE_BIBLE_TROPE_MUST_BE_ISOLATED：旧剧情套路不得反向进入当前任务。',
        styleSample: 'PLOT_BEARING_STYLE_SAMPLE_MUST_BE_ISOLATED：旧情节真相和道具不得进入新任务。',
        narrativeTone: '生活化、先轻松后微妙不安。',
        immutableFacts: 'FUTURE_BIBLE_TRUTH_MUST_BE_ISOLATED：未来终局真相不得提前进入当前任务。',
        updatedAt: timestamp
      }
    ],
    characters: [
      {
        id: 'character-agent-pipeline-main',
        projectId: 'project-agent-pipeline',
        name: '周宁',
        role: '主角；FUTURE_CHARACTER_SECRET_MUST_BE_ISOLATED：未来真相的执行者。',
        surfaceGoal: '准备早饭。',
        deepDesire: '保持日常。',
        coreFear: '失去对生活的掌控。',
        selfDeception: '',
        knownInformation: '知道粥在锅里。',
        unknownInformation: '',
        protagonistRelationship: '本人。',
        emotionalState: '轻松。',
        nextActionTendency: '继续做早饭。',
        forbiddenWriting: '',
        isMain: true,
        lastChangedChapter: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    characterStateFacts: [
      {
        id: 'state-agent-pipeline-future-secret',
        projectId: 'project-agent-pipeline',
        characterId: 'character-agent-pipeline-main',
        category: 'secret',
        label: 'FUTURE_STATE_SECRET_MUST_BE_ISOLATED',
        value: '未来章节才能知道的角色状态。',
        unit: '',
        trackingLevel: 'hard',
        promptPolicy: 'always',
        status: 'active',
        sourceType: 'manual',
        sourceId: null,
        sourceChapterOrder: null,
        linkedCardFields: ['futureHooks'],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    hardCanonPacks: [
      {
        id: 'hard-canon-agent-pipeline',
        projectId: 'project-agent-pipeline',
        title: '隔离测试硬设定',
        description: '验证本章禁止项可以隔离未来真相，但保留安全风格边界。',
        maxPromptTokens: 900,
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        items: [
          {
            id: 'hard-canon-future-plot',
            projectId: 'project-agent-pipeline',
            category: 'timeline_anchor',
            title: 'FUTURE_CANON_PLOT_MUST_BE_ISOLATED',
            content: '这是未来章节才能披露的真相。',
            priority: 'must',
            status: 'active',
            sourceType: 'manual',
            relatedCharacterIds: [],
            relatedForeshadowingIds: [],
            relatedTimelineEventIds: [],
            createdAt: timestamp,
            updatedAt: timestamp
          },
          {
            id: 'hard-canon-safe-style',
            projectId: 'project-agent-pipeline',
            category: 'style_boundary',
            title: 'SAFE_STYLE_BOUNDARY',
            content: '先日常、后微妙不安，不使用猎奇暴力。',
            priority: 'high',
            status: 'active',
            sourceType: 'manual',
            relatedCharacterIds: [],
            relatedForeshadowingIds: [],
            relatedTimelineEventIds: [],
            createdAt: timestamp,
            updatedAt: timestamp
          }
        ]
      }
    ],
    chapters: [
      {
        id: 'chapter-1',
        projectId: 'project-agent-pipeline',
        order: 1,
        title: '雨夜来信',
        body: '周宁把没有署名的信压在桌角。走廊尽头传来第二次敲门声，她没有开门。',
        summary: '周宁收到匿名信，并被不明来客堵在房内。',
        newInformation: '',
        characterChanges: '',
        newForeshadowing: '',
        resolvedForeshadowing: '',
        endingHook: '第二次敲门声响起。',
        riskWarnings: '',
        includedInStageSummary: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ],
    storyDirectionGuides: [
      {
        id: 'stale-story-direction',
        projectId: 'project-agent-pipeline',
        title: '旧剧情导向',
        status: 'active',
        source: 'user_polished',
        horizonChapters: 5,
        startChapterOrder: 1,
        endChapterOrder: 5,
        strategicTheme: 'STALE_DIRECTION_MUST_NOT_OVERRIDE_EXPLICIT_TASK',
        chapterBeats: [
          {
            id: 'stale-story-direction-beat-2',
            chapterOffset: 1,
            chapterOrder: 2,
            goal: 'STALE_DIRECTION_MUST_NOT_OVERRIDE_EXPLICIT_TASK',
            conflict: '立刻进入高压追逐。'
          }
        ],
        createdAt: timestamp,
        updatedAt: timestamp
      }
    ]
  })
  return {
    ...data,
    settings: {
      ...data.settings,
      apiProvider: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      modelName: 'run-snapshot-model',
      hasApiKey: false,
      requestTimeoutMs: 300_000,
      defaultTokenBudget: 12_000
    }
  }
}

function fakeWorkflowAI() {
  const body = Array.from(
    { length: 65 },
    (_, index) => `第${index + 1}次雨点敲在窗沿，周宁沿着上一章的敲门声继续判断来客位置，并把匿名信藏进衣袋。`
  ).join('') + '门外的人终于停下动作。'
  const captures = { planContexts: [], planOptions: [], draftPlans: [], draftContexts: [], draftOptions: [] }
  return {
    body,
    captures,
    service: {
      async generateChapterPlan(context, options) {
        captures.planContexts.push(context)
        captures.planOptions.push(options)
        return {
          ok: true,
          usedAI: true,
          data: {
            chapterTitle: '门外的人',
            chapterGoal: '承接敲门声，确认来客目的。',
            conflictToPush: '周宁必须在不开门的前提下判断走廊情况。',
            characterBeats: '周宁克制恐惧并采取验证行动。',
            foreshadowingToUse: '',
            foreshadowingNotToReveal: '',
            endingHook: '来客停止敲门，却从门缝塞入第三封信。',
            readerEmotionTarget: options.readerEmotionTarget,
            estimatedWordCount: options.estimatedWordCount,
            openingContinuationBeat: '从第二次敲门声后立即继续。',
            carriedPhysicalState: '周宁仍在房内，尚未开门。',
            carriedEmotionalState: '警惕且克制。',
            unresolvedMicroTensions: '来客身份未知。',
            forbiddenResets: '不得跳过敲门后的即时反应。',
            allowedNovelty: {
              allowedNewCharacters: [],
              allowedNewRules: [],
              allowedNewSystemMechanics: [],
              allowedNewOrganizationsOrRanks: [],
              allowedLoreReveals: [],
              notes: ''
            },
            forbiddenNovelty: {
              forbiddenNewCharacters: [],
              forbiddenNewRules: ['临时救命规则'],
              forbiddenSystemMechanics: [],
              forbiddenOrganizationsOrRanks: [],
              forbiddenLoreReveals: [],
              notes: ''
            }
          }
        }
      },
      async generateChapterDraft(plan, context, options) {
        captures.draftPlans.push(plan)
        captures.draftContexts.push(context)
        captures.draftOptions.push(options)
        return { ok: true, usedAI: true, data: { title: '门外的人', body } }
      },
      async generateChapterReview() {
        return {
          ok: true,
          usedAI: true,
          data: {
            summary: '周宁延续雨夜危机，开始验证门外来客。',
            newInformation: '',
            characterChanges: '',
            newForeshadowing: '',
            resolvedForeshadowing: '',
            endingHook: '第三封信出现。',
            riskWarnings: '',
            continuityBridgeSuggestion: {
              lastSceneLocation: '周宁的房间',
              lastPhysicalState: '未受伤',
              lastEmotionalState: '警惕',
              lastUnresolvedAction: '检查第三封信',
              lastDialogueOrThought: '',
              immediateNextBeat: '确认信件来源',
              mustContinueFrom: '门缝中的第三封信',
              mustNotReset: '不得让门外危机无解释消失',
              openMicroTensions: '来客身份未知'
            },
            characterStateChangeSuggestions: []
          }
        }
      },
      async updateCharacterStates() {
        return { ok: true, usedAI: true, data: [] }
      },
      async extractForeshadowing() {
        return {
          ok: true,
          usedAI: true,
          data: {
            newForeshadowingCandidates: [],
            advancedForeshadowingIds: [],
            resolvedForeshadowingIds: [],
            abandonedForeshadowingCandidates: [],
            statusChanges: []
          }
        }
      },
      async generateConsistencyReview() {
        return {
          ok: true,
          usedAI: true,
          data: {
            timelineProblems: [],
            settingConflicts: [],
            characterOOC: [],
            foreshadowingMisuse: [],
            pacingProblems: [],
            emotionPayoffProblems: [],
            suggestions: [],
            severitySummary: 'low',
            issues: []
          }
        }
      }
    }
  }
}

function rogueOpeningPlanWorkflowAI() {
  const stable = fakeWorkflowAI()
  const roguePlan = {
    chapterTitle: '顾临渊的地下通知',
    chapterGoal: '让顾临渊带周宁进入地下观测站。',
    conflictToPush: '回声权限失控，楼道追杀立即开始。',
    characterBeats: '周宁提前打开通知，并跟随顾临渊执行撤离行动。',
    foreshadowingToUse: '回收地下观测站和回声权限。',
    foreshadowingNotToReveal: '',
    endingHook: '地下观测站发来血色倒计时。',
    readerEmotionTarget: '立即压抑和恐惧。',
    estimatedWordCount: '9000',
    openingContinuationBeat: '从周宁提前打开通知并听到警报开始。',
    carriedPhysicalState: '周宁已被回声权限标记。',
    carriedEmotionalState: '周宁已经知道顾临渊的真实身份。',
    unresolvedMicroTensions: '顾临渊是否会启动地下观测站。',
    forbiddenResets: '不得取消楼道追杀。',
    allowedNovelty: {
      allowedNewCharacters: ['顾临渊'],
      allowedNewRules: ['回声权限'],
      allowedNewSystemMechanics: ['血色倒计时'],
      allowedNewOrganizationsOrRanks: ['地下观测站'],
      allowedLoreReveals: ['顾临渊是未来章节的执行者'],
      notes: '允许一切额外危险行动。'
    },
    forbiddenNovelty: {
      forbiddenNewCharacters: [],
      forbiddenNewRules: [],
      forbiddenSystemMechanics: [],
      forbiddenOrganizationsOrRanks: [],
      forbiddenLoreReveals: [],
      notes: ''
    }
  }
  return {
    ...stable,
    roguePlan,
    service: {
      ...stable.service,
      async generateChapterPlan(context, options) {
        stable.captures.planContexts.push(context)
        stable.captures.planOptions.push(options)
        return { ok: true, usedAI: true, data: roguePlan }
      }
    }
  }
}

function flakyWorkflowAI() {
  const stable = fakeWorkflowAI()
  const captures = { planCalls: 0, draftCalls: 0, planContexts: [], planOptions: [], draftContexts: [], draftOptions: [] }
  let shouldFailDraft = true
  return {
    body: stable.body,
    captures,
    service: {
      ...stable.service,
      async generateChapterPlan(...args) {
        captures.planCalls += 1
        captures.planContexts.push(args[0])
        captures.planOptions.push(args[1])
        return stable.service.generateChapterPlan(...args)
      },
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        captures.draftContexts.push(args[1])
        captures.draftOptions.push(args[2])
        if (shouldFailDraft) {
          shouldFailDraft = false
          return { ok: false, usedAI: true, data: null, error: '模拟正文生成中断' }
        }
        return stable.service.generateChapterDraft(...args)
      }
    }
  }
}

function chapterTaskContractRetryWorkflowAI() {
  const stable = fakeWorkflowAI()
  const shortBody = Array.from(
    { length: 50 },
    (_, index) => `第${index + 1}次雨点敲在窗沿，周宁沿着上一章的敲门声继续判断来客位置，并把匿名信藏进衣袋。`
  ).join('') + '门外的人终于停下动作。'
  const captures = { draftCalls: 0, retryReasons: [], previousDrafts: [] }
  return {
    captures,
    service: {
      ...stable.service,
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        captures.retryReasons.push(args[2]?.retryReason ?? null)
        captures.previousDrafts.push(args[2]?.previousDraft ?? null)
        if (captures.draftCalls === 1) return { ok: true, usedAI: true, data: { title: '门外的人', body: shortBody } }
        return stable.service.generateChapterDraft(...args)
      }
    }
  }
}

function regressingLengthRetryWorkflowAI() {
  const stable = fakeWorkflowAI()
  const earlierBody = `我${'做饭'.repeat(1149)}呀。`
  const laterBody = `我${'做饭'.repeat(899)}呀。`
  const captures = { draftCalls: 0, retryReasons: [], previousDrafts: [] }
  return {
    earlierBody,
    laterBody,
    captures,
    service: {
      ...stable.service,
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        captures.retryReasons.push(args[2]?.retryReason ?? null)
        captures.previousDrafts.push(args[2]?.previousDraft ?? null)
        return {
          ok: true,
          usedAI: true,
          data: captures.draftCalls === 1
            ? { title: '较完整的首稿', body: earlierBody }
            : { title: '更短的重试稿', body: laterBody }
        }
      }
    }
  }
}

function phrasePositionRetryWorkflowAI() {
  const stable = fakeWorkflowAI()
  const phrase = '九号水文站遗留资料核对'
  const earlierBody = `${phrase}。${stable.body}`
  const laterBody = `${stable.body}${phrase}。`
  const captures = { draftCalls: 0, retryReasons: [], previousDrafts: [], retryIssueTypes: [] }
  return {
    phrase,
    earlierBody,
    laterBody,
    captures,
    service: {
      ...stable.service,
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        captures.retryReasons.push(args[2]?.retryReason ?? null)
        captures.previousDrafts.push(args[2]?.previousDraft ?? null)
        captures.retryIssueTypes.push(args[2]?.retryIssueTypes ?? null)
        return {
          ok: true,
          usedAI: true,
          data: captures.draftCalls === 1
            ? { title: '位置过早的首稿', body: earlierBody }
            : { title: '定点修订稿', body: laterBody }
        }
      }
    }
  }
}

function structurallyInvalidRetryWorkflowAI() {
  const stable = fakeWorkflowAI()
  const earlierBody = `我${'继续写正文'.repeat(220)}`
  const captures = { draftCalls: 0, previousDrafts: [] }
  return {
    captures,
    service: {
      ...stable.service,
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        captures.previousDrafts.push(args[2]?.previousDraft ?? null)
        return captures.draftCalls === 1
          ? { ok: true, usedAI: true, data: { title: '截断首稿', body: earlierBody } }
          : stable.service.generateChapterDraft(...args)
      }
    }
  }
}

function nonAuthoritativePlanThenRecoverWorkflowAI() {
  const stable = fakeWorkflowAI()
  const captures = { planCalls: 0, draftCalls: 0 }
  let shouldReturnFallback = true
  return {
    captures,
    service: {
      ...stable.service,
      async generateChapterPlan(...args) {
        captures.planCalls += 1
        const result = await stable.service.generateChapterPlan(...args)
        if (shouldReturnFallback) {
          shouldReturnFallback = false
          return {
            ...result,
            ok: true,
            usedAI: false,
            parseError: '模拟计划 JSON 解析失败',
            error: '远程 AI 任务书生成失败，已降级为本地任务书模板。'
          }
        }
        return result
      },
      async generateChapterDraft(...args) {
        captures.draftCalls += 1
        return stable.service.generateChapterDraft(...args)
      }
    }
  }
}

function cancellableWorkflowAI() {
  const stable = fakeWorkflowAI()
  let resolveStarted
  let resolveCancellation
  const started = new Promise((resolve) => {
    resolveStarted = resolve
  })
  return {
    body: stable.body,
    started,
    cancel() {
      resolveCancellation?.()
      return true
    },
    service: {
      ...stable.service,
      async generateChapterPlan() {
        resolveStarted()
        await new Promise((resolve) => {
          resolveCancellation = resolve
        })
        return { ok: false, usedAI: true, data: null, error: 'AI 请求已取消。' }
      }
    }
  }
}

function fakeDiagnostics(h, captures) {
  const passAudit = () => ({
    newNamedCharacters: [],
    newWorldRules: [],
    newSystemMechanics: [],
    newOrganizationsOrRanks: [],
    majorLoreReveals: [],
    suspiciousDeusExRules: [],
    untracedNames: [],
    severity: 'pass',
    summary: '未发现未授权新增内容。'
  })
  return {
    async auditNovelty(request) {
      captures.noveltyBodies.push(request.generatedText)
      return passAudit()
    },
    async analyzeRedundancy(request) {
      return {
        id: `redundancy-${captures.noveltyBodies.length}`,
        projectId: request.projectId,
        chapterId: request.chapterId,
        draftId: request.draftId,
        draftContentHash: h.draftContentHash(request.body),
        repeatedPhrases: [],
        repeatedSceneDescriptions: [],
        repeatedExplanations: [],
        overusedIntensifiers: [],
        redundantParagraphs: [],
        compressionSuggestions: [],
        overallRedundancyScore: 0,
        createdAt: new Date().toISOString()
      }
    },
    async evaluateQualityGate(request) {
      captures.qualityModels.push(request.settings.modelName)
      captures.qualityRequests?.push(request)
      const score = 92
      return {
        id: 'quality-current',
        projectId: request.projectId,
        jobId: request.jobId,
        chapterId: request.chapterId,
        draftId: request.draftId,
        draftContentHash: h.draftContentHash(request.chapterDraft.body),
        promptContextSnapshotId: request.promptContextSnapshotId,
        overallScore: score,
        pass: true,
        dimensions: {
          plotCoherence: score,
          characterConsistency: score,
          characterStateConsistency: score,
          foreshadowingControl: score,
          chapterContinuity: score,
          redundancyControl: score,
          styleMatch: score,
          pacing: score,
          emotionalPayoff: score,
          originality: score,
          promptCompliance: score,
          contextRelevanceCompliance: score
        },
        issues: [],
        requiredFixes: [],
        optionalSuggestions: [],
        createdAt: new Date().toISOString()
      }
    }
  }
}

async function main() {
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const h = await loadHarness()
  const primaryTask = chapterTaskFixture('PRIMARY_TASK_CONTRACT')
  const runAuditGoal = 'RUN_AUDIT_GOAL_MUST_NOT_BECOME_PROSE_INSTRUCTION'
  const aiPromptCaptures = []
  const pipelineAI = new h.GenerationPipelineAI({
    async requestJson(systemPrompt, userPrompt, _normalizer, fallback) {
      aiPromptCaptures.push({ systemPrompt, userPrompt })
      return { ok: true, usedAI: false, data: fallback, rawText: '' }
    }
  })
  const localPlan = await pipelineAI.generateChapterPlan('LOCAL_CONTEXT_SENTINEL', {
    mode: 'standard',
    targetChapterOrder: 2,
    estimatedWordCount: '9999',
    readerEmotionTarget: 'GENERIC_EMOTION_MUST_NOT_WIN',
    chapterTask: primaryTask
  })
  assert(localPlan.data.chapterGoal === primaryTask.goal, 'The local plan fallback must preserve the explicit task goal.', localPlan.data)
  assert(localPlan.data.conflictToPush === primaryTask.conflict, 'The local plan fallback must preserve the explicit task conflict.', localPlan.data)
  assert(localPlan.data.endingHook === primaryTask.endingHook, 'The local plan fallback must preserve the explicit task ending hook.', localPlan.data)
  assert(localPlan.data.readerEmotionTarget === primaryTask.readerEmotion, 'The local plan fallback must prefer the task emotion.', localPlan.data)
  assert(localPlan.data.estimatedWordCount === primaryTask.targetWordCount, 'The local plan fallback must prefer the task word-count contract.', localPlan.data)
  await pipelineAI.generateChapterDraft(localPlan.data, 'LOCAL_CONTEXT_SENTINEL', {
    mode: 'standard',
    targetChapterOrder: 2,
    estimatedWordCount: '9999',
    readerEmotionTarget: 'GENERIC_EMOTION_MUST_NOT_WIN',
    chapterTask: primaryTask
  })
  assert(aiPromptCaptures.length === 2, 'Plan and draft prompt builders must each make one request.', aiPromptCaptures)
  assert(aiPromptCaptures[0].userPrompt.includes('first scene must continue the previous chapter ending'), 'A later chapter plan must retain the continuity hard rule.')
  assert(aiPromptCaptures[1].userPrompt.includes('first scene must continue the previous chapter ending'), 'A later chapter draft must retain the continuity hard rule.')
  for (const capture of aiPromptCaptures) {
    for (const value of Object.values(primaryTask).filter(Boolean)) {
      assert(capture.userPrompt.includes(value), 'The final model prompt must include every non-empty task field.', { value, prompt: capture.userPrompt })
    }
  }
  const openingPromptCaptures = []
  const openingPipelineAI = new h.GenerationPipelineAI({
    async requestJson(systemPrompt, userPrompt, _normalizer, fallback) {
      openingPromptCaptures.push({ systemPrompt, userPrompt })
      return { ok: true, usedAI: false, data: fallback, rawText: '' }
    }
  })
  const openingPlan = await openingPipelineAI.generateChapterPlan('OPENING_CONTEXT_SENTINEL', {
    mode: 'conservative',
    targetChapterOrder: 1,
    estimatedWordCount: primaryTask.targetWordCount,
    readerEmotionTarget: primaryTask.readerEmotion,
    chapterTask: primaryTask
  })
  assert(!openingPlan.data.openingContinuationBeat.includes('承接上一章'), 'Chapter 1 local plan must not invent a previous chapter.', openingPlan.data)
  await openingPipelineAI.generateChapterDraft(openingPlan.data, 'OPENING_CONTEXT_SENTINEL', {
    mode: 'conservative',
    targetChapterOrder: 1,
    estimatedWordCount: primaryTask.targetWordCount,
    readerEmotionTarget: primaryTask.readerEmotion,
    chapterTask: primaryTask
  })
  assert(openingPromptCaptures.length === 2, 'Opening chapter must build both plan and draft prompts.', openingPromptCaptures)
  for (const capture of openingPromptCaptures) {
    assert(!capture.userPrompt.includes('first scene must continue the previous chapter ending'), 'Chapter 1 model prompts must not contain an unconditional previous-chapter rule.', capture)
    assert(!capture.systemPrompt.includes('开头必须承接上一章结尾'), 'Chapter 1 system prompts must not contain the old unconditional continuation rule.', capture)
    assert(capture.userPrompt.includes('this is chapter 1'), 'Chapter 1 model prompts must explicitly establish opening semantics.', capture)
    assert(!capture.userPrompt.includes('aggressive = may propose new conflict/foreshadowing'), 'Chapter 1 prompts must not advertise a mode that can invent extra conflict or foreshadowing.', capture)
  }
  assert(
    !openingPromptCaptures[1].userPrompt.includes('and an ending hook') &&
      openingPromptCaptures[1].userPrompt.includes('task-specified closing beat') &&
      !openingPromptCaptures[1].userPrompt.includes('Preserve current dramatic state'),
    'Chapter 1 draft prompt must not reintroduce a generic suspense hook or imply a carried dramatic state.',
    openingPromptCaptures[1]
  )

  const qualityPromptCaptures = []
  const qualityGateAI = new h.QualityGateAI({
    async requestJson(systemPrompt, userPrompt, _normalizer, fallback) {
      qualityPromptCaptures.push({ systemPrompt, userPrompt })
      return { ok: true, usedAI: false, data: fallback, rawText: '' }
    }
  })
  const qualityDraft = { title: '第一章', body: '周宁把粥盛进碗里，窗外刚好停了雨。' }
  await qualityGateAI.generateQualityGateReport(qualityDraft, 'QUALITY_CONTEXT', openingPlan.data, {
    targetChapterOrder: 1,
    hasAuthoritativeChapterTask: true
  })
  await qualityGateAI.generateQualityGateReport(qualityDraft, 'QUALITY_CONTEXT', localPlan.data, {
    targetChapterOrder: 2,
    hasAuthoritativeChapterTask: true
  })
  await qualityGateAI.generateQualityGateReport(qualityDraft, 'QUALITY_CONTEXT', openingPlan.data, {
    targetChapterOrder: 1,
    hasAuthoritativeChapterTask: false
  })
  const legacyContinuityRule = 'first scene must directly continue the previous ending'
  assert(qualityPromptCaptures.length === 3, 'QualityGateAI must build one prompt for each review scope.', qualityPromptCaptures)
  assert(
    !qualityPromptCaptures[0].userPrompt.includes(legacyContinuityRule) &&
      qualityPromptCaptures[0].userPrompt.includes('there is no previous chapter ending or previous hook') &&
      qualityPromptCaptures[0].userPrompt.includes('Do not penalize the draft') &&
      qualityPromptCaptures[0].userPrompt.includes('flag invented prior-chapter events'),
    'An authoritative chapter-1 quality prompt must use opening semantics instead of requiring previous-chapter continuation.',
    qualityPromptCaptures[0]
  )
  assert(
    qualityPromptCaptures[1].userPrompt.includes(legacyContinuityRule),
    'Chapter 2 and later must retain the existing previous-ending continuity review rule.',
    qualityPromptCaptures[1]
  )
  assert(
    qualityPromptCaptures[2].userPrompt.includes(legacyContinuityRule),
    'A chapter-1 review without an authoritative task snapshot must retain existing behavior.',
    qualityPromptCaptures[2]
  )

  const openingGuardTask = chapterTaskFixture('OPENING_PLAN_GUARD_CONTRACT')
  const rogueOpeningAI = rogueOpeningPlanWorkflowAI()
  const rogueMarkers = [
    '顾临渊',
    '地下观测站',
    '回声权限',
    '提前打开通知',
    '楼道追杀',
    '血色倒计时',
    '额外危险行动'
  ]
  const compactDraftPromptCaptures = []
  const compactDraftPipelineAI = new h.GenerationPipelineAI({
    async requestJson(systemPrompt, userPrompt, _normalizer, fallback) {
      compactDraftPromptCaptures.push({ systemPrompt, userPrompt })
      return { ok: true, usedAI: false, data: fallback, rawText: '' }
    }
  })
  await compactDraftPipelineAI.generateChapterDraft(
    rogueOpeningAI.roguePlan,
    'COMPACT_OPENING_CONTEXT_MUST_NOT_ENTER',
    {
      mode: 'standard',
      targetChapterOrder: 1,
      estimatedWordCount: openingGuardTask.targetWordCount,
      readerEmotionTarget: openingGuardTask.readerEmotion,
      chapterTask: openingGuardTask,
      authoritativeChapterTask: true
    }
  )
  await compactDraftPipelineAI.generateChapterDraft(
    rogueOpeningAI.roguePlan,
    'LATER_CHAPTER_CONTEXT_MUST_REMAIN',
    {
      mode: 'standard',
      targetChapterOrder: 2,
      estimatedWordCount: openingGuardTask.targetWordCount,
      readerEmotionTarget: openingGuardTask.readerEmotion,
      chapterTask: openingGuardTask,
      authoritativeChapterTask: true
    }
  )
  assert(compactDraftPromptCaptures.length === 2, 'Compact opening and later-chapter controls must each issue one draft request.', compactDraftPromptCaptures)
  const compactOpeningDraftPrompt = compactDraftPromptCaptures[0].userPrompt
  assert(
    !compactOpeningDraftPrompt.includes('COMPACT_OPENING_CONTEXT_MUST_NOT_ENTER') &&
      !compactOpeningDraftPrompt.includes('Chapter plan:') &&
      !compactOpeningDraftPrompt.includes(JSON.stringify(rogueOpeningAI.roguePlan, null, 2)),
    'An authoritative opening draft prompt must omit both the context and the full chapter plan.',
    compactDraftPromptCaptures[0]
  )
  for (const marker of rogueMarkers) {
    assert(!compactOpeningDraftPrompt.includes(marker), 'No AI-plan-only marker may enter the compact authoritative opening draft prompt.', {
      marker,
      prompt: compactOpeningDraftPrompt
    })
  }
  for (const [field, value] of Object.entries(openingGuardTask).filter(([, value]) => value)) {
    assert(
      occurrenceCount(compactOpeningDraftPrompt, value) === 1,
      'Each non-empty ChapterTask field value must be serialized exactly once in the compact opening prompt.',
      { field, value, occurrences: occurrenceCount(compactOpeningDraftPrompt, value), prompt: compactOpeningDraftPrompt }
    )
  }
  assert(
    compactDraftPromptCaptures[1].userPrompt.includes('LATER_CHAPTER_CONTEXT_MUST_REMAIN') &&
      compactDraftPromptCaptures[1].userPrompt.includes('Chapter plan:') &&
      compactDraftPromptCaptures[1].userPrompt.includes('顾临渊'),
    'Chapter 2 must retain the full plan/context draft prompt even when the job has an authoritative task.',
    compactDraftPromptCaptures[1]
  )
  assert(
    openingPromptCaptures[1].userPrompt.includes('OPENING_CONTEXT_SENTINEL') &&
      openingPromptCaptures[1].userPrompt.includes('Chapter plan:'),
    'Chapter 1 without authoritativeChapterTask must retain the existing full plan/context prompt.',
    openingPromptCaptures[1]
  )
  const guardedOpeningPlan = h.guardOpeningChapterPlanForDraft({
    generatedPlan: rogueOpeningAI.roguePlan,
    targetChapterOrder: 1,
    chapterTaskSnapshot: openingGuardTask
  })
  assert(guardedOpeningPlan !== rogueOpeningAI.roguePlan, 'Authoritative chapter 1 must receive a newly derived plan object.')
  assert(guardedOpeningPlan.chapterTitle === '第一章', 'The guarded opening title must be structural and task-safe.', guardedOpeningPlan)
  assert(guardedOpeningPlan.chapterGoal === openingGuardTask.goal, 'The guarded goal must come only from ChapterTask.', guardedOpeningPlan)
  assert(guardedOpeningPlan.conflictToPush === openingGuardTask.conflict, 'The guarded conflict must come only from ChapterTask.', guardedOpeningPlan)
  assert(guardedOpeningPlan.endingHook === openingGuardTask.endingHook, 'The guarded closing beat must come only from ChapterTask.', guardedOpeningPlan)
  assert(guardedOpeningPlan.readerEmotionTarget === openingGuardTask.readerEmotion, 'The guarded emotion must come only from ChapterTask.', guardedOpeningPlan)
  assert(guardedOpeningPlan.estimatedWordCount === openingGuardTask.targetWordCount, 'The guarded word-count contract must come only from ChapterTask.', guardedOpeningPlan)
  for (const marker of rogueMarkers) {
    assert(!JSON.stringify(guardedOpeningPlan).includes(marker), 'No rogue AI-plan marker may survive the pure opening-plan guard.', {
      marker,
      guardedOpeningPlan
    })
  }
  assert(
    h.guardOpeningChapterPlanForDraft({
      generatedPlan: rogueOpeningAI.roguePlan,
      targetChapterOrder: 2,
      chapterTaskSnapshot: openingGuardTask
    }) === rogueOpeningAI.roguePlan,
    'Later chapters must retain the generated plan unchanged.'
  )
  assert(
    h.guardOpeningChapterPlanForDraft({
      generatedPlan: rogueOpeningAI.roguePlan,
      targetChapterOrder: 1,
      chapterTaskSnapshot: null
    }) === rogueOpeningAI.roguePlan,
    'Chapter 1 without an authoritative task snapshot must retain existing behavior.'
  )

  const openingGuardPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 1,
    goal: '验证真实 AI 计划请求后的正文硬门禁。',
    chapterTaskSnapshot: openingGuardTask
  })
  const openingGuardStoragePath = join(outDir, 'opening-plan-guard-data.json')
  await writeFile(openingGuardStoragePath, JSON.stringify(openingGuardPrepared.appData, null, 2), 'utf8')
  const openingGuardRuntime = await h.loadAgentRuntimeData({ storagePath: openingGuardStoragePath, userDataPath: outDir })
  const openingGuardDiagnosticCaptures = { noveltyBodies: [], qualityModels: [], qualityRequests: [] }
  const openingGuardResult = await h.executeAgentChapterPipeline(
    {
      appData: openingGuardRuntime.data,
      runtime: openingGuardRuntime,
      agentRunId: openingGuardPrepared.agentRun.id,
      jobId: openingGuardPrepared.job.id,
      estimatedWordCount: openingGuardTask.targetWordCount,
      readerEmotionTarget: openingGuardTask.readerEmotion
    },
    {
      workflowAI: rogueOpeningAI.service,
      diagnostics: fakeDiagnostics(h, openingGuardDiagnosticCaptures)
    }
  )
  assert(openingGuardResult.failedStep === null, 'A task-derived safe opening plan must complete the full pipeline.', openingGuardResult.failedStep)
  assert(
    openingGuardDiagnosticCaptures.qualityRequests.length === 1 &&
      openingGuardDiagnosticCaptures.qualityRequests[0].targetChapterOrder === 1 &&
      openingGuardDiagnosticCaptures.qualityRequests[0].hasAuthoritativeChapterTask === true,
    'The pipeline quality request must carry the authoritative opening review scope.',
    openingGuardDiagnosticCaptures.qualityRequests
  )
  assert(rogueOpeningAI.captures.planOptions.length === 0, 'An authoritative chapter-1 job must use the canonical local plan without an AI plan request.', rogueOpeningAI.captures)
  assert(rogueOpeningAI.captures.draftPlans.length === 1, 'A successful guarded pipeline must make one draft request.', rogueOpeningAI.captures)
  const planPassedToDraft = rogueOpeningAI.captures.draftPlans[0]
  assert(JSON.stringify(planPassedToDraft) === JSON.stringify(guardedOpeningPlan), 'The draft request must receive only the task-derived safe plan.', {
    expected: guardedOpeningPlan,
    actual: planPassedToDraft
  })
  const guardedPlanStep = openingGuardResult.appData.chapterGenerationSteps.find(
    (step) => step.jobId === openingGuardResult.job.id && step.type === 'generate_chapter_plan'
  )
  for (const marker of rogueMarkers) {
    assert(!JSON.stringify(planPassedToDraft).includes(marker), 'The draft plan must not contain rogue names, places, mechanisms, actions, or hooks.', { marker, planPassedToDraft })
    assert(!rogueOpeningAI.captures.draftContexts[0].includes(marker), 'The rebuilt draft context must not be contaminated by the rogue plan.', {
      marker,
      context: rogueOpeningAI.captures.draftContexts[0]
    })
    assert(!guardedPlanStep?.output.includes(marker), 'The persisted plan step must contain only the guarded plan.', { marker, output: guardedPlanStep?.output })
  }
  assert(JSON.stringify(rogueOpeningAI.roguePlan).includes('提前打开通知'), 'The pure guard must not mutate the captured AI plan object.')
  assert(openingGuardResult.draftIds.length === 1, 'The guarded plan must still produce one reviewable draft.', openingGuardResult.draftIds)

  const staleOpeningPlanAI = fakeWorkflowAI()
  const staleOpeningPlanData = {
    ...openingGuardPrepared.appData,
    chapterGenerationSteps: openingGuardPrepared.appData.chapterGenerationSteps.map((step) => {
      const index = h.AGENT_PIPELINE_STEP_ORDER.indexOf(step.type)
      if (index >= h.AGENT_PIPELINE_STEP_ORDER.indexOf('generate_chapter_draft')) return step
      const completed = openingGuardResult.appData.chapterGenerationSteps.find(
        (candidate) => candidate.jobId === step.jobId && candidate.type === step.type
      )
      return {
        ...step,
        status: 'completed',
        output: step.type === 'generate_chapter_plan' ? JSON.stringify(rogueOpeningAI.roguePlan) : completed?.output ?? ''
      }
    })
  }
  const staleOpeningPlanPath = join(outDir, 'opening-plan-draft-boundary-data.json')
  await writeFile(staleOpeningPlanPath, JSON.stringify(staleOpeningPlanData, null, 2), 'utf8')
  const staleOpeningPlanRuntime = await h.loadAgentRuntimeData({ storagePath: staleOpeningPlanPath, userDataPath: outDir })
  const staleOpeningPlanResult = await h.executeAgentChapterPipeline(
    {
      appData: staleOpeningPlanRuntime.data,
      runtime: staleOpeningPlanRuntime,
      agentRunId: openingGuardPrepared.agentRun.id,
      jobId: openingGuardPrepared.job.id,
      estimatedWordCount: openingGuardTask.targetWordCount,
      readerEmotionTarget: openingGuardTask.readerEmotion
    },
    {
      workflowAI: staleOpeningPlanAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [] })
    }
  )
  assert(staleOpeningPlanResult.startedFromStep === 'generate_chapter_draft', 'A persisted legacy plan fixture must resume directly at the draft boundary.', staleOpeningPlanResult)
  assert(staleOpeningPlanResult.failedStep === null, 'The draft-boundary guard must safely recover a persisted legacy opening plan.', staleOpeningPlanResult.failedStep)
  assert(staleOpeningPlanAI.captures.planOptions.length === 0, 'Draft-boundary recovery must not regenerate or bypass the captured AI plan request.', staleOpeningPlanAI.captures)
  assert(staleOpeningPlanAI.captures.draftPlans.length === 1, 'Draft-boundary recovery must issue exactly one guarded draft request.', staleOpeningPlanAI.captures)
  for (const marker of rogueMarkers) {
    assert(!JSON.stringify(staleOpeningPlanAI.captures.draftPlans[0]).includes(marker), 'Even a persisted rogue plan must be normalized immediately before the draft request.', {
      marker,
      plan: staleOpeningPlanAI.captures.draftPlans[0]
    })
  }

  const prepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: runAuditGoal,
    chapterTaskSnapshot: primaryTask,
    temperature: 0.35
  })
  assert(JSON.stringify(prepared.job.chapterTaskSnapshot) === JSON.stringify(primaryTask), 'The job must freeze the complete chapter task contract.', prepared.job)
  assert(prepared.job.aiRunConfig?.temperature === 0.35, 'The requested A/B temperature must be frozen in the job AI config.', prepared.job.aiRunConfig)

  // The saved settings may change while a run is active; the job snapshot must remain authoritative.
  const preparedData = {
    ...prepared.appData,
    settings: { ...prepared.appData.settings, modelName: 'later-settings-model' }
  }
  const storagePath = join(outDir, 'novel-director-data.json')
  await writeFile(storagePath, JSON.stringify(preparedData, null, 2), 'utf8')
  const runtime = await h.loadAgentRuntimeData({ storagePath, userDataPath: outDir })
  const fake = fakeWorkflowAI()
  const captures = { noveltyBodies: [], qualityModels: [], qualityRequests: [] }
  const result = await h.executeAgentChapterPipeline(
    {
      appData: runtime.data,
      runtime,
      agentRunId: prepared.agentRun.id,
      jobId: prepared.job.id,
      estimatedWordCount: '2400-3000',
      readerEmotionTarget: '紧张，并期待门外身份揭晓'
    },
    {
      workflowAI: fake.service,
      diagnostics: fakeDiagnostics(h, captures)
    }
  )

  assert(result.failedStep === null, 'The isolated Agent pipeline should complete without a failed step.', result.failedStep)
  assert(result.completedStepCount === h.AGENT_PIPELINE_STEP_ORDER.length, 'Agent must execute all standard single-chapter steps.', {
    expected: h.AGENT_PIPELINE_STEP_ORDER.length,
    actual: result.completedStepCount
  })
  assert(result.job.status === 'completed' && result.job.currentStep === 'await_user_confirmation', 'Job must stop at the acceptance boundary.', result.job)
  assert(result.agentRun.status === 'paused', 'AgentRun must pause for the same acceptance decision as the desktop workflow.', result.agentRun)
  assert(result.draftIds.length === 1, 'A completed run must produce exactly one current draft.', result.draftIds)
  assert(result.appData.chapters.length === 1, 'Generation must not silently accept the draft into the chapter collection.')
  assert(result.appData.chapterCommitBundles.length === 0, 'Generation must not create a formal ChapterCommitBundle before acceptance.')

  const draft = result.appData.generatedChapterDrafts.find((item) => item.id === result.draftIds[0])
  assert(draft?.body === fake.body, 'The generated draft must be the body reviewed by downstream diagnostics.')
  const report = result.appData.qualityGateReports.find((item) => item.draftId === draft?.id)
  assert(report?.draftContentHash === h.draftContentHash(fake.body), 'Quality report must bind to the current draft content hash.', report)
  const consistency = result.appData.consistencyReviewReports.find((item) => item.draftId === draft?.id)
  assert(consistency?.draftContentHash === h.draftContentHash(fake.body), 'Consistency report must bind to the current draft content hash.', consistency)
  const trace = result.appData.generationRunTraces.find((item) => item.jobId === result.job.id)
  assert(h.noveltyAuditMatchesDraft(trace?.noveltyAuditResult, draft), 'Novelty audit must bind to the exact generated draft revision.')
  assert(captures.noveltyBodies.every((body) => body === fake.body), 'Every novelty pass must inspect the current body only.')
  assert(captures.qualityModels.every((model) => model === 'run-snapshot-model'), 'Quality diagnostics must inherit the job model snapshot.', captures)
  assert(
      captures.qualityRequests.length === 1 &&
      captures.qualityRequests[0].targetChapterOrder === 2 &&
      captures.qualityRequests[0].hasAuthoritativeChapterTask === true &&
      JSON.stringify(captures.qualityRequests[0].chapterTask) === JSON.stringify(primaryTask),
    'A later authoritative chapter must keep its later-chapter quality review scope.',
    captures.qualityRequests
  )
  assert(fake.captures.planOptions.length === 1, 'The plan generator must receive one chapter task contract.', fake.captures)
  assert(JSON.stringify(fake.captures.planOptions[0].chapterTask) === JSON.stringify(primaryTask), 'The plan generator must receive the exact persisted task.', fake.captures.planOptions[0])
  assert(JSON.stringify(fake.captures.draftOptions[0].chapterTask) === JSON.stringify(primaryTask), 'The draft generator must receive the exact same persisted task.', fake.captures.draftOptions[0])
  assert(fake.captures.draftOptions[0].targetChapterOrder === 2, 'The target chapter order must survive into draft generation.', fake.captures.draftOptions[0])
  for (const value of Object.values(primaryTask).filter(Boolean)) {
    assert(fake.captures.planContexts[0].includes(value), 'Every non-empty task field must be present in the plan context.', { value })
    assert(fake.captures.draftContexts[0].includes(value), 'Every non-empty task field must be present in the rebuilt draft context.', { value })
  }
  assert(!fake.captures.planContexts[0].includes(runAuditGoal), 'AgentRun.goal must remain audit metadata and must not leak into the prose prompt.')
  assert(!fake.captures.draftContexts[0].includes(runAuditGoal), 'AgentRun.goal must remain absent after plan-derived context rebuild.')
  assert(!fake.captures.planContexts[0].includes('STALE_DIRECTION_MUST_NOT_OVERRIDE_EXPLICIT_TASK'), 'An explicit job task must suppress stale active StoryDirection guidance.')
  assert(!fake.captures.draftContexts[0].includes('STALE_DIRECTION_MUST_NOT_OVERRIDE_EXPLICIT_TASK'), 'Stale StoryDirection guidance must stay suppressed after plan-derived rebuild.')
  assert(!fake.captures.planContexts[0].includes('PLOT_BEARING_STYLE_SAMPLE_MUST_BE_ISOLATED'), 'An explicit job task must isolate plot-bearing style sample prose before planning.')
  assert(!fake.captures.draftContexts[0].includes('PLOT_BEARING_STYLE_SAMPLE_MUST_BE_ISOLATED'), 'Plot-bearing style sample prose must remain absent after plan-derived context rebuild.')
  assert(!fake.captures.planContexts[0].includes('这是未来章节才能披露的真相'), 'A forbidden hard-canon plot item must be isolated before planning.')
  assert(!fake.captures.draftContexts[0].includes('这是未来章节才能披露的真相'), 'A forbidden hard-canon plot item must remain absent after context rebuild.')
  assert(!fake.captures.planContexts[0].includes('旧剧情套路不得反向进入当前任务'), 'Forbidden StoryBible trope prose must be isolated before planning.')
  assert(!fake.captures.draftContexts[0].includes('未来终局真相不得提前进入当前任务'), 'Forbidden StoryBible immutable-fact prose must remain absent after context rebuild.')
  assert(!fake.captures.planContexts[0].includes('未来真相的执行者'), 'Forbidden future character-card content must be isolated before planning.')
  assert(!fake.captures.draftContexts[0].includes('未来章节才能知道的角色状态'), 'Forbidden future state-ledger content must stay isolated after context rebuild.')
  assert(fake.captures.draftContexts[0].includes('### 周宁'), 'Character filtering must preserve the allowed current-chapter identity and safe lines.')
  assert(fake.captures.draftContexts[0].includes('SAFE_STYLE_BOUNDARY'), 'Unrelated safe hard-canon boundaries must remain available.')
  assert(fake.captures.draftContexts[0].includes(primaryTask.styleRequirement), 'The explicit task style requirement must remain after style-sample isolation.')
  const needPlanStep = result.appData.chapterGenerationSteps.find(
    (step) => step.jobId === result.job.id && step.type === 'context_need_planning'
  )
  assert(needPlanStep?.output.includes('PRIMARY_TASK_CONTRACT'), 'ContextNeedPlan must derive its chapter intent from the persisted task.', needPlanStep)

  const contractRetryPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证 ChapterTask 合约触发精确重写。',
    chapterTaskSnapshot: primaryTask
  })
  const contractRetryAI = chapterTaskContractRetryWorkflowAI()
  const contractRetryStoragePath = join(outDir, 'chapter-contract-retry.json')
  await writeFile(contractRetryStoragePath, JSON.stringify(contractRetryPrepared.appData, null, 2), 'utf8')
  const contractRetryRuntime = await h.loadAgentRuntimeData({ storagePath: contractRetryStoragePath, userDataPath: outDir })
  const contractRetryResult = await h.executeAgentChapterPipeline(
    {
      appData: contractRetryRuntime.data,
      runtime: contractRetryRuntime,
      agentRunId: contractRetryPrepared.agentRun.id,
      jobId: contractRetryPrepared.job.id
    },
    {
      workflowAI: contractRetryAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [] })
    }
  )
  assert(contractRetryResult.failedStep === null, 'A second draft that satisfies ChapterTask should complete after one contract rewrite.', contractRetryResult.failedStep)
  assert(contractRetryAI.captures.draftCalls === 2, 'An under-range authoritative draft must invoke the existing one-retry path exactly once.', contractRetryAI.captures)
  assert(/^正文仅 \d+ 个可见字符，低于作者明确篇幅下限 \d+$/u.test(contractRetryAI.captures.retryReasons[1] ?? ''), 'The retry reason must carry a concise explicit author length failure without repeating the full target range.', contractRetryAI.captures)
  assert(contractRetryAI.captures.previousDrafts[1]?.body?.length > 0, 'A length-only retry must carry the complete earlier draft as an explicit revision base.', contractRetryAI.captures)

  const phraseRetryAI = phrasePositionRetryWorkflowAI()
  const phraseRetryTask = {
    ...primaryTask,
    allowedPayoffs: `锁屏标题“${phraseRetryAI.phrase}”，全文只出现一次，并且首次出现位置不得早于正文85%。`
  }
  const phraseRetryPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证短语位置错误使用首稿做定点修订。',
    chapterTaskSnapshot: phraseRetryTask
  })
  const phraseRetryStoragePath = join(outDir, 'chapter-phrase-position-retry.json')
  await writeFile(phraseRetryStoragePath, JSON.stringify(phraseRetryPrepared.appData, null, 2), 'utf8')
  const phraseRetryRuntime = await h.loadAgentRuntimeData({ storagePath: phraseRetryStoragePath, userDataPath: outDir })
  const phraseRetryResult = await h.executeAgentChapterPipeline(
    {
      appData: phraseRetryRuntime.data,
      runtime: phraseRetryRuntime,
      agentRunId: phraseRetryPrepared.agentRun.id,
      jobId: phraseRetryPrepared.job.id
    },
    {
      workflowAI: phraseRetryAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [], qualityRequests: [] })
    }
  )
  assert(phraseRetryResult.failedStep === null, 'A targeted phrase-position revision that passes the contract should complete.', phraseRetryResult.failedStep)
  assert(phraseRetryAI.captures.draftCalls === 2, 'A phrase-position failure must use exactly one retry.', phraseRetryAI.captures)
  assert(phraseRetryAI.captures.previousDrafts[1]?.body === phraseRetryAI.earlierBody, 'A phrase-position retry must carry the complete first draft instead of blind resampling.', phraseRetryAI.captures)
  assert(
    phraseRetryAI.captures.retryIssueTypes[1]?.includes('chapter_task_phrase_position'),
    'The retry prompt builder must receive structured issue types rather than infer them from Chinese prose.',
    phraseRetryAI.captures
  )

  const invalidRetryPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证截断首稿不会被当成局部修订底稿。',
    chapterTaskSnapshot: primaryTask
  })
  const invalidRetryAI = structurallyInvalidRetryWorkflowAI()
  const invalidRetryStoragePath = join(outDir, 'chapter-invalid-base-retry.json')
  await writeFile(invalidRetryStoragePath, JSON.stringify(invalidRetryPrepared.appData, null, 2), 'utf8')
  const invalidRetryRuntime = await h.loadAgentRuntimeData({ storagePath: invalidRetryStoragePath, userDataPath: outDir })
  const invalidRetryResult = await h.executeAgentChapterPipeline(
    {
      appData: invalidRetryRuntime.data,
      runtime: invalidRetryRuntime,
      agentRunId: invalidRetryPrepared.agentRun.id,
      jobId: invalidRetryPrepared.job.id
    },
    {
      workflowAI: invalidRetryAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [], qualityRequests: [] })
    }
  )
  assert(invalidRetryResult.failedStep === null, 'The retry should recover after a structurally invalid first attempt.', invalidRetryResult.failedStep)
  assert(invalidRetryAI.captures.previousDrafts[1] === null, 'A truncated or structurally invalid body must never be supplied as an in-place revision base.', invalidRetryAI.captures)

  const regressingRetryPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证变短的重试稿不会覆盖更接近目标的首稿。',
    chapterTaskSnapshot: primaryTask
  })
  const regressingRetryAI = regressingLengthRetryWorkflowAI()
  const regressingRetryStoragePath = join(outDir, 'chapter-contract-regressing-retry.json')
  await writeFile(regressingRetryStoragePath, JSON.stringify(regressingRetryPrepared.appData, null, 2), 'utf8')
  const regressingRetryRuntime = await h.loadAgentRuntimeData({ storagePath: regressingRetryStoragePath, userDataPath: outDir })
  const regressingRetryResult = await h.executeAgentChapterPipeline(
    {
      appData: regressingRetryRuntime.data,
      runtime: regressingRetryRuntime,
      agentRunId: regressingRetryPrepared.agentRun.id,
      jobId: regressingRetryPrepared.job.id
    },
    {
      workflowAI: regressingRetryAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [], qualityRequests: [] })
    }
  )
  assert(regressingRetryAI.captures.draftCalls === 2, 'A reviewable but short first attempt must still receive exactly one rewrite attempt.', regressingRetryAI.captures)
  assert(regressingRetryAI.captures.previousDrafts[1]?.body === regressingRetryAI.earlierBody, 'The retry must revise the earlier length-only draft rather than blindly resample.', regressingRetryAI.captures)
  assert(regressingRetryResult.failedStep === null, 'The longer first attempt should remain reviewable when the retry regresses.', regressingRetryResult.failedStep)
  const regressingDraft = regressingRetryResult.appData.generatedChapterDrafts.find((item) => regressingRetryResult.draftIds.includes(item.id))
  assert(regressingDraft?.body === regressingRetryAI.earlierBody, 'A shorter length-only retry must not overwrite the more complete first attempt.', {
    selectedLength: regressingDraft?.body.length,
    earlierLength: regressingRetryAI.earlierBody.length,
    laterLength: regressingRetryAI.laterBody.length
  })

  const reloaded = await h.loadAgentRuntimeData({ storagePath, userDataPath: outDir })
  const persistedSteps = reloaded.data.chapterGenerationSteps.filter((step) => step.jobId === result.job.id)
  assert(persistedSteps.every((step) => step.status === 'completed'), 'Every completed step must be persisted for recovery.', persistedSteps)
  assert(reloaded.data.generatedChapterDrafts.some((item) => item.id === draft.id), 'Generated draft must survive a storage reload.')
  assert(reloaded.data.agentRuns.find((item) => item.id === result.agentRun.id)?.status === 'paused', 'AgentRun pause state must survive a storage reload.')
  assert(
    JSON.stringify(reloaded.data.chapterGenerationJobs.find((item) => item.id === result.job.id)?.chapterTaskSnapshot) === JSON.stringify(primaryTask),
    'The immutable chapter task must survive storage normalization and reload.'
  )

  let missingContractRejected = false
  try {
    h.assertChapterTaskPresentInPrompt(primaryTask.goal, primaryTask, 'plan')
  } catch (error) {
    missingContractRejected = /conflict/.test(String(error)) && /正文生成前|计划生成前/.test(String(error))
  }
  assert(missingContractRejected, 'The generation preflight must name missing task fields instead of silently dropping them.')

  const planGuardTask = chapterTaskFixture('PLAN_PREFLIGHT_CONTRACT')
  const planGuardPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证计划前契约门禁。',
    chapterTaskSnapshot: planGuardTask
  })
  const planStepIndex = h.AGENT_PIPELINE_STEP_ORDER.indexOf('generate_chapter_plan')
  const planGuardData = {
    ...planGuardPrepared.appData,
    chapterGenerationSteps: planGuardPrepared.appData.chapterGenerationSteps.map((step) => {
      const index = h.AGENT_PIPELINE_STEP_ORDER.indexOf(step.type)
      if (index >= planStepIndex) return step
      return {
        ...step,
        status: 'completed',
        output: step.type === 'build_context' ? planGuardTask.goal : ''
      }
    })
  }
  const planGuardPath = join(outDir, 'plan-preflight-data.json')
  await writeFile(planGuardPath, JSON.stringify(planGuardData, null, 2), 'utf8')
  const planGuardRuntime = await h.loadAgentRuntimeData({ storagePath: planGuardPath, userDataPath: outDir })
  const planGuardAI = fakeWorkflowAI()
  const planGuardResult = await h.executeAgentChapterPipeline(
    {
      appData: planGuardRuntime.data,
      runtime: planGuardRuntime,
      agentRunId: planGuardPrepared.agentRun.id,
      jobId: planGuardPrepared.job.id
    },
    {
      workflowAI: planGuardAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [] })
    }
  )
  assert(planGuardResult.failedStep?.type === 'generate_chapter_plan', 'A truncated context must fail at the plan preflight.', planGuardResult.failedStep)
  assert(/conflict/.test(planGuardResult.failedStep?.errorMessage ?? ''), 'The plan preflight failure must identify missing task fields.', planGuardResult.failedStep)
  assert(planGuardAI.captures.planOptions.length === 0, 'The plan model must not be called after the task preflight fails.')

  const draftGuardTask = chapterTaskFixture('DRAFT_PREFLIGHT_CONTRACT')
  const draftGuardPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证正文前契约门禁。',
    chapterTaskSnapshot: draftGuardTask
  })
  const draftStepIndex = h.AGENT_PIPELINE_STEP_ORDER.indexOf('generate_chapter_draft')
  const draftGuardData = {
    ...draftGuardPrepared.appData,
    chapterGenerationSteps: draftGuardPrepared.appData.chapterGenerationSteps.map((step) => {
      const index = h.AGENT_PIPELINE_STEP_ORDER.indexOf(step.type)
      if (index >= draftStepIndex) return step
      const output = step.type === 'generate_chapter_plan'
        ? JSON.stringify(localPlan.data)
        : step.type === 'build_context' || step.type === 'rebuild_context_with_plan'
          ? draftGuardTask.goal
          : ''
      return { ...step, status: 'completed', output }
    })
  }
  const draftGuardPath = join(outDir, 'draft-preflight-data.json')
  await writeFile(draftGuardPath, JSON.stringify(draftGuardData, null, 2), 'utf8')
  const draftGuardRuntime = await h.loadAgentRuntimeData({ storagePath: draftGuardPath, userDataPath: outDir })
  const draftGuardAI = fakeWorkflowAI()
  const draftGuardResult = await h.executeAgentChapterPipeline(
    {
      appData: draftGuardRuntime.data,
      runtime: draftGuardRuntime,
      agentRunId: draftGuardPrepared.agentRun.id,
      jobId: draftGuardPrepared.job.id
    },
    {
      workflowAI: draftGuardAI.service,
      diagnostics: fakeDiagnostics(h, { noveltyBodies: [], qualityModels: [] })
    }
  )
  assert(draftGuardResult.failedStep?.type === 'generate_chapter_draft', 'A truncated rebuilt context must fail at the draft preflight.', draftGuardResult.failedStep)
  assert(/conflict/.test(draftGuardResult.failedStep?.errorMessage ?? ''), 'The draft preflight failure must identify missing task fields.', draftGuardResult.failedStep)
  assert(draftGuardAI.captures.draftOptions.length === 0, 'The draft model must not be called after the task preflight fails.')

  const retryTask = chapterTaskFixture('RETRY_TASK_CONTRACT')
  const retryPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证失败步骤恢复。',
    chapterTaskSnapshot: retryTask
  })
  const retryStoragePath = join(outDir, 'agent-retry-data.json')
  await writeFile(retryStoragePath, JSON.stringify(retryPrepared.appData, null, 2), 'utf8')
  const retryRuntime = await h.loadAgentRuntimeData({ storagePath: retryStoragePath, userDataPath: outDir })
  const flaky = flakyWorkflowAI()
  const retryCaptures = { noveltyBodies: [], qualityModels: [] }
  const failed = await h.executeAgentChapterPipeline(
    {
      appData: retryRuntime.data,
      runtime: retryRuntime,
      agentRunId: retryPrepared.agentRun.id,
      jobId: retryPrepared.job.id
    },
    {
      workflowAI: flaky.service,
      diagnostics: fakeDiagnostics(h, retryCaptures)
    }
  )
  assert(failed.failedStep?.type === 'generate_chapter_draft', 'Injected failure must stop at the draft step.', failed.failedStep)
  assert(failed.agentRun.status === 'failed', 'A failed step must leave the AgentRun recoverable and failed.', failed.agentRun)
  const completedBeforeRetry = failed.appData.chapterGenerationSteps
    .filter((step) => step.jobId === failed.job.id && step.status === 'completed')
    .map((step) => step.type)
  assert(completedBeforeRetry.includes('generate_chapter_plan'), 'The completed plan must be persisted before retry.', completedBeforeRetry)
  const failedReloaded = await h.loadAgentRuntimeData({ storagePath: retryStoragePath, userDataPath: outDir })
  assert(
    failedReloaded.data.chapterGenerationSteps.some(
      (step) => step.jobId === failed.job.id && step.type === 'generate_chapter_draft' && step.status === 'failed'
    ),
    'The failed step must survive a process/storage reload before retry.'
  )

  const resumed = await h.executeAgentChapterPipeline(
    {
      appData: failedReloaded.data,
      runtime: failedReloaded,
      agentRunId: retryPrepared.agentRun.id,
      jobId: retryPrepared.job.id
    },
    {
      workflowAI: flaky.service,
      diagnostics: fakeDiagnostics(h, retryCaptures)
    }
  )
  assert(resumed.startedFromStep === 'generate_chapter_draft', 'Retry must resume from the first failed step.', resumed)
  assert(resumed.failedStep === null, 'Retry should finish after the transient failure clears.', resumed.failedStep)
  assert(resumed.completedStepCount === h.AGENT_PIPELINE_STEP_ORDER.length, 'Retry must complete the full persisted step chain.', resumed.completedStepCount)
  assert(flaky.captures.planCalls === 1, 'Retry must not regenerate the already completed chapter plan.', flaky.captures)
  assert(flaky.captures.draftCalls === 2, 'Only the failed draft call should be repeated.', flaky.captures)
  assert(
    flaky.captures.planOptions.every((options) => JSON.stringify(options.chapterTask) === JSON.stringify(retryTask)),
    'The initial plan call must use the retry job task snapshot.',
    flaky.captures.planOptions
  )
  assert(
    flaky.captures.draftOptions.every((options) => JSON.stringify(options.chapterTask) === JSON.stringify(retryTask)),
    'The failed and resumed draft calls must reuse the same persisted task snapshot.',
    flaky.captures.draftOptions
  )
  assert(
    JSON.stringify(resumed.job.chapterTaskSnapshot) === JSON.stringify(retryTask),
    'Retry must not replace or mutate the job chapter task snapshot.',
    resumed.job.chapterTaskSnapshot
  )
  assert(
    resumed.agentRun.decisions.some(
      (decision) => decision.action === 'retry_step' && decision.result === 'applied' && decision.step === 'generate_chapter_draft'
    ),
    'A resumed pipeline must leave an applied retry_step AgentDecision audit record.',
    resumed.agentRun.decisions
  )
  assert(resumed.appData.generatedChapterDrafts.filter((item) => item.jobId === resumed.job.id).length === 1, 'Retry must not duplicate the generated draft.')
  assert(resumed.appData.chapterCommitBundles.length === 0, 'Retry still must stop before formal acceptance.')
  let completedRetryRejected = false
  try {
    await h.executeAgentChapterPipeline(
      {
        appData: resumed.appData,
        runtime: failedReloaded,
        agentRunId: retryPrepared.agentRun.id,
        jobId: retryPrepared.job.id
      },
      {
        workflowAI: flaky.service,
        diagnostics: fakeDiagnostics(h, retryCaptures)
      }
    )
  } catch (error) {
    completedRetryRejected = /no failed or unfinished step/i.test(String(error))
  }
  assert(completedRetryRejected, 'A completed pipeline must reject duplicate retry instead of creating duplicate artifacts.')

  const strictPlanTask = chapterTaskFixture('STRICT_PLAN_CONTRACT')
  const strictPlanPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证 Agent 不会用本地通用计划继续写作。',
    chapterTaskSnapshot: strictPlanTask
  })
  const strictPlanStoragePath = join(outDir, 'agent-strict-plan-data.json')
  await writeFile(strictPlanStoragePath, JSON.stringify(strictPlanPrepared.appData, null, 2), 'utf8')
  const strictPlanRuntime = await h.loadAgentRuntimeData({ storagePath: strictPlanStoragePath, userDataPath: outDir })
  const strictPlanAI = nonAuthoritativePlanThenRecoverWorkflowAI()
  const strictPlanCaptures = { noveltyBodies: [], qualityModels: [] }
  const strictPlanFailed = await h.executeAgentChapterPipeline(
    {
      appData: strictPlanRuntime.data,
      runtime: strictPlanRuntime,
      agentRunId: strictPlanPrepared.agentRun.id,
      jobId: strictPlanPrepared.job.id
    },
    {
      workflowAI: strictPlanAI.service,
      diagnostics: fakeDiagnostics(h, strictPlanCaptures)
    }
  )
  assert(strictPlanFailed.failedStep?.type === 'generate_chapter_plan', 'A non-authoritative plan must stop the Agent pipeline at plan generation.', strictPlanFailed.failedStep)
  assert(
    strictPlanFailed.failedStep?.errorMessage.includes('PLAN_GENERATION_NON_AUTHORITATIVE'),
    'The failed step must expose a stable strict-plan diagnostic code.',
    strictPlanFailed.failedStep
  )
  assert(strictPlanAI.captures.planCalls === 1 && strictPlanAI.captures.draftCalls === 0, 'No draft call is allowed after a local plan fallback.', strictPlanAI.captures)
  assert(
    strictPlanFailed.appData.generatedChapterDrafts.every((draft) => draft.jobId !== strictPlanPrepared.job.id),
    'Strict plan failure must not create a draft.'
  )
  assert(
    strictPlanFailed.appData.qualityGateReports.every((report) => report.jobId !== strictPlanPrepared.job.id),
    'Strict plan failure must not create a quality report.'
  )
  assert(
    strictPlanFailed.appData.memoryUpdateCandidates.every((candidate) => candidate.jobId !== strictPlanPrepared.job.id) &&
      strictPlanFailed.appData.characterStateChangeCandidates.every((candidate) => candidate.jobId !== strictPlanPrepared.job.id),
    'Strict plan failure must not create memory candidates.'
  )

  const strictPlanReloaded = await h.loadAgentRuntimeData({ storagePath: strictPlanStoragePath, userDataPath: outDir })
  const strictPlanResumed = await h.executeAgentChapterPipeline(
    {
      appData: strictPlanReloaded.data,
      runtime: strictPlanReloaded,
      agentRunId: strictPlanPrepared.agentRun.id,
      jobId: strictPlanPrepared.job.id
    },
    {
      workflowAI: strictPlanAI.service,
      diagnostics: fakeDiagnostics(h, strictPlanCaptures)
    }
  )
  assert(strictPlanResumed.startedFromStep === 'generate_chapter_plan', 'A valid retry must resume from the rejected plan step.', strictPlanResumed)
  assert(strictPlanResumed.failedStep === null, 'A later authoritative plan must recover the same persisted job.', strictPlanResumed.failedStep)
  assert(strictPlanAI.captures.planCalls === 2 && strictPlanAI.captures.draftCalls === 1, 'Recovery must regenerate the plan once and draft only after success.', strictPlanAI.captures)
  assert(strictPlanResumed.appData.generatedChapterDrafts.filter((draft) => draft.jobId === strictPlanPrepared.job.id).length === 1, 'Strict-plan recovery must create exactly one draft.')

  const cancelPrepared = h.AgentRunService.prepareSingleChapterRun({
    appData: fixture(h),
    projectId: 'project-agent-pipeline',
    targetChapterOrder: 2,
    goal: '验证跨工具取消。'
  })
  const cancelStoragePath = join(outDir, 'agent-cancel-data.json')
  await writeFile(cancelStoragePath, JSON.stringify(cancelPrepared.appData, null, 2), 'utf8')
  const cancelRuntime = await h.loadAgentRuntimeData({ storagePath: cancelStoragePath, userDataPath: outDir })
  const cancellable = cancellableWorkflowAI()
  const cancelCaptures = { noveltyBodies: [], qualityModels: [] }
  const executionPromise = h.executeAgentChapterPipeline(
    {
      appData: cancelRuntime.data,
      runtime: cancelRuntime,
      agentRunId: cancelPrepared.agentRun.id,
      jobId: cancelPrepared.job.id
    },
    {
      workflowAI: cancellable.service,
      diagnostics: fakeDiagnostics(h, cancelCaptures),
      cancelActiveRun: () => cancellable.cancel(),
      cancellationPollIntervalMs: 20
    }
  )
  await cancellable.started
  const runningSnapshot = await h.loadAgentRuntimeData({ storagePath: cancelStoragePath, userDataPath: outDir })
  const runningProgress = await h.AgentExecutionControlService.getProgress(
    runningSnapshot.data,
    runningSnapshot,
    cancelPrepared.job.id
  )
  assert(runningProgress.jobStatus === 'running', 'Progress query must observe a running persisted job.', runningProgress)
  assert(runningProgress.currentStep === 'generate_chapter_plan', 'Progress query must expose the active step.', runningProgress)
  assert(runningProgress.currentStepElapsedMs !== null, 'Progress query must expose elapsed time for a running step.', runningProgress)
  await h.AgentExecutionControlService.requestCancellation(
    runningSnapshot,
    cancelPrepared.job.id,
    '隔离测试主动取消'
  )
  const requestedProgress = await h.AgentExecutionControlService.getProgress(
    runningSnapshot.data,
    runningSnapshot,
    cancelPrepared.job.id
  )
  assert(requestedProgress.cancellationRequested, 'Progress must expose a pending cross-process cancellation request.', requestedProgress)
  const cancelled = await executionPromise
  assert(cancelled.agentRun.status === 'cancelled', 'Cancellation must produce a cancelled AgentRun.', cancelled.agentRun)
  assert(cancelled.job.status === 'paused', 'Cancellation must pause the job so it remains recoverable.', cancelled.job)
  assert(cancelled.failedStep?.type === 'generate_chapter_plan', 'Cancellation must retain the interrupted step as the recovery point.', cancelled.failedStep)
  assert(
    cancelled.agentRun.decisions.some((decision) => decision.action === 'cancel_run' && decision.result === 'applied'),
    'Cancellation must leave a traceable AgentDecision.',
    cancelled.agentRun.decisions
  )
  const cancelledReloaded = await h.loadAgentRuntimeData({ storagePath: cancelStoragePath, userDataPath: outDir })
  const cancelledProgress = await h.AgentExecutionControlService.getProgress(
    cancelledReloaded.data,
    cancelledReloaded,
    cancelPrepared.job.id
  )
  assert(!cancelledProgress.cancellationRequested, 'The transient cancellation marker must be removed after persistence.', cancelledProgress)
  assert(cancelledProgress.recoverableFromStep === 'generate_chapter_plan', 'Cancelled progress must identify the retry point.', cancelledProgress)

  console.log(
    JSON.stringify(
      {
        ok: true,
        completedStepCount: result.completedStepCount,
        draftId: draft.id,
        qualityReportId: report.id,
        modelSnapshot: captures.qualityModels[0],
        persistedStepCount: persistedSteps.length,
        retry: {
          resumedFromStep: resumed.startedFromStep,
          planCalls: flaky.captures.planCalls,
          draftCalls: flaky.captures.draftCalls,
          completedStepCount: resumed.completedStepCount
        },
        strictPlan: {
          failureCode: strictPlanFailed.failedStep?.errorMessage.split(':')[0],
          resumedFromStep: strictPlanResumed.startedFromStep,
          planCalls: strictPlanAI.captures.planCalls,
          draftCalls: strictPlanAI.captures.draftCalls
        },
        cancellation: {
          currentStep: runningProgress.currentStep,
          progressPercent: runningProgress.progressPercent,
          finalRunStatus: cancelled.agentRun.status,
          finalJobStatus: cancelled.job.status,
          recoverableFromStep: cancelledProgress.recoverableFromStep
        }
      },
      null,
      2
    )
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
})
