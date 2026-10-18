// The whole extraction, start to finish:
//   1. Outline: one call reads the full text and maps sessions, themes and pages to skip.
//   2. Details: the remaining pages are cut into chunks, and several chunks are sent at once.
//      If an answer gets cut off for being too long, that chunk is split in half and retried.
//   3. Merge: plain code assembles the digest (merge.ts).
//   4. Check: the digest is validated, including the grounding check against the PDF text,
//      and every issue is recorded in the digest's warnings.
//
// The same function runs in the browser and in the evaluation scripts, so the evaluation
// measures exactly what the app does.

import type Anthropic from '@anthropic-ai/sdk'
import { roughTokenCount, toPromptText, type CleanPage } from '../pdf/cleanText'
import { makeChunks, type Chunk } from './chunk'
import {
  CallFailed,
  callStructured,
  countPromptTokens,
  SpendGuard,
  type CallRecord,
} from './claude'
import { mergeDigest, type ChunkResult } from './merge'
import { ChunkOutput, OutlineOutput } from './modelOutput'
import { costOfCall, type Effort, type ModelId } from './pricing'
import { DETAIL_SYSTEM, OUTLINE_SYSTEM, detailUserMessage, outlineUserMessage } from './prompts'
import type { Digest } from './schema'
import { checkDigest, type ValidationIssue } from './validate'

export interface ExtractionDocument {
  fileName: string
  sha256: string | null
  pages: CleanPage[]
}

export interface ExtractionOptions {
  client: Anthropic
  model: ModelId
  effort: Effort
  /** The run stops before any request once this much has been spent. */
  spendLimitUsd: number
  /** How many chunks are sent at the same time. */
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (progress: ExtractionProgress) => void
}

export interface ExtractionProgress {
  stage: 'outline' | 'details' | 'checking'
  done: number
  total: number
  spentUsd: number
}

export interface FailedChunk {
  pages: number[]
  message: string
}

export interface ExtractionResult {
  digest: Digest
  issues: ValidationIssue[]
  calls: CallRecord[]
  failedChunks: FailedChunk[]
  spentUsd: number
  seconds: number
}

const OUTLINE_MAX_TOKENS = 32_000
const DETAIL_MAX_TOKENS = 32_000

export async function runExtraction(
  doc: ExtractionDocument,
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const started = performance.now()
  const { client, model, effort } = options
  // One switch that cancels every request in flight: flipped by the user's Cancel button, or
  // by us when one request hits a stopping problem (spending limit, rejected key).
  const stopper = new AbortController()
  options.signal?.addEventListener('abort', () => stopper.abort())
  const signal = stopper.signal
  const guard = new SpendGuard(options.spendLimitUsd)
  const calls: CallRecord[] = []
  const report = (stage: ExtractionProgress['stage'], done: number, total: number) =>
    options.onProgress?.({ stage, done, total, spentUsd: guard.spentUsd })

  // ---- 1. Outline
  report('outline', 0, 1)
  const outlineCall = await callStructured({
    client,
    model,
    effort,
    system: OUTLINE_SYSTEM,
    user: outlineUserMessage(toPromptText(doc.pages)),
    schema: OutlineOutput,
    maxTokens: OUTLINE_MAX_TOKENS,
    guard,
    label: 'the outline',
    signal,
  })
  calls.push(outlineCall.record)
  const outline = outlineCall.data
  report('outline', 1, 1)

  // ---- 2. Details, a few chunks at a time
  const queue: Chunk[] = makeChunks(doc.pages, { skipPages: outline.skip_pages })
  const results: ChunkResult[] = []
  const failedChunks: FailedChunk[] = []
  let total = queue.length
  let done = 0
  report('details', 0, total)

  const runChunk = async (chunk: Chunk) => {
    const pages = chunk.extractPages
    const label = `pages ${pages[0]}-${pages.at(-1)}`
    try {
      const { data, record } = await callStructured({
        client,
        model,
        effort,
        system: DETAIL_SYSTEM,
        user: detailUserMessage({
          outline,
          chunkText: chunk.text,
          extractPages: chunk.extractPages,
          contextPages: chunk.contextPages,
        }),
        schema: ChunkOutput,
        maxTokens: DETAIL_MAX_TOKENS,
        guard,
        label,
        signal,
      })
      calls.push(record)
      results.push({ chunk, presentations: data.presentations })
    } catch (error) {
      if (!(error instanceof CallFailed)) throw error // spending limit, bad key, cancel: stop everything
      if (error.record) calls.push(error.record)
      if (error.reason === 'cut_off' && pages.length > 1) {
        // Too much for one answer: split the chunk in half and try both halves.
        const pageSet = new Set(pages)
        const halfSize = Math.ceil(chunk.text.length / 2)
        const smaller = makeChunks(
          doc.pages.filter((p) => pageSet.has(p.pageNumber)),
          { maxChars: halfSize },
        )
        queue.push(...smaller)
        total += smaller.length
      } else {
        failedChunks.push({ pages, message: error.message })
      }
    }
    done++
    report('details', done, total)
  }

  // A simple worker pool: each worker takes the next chunk until the queue is empty.
  const workers = Array.from({ length: options.concurrency ?? 4 }, async () => {
    try {
      for (let chunk = queue.shift(); chunk; chunk = queue.shift()) {
        await runChunk(chunk)
      }
    } catch (error) {
      stopper.abort() // stop the other workers too, so nothing more is spent
      throw error
    }
  })
  await Promise.all(workers)

  // ---- 3. Merge
  report('checking', 0, 1)
  results.sort((a, b) => a.chunk.extractPages[0]! - b.chunk.extractPages[0]!)
  const digest = mergeDigest({
    source: {
      file_name: doc.fileName,
      sha256: doc.sha256,
      page_count: doc.pages.length,
      doc_kind: outline.doc_kind,
      extracted_with: { model, effort, date: new Date().toISOString().slice(0, 10) },
    },
    outline,
    chunks: results,
  })

  // ---- 4. Check, and record every problem in the digest itself
  const pageTexts = new Map(doc.pages.map((p) => [p.pageNumber, p.text]))
  const issues = checkDigest(digest, { pageTexts })
  for (const failed of failedChunks) {
    digest.warnings.push({ code: 'CHUNK_FAILED', message: failed.message, ref_id: null, pages: failed.pages })
  }
  for (const issue of issues) {
    digest.warnings.push({ code: issue.code, message: issue.message, ref_id: issue.refId, pages: issue.pages })
  }
  report('checking', 1, 1)

  return {
    digest,
    issues,
    calls,
    failedChunks,
    spentUsd: guard.spentUsd,
    seconds: (performance.now() - started) / 1000,
  }
}

export interface CostEstimate {
  /** Exact, from the token-counting endpoint. */
  outlineInputTokens: number
  detailInputTokens: number
  lowUsd: number
  highUsd: number
  /** A suggested spending limit: the high estimate plus a margin. */
  suggestedLimitUsd: number
}

/**
 * Estimates what a run will cost before spending anything. Input tokens are counted exactly
 * for the outline (a free API call); the detail pass is scaled from that count. Output is the
 * uncertain part, so the estimate is a range. The evaluation harness will measure real ratios
 * and tighten it.
 */
export async function estimateCost(
  doc: ExtractionDocument,
  client: Anthropic,
  model: ModelId,
): Promise<CostEstimate> {
  const documentText = toPromptText(doc.pages)
  const outlineInputTokens = await countPromptTokens(
    client,
    model,
    OUTLINE_SYSTEM,
    outlineUserMessage(documentText),
  )
  const tokensPerChar = outlineInputTokens / Math.max(1, documentText.length)

  // Before the outline we don't know which pages will be skipped, so assume none (the high side).
  const chunks = makeChunks(doc.pages)
  const PER_CHUNK_OVERHEAD = 2_000 // instructions, nearby sessions and the theme list
  const detailInputTokens = chunks.reduce(
    (sum, chunk) => sum + Math.ceil(chunk.text.length * tokensPerChar) + PER_CHUNK_OVERHEAD,
    0,
  )
  const chunkTokens = detailInputTokens / Math.max(1, chunks.length)

  // Output (including thinking) as a share of detail input: dense author lists produce long answers.
  const estimate = (outputShare: number, outlineOutput: number) =>
    costOfCall(model, { input_tokens: outlineInputTokens, output_tokens: outlineOutput }) +
    chunks.length *
      costOfCall(model, { input_tokens: chunkTokens, output_tokens: chunkTokens * outputShare })

  const lowUsd = estimate(0.3, 4_000)
  const highUsd = estimate(1.2, 16_000)
  return {
    outlineInputTokens,
    detailInputTokens,
    lowUsd,
    highUsd,
    suggestedLimitUsd: Math.ceil(highUsd * 1.25 * 100) / 100,
  }
}

/** A quick size check that needs no API call, for showing before the user has a key. */
export function roughSize(doc: ExtractionDocument): { tokens: number; chunks: number } {
  return { tokens: roughTokenCount(toPromptText(doc.pages)), chunks: makeChunks(doc.pages).length }
}
