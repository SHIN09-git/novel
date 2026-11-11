import type { Character, CharacterStateFact } from '../../shared/types'
import { qualifiedAccount as otherAccount, resourceAccountScope } from '../../shared/characterStateDefinition'
import { CARD_FIELDS } from './cardFields'

const textFields = [...CARD_FIELDS, 'role', 'deepDesire', 'selfDeception', 'knownInformation', 'unknownInformation',
  'protagonistRelationship', 'emotionalState', 'nextActionTendency', 'forbiddenWriting'] as const
const personalAccount = /^(?:cash(?:[_. -]?balance)?|money|balance|wallet|(?:个人|随身|现有|手头)?现金(?:余额)?|余额|钱袋|银钱|盘缠|金币)$/i
const amount = /^(?:(?:目前|眼下|如今|现在|当前|个人|随身|手头|身上|身边|兜里|怀里|钱袋里?|钱包里?|身上带着)\s*)*(?:(?<account>现金余额|现有现金|手头现金|现金|钱包余额|余额|盘缠|余钱|银钱|铜钱|金币|钱)\s*)?(?:只(?:剩下?|有)|仅(?:剩下?|有)|剩余|剩下?|还剩下?|剩有|余下?|共有|持有|还有|有|为|[：:=])?\s*(?<amount>-?(?:\d+(?:[,.]\d+)*|[零〇一二三四五六七八九十百千万亿两]+))\s*(?<unit>文钱?|枚金币|金币|枚银币|银币|两银子?|两白银|银两|两|美元|英镑|元钱?|块钱|铜板|枚铜钱|铜钱)?(?:而已|整)?$/u
const balanceContext = /余额|现金|盘缠|银钱|钱袋|钱(?:只|仅|还|剩)|(?:只|仅|还)剩.{0,14}(?:文|金币|元|铜板)/
const selfPossession = /^(?:目前|眼下|如今|现在|当前|个人|随身|身上|手头|身边|兜里|怀里|只[剩有]|仅[剩有]|还[剩有]|剩余|现有|持有|有|现金|余额|余钱|钱|银钱|盘缠|金币|铜钱)/
const splitClause = /([。；;！？!?\n，、]|,(?!\d{3}(?:\D|$)))/u
const separateClaim = /[。；;！？!?\n]/u
const pastOrOther = /回忆|当时|当年|昔日|以前|曾经|当初|如果|假如|据说|听说|代管|替.+保管|的钱|的余额|掌柜|队长/
const unitAliases: Record<string, string> = { '文钱': '文', '枚金币': '金币', '枚银币': '银币', '两银': '两', '两银子': '两', '两白银': '两',
  '银两': '两', '元钱': '元', '块钱': '元', '枚铜钱': '铜钱' }
const namedUnit = (s: string) => unitAliases[s] ?? s

function withoutSubject(text: string, name: string) {
  if (name && text.startsWith(name)) return text.slice(name.length).replace(/^\s*的?\s*/, '')
  return text.replace(/^(?:他|她|自己|本人)的?/, '')
}

function cashObservation(f: CharacterStateFact, name: string) {
  if (f.category !== 'resource' || resourceAccountScope(f.key, f.label)) return []
  const unit = namedUnit(f.unit.trim())
  const simple = typeof f.value === 'number' ? Number.isFinite(f.value) :
    typeof f.value === 'string' && /^-?\d+(?:\.\d+)?$/.test(f.value.trim())
  const statement = typeof f.value === 'string' ? withoutSubject(f.value.trim().replace(/[。.]$/u, ''), name) : ''
  const parsed = amount.exec(statement)?.groups
  const keyed = personalAccount.test(f.key) || ((!f.key || f.key === f.label) && personalAccount.test(f.label))
  if (!keyed && !(parsed?.unit && selfPossession.test(statement) && /^(?:资源[\/／]?余额|资源|余额)$/.test(f.label))) return []
  const statedUnit = parsed?.unit ? namedUnit(parsed.unit) : ''
  return [{ unit: simple ? unit : (statedUnit && (!unit || statedUnit === unit) ? statedUnit : '') }]
}

/** Suppress only a complete claim with an identifiable owner, account and denomination.
 * Inventory, obligations, historical quotes and other accounts in the same card stay intact. */
export function writingCardAtChapter(character: Character, facts: readonly CharacterStateFact[], target: number, historicalReplay = false) {
  const usable = facts.filter(f => f.projectId === character.projectId && f.characterId === character.id &&
    f.status === 'active' && f.promptPolicy !== 'manual_only')
  const cash = usable.flatMap(f => cashObservation(f, character.name))
  const futureCard = (character.lastChangedChapter ?? 0) > target || (historicalReplay && character.lastChangedChapter == null)
  const warnings = new Set<string>()
  const card = { ...character }
  const labels = new Map<string, CharacterStateFact[]>()
  for (const f of usable) if (f.label.trim()) labels.set(f.label.trim(), [...(labels.get(f.label.trim()) ?? []), f])
  const clean = (text: string, datedAfterTarget = false): string => {
    if (!text) return ''
    const parts = text.split(splitClause)
    let changed = false, result = '', sep = '', quoted = false, qualified = false
    for (let i = 0; i < parts.length; i += 2) {
      const clause = parts[i].trim()
      if (!clause) continue
      const own = withoutSubject(clause, character.name)
      const inQuote = quoted || /[“”「」『』"]/.test(clause)
      for (const q of clause.match(/[“”「」『』"]/g) ?? []) quoted = q === '"' ? !quoted : /[“「『]/.test(q)
      const scoped = inQuote || qualified
      // A comma does not end a quoted recollection or change whose money the preceding clause describes.
      qualified = !separateClaim.test(parts[i + 1] ?? '') && (qualified || pastOrOther.test(own) || otherAccount.test(own))
      const m = !scoped && selfPossession.test(own) ? amount.exec(own) : null
      let omit = false
      if (m?.groups && (m.groups.unit || m.groups.account)) {
        const unit = namedUnit(m.groups.unit ?? (['金币', '铜钱'].includes(m.groups.account) ? m.groups.account : ''))
        const matched = unit ? cash.filter(f => f.unit === unit) : []
        omit = datedAfterTarget || (matched.length === 1 && !cash.some(f => !f.unit))
        if (datedAfterTarget && !matched.length) warnings.add(character.name + '的卡片余额没有本章或更早的依据，回看此章不使用该金额。')
        if (!omit && cash.length && (matched.length > 1 || !unit || cash.some(f => !f.unit.trim()))) {
          warnings.add(character.name + '的角色卡和账本都写了余额，账户或单位不能唯一对应；请核对原卡。')
        }
      } else if (!scoped) {
        const entry = /^([^：:]{1,36})[：:]\s*(.+)$/.exec(own)
        const same = entry && labels.get(entry[1].trim())
        if (entry && same?.length === 1 && same[0].category !== 'resource' &&
          (same[0].key === entry[1].trim() || /^(?:location|goal)$/.test(same[0].key)) && entry[2].length <= 32 &&
          !/和|而且|但是|并且|须|必须|禁止|不得|如果|除了|以前|曾经/.test(entry[2])) omit = true
        else if (cash.length && balanceContext.test(own) && /[\d零〇一二三四五六七八九十百千万两]/u.test(own) && !otherAccount.test(own) &&
          !/以前|当时|曾经|如果|打算|替|据说|“|”|「|」/.test(own)) {
          warnings.add(character.name + '的卡片含另一条钱款记载，无法确定是否为同一笔余额，已保留原句供核对。')
        }
      }
      if (omit) { changed = true; continue }
      if (result) result += sep || '；'
      result += clause
      sep = parts[i + 1] ?? ''
    }
    return changed ? result + (result && /[。！？!?]/.test(sep) ? sep : '') : text
  }
  for (const field of textFields) {
    if (character[field]) card[field] = clean(character[field], futureCard)
  }
  return { card, warnings, cleanLog: (note: string) => clean(note) }
}
