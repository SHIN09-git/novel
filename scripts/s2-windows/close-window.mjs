import assert from 'node:assert/strict'
import { once } from 'node:events'
import { evaluate } from '../utils/qa-agent-authorization-driver.mjs'

export async function closeInstalledWindow(session) {
  const { child, client } = session
  assert.equal(child.exitCode, null, 'Installed product exited before the close request')
  // Ask the actual window to close, then await the OS exit event before hashing/copying SQLite.
  const [[code, signal]] = await Promise.all([
    once(child, 'exit', { signal: AbortSignal.timeout(30000) }),
    evaluate(client, 'setTimeout(() => window.close(), 50); true')
  ])
  assert.equal(signal, null, 'Installed product was terminated by a signal')
  assert.equal(code, 0, 'Installed product did not exit cleanly')
  return { code, signal }
}
