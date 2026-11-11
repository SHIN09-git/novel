import type { AppData, HardCanonCheck, HardCanonItem } from '../../shared/types'
import { normalizeHardCanonCheck } from '../../shared/normalizers/hardCanonCheck'
import { draftContentHash } from '../DraftDiagnosticBindingService'

export interface AuditRule<T extends HardCanonCheck = HardCanonCheck> {
  id: string
  title: string
  version: string
  check: T
}

export function fingerprint(value: unknown): string {
  return draftContentHash(JSON.stringify(value)).replace('draft-v1-', 'canon-v1-')
}

export function uniqueWords(words: readonly string[]): string[] {
  return [...new Set(words)].sort()
}

function canonicalCheck(value: unknown): HardCanonCheck | undefined {
  const c = normalizeHardCanonCheck(value)
  if (!c) return undefined
  return c.kind === 'literal' ? { ...c, terms: c.terms.sort(), exceptions: c.exceptions?.sort() } :
    { ...c, actions: c.actions.sort(), aliases: c.aliases?.sort(), objects: c.objects?.sort() }
}

export function applicableRules(packs: AppData['hardCanonPacks'], projectId: string, order: number): AuditRule[] {
  const current = new Map<string, HardCanonItem>()
  for (const pack of packs) {
    if (pack.projectId !== projectId) continue
    for (const item of pack.items) {
      if (item.projectId !== projectId) continue
      const old = current.get(item.id)
      if (!old || item.updatedAt > old.updatedAt) current.set(item.id, item)
    }
  }
  const rules: AuditRule[] = []
  for (const id of [...current.keys()].sort()) {
    const item = current.get(id)!
    if (item.status !== 'active') continue
    const check = canonicalCheck(item.check)
    if (!check || order < (check.fromChapter ?? 1) || order > (check.toChapter ?? Infinity)) continue
    const version = fingerprint([id, item.title, item.content, item.updatedAt, check])
    rules.push({ id, title: item.title, version, check })
  }
  return rules
}
