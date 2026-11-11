import type { Character, CharacterStateFact, Chapter, HardCanonActorActionCheck } from '../../shared/types'
import { isChapterArchived } from '../ChapterLifecycleService'
import { uniqueWords } from './rules'
import { alternatives } from './text'

export interface ActorIdentity {
  names: string[]
  characterId?: string
  unresolvedId: boolean
}

export function actorDirectory(characters: Character[], checks: HardCanonActorActionCheck[]) {
  const owners = new Map<string, Set<string>>()
  function register(name: string, ids: string[]) {
    if (!name) return
    const entry = owners.get(name) ?? new Set<string>()
    for (const id of ids) entry.add(id)
    owners.set(name, entry)
  }
  const byId = new Map(characters.map((c) => [c.id, c]))
  for (const c of characters) register(c.name, [c.id])
  const identities = new Map<HardCanonActorActionCheck, ActorIdentity>()
  for (const c of checks) {
    const declared = [c.actor, ...(c.aliases ?? [])]
    const matches = characters.filter((person) => declared.includes(person.name)).map((person) => person.id)
    const id = c.characterId ?? (matches.length === 1 ? matches[0] : undefined)
    const card = id ? byId.get(id) : undefined
    identities.set(c, { names: uniqueWords(card ? [...declared, card.name] : declared),
      characterId: id, unresolvedId: Boolean(c.characterId && !card) || (!id && matches.length > 1) })
  }
  for (const [check, identity] of identities) {
    const ids = identity.characterId ? [identity.characterId] :
      characters.filter((c) => identity.names.includes(c.name)).map((c) => c.id)
    for (const name of identity.names) register(name, ids.length ? ids : ['name:' + check.actor])
  }
  const names = [...owners.keys()].sort()
  return { names, pattern: alternatives(names), identities,
    ambiguous: (name: string) => (owners.get(name)?.size ?? 0) > 1,
    signature: names.map((name) => [name, [...owners.get(name)!].sort()]) }
}

export type StateBasis = 'confirmed' | 'absent' | 'missing' | 'conflict'

function stateValue(f: CharacterStateFact, state: string): StateBasis {
  const labels = [f.key, f.label]
  const isLabel = labels.some((s) => s === state || s === state + '状态')
  const personal = ['physical', 'mental', 'status', 'location', 'custom'].includes(f.category)
  const values = Array.isArray(f.value) ? f.value : [f.value]
  let yes = false, no = false
  for (const v of values) {
    if (typeof v === 'boolean') {
      if (isLabel) { if (v) yes = true; else no = true }
      continue
    }
    if (typeof v !== 'string' || (!personal && !isLabel)) continue
    const value = v.trim()
    if ([state, state + '中', state + '状态', '处于' + state, '处于' + state + '状态'].includes(value) ||
        labels.some((s) => s + value === state) ||
        (isLabel && /^(是|有|持续|未愈|未恢复|属实|true)$/.test(value))) yes = true
    if (['未' + state, '未曾' + state, '没有' + state, '不再' + state].includes(value) ||
        (isLabel && /^(否|无|已解除|已恢复|已痊愈|false)$/.test(value)) ||
        (state === '昏迷' && /^(清醒|已清醒|苏醒|已苏醒)$/.test(value))) no = true
  }
  if (yes && no) return 'conflict'
  if (no) return 'absent'
  if (!yes) return 'missing'
  return f.status !== 'active' ? 'missing' : 'confirmed'
}

export function stateAtChapter(
  state: string | undefined, identity: ActorIdentity, facts: CharacterStateFact[],
  chapters: Map<string, Chapter>, projectId: string, order: number
): StateBasis {
  if (!state) return 'confirmed'
  if (!identity.characterId || identity.unresolvedId) return 'missing'
  const fields = new Map<string, { at: number; facts: CharacterStateFact[] }>()
  const undated = new Set<StateBasis>()
  for (const f of facts) {
    if (f.projectId !== projectId || f.characterId !== identity.characterId) continue
    const source = f.sourceChapterId ? chapters.get(f.sourceChapterId) : undefined
    if (f.sourceChapterId && !source) continue
    if (source && (source.projectId !== projectId || isChapterArchived(source))) continue
    const at = f.sourceChapterOrder ?? source?.order
    if ((source && source.order > order) || (at !== undefined && at > order)) continue
    if (at === undefined || !Number.isSafeInteger(at) || at < 0 || (source && at !== source.order)) {
      if (f.status === 'active') undated.add(stateValue(f, state))
      continue
    }
    const key = JSON.stringify([f.category, f.key || f.id, f.unit ?? ''])
    const group = fields.get(key)
    if (!group || at > group.at) fields.set(key, { at, facts: [f] })
    else if (at === group.at) group.facts.push(f)
  }
  let confirmed = false, absent = false, disputed = false
  for (const group of fields.values()) {
    const observations = group.facts.map((f) => {
      if (f.status !== 'active') return 'missing'
      const v = stateValue(f, state)
      return f.trackingLevel === 'note' || f.trackingLevel === 'soft' ? 'missing' : v
    })
    if (observations.includes('conflict')) disputed = true
    if (observations.includes('confirmed')) {
      confirmed = true
      if (observations.some((v) => v !== 'confirmed')) disputed = true
    }
    if (observations.includes('absent')) absent = true
  }
  if (disputed || (confirmed && (absent || undated.has('absent') || undated.has('conflict'))) ||
      (absent && (undated.has('confirmed') || undated.has('conflict')))) return 'conflict'
  return confirmed ? 'confirmed' : absent ? 'absent' : 'missing'
}
