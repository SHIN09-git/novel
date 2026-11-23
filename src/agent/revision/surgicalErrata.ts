/** One bounded interior edit; the limit chooses review scope, never determines whether it passes. */
export function surgicalErrata(before: string, after: string) {
  let start = 0, oldEnd = before.length, newEnd = after.length
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd-- }
  const old = before.slice(start, oldEnd), replacement = after.slice(start, newEnd)
  if ((!old && !replacement) || Math.max(old.length, replacement.length) > 120 || /[\r\n]/.test(old + replacement) ||
    start < 120 || before.length - oldEnd < 120 ||
    (before.trim().includes('\n') && (!before.slice(0, start).trimStart().includes('\n') || !before.slice(oldEnd).trimEnd().includes('\n')))) {
    throw new Error('局部勘误只适用于章中一处短改，且不能更动开头或结尾；请改用 full 全章审稿。')
  }
  const left = before.slice(Math.max(0, start - 90), start), right = before.slice(oldEnd, oldEnd + 90)
  return { start, old, replacement, beforeExcerpt: left + old + right, afterExcerpt: left + replacement + right }
}

/** Only mirror a unique verbatim passage, never generate or reinterpret a synopsis. */
export function summaryErratum(before: string, after: string, summary: string) {
  const edit = surgicalErrata(before, after)
  if (!edit.old || !summary) return null
  const boundary = /[，。；：！？\n\r]/u
  if (boundary.test(edit.old)) return null
  let left = edit.start, right = edit.start + edit.old.length
  while (left && !boundary.test(before[left - 1])) left--
  while (right < before.length && !boundary.test(before[right])) right++
  const clause = before.slice(left, right)
  if (clause.trim().length < 4 || before.indexOf(clause) !== before.lastIndexOf(clause)) return null
  const anchor = summary.indexOf(clause)
  if (anchor < 0 || anchor !== summary.lastIndexOf(clause)) return null
  const at = anchor + edit.start - left
  return { before: summary, after: summary.slice(0, at) + edit.replacement + summary.slice(at + edit.old.length) }
}
