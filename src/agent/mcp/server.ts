#!/usr/bin/env node
import { AgentToolService } from '../tools/AgentToolService'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

let buffer = Buffer.alloc(0)

function writeMessage(message: JsonRpcResponse): void {
  const body = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`
  process.stdout.write(header + body)
}

function writeLineMessage(message: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function errorResponse(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message }
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!request.method) return errorResponse(request.id, -32600, 'Missing JSON-RPC method.')
  if (request.id === undefined && request.method.startsWith('notifications/')) return null

  try {
    switch (request.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'novel-director-agent-tools',
              version: '0.1.0'
            }
          }
        }
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: {
            tools: AgentToolService.listTools().map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema
            }))
          }
        }
      case 'tools/call': {
        const params = request.params && typeof request.params === 'object' ? request.params as Record<string, unknown> : {}
        const name = typeof params.name === 'string' ? params.name : ''
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
        if (!name) return errorResponse(request.id, -32602, 'Missing tool name.')
        const result = await AgentToolService.callTool({ name, arguments: args })
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ],
            structuredContent: result,
            isError: false
          }
        }
      }
      case 'agent/listTools':
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: AgentToolService.listTools()
        }
      case 'agent/callTool': {
        const params = request.params && typeof request.params === 'object' ? request.params as Record<string, unknown> : {}
        const name = typeof params.name === 'string' ? params.name : ''
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {}
        if (!name) return errorResponse(request.id, -32602, 'Missing tool name.')
        return {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: await AgentToolService.callTool({ name, arguments: args })
        }
      }
      default:
        return errorResponse(request.id, -32601, `Unknown method: ${request.method}`)
    }
  } catch (error) {
    return errorResponse(request.id, -32000, error instanceof Error ? error.message : String(error))
  }
}

function handleLineMessage(line: string): void {
  if (!line.trim()) return
  let request: JsonRpcRequest
  try {
    request = JSON.parse(line) as JsonRpcRequest
  } catch {
    writeLineMessage(errorResponse(null, -32700, 'Invalid JSON-RPC message.'))
    return
  }
  void handleRequest(request)
    .then((response) => {
      if (response) writeLineMessage(response)
    })
    .catch((error) => {
      writeLineMessage(errorResponse(request.id, -32000, error instanceof Error ? error.message : String(error)))
    })
}

function handleFramedMessage(body: string): void {
  let request: JsonRpcRequest
  try {
    request = JSON.parse(body) as JsonRpcRequest
  } catch {
    writeMessage(errorResponse(null, -32700, 'Invalid JSON-RPC message.'))
    return
  }
  void handleRequest(request)
    .then((response) => {
      if (response) writeMessage(response)
    })
    .catch((error) => {
      writeMessage(errorResponse(request.id, -32000, error instanceof Error ? error.message : String(error)))
    })
}

function consumeBuffer(): void {
  while (buffer.length > 0) {
    const text = buffer.toString('utf-8')
    if (!text.startsWith('Content-Length:')) {
      const lineEnd = text.indexOf('\n')
      if (lineEnd < 0) return
      const line = text.slice(0, lineEnd).trim()
      buffer = buffer.subarray(Buffer.byteLength(text.slice(0, lineEnd + 1), 'utf-8'))
      handleLineMessage(line)
      continue
    }

    const headerEnd = text.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const header = text.slice(0, headerEnd)
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    if (!match) {
      buffer = Buffer.alloc(0)
      writeMessage(errorResponse(null, -32700, 'Invalid Content-Length header.'))
      return
    }
    const length = Number.parseInt(match[1], 10)
    const bodyStart = headerEnd + 4
    const totalLength = Buffer.byteLength(text.slice(0, bodyStart), 'utf-8') + length
    if (buffer.length < totalLength) return
    const body = buffer.subarray(Buffer.byteLength(text.slice(0, bodyStart), 'utf-8'), totalLength).toString('utf-8')
    buffer = buffer.subarray(totalLength)
    handleFramedMessage(body)
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk])
  try {
    consumeBuffer()
  } catch (error) {
    writeMessage(errorResponse(null, -32000, error instanceof Error ? error.message : String(error)))
  }
})

process.stdin.resume()
