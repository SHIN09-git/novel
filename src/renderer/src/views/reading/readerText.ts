export interface ReaderBodySegment {
  id: string
  text: string
  start: number
  end: number
}

export interface ReaderTextRange {
  start: number
  end: number
  text: string
}

export function splitReaderBody(body: string): ReaderBodySegment[] {
  const trimmed = body.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/\n{2,}/)
  let cursor = body.indexOf(parts[0])
  return parts.map((part, index) => {
    const start = body.indexOf(part, Math.max(0, cursor))
    const safeStart = start >= 0 ? start : Math.max(0, cursor)
    const end = safeStart + part.length
    cursor = end
    return {
      id: `${index}-${safeStart}`,
      text: part,
      start: safeStart,
      end
    }
  })
}

function closestSegment(node: Node | null): HTMLElement | null {
  if (!node) return null
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement
  return element?.closest<HTMLElement>('[data-reader-segment-start]') ?? null
}

function textOffsetWithin(element: HTMLElement, node: Node, nodeOffset: number): number {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let offset = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return offset + nodeOffset
    offset += current.textContent?.length ?? 0
    current = walker.nextNode()
  }

  if (node.nodeType === Node.ELEMENT_NODE && element.contains(node)) {
    const target = node as HTMLElement
    const beforeRange = document.createRange()
    beforeRange.selectNodeContents(element)
    beforeRange.setEnd(target, Math.min(nodeOffset, target.childNodes.length))
    return beforeRange.toString().length
  }

  return 0
}

function rangeOffsetForSegment(range: Range, boundary: 'start' | 'end'): number | null {
  const node = boundary === 'start' ? range.startContainer : range.endContainer
  const nodeOffset = boundary === 'start' ? range.startOffset : range.endOffset
  const segment = closestSegment(node)
  if (!segment) return null
  const segmentStart = Number(segment.dataset.readerSegmentStart)
  if (!Number.isFinite(segmentStart)) return null
  return segmentStart + textOffsetWithin(segment, node, nodeOffset)
}

export function readerTextRangeFromSelection(range: Range, body: string, selectedText: string): ReaderTextRange | null {
  let start = rangeOffsetForSegment(range, 'start')
  let end = rangeOffsetForSegment(range, 'end')
  if (start === null || end === null || start === end) {
    const fallbackStart = body.indexOf(selectedText)
    if (fallbackStart < 0) return null
    start = fallbackStart
    end = fallbackStart + selectedText.length
  }
  if (start > end) [start, end] = [end, start]
  return {
    start,
    end,
    text: body.slice(start, end) || selectedText
  }
}

export function currentReaderTextSelection(chapterId: string, body: string): ReaderTextRange | null {
  const selected = window.getSelection()
  if (!selected?.rangeCount || !selected.toString().trim()) return null
  const range = selected.getRangeAt(0)
  const node = range.commonAncestorContainer
  const element = node instanceof Element ? node : node.parentElement
  if (element?.closest<HTMLElement>('[data-reader-chapter-id]')?.dataset.readerChapterId !== chapterId) return null
  return readerTextRangeFromSelection(range, body, selected.toString())
}
