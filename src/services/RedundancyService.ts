import type { ID, RedundancyReport } from '../shared/types'

const COMMON_INTENSIFIERS = ['极其', '彻底', '完全', '深不见底', '令人牙酸', '无法形容', '某种', '仿佛', '像是']

function repeatedItems(items: string[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items.map((value) => value.trim()).filter((value) => value.length >= 2)) {
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, count]) => count >= 3).map(([item, count]) => `${item} x${count}`)
}

function tokenizeChinesePhrases(text: string): string[] {
  const matches = text.match(/[\u4e00-\u9fff]{2,8}/g) ?? []
  return matches.filter((item) => !/^[的是了和在有不就都而及与或]$/.test(item))
}

function repeatedParagraphStarts(paragraphs: string[]): string[] {
  return repeatedItems(paragraphs.map((paragraph) => paragraph.slice(0, 12))).slice(0, 8)
}

export function analyzeRedundancy(options: {
  projectId: ID
  chapterId: ID | null
  draftId: ID | null
  body: string
}): RedundancyReport {
  const paragraphs = options.body.split(/\n+/).map((item) => item.trim()).filter(Boolean)
  const repeatedPhrases = repeatedItems(tokenizeChinesePhrases(options.body)).slice(0, 12)
  const overusedIntensifiers = COMMON_INTENSIFIERS
    .map((phrase) => ({ phrase, count: (options.body.match(new RegExp(phrase, 'g')) ?? []).length }))
    .filter((item) => item.count >= 3)
    .map((item) => `${item.phrase} x${item.count}`)
  const repeatedExplanations = paragraphs
    .filter((paragraph) => /这不是|而是|规则|机制|本质|意味着|说明/.test(paragraph))
    .filter((paragraph, index, list) => list.findIndex((item) => item.slice(0, 18) === paragraph.slice(0, 18)) !== index || paragraph.length > 180)
    .slice(0, 8)
  const repeatedSceneDescriptions = repeatedParagraphStarts(paragraphs)
  const redundantParagraphs = paragraphs.filter((paragraph) => paragraph.length > 260 && /仿佛|像是|似乎|某种|深处|压迫|回声/.test(paragraph)).slice(0, 6)
  const issueCount = repeatedPhrases.length + overusedIntensifiers.length + repeatedExplanations.length + redundantParagraphs.length
  const overallRedundancyScore = Math.max(0, Math.min(100, Math.round(issueCount * 6 + Math.max(0, paragraphs.length - 60))))

  const compressionSuggestions = [
    repeatedPhrases.length ? '合并或替换重复出现的短语，保留最有叙事功能的一次。' : '',
    repeatedSceneDescriptions.length ? '检查相似开头和环境描写，删除读者已知的背景重述。' : '',
    repeatedExplanations.length ? '把重复解释改成动作、对话或一次性明确信息。' : '',
    overusedIntensifiers.length ? '减少抽象强化词，改用具体动作和可见后果。' : '',
    redundantParagraphs.length ? '压缩长段抽象描写，保留人物选择、冲突和伏笔信号。' : ''
  ].filter(Boolean)

  return {
    id: crypto.randomUUID(),
    projectId: options.projectId,
    chapterId: options.chapterId,
    draftId: options.draftId,
    repeatedPhrases,
    repeatedSceneDescriptions,
    repeatedExplanations,
    overusedIntensifiers,
    redundantParagraphs,
    compressionSuggestions,
    overallRedundancyScore,
    createdAt: new Date().toISOString()
  }
}
