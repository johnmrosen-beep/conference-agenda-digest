import { useEffect, useRef, useState } from 'react'
import type { CleanPage } from '../lib/pdf/cleanText'
import { createClient } from '../lib/extraction/claude'
import {
  estimateCost,
  runExtraction,
  type CostEstimate,
  type ExtractionProgress,
  type ExtractionResult,
} from '../lib/extraction/pipeline'
import { MODELS, formatUsd, type Effort, type ModelId } from '../lib/extraction/pricing'

interface Props {
  file: File
  pages: CleanPage[]
  apiKey: string | null
}

type RunState =
  | { step: 'idle' }
  | { step: 'estimating' }
  | { step: 'estimated'; estimate: CostEstimate }
  | { step: 'running'; progress: ExtractionProgress | null }
  | { step: 'done'; result: ExtractionResult }
  | { step: 'error'; message: string }

const STAGE_LABEL: Record<ExtractionProgress['stage'], string> = {
  outline: 'Mapping sessions and themes',
  details: 'Reading presentations',
  institutions: 'Merging institution names',
  checking: 'Checking the results',
}

async function fingerprint(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function downloadJson(data: unknown, fileName: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Step 3: turns the PDF text into a digest with Claude, using the visitor's own key.
// Nothing is sent until the visitor has seen a cost estimate and set a spending limit.
export default function BuildDigest({ file, pages, apiKey }: Props) {
  const [model, setModel] = useState<ModelId>('claude-haiku-5-5')
  const [effort, setEffort] = useState<Effort>('medium')
  const [limit, setLimit] = useState('')
  const [state, setState] = useState<RunState>({ step: 'idle' })
  const running = useRef<AbortController | null>(null)
  // When the last piece of an answer arrived, to show "waiting" vs "writing".
  const lastActivity = useRef({ chars: 0, at: 0 })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => () => running.current?.abort(), [])

  // While running, refresh once a second so the "last activity" time stays current.
  const isRunning = state.step === 'running'
  useEffect(() => {
    if (!isRunning) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  const doc = { fileName: file.name, sha256: null, pages }
  const limitUsd = Number(limit)
  const limitValid = Number.isFinite(limitUsd) && limitUsd > 0

  async function estimate() {
    if (!apiKey) return
    setState({ step: 'estimating' })
    try {
      const result = await estimateCost(doc, createClient(apiKey), model)
      setLimit(result.suggestedLimitUsd.toFixed(2))
      setState({ step: 'estimated', estimate: result })
    } catch (error) {
      setState({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function build() {
    if (!apiKey || !limitValid) return
    const controller = new AbortController()
    running.current = controller
    lastActivity.current = { chars: 0, at: Date.now() }
    setState({ step: 'running', progress: null })
    try {
      const result = await runExtraction(
        { ...doc, sha256: await fingerprint(file) },
        {
          client: createClient(apiKey),
          model,
          effort,
          spendLimitUsd: limitUsd,
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.receivedChars !== lastActivity.current.chars) {
              lastActivity.current = { chars: progress.receivedChars, at: Date.now() }
            }
            setState({ step: 'running', progress })
          },
        },
      )
      setState({ step: 'done', result })
    } catch (error) {
      setState({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // Changing the model or effort makes an earlier estimate out of date.
  function changeSettings(update: () => void) {
    update()
    if (state.step === 'estimated' || state.step === 'error') setState({ step: 'idle' })
  }

  if (!apiKey) {
    return (
      <div className="build">
        <p className="eyebrow">Step 3 · Build the digest</p>
        <p className="hint">Add your Anthropic API key in step 1 to build a digest from this text.</p>
      </div>
    )
  }

  const busy = state.step === 'estimating' || state.step === 'running'

  return (
    <div className="build">
      <p className="eyebrow">Step 3 · Build the digest</p>

      <div className="build-options">
        <label className="field">
          Model
          <select
            value={model}
            disabled={busy}
            onChange={(e) => changeSettings(() => setModel(e.target.value as ModelId))}
          >
            {(Object.keys(MODELS) as ModelId[]).map((id) => (
              <option key={id} value={id}>
                {MODELS[id].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Effort
          <select
            value={effort}
            disabled={busy}
            onChange={(e) => changeSettings(() => setEffort(e.target.value as Effort))}
          >
            <option value="low">Low (cheapest)</option>
            <option value="medium">Medium</option>
            <option value="high">High (most careful)</option>
          </select>
        </label>
      </div>

      {(state.step === 'idle' || state.step === 'estimating') && (
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={estimate} disabled={busy}>
            {state.step === 'estimating' ? 'Counting tokens…' : 'Estimate the cost (free)'}
          </button>
        </div>
      )}

      {state.step === 'estimated' && (
        <>
          <p className="status">
            Estimated cost: {formatUsd(state.estimate.lowUsd)} to {formatUsd(state.estimate.highUsd)}
          </p>
          <label className="field" htmlFor="spend-limit">
            Spending limit (US dollars). The run stops before any request once this is reached.
          </label>
          <input
            id="spend-limit"
            type="text"
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <div className="btn-row">
            <button type="button" className="btn" onClick={build} disabled={!limitValid}>
              Build digest, spending at most {limitValid ? formatUsd(limitUsd) : '…'}
            </button>
          </div>
        </>
      )}

      {state.step === 'running' && (
        <div className="reading" role="status">
          <p className="status">
            {state.progress
              ? `${STAGE_LABEL[state.progress.stage]}: ${state.progress.done} of ${state.progress.total} · spent ${formatUsd(state.progress.spentUsd)}`
              : 'Starting…'}
          </p>
          <progress max={state.progress?.total || 1} value={state.progress?.done ?? 0} />
          {state.progress && (
            <p className="hint">
              {state.progress.inFlight} {state.progress.inFlight === 1 ? 'request' : 'requests'} running ·{' '}
              {state.progress.receivedChars.toLocaleString('en-US')} characters received · last text{' '}
              {Math.max(0, Math.round((now - lastActivity.current.at) / 1000))} seconds ago.{' '}
              {now - lastActivity.current.at > 90_000
                ? 'Long pauses usually mean the API is pacing requests from a new account; it retries automatically.'
                : ''}
            </p>
          )}
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => running.current?.abort()}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.step === 'error' && (
        <>
          <p className="error" role="alert">
            {state.message}
          </p>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setState({ step: 'idle' })}>
              Start over
            </button>
          </div>
        </>
      )}

      {state.step === 'done' && <BuildResult result={state.result} />}
    </div>
  )
}

function BuildResult({ result }: { result: ExtractionResult }) {
  const { digest } = result
  const name = digest.source.file_name.replace(/\.pdf$/i, '')
  return (
    <div className="build-result">
      <p className="status">
        Done in {Math.round(result.seconds)} seconds · spent {formatUsd(result.spentUsd)} ·{' '}
        {result.calls.length} requests
      </p>
      <p>
        <strong>{digest.conference.name}</strong>
        {digest.conference.start_date ? ` · ${digest.conference.start_date} to ${digest.conference.end_date ?? '?'}` : ''}
        {digest.conference.city ? ` · ${digest.conference.city}` : ''}
      </p>
      <p className="status">
        {digest.sessions.length} sessions · {digest.presentations.length} presentations ·{' '}
        {digest.people.length} people · {digest.institutions.length} institutions ·{' '}
        {digest.themes.length} themes
      </p>
      {digest.warnings.length > 0 && (
        <details className="cleanup">
          <summary>
            {digest.warnings.length} things to double-check
            {result.failedChunks.length > 0 ? ` (${result.failedChunks.length} groups of pages failed)` : ''}
          </summary>
          <ul>
            {digest.warnings.slice(0, 50).map((w, i) => (
              <li key={i}>
                ⚠ {w.message}
                {w.pages.length > 0 ? ` (page ${w.pages.join(', ')})` : ''}
              </li>
            ))}
          </ul>
          {digest.warnings.length > 50 && <p className="hint">…and {digest.warnings.length - 50} more in the downloaded file.</p>}
        </details>
      )}
      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={() => downloadJson(digest, `${name} - digest.json`)}>
          Download digest (.json)
        </button>
        <button
          type="button"
          className="btn secondary"
          onClick={() => downloadJson({ ...result.raw, calls: result.calls }, `${name} - raw answers.json`)}
        >
          Download Claude's raw answers
        </button>
      </div>
      <p className="hint">Summary, charts, search and agenda export for this digest arrive in the next milestones.</p>
    </div>
  )
}
