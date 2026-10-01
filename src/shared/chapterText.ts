const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

function parseChineseNumber(input: string): number | null {
  const text = input.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)

  if (!/[十百千万]/.test(text)) {
    let value = 0
    for (const char of text) {
      const digit = CHINESE_DIGITS[char]
      if (digit === undefined) return null
      value = value * 10 + digit
    }
    return value
  }

  let total = 0
  let section = 0
  let number = 0
  const unitMap: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }

  for (const char of text) {
    const digit = CHINESE_DIGITS[char]
    if (digit !== undefined) {
      number = digit
      continue
    }

    const unit = unitMap[char]
    if (!unit) return null
    if (unit === 10000) {
      section = (section + number) * unit
      total += section
      section = 0
    } else {
      section += (number || 1) * unit
    }
    number = 0
  }

  return total + section + number
}

function numberPattern(): string {
  return String.raw`(?:\d+|[零〇一二两三四五六七八九十百千万]+)`
}

function normalizeChapterNumber(value: string): number | null {
  return parseChineseNumber(value.replace(/^第/, '').replace(/章$/, ''))
}

export function parseChapterRangesFromText(text: string): Array<{ start: number; end: number }> {
  const pattern = numberPattern()
  const ranges: Array<{ start: number; end: number }> = []
  const rangeRegex = new RegExp(`第?(${pattern})\\s*(?:-|—|~|到|至)\\s*第?(${pattern})\\s*章?`, 'g')
  for (const match of text.matchAll(rangeRegex)) {
    const start = normalizeChapterNumber(match[1])
    const end = normalizeChapterNumber(match[2])
    if (start !== null && end !== null) {
      ranges.push({ start: Math.min(start, end), end: Math.max(start, end) })
    }
  }
  return ranges
}

export function parseChapterNumbersFromText(text: string): number[] {
  const pattern = numberPattern()
  const numbers = new Set<number>()
  const chapterRegex = new RegExp(`第?(${pattern})\\s*章`, 'g')
  for (const match of text.matchAll(chapterRegex)) {
    const value = normalizeChapterNumber(match[1])
    if (value !== null) numbers.add(value)
  }

  for (const range of parseChapterRangesFromText(text)) {
    numbers.add(range.start)
    numbers.add(range.end)
  }

  return [...numbers].sort((a, b) => a - b)
}
