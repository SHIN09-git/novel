// A caller-supplied display label, never an identity or a grant.
const tagPattern = /^(?!\s*$)[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u
export const actorTagSchema = {
  type: 'string', minLength: 1, maxLength: 48, pattern: tagPattern.source,
  description: 'Optional author-visible source label, not an identity or authorization. Up to 48 characters; no control characters or line breaks.'
}

export function validActorTag(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 2 * actorTagSchema.maxLength &&
    Array.from(value).length <= actorTagSchema.maxLength && tagPattern.test(value) ? value.trim() : undefined
}

export function readActorTag(value: unknown): string | undefined {
  if (value === undefined) return undefined
  const tag = validActorTag(value)
  if (!tag) throw new Error('actorTag 必须是 1 至 48 个字符的单行短文本，不能含控制字符。')
  return tag
}
