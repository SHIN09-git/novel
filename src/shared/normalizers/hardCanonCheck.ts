import type { HardCanonCheck } from '../types/hardCanonCheck'

const sharedFields = ['kind', 'enforcement', 'fromChapter', 'toChapter']
const literalFields = [...sharedFields, 'mode', 'terms', 'exceptions', 'maxPerChapter', 'maxPerBook']
const actorFields = [...sharedFields, 'actor', 'characterId', 'aliases', 'actions', 'side', 'objects', 'state', 'effect']

function invalid(field: string, reason: string): never {
  throw new Error(`检查条件 check${field ? `.${field}` : ''}：${reason}`)
}

function choice<T extends string>(value: unknown, field: string, options: readonly T[]): T {
  if (!options.includes(value as T)) invalid(field, `请选择 ${options.join(' / ')}。`)
  return value as T
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(field, '请填写非空文本。')
  return value.trim()
}

function words(value: unknown, field: string, required = false): string[] {
  if (!Array.isArray(value) || (required && !value.length)) {
    invalid(field, required ? '请至少填写一项。' : '请使用文本列表。')
  }
  return [...new Set(Array.from(value, (entry, i) => text(entry, `${field}[${i}]`)))]
}

function integer(value: unknown, field: string, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    invalid(field, min ? '章号必须是从 1 开始的整数。' : '次数必须是大于等于 0 的整数。')
  }
  return value
}

// Reject the whole condition on any invalid field: dropping just a misspelled
// book limit, exception or chapter boundary could turn it into a wider ban.
export function parseHardCanonCheck(value: unknown): HardCanonCheck {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('', '需要一个检查条件对象。')
  const raw = value as Record<string, unknown>
  const kind = choice(raw.kind, 'kind', ['literal', 'actor_action'] as const)
  const allowed = kind === 'literal' ? literalFields : actorFields
  for (const field of Object.keys(raw)) if (!allowed.includes(field)) invalid(field, '不支持这个字段。')
  const enforcement = choice(raw.enforcement, 'enforcement', ['block', 'review'] as const)
  const fromChapter = 'fromChapter' in raw ? integer(raw.fromChapter, 'fromChapter', 1) : undefined
  const toChapter = 'toChapter' in raw ? integer(raw.toChapter, 'toChapter', 1) : undefined
  if (fromChapter !== undefined && toChapter !== undefined && toChapter < fromChapter) {
    invalid('toChapter', '结束章不能早于起始章。')
  }
  const bounds = { enforcement, ...(fromChapter !== undefined && { fromChapter }), ...(toChapter !== undefined && { toChapter }) }
  if (kind === 'literal') {
    const mode = choice(raw.mode, 'mode', ['terms', 'latin'] as const)
    const terms = words(raw.terms, 'terms', mode === 'terms')
    const exceptions = 'exceptions' in raw ? words(raw.exceptions, 'exceptions') : []
    return {
      kind, mode, terms, ...(exceptions.length > 0 && { exceptions }),
      ...('maxPerChapter' in raw && { maxPerChapter: integer(raw.maxPerChapter, 'maxPerChapter', 0) }),
      ...('maxPerBook' in raw && { maxPerBook: integer(raw.maxPerBook, 'maxPerBook', 0) }),
      ...bounds
    }
  }
  const aliases = 'aliases' in raw ? words(raw.aliases, 'aliases') : []
  const objects = 'objects' in raw ? words(raw.objects, 'objects') : []
  return {
    kind, actor: text(raw.actor, 'actor'), actions: words(raw.actions, 'actions', true),
    effect: choice(raw.effect, 'effect', ['forbid', 'allow'] as const),
    ...('characterId' in raw && { characterId: text(raw.characterId, 'characterId') }),
    ...(aliases.length > 0 && { aliases }),
    ...('side' in raw && { side: choice(raw.side, 'side', ['左', '右'] as const) }),
    ...(objects.length > 0 && { objects }), ...('state' in raw && { state: text(raw.state, 'state') }),
    ...bounds
  }
}

export function normalizeHardCanonCheck(value: unknown): HardCanonCheck | undefined {
  if (value == null) return undefined
  try { return parseHardCanonCheck(value) } catch { return undefined }
}
