export const TASK_NUMBER = String.raw`(?:\d+(?:\.\d+)?(?:千|万)?|[零〇一二两三四五六七八九十百千万]+)`
export const TASK_CHARACTER_UNIT = String.raw`(?:个)?(?:可见字符|字符|字)`

export function taskNumber(value: string): number {
  const arabic = /^(\d+(?:\.\d+)?)(千|万)?$/u.exec(value)
  if (arabic) return Number(arabic[1]) * (arabic[2] === '万' ? 10000 : arabic[2] === '千' ? 1000 : 1)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 }
  let total = 0
  let section = 0
  let digit = 0
  for (const char of value) {
    if (char in digits) digit = digits[char]
    else if (char === '万') { total += (section + digit || 1) * 10000; section = 0; digit = 0 }
    else if (char in units) { section += (digit || 1) * units[char]; digit = 0 }
    else return NaN
  }
  return total + section + digit
}

export const visibleCharacterCount = (value: string) => [...value.replace(/\s/gu, '')].length

export function countOccurrences(value: string, phrase: string): number {
  if (!phrase) return 0
  let count = 0
  let offset = 0
  while ((offset = value.indexOf(phrase, offset)) >= 0) { count += 1; offset += phrase.length }
  return count
}

export interface TaskQuote { phrase: string; start: number; end: number }

export function taskQuotes(value: string): TaskQuote[] {
  const pairs: Record<string, string> = { '“': '”', '「': '」', '『': '』', '‘': '’', '"': '"' }
  const stack: string[] = []
  const quotes: TaskQuote[] = []
  let start = -1
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (stack.length && char === stack[stack.length - 1]) {
      stack.pop()
      if (!stack.length) quotes.push({ phrase: value.slice(start + 1, index), start, end: index + 1 })
    } else if (pairs[char]) {
      if (!stack.length) start = index
      stack.push(pairs[char])
    }
  }
  return quotes
}

export function maskTaskQuotes(value: string): string {
  const chars = value.split('')
  for (const quote of taskQuotes(value)) chars.fill(' ', quote.start, quote.end)
  return chars.join('')
}

export function taskClauses(value: string): string[] {
  const masked = maskTaskQuotes(value)
  const clauses: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (/[。；;\r\n]/u.test(masked[index])) { clauses.push(value.slice(start, index)); start = index + 1 }
  }
  clauses.push(value.slice(start))
  return clauses.filter((clause) => clause.trim())
}

// Only explicit instructions bind. Quoted examples, negated instructions and suggestions do not.
export function nonBindingTaskContext(prefix: string): boolean {
  const instruction = prefix.split(/[。；;\r\n]/u).at(-1)?.replace(/\s/gu, '') ?? ''
  const localContext = instruction.split(/[，,]/u).at(-1) ?? ''
  const uncertainInstruction = /^(?:(?:如果|若|假如|倘若|视情况|视节奏|视篇幅|原则上|酌情|建议|可考虑|可以考虑|尽量|尽可能|最好|优先|作为建议)(?:[^，,]*[，,])?)/u
  return uncertainInstruction.test(instruction) ||
    /(?:无需|无须|不必|不用|不需要|不要求|不限制|并非|不是|取消|不只|不止|不能只|不要只|示例|例如|举例|假设|如果|若|曾说|曾要求|写着|描述|讨论|提到|建议|可考虑|可以考虑|尽量|尽可能|最好|优先|原则上|酌情|视情况|大约|约)[^，,。；;]*$/u.test(localContext) ||
    /(?:不|未|没)$/u.test(localContext)
}

export function amountRange(mode: string, amount: number): [number, number | null] {
  if (/至少|最少|不少于|不得少于|不低于|以上/u.test(mode)) return [amount, null]
  if (/最多|至多|不超过|不得超过|不能超过|以内|以下/u.test(mode)) return [0, amount]
  return [amount, amount]
}
