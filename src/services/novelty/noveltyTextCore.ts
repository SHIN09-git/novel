export function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => keyword && text.includes(keyword))
}

export function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　"'“”‘’`·,，.。;；:：、!?！？()[\]（）【】《》<>]/g, '')
    .trim()
}

export function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[、，,；;\n。]/).map((item) => item.trim()).filter(Boolean)
  return []
}

export function nearby(text: string, index: number, radius = 90): string {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + radius)).trim()
}
