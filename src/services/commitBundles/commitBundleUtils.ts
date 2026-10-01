import type { ID } from '../../shared/types'

export interface IdentifiedEntity {
  id: ID
}

export interface ProjectScopedEntity extends IdentifiedEntity {
  projectId: ID
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortForStableJson(entry)])
  )
}

export function requireCommitText(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
}

export function upsertCommitEntity<T extends IdentifiedEntity>(items: T[], item: T): T[] {
  const exists = items.some((current) => current.id === item.id)
  return exists ? items.map((current) => (current.id === item.id ? item : current)) : [item, ...items]
}

export function upsertCommitEntities<T extends IdentifiedEntity>(items: T[], nextItems: T[] = []): T[] {
  return nextItems.reduce((next, item) => upsertCommitEntity(next, item), items)
}

export function assertProjectScope(entity: ProjectScopedEntity, projectId: ID, label: string): void {
  if (entity.projectId !== projectId) {
    throw new Error(`${label} ${entity.id} projectId mismatch.`)
  }
}

export function assertNoCrossProjectIdCollision<T extends ProjectScopedEntity>(
  existingItems: T[],
  incomingItems: readonly T[] | undefined,
  label: string
): void {
  for (const incoming of incomingItems ?? []) {
    const existing = existingItems.find((item) => item.id === incoming.id)
    if (existing && existing.projectId !== incoming.projectId) {
      throw new Error(`${label} ${incoming.id} would overwrite another project.`)
    }
  }
}

export function assertImmutableCommit<T extends IdentifiedEntity>(
  existing: T | null | undefined,
  incoming: T,
  label: string
): void {
  if (!existing) return
  const existingJson = JSON.stringify(sortForStableJson(existing))
  const incomingJson = JSON.stringify(sortForStableJson(incoming))
  if (existingJson !== incomingJson) {
    throw new Error(`${label} ${incoming.id} is immutable and cannot be replaced with different content.`)
  }
}
