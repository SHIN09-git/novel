type CheckScope = {
  enforcement: 'block' | 'review'
  fromChapter?: number
  toChapter?: number
}

export type HardCanonLiteralCheck = CheckScope & {
  kind: 'literal'
  mode: 'terms' | 'latin'
  terms: string[]
  exceptions?: string[]
  maxPerChapter?: number
  maxPerBook?: number
}

export type HardCanonActorActionCheck = CheckScope & {
  kind: 'actor_action'
  actor: string
  characterId?: string
  aliases?: string[]
  actions: string[]
  side?: '左' | '右'
  objects?: string[]
  state?: string
  effect: 'forbid' | 'allow'
}

export type HardCanonCheck = HardCanonLiteralCheck | HardCanonActorActionCheck

export interface HardCanonAuditInput {
  projectId: string
  chapterOrder: number
  body: string
  chapterId?: string | null
}

export interface HardCanonAuditFinding {
  ruleId: string
  ruleTitle: string
  ruleVersion: string
  severity: 'block' | 'review'
  reason: string
  excerpt: string
  /** Half-open UTF-16 offsets into the original, untrimmed input.body. */
  start: number
  end: number
}

export interface HardCanonAuditCount {
  ruleId: string
  chapterCount: number
  bookCount: number
  projectedBookCount: number
  delta: number
}

export interface HardCanonAuditResult {
  projectId: string
  chapterOrder: number
  draftContentHash: string
  /** Unlike the shared draft hash, distinguishes CR, LF and CRLF for selections. */
  rawBodyFingerprint: string
  rulesFingerprint: string
  checkedRuleIds: string[]
  findings: HardCanonAuditFinding[]
  counts: HardCanonAuditCount[]
}
