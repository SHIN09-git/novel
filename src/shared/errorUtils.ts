export function getUserFriendlyError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return '操作失败，请稍后重试。'
}

export function isNetworkError(error: unknown): boolean {
  const message = getUserFriendlyError(error).toLowerCase()
  return /network|fetch|timeout|econn|enotfound|socket|dns|tls/.test(message)
}

export function isApiKeyMissingError(error: unknown): boolean {
  return /api\s*key|apikey|authorization|unauthorized|401|未配置/.test(getUserFriendlyError(error).toLowerCase())
}

export function isJsonParseError(error: unknown): boolean {
  return /json|parse|解析/.test(getUserFriendlyError(error).toLowerCase())
}

export function describeNetworkError(error: unknown): string {
  if (!(error instanceof Error)) return getUserFriendlyError(error)

  const parts = [error.message]
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const causeRecord = cause as Record<string, unknown>
    const causeMessage = typeof causeRecord.message === 'string' ? causeRecord.message : ''
    const detailKeys = ['code', 'errno', 'syscall', 'hostname', 'host', 'port']
    const details = detailKeys
      .map((key) => {
        const value = causeRecord[key]
        return value === undefined || value === null || value === '' ? '' : `${key}=${String(value)}`
      })
      .filter(Boolean)

    if (causeMessage && !parts.includes(causeMessage)) parts.push(causeMessage)
    if (details.length) parts.push(details.join(', '))
  }

  return parts.filter(Boolean).join('；')
}

export function redactSensitiveText(text: string, secrets: Array<string | undefined | null> = []): string {
  let sanitized = text
  for (const secret of secrets) {
    const trimmed = secret?.trim()
    if (trimmed) sanitized = sanitized.split(trimmed).join('[REDACTED]')
  }
  return sanitized
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
}

export function logSafeError(context: string, error: unknown, secrets: Array<string | undefined | null> = []): void {
  const message = redactSensitiveText(getUserFriendlyError(error), secrets).slice(0, 800)
  console.warn(`${context}: ${message}`)
}
