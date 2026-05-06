import { AIClient } from './AIClient'
import type { AIResult, Character, RevisionGenerationRequest, RevisionResult } from '../../shared/types'
import { REVISION_SYSTEM_PROMPT, buildRevisionUserPrompt } from './AIPromptTemplates'
import { ensureRevisionResult } from './AIResponseNormalizer'

function defaultRevisionInstruction(type: RevisionGenerationRequest['type']): string {
  const instructions: Partial<Record<RevisionGenerationRequest['type'], string>> = {
    reduce_ai_tone: '减少套话、过度解释和陈词滥调，增强具体动作、感官细节和潜台词，不改变剧情事实。',
    improve_dialogue: '增强对白潜台词，减少直白解释，保留人物关系状态，不让人物突然把话说透。',
    strengthen_conflict: '增强人物目标冲突和阻力，让场面更有张力，但不要随意新增大设定或改变既有事实。',
    compress_pacing: '删除重复解释和无效描写，压缩拖沓节奏，保留关键动作、情绪转折和伏笔。',
    improve_continuity: '让本章更自然地承接上一章结尾，保留身体状态、情绪余波和未完成动作。',
    reduce_redundancy: '删除重复、空泛、已解释过的描写，保留人物动作、对话和关键伏笔。',
    compress_description: '压缩重复环境描写，避免重新介绍读者已经知道的空间、机关和设定。',
    remove_repeated_explanation: '删除重复解释，只保留本章必要的新信息。',
    strengthen_chapter_transition: '强化章节开头对上一章结尾动作、情绪和钩子的直接承接。'
  }
  return instructions[type] ?? '按修订类型处理。'
}

export class RevisionAI {
  constructor(private readonly client: AIClient) {}

  async generateRevision(request: RevisionGenerationRequest, context: string): Promise<AIResult<RevisionResult>> {
    const normalizedRequest: RevisionGenerationRequest = {
      ...request,
      instruction: request.instruction || defaultRevisionInstruction(request.type)
    }
    const fallbackText =
      normalizedRequest.revisionScope === 'local' ? normalizedRequest.targetRange ?? '' : normalizedRequest.fullChapterText
    const fallback: RevisionResult = {
      revisedText: fallbackText,
      changedSummary:
        '未配置 API Key，已保留原文。请在设置页配置 API 后生成真实修订，或在右侧手动编辑修订版本。',
      risks: '本地模板没有实际改写，请人工确认后再接受。',
      preservedFacts: '未改动剧情事实、角色状态和伏笔状态。'
    }
    const userPrompt = buildRevisionUserPrompt(normalizedRequest, context)

    return this.client.requestJson(REVISION_SYSTEM_PROMPT, userPrompt, ensureRevisionResult, fallback)
  }

  async reduceAITone(chapterText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.generateRevision(
      {
        type: 'reduce_ai_tone',
        revisionScope: 'full',
        fullChapterText: chapterText,
        instruction:
          '减少套话、过度解释和陈词滥调，增强具体动作、感官细节和潜台词，不改变剧情事实。'
      },
      context
    )
  }

  async improveDialogue(sectionText: string, characters: Character[], context: string): Promise<AIResult<RevisionResult>> {
    const characterContext = characters
      .map(
        (character) =>
          `${character.name}｜关系：${character.protagonistRelationship || '未记录'}｜情绪：${character.emotionalState || '未记录'}`
      )
      .join('\n')
    return this.generateRevision(
      {
        type: 'improve_dialogue',
        revisionScope: 'full',
        fullChapterText: sectionText,
        instruction:
          '增强对白潜台词，减少直白解释，保留人物关系状态，不让人物突然把话说透。可参考角色状态：\n' +
          characterContext
      },
      context
    )
  }

  async strengthenConflict(sectionText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.generateRevision(
      {
        type: 'strengthen_conflict',
        revisionScope: 'full',
        fullChapterText: sectionText,
        instruction: '增强人物目标冲突和阻力，让场面更有张力，但不要随意新增大设定或改变既有事实。'
      },
      context
    )
  }

  async compressPacing(chapterText: string, context: string): Promise<AIResult<RevisionResult>> {
    return this.generateRevision(
      {
        type: 'compress_pacing',
        revisionScope: 'full',
        fullChapterText: chapterText,
        instruction: '删除重复解释和无效描写，压缩拖沓节奏，保留关键动作、情绪转折和伏笔。'
      },
      context
    )
  }
}
