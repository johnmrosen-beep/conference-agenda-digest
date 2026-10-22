import { useEffect, useRef, useState } from 'react'
import type { CleanPage } from '../lib/pdf/cleanText'
import { createClient } from '../lib/extraction/claude'
import {
  estimateCost,
  estimateMinutes,
  runExtraction,
  type CostEstimate,
  type ExtractionProgress,
  type ExtractionResult,
} from '../lib/extraction/pipeline'
import { MODELS, formatUsd, type Effort, type ModelId } from '../lib/extraction/pricing'
import {
  announceSavedChange,
  deleteProgress,
  getDigest,
  progressFor,
  progressKey,
  saveDigest,
  saveProgress,
  type SavedDigest,
  type SavedProgress,
} from '../lib/storage/saved'
import DigestView from './DigestView'

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
  | { step: 'opened'; saved: SavedDigest }
  | { step: 'error'; message: string }

const STAGE_LABEL: Record<ExtractionProgress['stage'], string> = {
  outline: 'Mapping sessions and themes',
  details: 'Reading presentations',
  institutions: 'Merging institution names',
  summary: 'Writing the overview',
  checking: 'Checking the results',
}

async function fingerprint(file: File): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 754 seconds -> "12:34" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function minutesText({ low, high }: { low: number; high: number }): string {
  return low === high ? `about ${low} minutes` : `about ${low}–${high} minutes`
}

/**
 * "Elapsed 4:12 · about 7 minutes left". Before page groups have a pace, it falls back to the
 * estimate made from the page count; once a few groups are done, it projects from their pace.
 */
function timeLine(
  progress: ExtractionProgress | null,
  now: number,
  timing: { started: number; detailsStarted: number | null; planned: { low: number; high: number } | null },
): string {
  const elapsed = `Elapsed ${clock((now - timing.started) / 1000)}`
  if (progress?.stage === 'details' && timing.detailsStarted !== null && progress.done >= 2) {
    const perGroup = (now - timing.detailsStarted) / 1000 / progress.done
    const left = perGroup * (progress.total - progress.done) + 90 // plus the final steps
    return `${elapsed} · about ${Math.max(1, Math.ceil(left / 60))} minutes left`
  }
  if (progress && ['institutions', 'summary', 'checking'].includes(progress.stage)) {
    return `${elapsed} · finishing up, about a minute left`
  }
  return timing.planned ? `${elapsed} · expected total ${minutesText(timing.planned)}` : elapsed
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
  // For the elapsed and remaining time: when the run began, and when page groups started.
  const timing = useRef<{ started: number; detailsStarted: number | null; planned: { low: number; high: number } | null }>({
    started: 0,
    detailsStarted: null,
    planned: null,
  })
  const [now, setNow] = useState(() => Date.now())
  // This PDF's fingerprint, and any digest or unfinished build saved for it in this browser.
  const [sha, setSha] = useState<string | null>(null)
  const [savedDigest, setSavedDigest] = useState<SavedDigest | null>(null)
  const [resumable, setResumable] = useState<SavedProgress | null>(null)
  const [resume, setResume] = useState<SavedProgress | null>(null)
  const spentSoFar = useRef(0)

  useEffect(() => () => running.current?.abort(), [])

  // Recognize a PDF seen before: same fingerprint, same file, whatever its name.
  useEffect(() => {
    let current = true
    void (async () => {
      const fingerprintHex = await fingerprint(file)
      if (!current) return
      setSha(fingerprintHex)
      const [digest, progress] = await Promise.all([getDigest(fingerprintHex), progressFor(fingerprintHex)])
      if (!current) return
      setSavedDigest(digest)
      setResumable(progress[0] ?? null)
    })()
    return () => {
      current = false
    }
  }, [file])

  // While running, refresh once a second so the "last activity" time stays current.
  const isRunning = state.step === 'running'
  useEffect(() => {
    if (!isRunning) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isRunning])

  // While running, ask before the tab is closed or reloaded: leaving stops the build.
  useEffect(() => {
    if (!isRunning) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = '' // older browsers need this to show the prompt
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isRunning])

  const doc = { fileName: file.name, sha256: null, pages }
  const limitUsd = Number(limit)
  const limitValid = Number.isFinite(limitUsd) && limitUsd > 0

  async function estimate(forModel: ModelId = model) {
    if (!apiKey) return
    setState({ step: 'estimating' })
    try {
      const result = await estimateCost(doc, createClient(apiKey), forModel)
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
    timing.current = {
      started: Date.now(),
      detailsStarted: null,
      planned: state.step === 'estimated' ? estimateMinutes(state.estimate.chunkCount, effort) : null,
    }
    setState({ step: 'running', progress: null })
    const sha256 = sha ?? (await fingerprint(file))
    const key = progressKey(sha256, model, effort)
    // Carry on from saved progress only when it was made with the same model and effort.
    const resumeFrom = resume && resume.key === key ? resume : null
    const spentBefore = resumeFrom?.spentUsd ?? 0
    spentSoFar.current = 0
    try {
      const result = await runExtraction(
        { ...doc, sha256 },
        {
          client: createClient(apiKey),
          model,
          effort,
          spendLimitUsd: limitUsd,
          signal: controller.signal,
          resumeFrom: resumeFrom ? { outline: resumeFrom.outline, chunks: resumeFrom.chunks } : undefined,
          onCheckpoint: (checkpoint) =>
            void saveProgress({
              key,
              sha256,
              fileName: file.name,
              model,
              effort,
              outline: checkpoint.outline,
              chunks: checkpoint.chunks,
              plannedChunks: checkpoint.plannedChunks,
              spentUsd: spentBefore + spentSoFar.current,
              updatedAt: new Date().toISOString(),
            }),
          onProgress: (progress) => {
            spentSoFar.current = progress.spentUsd
            if (progress.receivedChars !== lastActivity.current.chars) {
              lastActivity.current = { chars: progress.receivedChars, at: Date.now() }
            }
            if (progress.stage === 'details' && timing.current.detailsStarted === null) {
              timing.current.detailsStarted = Date.now()
            }
            setState({ step: 'running', progress })
          },
        },
      )
      // Keep the finished digest in this browser, and drop the progress it no longer needs.
      const saved: SavedDigest = {
        key: sha256,
        fileName: file.name,
        conferenceName: result.digest.conference.name,
        savedAt: new Date().toISOString(),
        digest: result.digest,
      }
      await saveDigest(saved)
      await deleteProgress(key)
      announceSavedChange()
      setSavedDigest(saved)
      setResumable(null)
      setResume(null)
      setState({ step: 'done', result })
    } catch (error) {
      // Whatever finished is saved; offer to resume from it.
      setResumable((await progressFor(sha256))[0] ?? null)
      setState({ step: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  // Changing the model or effort makes an earlier estimate out of date.
  function changeSettings(update: () => void) {
    update()
    if (state.step === 'estimated' || state.step === 'error') setState({ step: 'idle' })
  }

  /** Switches to the saved build's model and effort, then estimates what's left. */
  function startResume(progress: SavedProgress) {
    setModel(progress.model)
    setEffort(progress.effort)
    setResume(progress)
    void estimate(progress.model)
  }

  async function discardProgress(progress: SavedProgress) {
    await deleteProgress(progress.key)
    setResumable(null)
    setResume(null)
  }

  // A digest already built from this same PDF opens for free, with or without a key.
  const savedNotice = savedDigest && state.step !== 'opened' && state.step !== 'done' && state.step !== 'running' && (
    <div className="saved-notice">
      <p>
        <strong>You already built a digest of this PDF</strong> on{' '}
        {new Date(savedDigest.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.
        It's saved in this browser and opens at no cost.
      </p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setState({ step: 'opened', saved: savedDigest })}>
          Open the saved digest
        </button>
      </div>
    </div>
  )

  if (state.step === 'opened') {
    return (
      <div className="build">
        <p className="eyebrow">Step 3 · Your digest</p>
        <p className="status">Opened the digest saved in this browser · no new cost</p>
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => setState({ step: 'idle' })}>
            Build it again instead
          </button>
        </div>
        <DigestView digest={state.saved.digest} />
      </div>
    )
  }

  if (!apiKey) {
    return (
      <div className="build">
        <p className="eyebrow">Step 3 · Build the digest</p>
        {savedNotice}
        <p className="hint">Add your Anthropic API key in step 1 to build a digest from this text.</p>
      </div>
    )
  }

  const busy = state.step === 'estimating' || state.step === 'running'
  const resumeNotice = resumable && (state.step === 'idle' || state.step === 'error') && (
    <div className="saved-notice">
      <p>
        <strong>An earlier build of this PDF stopped partway:</strong> {resumable.chunks.length} of{' '}
        {resumable.plannedChunks} page groups were finished with {MODELS[resumable.model].label.split(' (')[0]} at{' '}
        {resumable.effort} effort ({formatUsd(resumable.spentUsd)} already spent). Resuming sends only the rest.
      </p>
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => startResume(resumable)}>
          Resume that build
        </button>
        <button type="button" className="btn secondary" onClick={() => void discardProgress(resumable)}>
          Discard it
        </button>
      </div>
    </div>
  )

  return (
    <div className="build">
      <p className="eyebrow">Step 3 · Build the digest</p>
      {savedNotice}
      {resumeNotice}

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
          <button type="button" className="btn secondary" onClick={() => void estimate()} disabled={busy}>
            {state.step === 'estimating' ? 'Counting tokens…' : 'Estimate the cost (free)'}
          </button>
        </div>
      )}

      {state.step === 'estimated' && (
        <>
          <p className="status">
            Estimated cost: {formatUsd(state.estimate.lowUsd)} to {formatUsd(state.estimate.highUsd)} · estimated time:{' '}
            {minutesText(estimateMinutes(state.estimate.chunkCount, effort))}
          </p>
          {resume && resume.model === model && resume.effort === effort && (
            <p className="status">
              Resuming: {resume.chunks.length} of {resume.plannedChunks} page groups are already done, so the real cost
              and time will be lower than this estimate.
            </p>
          )}
          <p className="hint">
            You don't need to watch it. Switch to other work and come back; just keep this browser tab open. If the tab
            does close, the finished part is saved in this browser and you can resume from it.
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
          <p className="status">{timeLine(state.progress, now, timing.current)}</p>
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
              {resumable ? 'Back' : 'Start over'}
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
        {result.calls.length} requests · saved in this browser
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
      <DigestView digest={digest} />
    </div>
  )
}
