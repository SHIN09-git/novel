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
  // The transport diagnoses known causes separately. A raw nested message or URL can contain credentials.
  if (error instanceof SyntaxError) return '无法解析 JSON 响应，请检查服务地址与接口格式。'
  return redactSensitiveText(getUserFriendlyError(error).replace(/\b[a-z][\w+.-]{0,31}:\/\/[^\s"'<>]+/gi, '[地址已隐藏]'))
}

export function redactSensitiveText(text: string, secrets: Array<string | undefined | null> = []): string {
  let sanitized = text
  for (const secret of secrets) {
    const trimmed = secret?.trim()
    if (trimmed) sanitized = sanitized.split(trimmed).join('[REDACTED]')
  }
  return sanitized
    .replace(/\b([a-z][\w+.-]{0,31}:\/\/)[^/\s?#"'<>]*@/gi, '$1[REDACTED]@')
    .replace(/(Authorization["']?\s*:\s*["']?Basic\s+)[A-Za-z0-9+/=_-]+/gi, '$1[REDACTED]')
    .replace(/"api[_-]?key"\s*:\s*"[^"]+"/gi, '"apiKey":"[REDACTED]"')
    .replace(/Authorization\s*:\s*Bearer\s+[^\s"',;]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, 'sk-ant-[REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|x-api-key|access[_-]?token|token)\s*=)\s*["']?[^"',\s;&]+["']?/gi, '$1[REDACTED]')
    .replace(/((?:x-api-key|api-key|access-token|token)\s*:)\s*["']?[^"',\s;]+["']?/gi, '$1 [REDACTED]')
}

export function logSafeError(context: string, error: unknown, secrets: Array<string | undefined | null> = []): void {
  const message = redactSensitiveText(getUserFriendlyError(error), secrets).slice(0, 800)
  console.warn(`${context}: ${message}`)
}
