// Splits the document into small groups of pages ("chunks") for the detail pass. Small chunks
// keep each answer short enough to finish reliably, let several run at once, and keep Haiku in
// its cheaper price tier (prompts under 100k tokens).
//
// Each chunk also carries the page just before it as read-only context, because an item near
// the top of a page often continues from the previous one. Claude is told not to extract from
// that context page, and merge.ts removes any duplicates that slip through.

import type { CleanPage } from '../pdf/cleanText'
import { toPromptText } from '../pdf/cleanText'

export interface Chunk {
  index: number
  /** Pages to extract from. */
  extractPages: number[]
  /** The page shown for context only (the one before the chunk), if any. */
  contextPages: number[]
  /** The text sent to Claude: context page first, then the pages to extract. */
  text: string
}

/** About 6,000 tokens of text per chunk. */
export const DEFAULT_CHUNK_CHARS = 24_000

export function makeChunks(
  pages: CleanPage[],
  options: { skipPages?: Iterable<number>; maxChars?: number } = {},
): Chunk[] {
  const skip = new Set(options.skipPages ?? [])
  const maxChars = options.maxChars ?? DEFAULT_CHUNK_CHARS
  const byNumber = new Map(pages.map((p) => [p.pageNumber, p]))
  const kept = pages.filter((p) => !skip.has(p.pageNumber) && p.text.trim() !== '')

  const groups: CleanPage[][] = []
  let current: CleanPage[] = []
  let size = 0
  for (const page of kept) {
    // Start a new chunk when this page would overflow it, or when pages were skipped in between.
    const previous = current.at(-1)
    const gap = previous !== undefined && page.pageNumber !== previous.pageNumber + 1
    if (current.length > 0 && (size + page.text.length > maxChars || gap)) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(page)
    size += page.text.length
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group, index) => {
    const before = byNumber.get(group[0]!.pageNumber - 1)
    const context =
      before && !skip.has(before.pageNumber) && before.text.trim() !== '' ? [before] : []
    return {
      index,
      extractPages: group.map((p) => p.pageNumber),
      contextPages: context.map((p) => p.pageNumber),
      text: toPromptText([...context, ...group]),
    }
  })
}
