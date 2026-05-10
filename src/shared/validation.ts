export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function validateString(
  value: unknown,
  fieldName: string,
  options: { minLength?: number; maxLength?: number; pattern?: RegExp; trim?: boolean } = {}
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${fieldName} must be a string.`)
  }

  const shouldTrim = options.trim ?? true
  const trimmed = shouldTrim ? value.trim() : value
  if (options.minLength !== undefined && trimmed.length < options.minLength) {
    throw new ValidationError(`${fieldName} must be at least ${options.minLength} characters.`)
  }
  if (options.maxLength !== undefined && trimmed.length > options.maxLength) {
    throw new ValidationError(`${fieldName} must be no more than ${options.maxLength} characters.`)
  }
  if (options.pattern && !options.pattern.test(trimmed)) {
    throw new ValidationError(`${fieldName} has an invalid format.`)
  }

  return trimmed
}

export function validateNumber(
  value: unknown,
  fieldName: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${fieldName} must be a finite number.`)
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new ValidationError(`${fieldName} must be an integer.`)
  }
  if (options.min !== undefined && value < options.min) {
    throw new ValidationError(`${fieldName} must be at least ${options.min}.`)
  }
  if (options.max !== undefined && value > options.max) {
    throw new ValidationError(`${fieldName} must be no more than ${options.max}.`)
  }
  return value
}

export function validateApiKey(apiKey: unknown): string {
  const key = validateString(apiKey, 'API Key', { minLength: 8, maxLength: 1000 })
  if (/[\u0000-\u001F\u007F\s]/.test(key)) {
    throw new ValidationError('API Key contains invalid whitespace or control characters.')
  }
  return key
}

export function validateUrl(url: unknown, fieldName: string): string {
  const urlString = validateString(url, fieldName, { minLength: 1, maxLength: 2000 }).replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(urlString)
  } catch {
    throw new ValidationError(`${fieldName} must be a valid URL.`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError(`${fieldName} must use HTTP or HTTPS.`)
  }
  return urlString
}

export function validateFilePath(path: unknown, fieldName: string): string {
  const pathString = validateString(path, fieldName, { minLength: 1, maxLength: 1000 })
  if (pathString.includes('\0') || pathString.split(/[\\/]+/).includes('..')) {
    throw new ValidationError(`${fieldName} contains an unsafe path segment.`)
  }
  return pathString
}
