import { randomUUID } from 'node:crypto'
import { open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import {
  AGENT_GRANT_ACTIONS,
  type AgentAuthorizationRequest,
  type AgentGrantAction,
  type AgentProjectGrant,
  type AgentProjectGrantInput
} from '../../shared/types/agentAuthorization'
import { withJsonWriteLock } from '../../storage/jsonWriteLock'

export type { AgentAuthorizationRequest } from '../../shared/types/agentAuthorization'
export const AGENT_AUTHORITY_FILE_NAME = 'agent-authorizations.json'

export class AgentAuthorizationError extends Error {
  constructor(
    readonly code: 'AGENT_AUTHORIZATION_REQUIRED' | 'AGENT_AUTHORIZATION_INVALID_INPUT' | 'AGENT_AUTHORITY_INVALID',
    message: string
  ) {
    super(message)
    this.name = 'AgentAuthorizationError'
  }
}

interface AuthorityFile {
  schemaVersion: 1
  grants: AgentProjectGrant[]
}

interface ResolvedRequest {
  storagePath: string
  projectId: string
  actions: AgentGrantAction[]
  orders: number[]
}

function invalidInput(message: string): never {
  throw new AgentAuthorizationError('AGENT_AUTHORIZATION_INVALID_INPUT', message)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('\0')
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function validActions(value: unknown): value is AgentGrantAction[] {
  return Array.isArray(value) && value.length > 0 && value.length <= AGENT_GRANT_ACTIONS.length &&
    [...value].every((action) => AGENT_GRANT_ACTIONS.includes(action)) && new Set(value).size === value.length
}

function validRange(start: unknown, end: unknown): boolean {
  return (start === null || positiveInteger(start)) && (end === null || positiveInteger(end)) &&
    (start === null || end === null || (start as number) <= (end as number))
}

function canonicalSpelling(path: string): string {
  const normalized = normalize(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function assertAbsolutePath(path: unknown): asserts path is string {
  if (!nonempty(path) || !isAbsolute(path)) invalidInput('An absolute local path is required.')
}

// Resolve aliases/junctions without initializing a database or userData directory.
async function canonicalPath(path: string): Promise<string> {
  assertAbsolutePath(path)
  try {
    return canonicalSpelling(await realpath(path))
  } catch (error) {
    if (!record(error) || error.code !== 'ENOENT') throw error
    const parent = dirname(path)
    if (parent === path) throw error
    return canonicalSpelling(join(await canonicalPath(parent), basename(path)))
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
}

function validGrant(value: unknown): value is AgentProjectGrant {
  if (!record(value)) return false
  return nonempty(value.id) && nonempty(value.projectId) && nonempty(value.storagePath) &&
    isAbsolute(value.storagePath) && canonicalSpelling(value.storagePath) === value.storagePath &&
    validActions(value.actions) && validRange(value.chapterStart, value.chapterEnd) &&
    value.grantedBy === 'user' && value.source === 'author-ui' &&
    validTimestamp(value.createdAt) && validTimestamp(value.updatedAt) && value.updatedAt >= value.createdAt &&
    ((value.status === 'active' && value.revokedAt === null) ||
      (value.status === 'revoked' && validTimestamp(value.revokedAt) &&
        value.revokedAt >= value.createdAt && value.revokedAt === value.updatedAt))
}

function cloneGrant(grant: AgentProjectGrant): AgentProjectGrant {
  return { ...grant, actions: [...grant.actions] }
}

function matchGrant(data: AuthorityFile, scope: ResolvedRequest): AgentProjectGrant | null {
  const grant = data.grants.find((item) => {
    if (item.status !== 'active' || item.storagePath !== scope.storagePath || item.projectId !== scope.projectId ||
      !scope.actions.every((action) => item.actions.includes(action))) return false
    if (scope.orders.length === 0) return item.chapterStart === null && item.chapterEnd === null
    return scope.orders.every((order) => (item.chapterStart === null || order >= item.chapterStart) &&
      (item.chapterEnd === null || order <= item.chapterEnd))
  })
  return grant ? cloneGrant(grant) : null
}

/**
 * userData selects a local profile (desktop host or explicit CLI selection), not
 * imported AppData. grant/revoke are trusted main-IPC entry points, not MCP tools.
 * Actor/confirm is not proof of consent. Local OS users can edit profile files;
 * this separates application authority from project data, not OS permissions.
 */
export class AgentAuthorizationService {
  private readonly userDataPath: string

  constructor(userDataPath: string) {
    assertAbsolutePath(userDataPath)
    this.userDataPath = userDataPath
  }

  private async authorityPath(): Promise<string> {
    return join(await canonicalPath(this.userDataPath), AGENT_AUTHORITY_FILE_NAME)
  }

  private async scope(storagePath: string, projectId: string): Promise<{ storagePath: string; projectId: string }> {
    if (!nonempty(projectId)) invalidInput('A projectId is required.')
    const path = await canonicalPath(storagePath)
    if (path === await this.authorityPath()) invalidInput('The authority file cannot be a project database.')
    return { storagePath: path, projectId }
  }

  private async resolveRequest(request: AgentAuthorizationRequest): Promise<ResolvedRequest> {
    if (!record(request) || !validActions(request.actions)) invalidInput('At least one known, unique action is required.')
    const { chapterOrder, chapterOrders } = request
    if (chapterOrder != null && !positiveInteger(chapterOrder)) invalidInput('chapterOrder must be a positive integer.')
    if (chapterOrders != null && (!Array.isArray(chapterOrders) || chapterOrders.length === 0 ||
      ![...chapterOrders].every(positiveInteger))) invalidInput('chapterOrders must be a nonempty array of positive integers.')
    const orders = [...(chapterOrders ?? []), ...(chapterOrder == null ? [] : [chapterOrder])]
    const actions = [...request.actions]
    return { ...await this.scope(request.storagePath, request.projectId), actions, orders }
  }

  private async readAuthority(path: string): Promise<AuthorityFile> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if (record(error) && error.code === 'ENOENT') return { schemaVersion: 1, grants: [] }
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new AgentAuthorizationError('AGENT_AUTHORITY_INVALID', 'The local authorization file is not valid JSON.')
    }
    // Reject the entire store, including duplicate IDs; never repair/reactivate implicitly.
    if (!record(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.grants) ||
      !parsed.grants.every(validGrant) || new Set(parsed.grants.map((grant) => grant.id)).size !== parsed.grants.length) {
      throw new AgentAuthorizationError('AGENT_AUTHORITY_INVALID', 'The local authorization file has invalid records.')
    }
    return { schemaVersion: 1, grants: parsed.grants }
  }

  private async writeAuthority(path: string, data: AuthorityFile): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`
    const handle = await open(temporary, 'wx', 0o600)
    try {
      try {
        await handle.writeFile(JSON.stringify(data, null, 2), 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!record(error) || error.code !== 'ENOENT') throw error
      })
    }
  }

  /** Read-only snapshot including revoked grants, never a gate for a later save. */
  async list(storagePath: string, projectId: string): Promise<AgentProjectGrant[]> {
    const scope = await this.scope(storagePath, projectId)
    const data = await this.readAuthority(await this.authorityPath())
    return data.grants.filter((grant) => grant.storagePath === scope.storagePath && grant.projectId === scope.projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(cloneGrant)
  }

  /** Preview only. No file initialization, locks, or writes; execution must recheck. */
  async findGrant(request: AgentAuthorizationRequest): Promise<AgentProjectGrant | null> {
    const scope = await this.resolveRequest(request)
    return matchGrant(await this.readAuthority(await this.authorityPath()), scope)
  }

  /** Trusted main IPC only, after explicit user consent. Never expose as an Agent tool. */
  async grant(input: AgentProjectGrantInput): Promise<AgentProjectGrant> {
    if (!record(input) || !validActions(input.actions)) invalidInput('At least one known, unique action is required.')
    const chapterStart = input.chapterStart === undefined ? null : input.chapterStart
    const chapterEnd = input.chapterEnd === undefined ? null : input.chapterEnd
    if (!validRange(chapterStart, chapterEnd)) invalidInput('Chapter bounds must be positive integers in ascending order.')
    const actions = [...input.actions]
    const scope = await this.scope(input.storagePath, input.projectId)
    const path = await this.authorityPath()
    return withJsonWriteLock(path, async () => {
      const data = await this.readAuthority(path)
      const now = new Date().toISOString()
      const grant: AgentProjectGrant = {
        id: randomUUID(), ...scope, actions, chapterStart, chapterEnd, source: 'author-ui',
        status: 'active', createdAt: now, updatedAt: now, revokedAt: null, grantedBy: 'user'
      }
      data.grants.push(grant)
      await this.writeAuthority(path, data)
      return cloneGrant(grant)
    })
  }

  /** Scoped and idempotent. A missing/out-of-scope ID returns null without writing. */
  async revoke(id: string, storagePath: string, projectId: string): Promise<AgentProjectGrant | null> {
    if (!nonempty(id)) invalidInput('A grant id is required.')
    const scope = await this.scope(storagePath, projectId)
    const path = await this.authorityPath()
    return withJsonWriteLock(path, async () => {
      const data = await this.readAuthority(path)
      const grant = data.grants.find((item) => item.id === id &&
        item.storagePath === scope.storagePath && item.projectId === scope.projectId)
      if (!grant) return null
      if (grant.status === 'active') {
        grant.status = 'revoked'
        grant.updatedAt = new Date(Math.max(Date.now(), Date.parse(grant.updatedAt))).toISOString()
        grant.revokedAt = grant.updatedAt
        await this.writeAuthority(path, data)
      }
      return cloneGrant(grant)
    })
  }

  /**
   * Hold the authority lock through the awaited short transactional save. Run
   * AI/network work beforehand. Acquire authority BEFORE database locks; do not
   * nest grant/revoke/withAuthorization. Derive actions and ALL chapter orders
   * from actual server-side write targets, not caller actor/confirm fields.
   * Global world edits must omit chapter scope. Never default a missing order to 1.
   */
  async withAuthorization<T>(
    request: AgentAuthorizationRequest,
    operation: (grant: AgentProjectGrant) => Promise<T> | T
  ): Promise<T> {
    if (typeof operation !== 'function') invalidInput('An authorized save callback is required.')
    const scope = await this.resolveRequest(request)
    const path = await this.authorityPath()
    return withJsonWriteLock(path, async () => {
      const grant = matchGrant(await this.readAuthority(path), scope)
      if (!grant) throw new AgentAuthorizationError('AGENT_AUTHORIZATION_REQUIRED', 'An active user grant covering this operation is required.')
      return await operation(grant)
    })
  }
}
