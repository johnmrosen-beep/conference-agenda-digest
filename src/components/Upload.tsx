import { useState, type DragEvent } from 'react'

interface Props {
  hasKey: boolean
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Placeholder: accepts a PDF and shows its name and size. Nothing is read from the file yet.
export default function Upload({ hasKey }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  function choose(picked: File | undefined) {
    if (!picked) return
    if (!isPdf(picked)) {
      setFile(null)
      setError('Please choose a PDF file.')
      return
    }
    setFile(picked)
    setError(null)
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
          Selected: {file.name} ({formatSize(file.size)}). Building a digest arrives in a later
          milestone{hasKey ? '' : ', and will need an API key'}.
        </p>
      )}
    </section>
  )
}
