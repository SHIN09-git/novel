import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'

type ExecutionState = 'active' | 'stopped' | 'untracked'

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

async function scope(storagePath: string, jobId: string) {
  const path = await realpath(storagePath)
  const canonical = process.platform === 'win32' ? path.toLowerCase() : path
  return {
    directory: join(dirname(path), '.novel-director-agent-execution'),
    prefix: createHash('sha256').update(canonical).update('\0').update(jobId).digest('hex') + '.'
  }
}

async function tickets({ directory, prefix }: Awaited<ReturnType<typeof scope>>) {
  const names = await readdir(directory).catch((error: unknown) => {
    if (missing(error)) return []
    throw error
  })
  return names.flatMap(name => {
    const match = name.startsWith(prefix) && /^(\d+)\.[0-9a-f-]{36}\.claim$/.exec(name.slice(prefix.length))
    const pid = match ? Number(match[1]) : 0
    return Number.isInteger(pid) && pid > 0 && pid <= 0x7fffffff ? [{ name, pid }] : []
  })
}

function processAlive(pid: number): boolean {
  if (pid === process.pid) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

export async function readAgentJobExecution(storagePath: string | null | undefined, jobId: string): Promise<ExecutionState> {
  if (!storagePath) return 'untracked'
  try {
    const entries = await tickets(await scope(storagePath, jobId))
    return entries.some(entry => processAlive(entry.pid)) ? 'active' : entries.length ? 'stopped' : 'untracked'
  } catch (error) {
    if (missing(error)) return 'untracked'
    throw error
  }
}

export class AgentJobAlreadyExecuting extends Error {
  readonly code = 'AGENT_JOB_ALREADY_EXECUTING'
  constructor() { super('该章节任务已有执行者，请查看进度，不要重复生成。') }
}

export async function claimAgentJobExecution(storagePath: string, jobId: string): Promise<() => Promise<void>> {
  const slot = await scope(storagePath, jobId)
  await mkdir(slot.directory, { recursive: true })
  const name = `${slot.prefix}${process.pid}.${randomUUID()}.claim`
  const file = join(slot.directory, name)
  const remove = (path: string) => unlink(path).catch((error: unknown) => { if (!missing(error)) throw error })
  await (await open(file, 'wx')).close()
  try {
    // Publish before scanning: two live claimants cannot both see themselves
    // as the only one. Unique filenames make dead-owner cleanup race-free.
    const peers = (await tickets(slot)).filter(entry => entry.name !== name)
    if (peers.some(entry => processAlive(entry.pid))) throw new AgentJobAlreadyExecuting()
    for (const peer of peers) await remove(join(slot.directory, peer.name))
    return () => remove(file)
  } catch (error) {
    await remove(file)
    throw error
  }
}
