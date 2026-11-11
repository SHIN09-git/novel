export type AiConnectionTransport = 'node-fetch' | 'electron-net' | 'codex-cli' | 'custom-fetch'

interface ConnectionContext {
  transport: AiConnectionTransport
  baseUrl?: string
}

type NetworkKind = 'dns' | 'connect_timeout' | 'read_timeout' | 'read_failure' | 'connection' | 'network'
type DiagnosisKind = NetworkKind | 'total_timeout' | 'authentication' | 'quota_exhausted' | 'rate_limited' |
  'http' | 'cli_process' | 'cli_timeout' | 'cancelled'

interface ConnectionDiagnosis {
  kind: DiagnosisKind
  message: string
}

type Fields = Record<string, unknown>
function fields(value: unknown): Fields {
  return value !== null && typeof value === 'object' ? value as Fields : {}
}

const quotaCodes = new Set([
  'insufficient_quota', 'insufficient_balance', 'insufficient_credits', 'quota_exhausted',
  'balance_not_enough', 'balance_exhausted', 'credits_exhausted', 'out_of_credits',
  'credit_balance_too_low', 'billing_hard_limit_reached'
])

// Only machine-readable fields qualify. "quota" in a message can just mean tokens per minute.
export function readQuotaCode(status: number, responseText: string): string | undefined {
  if ((status !== 402 && status !== 429) || responseText.length > 64 * 1024) return undefined
  try {
    const root = fields(JSON.parse(responseText))
    const error = fields(root.error)
    for (const value of [error.code, error.type, root.code, root.type]) {
      if (typeof value !== 'string' || value.length > 64) continue
      const code = value.trim().replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()
      if (quotaCodes.has(code)) return code
    }
  } catch {
    // Empty, HTML and malformed error bodies carry no reliable quota evidence.
  }
  return undefined
}

const networkKinds = new Map<string, NetworkKind>([
  ['ENOTFOUND', 'dns'], ['EAI_AGAIN', 'dns'], ['ERR_NAME_NOT_RESOLVED', 'dns'],
  ['ERR_NAME_RESOLUTION_FAILED', 'dns'], ['ERR_DNS_TIMED_OUT', 'dns'],
  ['UND_ERR_CONNECT_TIMEOUT', 'connect_timeout'], ['ERR_CONNECTION_TIMED_OUT', 'connect_timeout'],
  ['UND_ERR_HEADERS_TIMEOUT', 'read_timeout'], ['UND_ERR_BODY_TIMEOUT', 'read_timeout'],
  ['ECONNRESET', 'connection'], ['ECONNREFUSED', 'connection'], ['EHOSTUNREACH', 'connection'],
  ['ENETUNREACH', 'connection'], ['UND_ERR_SOCKET', 'connection'], ['ERR_CONNECTION_RESET', 'connection'],
  ['ERR_CONNECTION_CLOSED', 'connection'], ['ERR_CONNECTION_REFUSED', 'connection'],
  ['ERR_CONNECTION_ABORTED', 'connection'], ['ERR_EMPTY_RESPONSE', 'connection'],
  ['ERR_ADDRESS_UNREACHABLE', 'connection'], ['ERR_INTERNET_DISCONNECTED', 'connection'],
  ['ERR_PROXY_CONNECTION_FAILED', 'connection'], ['ERR_TUNNEL_CONNECTION_FAILED', 'connection'],
  ['ERR_TIMED_OUT', 'network'], ['ETIMEDOUT', 'network']
])

interface NetworkFailure { kind: NetworkKind; code?: string }

type HttpPhase = 'waiting_headers' | 'reading'

export class AiTransportFailure extends TypeError {
  constructor(error: unknown, readonly phase: HttpPhase) {
    const failure = networkCause(error)
    const syscall = failure?.kind === 'connect_timeout' ? 'connect' : failure?.kind === 'read_timeout' ? 'read' : undefined
    // Even console.error(error) must not print a body fragment, arbitrary stderr or a URL from the original cause.
    super(phase === 'reading' ? '读取 AI 响应正文失败。' : 'fetch failed',
      failure?.code ? { cause: { code: failure.code, syscall } } : undefined)
    this.name = 'AiTransportFailure'
  }
}

function networkCause(error: unknown): NetworkFailure | undefined {
  // fetch wraps OS/Undici failures in TypeError; dual-stack connects can wrap them again in AggregateError.
  const queue: unknown[] = [error]
  const seen = new Set<unknown>()
  let generic: NetworkFailure | undefined
  for (let i = 0; i < queue.length && i < 16; i++) {
    const item = queue[i]
    if (!item || seen.has(item)) continue
    seen.add(item)
    const e = fields(item)
    const message = typeof item === 'string' ? item : typeof e.message === 'string' ? e.message : ''
    const reported = typeof e.code === 'string' ? e.code.replace(/^net::/, '') : ''
    const chromium = /^net::(ERR_[A-Z0-9_]+)\b/.exec(message)?.[1]
    for (const code of [reported, chromium]) {
      if (!code) continue
      if (code === 'ETIMEDOUT' && (e.syscall === 'connect' || /^connect ETIMEDOUT\b/.test(message))) {
        return { kind: 'connect_timeout', code }
      }
      if (code === 'ETIMEDOUT' && e.syscall === 'read') return { kind: 'read_timeout', code }
      const kind = networkKinds.get(code)
      if (kind && kind !== 'network') return { kind, code }
      if (kind) generic = { kind, code }
    }
    if (!generic && (chromium || /^(fetch failed|failed to fetch|network error|socket hang up|failed to parse URL|request cannot be constructed from a URL)/i.test(message))) {
      generic = { kind: 'network' }
    }
    if (e.cause) queue.push(e.cause)
    if (Array.isArray(e.errors)) queue.push(...e.errors.slice(0, 8))
  }
  return generic
}

export function aiNetworkFailure(error: unknown): NetworkFailure | undefined {
  const failure = networkCause(error)
  const e = fields(error)
  if (e.name !== 'AiTransportFailure' || e.phase !== 'reading') return failure
  const timedOut = failure?.kind === 'read_timeout' || failure?.kind === 'connect_timeout' ||
    failure?.code === 'ETIMEDOUT' || failure?.code === 'ERR_TIMED_OUT'
  return { kind: timedOut ? 'read_timeout' : 'read_failure', code: failure?.code }
}

export function supportsNodeFetchEnvProxy(version: string): boolean {
  // Built-in fetch gained the env switch before node:http did on 24.x.
  // https://nodejs.org/en/learn/http/enterprise-network-configuration
  const match = /^v?(\d+)\.(\d+)\./.exec(version)
  return !!match && (Number(match[1]) >= 24 || (Number(match[1]) === 22 && Number(match[2]) >= 21))
}

function proxySwitch(env: NodeJS.ProcessEnv, execArgv: readonly string[]): 'on' | 'off' | 'off-by-flag' {
  // Command-line flags take precedence over NODE_OPTIONS, which in turn overrides the env switch.
  const flags = (env.NODE_OPTIONS ?? '').match(/"[^"]*"|[^\s"]+/g) ?? []
  let setting: 'on' | 'off' | 'off-by-flag' = env.NODE_USE_ENV_PROXY === '1' ? 'on' : 'off'
  for (const flag of [...flags.map(value => value.replace(/^"|"$/g, '')), ...execArgv]) {
    if (flag === '--use-env-proxy') setting = 'on'
    else if (flag === '--no-use-env-proxy') setting = 'off-by-flag'
  }
  return setting
}

function bypassFor(url: URL, noProxy: string): 'yes' | 'no' | 'uncertain' {
  const host = url.hostname.toLowerCase()
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  let uncertain = false
  for (const token of noProxy.toLowerCase().split(/[,\s]+/).filter(Boolean)) {
    if (token === '*') return 'yes'
    const match = /^(.+):(\d+)$/.exec(token)
    if (match && Number(match[2]) !== port) continue
    const rule = match ? match[1] : token
    if (host === rule) return 'yes'
    const suffix = rule.replace(/^\*?\./, '')
    if (rule !== suffix && host.endsWith('.' + suffix)) return 'yes'
    // Bare parent domains, dotted apex names and nonstandard rules vary between bundled Undici versions.
    if (host === suffix || host.endsWith('.' + suffix) || /[*/]/.test(suffix) ||
        host.endsWith('.') || rule.endsWith('.') || /^\d[\d.]*-\d/.test(rule)) uncertain = true
  }
  return uncertain ? 'uncertain' : 'no'
}

export function describeNodeProxy(
  baseUrl: string | undefined,
  version = process.versions.node,
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv
): string {
  let url: URL
  try { url = new URL(baseUrl ?? '') } catch { return '无法判断此地址的环境代理配置。' }
  if (!['http:', 'https:'].includes(url.protocol)) return '无法判断此地址的环境代理配置。'
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY
  const proxy = url.protocol === 'https:' ? (env.https_proxy ?? env.HTTPS_PROXY) || httpProxy : httpProxy
  if (!proxy) return '未配置适用于此地址的环境代理，按配置直连。'
  if (!supportsNodeFetchEnvProxy(version)) return '此版本的内置 fetch 不支持环境代理开关。需要环境代理时请使用 Node.js 22.21 或更新的 22.x，或使用 24 及以上版本。'
  const bypass = bypassFor(url, env.no_proxy ?? env.NO_PROXY ?? '')
  const setting = proxySwitch(env, execArgv)
  if (setting !== 'on') {
    if (bypass === 'yes') return '环境代理未启用；此地址也匹配 NO_PROXY，按配置直连。'
    if (setting === 'off-by-flag') return '启动参数 --no-use-env-proxy 禁用了环境代理，按配置直连。需要使用代理时请调整启动参数。'
    return '已配置代理，但未启用 Node 环境代理，按配置直连。确需代理时可在启动 Node 前设置 NODE_USE_ENV_PROXY=1。'
  }
  if (bypass === 'yes') return '环境代理已启用；此地址匹配 NO_PROXY，按配置绕过代理直连。'
  if (bypass === 'uncertain') return '环境代理已启用；请核对此版本对 NO_PROXY 规则的匹配，未确认此地址是否绕过代理。'
  return '环境代理已启用，此地址按配置使用代理。'
}

const balance = '未查询账户余额，额度未知。'
const cliValidationMessages = new Set([
  'Codex CLI 路径无效。', 'CLI 命令只允许使用 codex，或选择 codex/codex.exe/codex.cmd 的绝对路径。',
  '所选文件不是 Codex CLI 可执行文件。', 'Codex CLI 模型名包含不支持的字符。', 'Codex CLI 参数无效。'
])

function timeLimit(ms: unknown): string {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? `${Math.ceil(ms / 1_000)} 秒` : ''
}

function cliDiagnosis(e: Fields): ConnectionDiagnosis {
  let kind: DiagnosisKind = 'cli_process'
  let reason: string
  switch (e.code) {
    case 'CODEX_CLI_CANCELLED': kind = 'cancelled'; reason = 'Codex CLI 调用已取消。'; break
    case 'CODEX_CLI_TIMEOUT':
      kind = 'cli_timeout'
      reason = timeLimit(e.timeoutMs) ? `Codex CLI 调用超过 ${timeLimit(e.timeoutMs)}，已终止。` : 'Codex CLI 调用超时，已终止。'
      break
    case 'CODEX_CLI_AUTH': kind = 'authentication'; reason = 'Codex CLI 身份验证失败，请在终端运行 codex login status 核对登录状态。'; break
    case 'CODEX_CLI_SPAWN': case 'ENOENT': case 'EACCES': case 'EPERM':
      reason = '无法启动 Codex CLI，请检查安装位置和执行权限。'; break
    case 'CODEX_CLI_OUTPUT_LIMIT': reason = 'Codex CLI 输出过大，已终止。'; break
    case 'CODEX_CLI_EXIT':
      reason = Number.isSafeInteger(e.exitCode) ? `Codex CLI 执行失败（退出码 ${e.exitCode}）。` : 'Codex CLI 已异常退出。'
      break
    default:
      reason = typeof e.message === 'string' && cliValidationMessages.has(e.message) ? e.message : 'Codex CLI 调用失败，请检查本机 CLI 的安装与登录状态。'
  }
  return { kind, message: `${reason} 请求路径：Codex CLI 子进程。${balance}` }
}

export function diagnoseAiConnection(error: unknown, context: ConnectionContext): ConnectionDiagnosis | undefined {
  const e = fields(error)
  const path = context.transport === 'node-fetch' ? `独立 Node.js ${process.versions.node}（内置 fetch）`
    : context.transport === 'electron-net' ? (process.versions.electron ? `桌面 Electron ${process.versions.electron}（Chromium net.fetch）` : 'Electron net.fetch 接口（非 Electron 运行时，未验证桌面网络路径）')
    : context.transport === 'codex-cli' ? 'Codex CLI 子进程' : '自定义 fetch（实际网络路径未知）'
  const report = (kind: DiagnosisKind, reason: string, routing = false): ConnectionDiagnosis => {
    const hint = !routing ? '' : context.transport === 'node-fetch' ? describeNodeProxy(context.baseUrl)
      : context.transport === 'electron-net' && process.versions.electron ? '请检查桌面会话使用的系统或应用代理。' : ''
    return { kind, message: `${reason} 请求路径：${path}。${hint}${balance}` }
  }
  if (e.code === 'AI_REQUEST_CANCELLED') return report('cancelled', '用户已取消 AI 请求。可从最后成功步骤继续重试。')
  if (e.name === 'AbortError') return report('cancelled', 'AI 请求已中止。可从最后成功步骤继续重试。')
  if (context.transport === 'codex-cli') return cliDiagnosis(e)
  if (e.code === 'AI_REQUEST_TIMEOUT') {
    const reading = e.phase === 'reading'
    return report(reading ? 'read_timeout' : 'total_timeout',
      `AI 请求${reading ? '在读取响应时达到' : '超过'} ${timeLimit(e.timeoutMs)}硬超时，已自动终止。可切换模型或从当前步骤重试。`)
  }
  const status = e.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 300 && status <= 599) {
    const http = (kind: DiagnosisKind, reason: string) => report(kind, `HTTP ${status}：${reason}`)
    if (status === 401) return http('authentication', '服务商拒绝了身份验证，请核对该服务地址对应的 API Key。')
    const code = typeof e.quotaCode === 'string' && quotaCodes.has(e.quotaCode) ? e.quotaCode : undefined
    if ((status === 402 || status === 429) && code) return http('quota_exhausted', `服务商报告可用额度不足（${code}）。请到服务商后台核对账单或额度上限。`)
    if (status === 402) return http('quota_exhausted', '服务商要求付款，请核对余额和计费状态；此状态码不能证明余额为零。')
    if (status === 429) return http('rate_limited', '请求被限流，请降低并发或稍后重试。')
    if (status === 403) return http('http', '服务商拒绝访问，请核对模型和账户权限。')
    if (status === 407) return http('http', '代理要求身份验证，请检查代理登录设置。')
    return http('http', status >= 500 ? '服务或网关暂时无法处理请求，请稍后重试。' : '请求未被接受，请核对服务地址、模型和请求参数。')
  }
  const failure = aiNetworkFailure(error)
  if (!failure) return undefined // Application/configuration errors have their own messages.
  const reasons = {
    dns: 'DNS 域名解析失败，请核对服务或代理地址及 DNS 配置。',
    connect_timeout: '建立连接超时，尚未收到响应。请检查网络是否可达。',
    read_timeout: failure.code === 'UND_ERR_HEADERS_TIMEOUT' ? '等待读取响应头超时。' : '读取响应超时，未能按时读完服务端响应。',
    read_failure: '已收到响应头，但未能读完响应正文。',
    connection: '连接失败或中断，请检查服务和网络是否可达。',
    network: /TIMED?_?OUT/.test(failure.code ?? '') ? '网络超时，无法确定发生在连接还是读取阶段。' : '网络请求失败，现有信息不足以确定原因。'
  }
  return report(failure.kind, reasons[failure.kind] + (failure.code ? `（${failure.code}）` : ''),
    failure.kind !== 'read_failure' && failure.kind !== 'read_timeout')
}
