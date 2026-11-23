import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentMcp } from './utils/build-agent-mcp.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
await buildAgentMcp(root, join(root, 'out', 'agent', 'server.mjs'), { cache: false })
