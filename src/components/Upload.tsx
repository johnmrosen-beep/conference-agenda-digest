import { useEffect, useRef, useState, type DragEvent } from 'react'
import { cleanDocument, type CleanDocument } from '../lib/pdf/cleanText'
import { PdfReadError, readPdfPages, type ReadProgress } from '../lib/pdf/extractText'
import TextPreview from './TextPreview'

interface Props {
  hasKey: boolean
}

type ReadState =
  | { step: 'idle' }
  | { step: 'reading'; progress: ReadProgress | null }
  | { step: 'done'; doc: CleanDocument }
  | { step: 'error'; message: string }

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Accepts a PDF, reads its text right here in the browser, and shows a page-by-page preview.
// Reading is free and private: no API key is needed and nothing is sent anywhere yet.
export default function Upload({ hasKey }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [read, setRead] = useState<ReadState>({ step: 'idle' })
  const reading = useRef<AbortController | null>(null)

  // Stop reading if the page section goes away mid-read.
  useEffect(() => () => reading.current?.abort(), [])

  async function readText(picked: File) {
    reading.current?.abort() // a new file replaces any read still in progress
    const controller = new AbortController()
    reading.current = controller
    setRead({ step: 'reading', progress: null })
    try {
      const rawPages = await readPdfPages(
        picked,
        (progress) => {
          if (!controller.signal.aborted) setRead({ step: 'reading', progress })
        },
        controller.signal,
      )
      if (!controller.signal.aborted) setRead({ step: 'done', doc: cleanDocument(rawPages) })
    } catch (err) {
      if (controller.signal.aborted) return
      const message =
        err instanceof PdfReadError ? err.message : 'Something went wrong while reading this PDF.'
      setRead({ step: 'error', message })
    }
  }

  function choose(picked: File | undefined) {
    if (!picked) return
    if (!isPdf(picked)) {
      reading.current?.abort()
      setFile(null)
      setRead({ step: 'idle' })
      setError('Please choose a PDF file.')
      return
    }
    setFile(picked)
    setError(null)
    void readText(picked)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files[0])
  }

  return (
    <section className="card" aria-labelledby="upload-heading">
      <p className="eyebrow">Step 2 · Upload</p>
      <h2 id="upload-heading">Add a conference program book</h2>
      <p className="hint">
        Your PDF stays on your computer. Its text is read inside this page, and only that text
        is sent to Claude, using your key.
      </p>

      <label
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <span className="label">Choose a PDF or drop it here</span>
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {file && (
        <p className="status">
          {file.name} ({formatSize(file.size)})
        </p>
      )}

      {read.step === 'reading' && (
        <div className="reading" role="status">
          <p className="status">
            {read.progress
              ? `Reading page ${read.progress.page} of ${read.progress.pageCount}…`
              : 'Opening the PDF…'}
          </p>
          <progress
            max={read.progress?.pageCount ?? 1}
            value={read.progress?.page ?? 0}
            aria-label="Reading progress"
          />
        </div>
      )}

      {read.step === 'error' && (
        <p className="error" role="alert">
          {read.message}
        </p>
      )}

      {read.step === 'done' && file && (
        <>
          <TextPreview key={`${file.name}-${file.lastModified}`} fileName={file.name} doc={read.doc} />
          <p className="hint">
            This is the text Claude will read. Building the digest from it arrives in a later
            milestone{hasKey ? '' : ', and will need an API key'}.
          </p>
        </>
      )}
    </section>
  )
}
