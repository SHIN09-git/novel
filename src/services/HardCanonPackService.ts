import type {
  AppData,
  HardCanonItem,
  HardCanonItemCategory,
  HardCanonPack,
  HardCanonPriority,
  HardCanonPromptBlockResult,
  HardCanonStatus,
  ID
} from '../shared/types'
import { TokenEstimator } from './TokenEstimator'

const PRIORITY_RANK: Record<HardCanonPriority, number> = { must: 0, high: 1, medium: 2 }
const DEFAULT_MAX_PROMPT_TOKENS = 900
const MAX_ITEM_CONTENT_CHARS = 320

function now(): string {
  return new Date().toISOString()
}

function newId(prefix: string): ID {
  const random = Math.random().toString(36).slice(2, 9)
  return `${prefix}-${Date.now()}-${random}`
}

function compactText(value: string, limit = MAX_ITEM_CONTENT_CHARS): { text: string; truncated: boolean } {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= limit) return { text: trimmed, truncated: false }
  return { text: `${trimmed.slice(0, limit).trim()}...`, truncated: true }
}

function normalizeArrays(item: HardCanonItem): HardCanonItem {
  return {
    ...item,
    relatedCharacterIds: item.relatedCharacterIds ?? [],
    relatedForeshadowingIds: item.relatedForeshadowingIds ?? [],
    relatedTimelineEventIds: item.relatedTimelineEventIds ?? []
  }
}

function sortItems(items: HardCanonItem[]): HardCanonItem[] {
  return [...items].sort((a, b) => {
    const priority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (priority !== 0) return priority
    return (b.updatedAt || '').localeCompare(a.updatedAt || '')
  })
}

function formatCategory(category: HardCanonItemCategory): string {
  const labels: Record<HardCanonItemCategory, string> = {
    world_rule: '世界规则',
    system_rule: '系统规则',
    character_identity: '角色身份',
    character_hard_state: '角色硬状态',
    timeline_anchor: '时间锚点',
    foreshadowing_rule: '伏笔规则',
    relationship_fact: '关系事实',
    prohibition: '禁止事项',
    style_boundary: '风格边界',
    other: '其他'
  }
  return labels[category] ?? category
}

function formatPriority(priority: HardCanonPriority): string {
  if (priority === 'must') return '必须遵守'
  if (priority === 'high') return '高优先级'
  return '中优先级'
}

function upsertPack(data: AppData, pack: HardCanonPack): AppData {
  const exists = data.hardCanonPacks.some((item) => item.id === pack.id)
  return {
    ...data,
    hardCanonPacks: exists
      ? data.hardCanonPacks.map((item) => (item.id === pack.id ? pack : item))
      : [pack, ...data.hardCanonPacks]
  }
}

export class HardCanonPackService {
  static createDefaultHardCanonPack(projectId: ID): HardCanonPack {
    const timestamp = now()
    return {
      id: `hard-canon-pack-${projectId}`,
      projectId,
      title: '不可违背设定包',
      description: '这里放不能被 AI 改写的硬设定。不要放长篇剧情回顾、临时情绪或普通描写。',
      items: [],
      maxPromptTokens: DEFAULT_MAX_PROMPT_TOKENS,
      createdAt: timestamp,
      updatedAt: timestamp,
      schemaVersion: 1
    }
  }

  static getHardCanonPackForProject(data: AppData, projectId: ID): HardCanonPack {
    return data.hardCanonPacks.find((pack) => pack.projectId === projectId) ?? this.createDefaultHardCanonPack(projectId)
  }

  static savePackMeta(data: AppData, pack: HardCanonPack): AppData {
    return upsertPack(data, { ...pack, updatedAt: now() })
  }

  static upsertHardCanonItem(data: AppData, item: HardCanonItem): AppData {
    const timestamp = now()
    const pack = this.getHardCanonPackForProject(data, item.projectId)
    const normalized = normalizeArrays({
      ...item,
      id: item.id || newId('hard-canon-item'),
      title: item.title.trim(),
      content: item.content.trim(),
      sourceType: item.sourceType ?? 'manual',
      status: item.status ?? 'active',
      priority: item.priority ?? 'medium',
      createdAt: item.createdAt || timestamp,
      updatedAt: timestamp
    })

    const duplicate = pack.items.find((existing) =>
      existing.id !== normalized.id &&
      existing.sourceId &&
      existing.sourceId === normalized.sourceId &&
      existing.sourceType === normalized.sourceType &&
      existing.category === normalized.category &&
      existing.content.trim() === normalized.content.trim()
    )
    const targetId = duplicate?.id ?? normalized.id
    const nextItem = { ...normalized, id: targetId, createdAt: duplicate?.createdAt ?? normalized.createdAt }
    const exists = pack.items.some((existing) => existing.id === targetId)
    const nextPack: HardCanonPack = {
      ...pack,
      items: exists ? pack.items.map((existing) => (existing.id === targetId ? nextItem : existing)) : [nextItem, ...pack.items],
      updatedAt: timestamp
    }
    return upsertPack(data, nextPack)
  }

  static removeHardCanonItem(data: AppData, itemId: ID): AppData {
    const timestamp = now()
    return {
      ...data,
      hardCanonPacks: data.hardCanonPacks.map((pack) =>
        pack.items.some((item) => item.id === itemId)
          ? { ...pack, items: pack.items.filter((item) => item.id !== itemId), updatedAt: timestamp }
          : pack
      )
    }
  }

  static setHardCanonItemStatus(data: AppData, itemId: ID, status: HardCanonStatus): AppData {
    const timestamp = now()
    return {
      ...data,
      hardCanonPacks: data.hardCanonPacks.map((pack) => ({
        ...pack,
        items: pack.items.map((item) => (item.id === itemId ? { ...item, status, updatedAt: timestamp } : item)),
        updatedAt: pack.items.some((item) => item.id === itemId) ? timestamp : pack.updatedAt
      }))
    }
  }

  static activateHardCanonItem(data: AppData, itemId: ID): AppData {
    return this.setHardCanonItemStatus(data, itemId, 'active')
  }

  static deactivateHardCanonItem(data: AppData, itemId: ID): AppData {
    return this.setHardCanonItemStatus(data, itemId, 'inactive')
  }

  static estimateHardCanonPackBudget(pack: HardCanonPack): number {
    return TokenEstimator.estimate(
      pack.items
        .filter((item) => item.status === 'active')
        .map((item) => `${item.title}\n${item.content}`)
        .join('\n')
    )
  }

  static compressHardCanonPackForPrompt(pack: HardCanonPack | null | undefined, options: { maxPromptTokens?: number } = {}): HardCanonPromptBlockResult {
    if (!pack) {
      return { body: '', includedItemIds: [], truncatedItemIds: [], tokenEstimate: 0, itemCount: 0, warnings: [] }
    }

    const budget = options.maxPromptTokens ?? pack.maxPromptTokens ?? DEFAULT_MAX_PROMPT_TOKENS
    const activeItems = sortItems(pack.items.filter((item) => item.status === 'active' && item.title.trim() && item.content.trim()))
    const included: string[] = []
    const includedItemIds: ID[] = []
    const truncatedItemIds: ID[] = []
    const warnings: string[] = []

    for (const item of activeItems) {
      const compacted = compactText(item.content)
      const line = `- [${formatPriority(item.priority)}｜${formatCategory(item.category)}] ${item.title}：${compacted.text}`
      const nextBody = [
        '本块只包含不可违背硬设定；若与普通摘要、旧章节回顾或模型临时发挥冲突，以本块为准。',
        ...included,
        line
      ].join('\n')
      const nextTokens = TokenEstimator.estimate(nextBody)
      if (nextTokens > budget && item.priority !== 'must') {
        warnings.push(`硬设定「${item.title}」因预算限制未进入 prompt。`)
        continue
      }
      included.push(line)
      includedItemIds.push(item.id)
      if (compacted.truncated) truncatedItemIds.push(item.id)
    }

    const body = included.length
      ? [
          `标题：${pack.title}`,
          pack.description ? `说明：${compactText(pack.description, 120).text}` : '',
          '硬规则：',
          ...included,
          '约束：HardCanonPack 不得静默覆盖上一章结尾衔接或本章任务契约；如发生冲突，应按更高优先级上下文执行并在审稿中提示。'
        ]
          .filter(Boolean)
          .join('\n')
      : ''

    return {
      body,
      includedItemIds,
      truncatedItemIds,
      tokenEstimate: TokenEstimator.estimate(body),
      itemCount: includedItemIds.length,
      warnings
    }
  }

  static buildHardCanonPromptBlock(data: AppData, projectId: ID, options: { maxPromptTokens?: number } = {}): HardCanonPromptBlockResult {
    return this.compressHardCanonPackForPrompt(this.getHardCanonPackForProject(data, projectId), options)
  }
}
