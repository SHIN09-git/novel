import { mkdir, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

// Covers every JSON writer, including separate desktop and Agent processes.
// We never steal an existing lock: a timed-out writer may still be committing.
export async function withJsonWriteLock<T>(storagePath: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(storagePath), { recursive: true })
  const lockPath = `${storagePath}.write-lock`
  const deadline = Date.now() + 5_000
  let handle: Awaited<ReturnType<typeof open>>
  for (;;) {
    try {
      handle = await open(lockPath, 'wx')
      break
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error
      if (Date.now() >= deadline) {
        throw new Error('本地 JSON 数据正在被另一进程写入，请稍后重试。若程序曾意外退出，请关闭所有工作台和 Agent 后清理数据文件旁的 .write-lock 文件。')
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
    return await operation()
  } finally {
    await handle.close()
    await unlink(lockPath)
  }
}
