import { useEffect, useState } from 'react'
import { parseDigest } from '../lib/extraction/validate'
import {
  announceSavedChange,
  deleteDigest,
  listDigests,
  saveDigest,
  type SavedDigest,
} from '../lib/storage/saved'
import DigestView from './DigestView'

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Digests saved in this browser, ready to reopen at no cost, plus a way to open a digest file
// downloaded earlier (on another computer, say, or after clearing the browser).
export default function SavedDigests() {
  const [saved, setSaved] = useState<SavedDigest[]>([])
  const [open, setOpen] = useState<SavedDigest | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const refresh = () => void listDigests().then(setSaved)
    refresh()
    window.addEventListener('saved-digests-changed', refresh)
    return () => window.removeEventListener('saved-digests-changed', refresh)
  }, [])

  async function openFile(file: File | undefined) {
    if (!file) return
    setError(null)
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      setError("That file isn't a digest: it isn't valid JSON.")
      return
    }
    // The same shape check the app uses for everything it reads.
    const result = parseDigest(data)
    if (!result.ok) {
      setError(`That file isn't a digest this app can open (${result.problems[0] ?? 'unknown problem'}).`)
      return
    }
    const record: SavedDigest = {
      key: result.digest.source.sha256 ?? `file:${file.name}`,
      fileName: result.digest.source.file_name,
      conferenceName: result.digest.conference.name,
      savedAt: new Date().toISOString(),
      digest: result.digest,
    }
    await saveDigest(record)
    announceSavedChange()
    setOpen(record)
  }

  async function remove(record: SavedDigest) {
    await deleteDigest(record.key)
    if (open?.key === record.key) setOpen(null)
    announceSavedChange()
  }

  return (
    <section className="card" aria-labelledby="saved-heading">
      <p className="eyebrow">Come back later · Your digests</p>
      <h2 id="saved-heading">Saved digests</h2>
      <p className="hint">
        Every digest you build is saved in this browser, so you can come back to it, and your picks, at no cost. Nothing
        is uploaded. To use a digest on another computer, download it as a file and open it there.
      </p>

      {saved.length > 0 ? (
        <ul className="saved-list">
          {saved.map((record) => (
            <li key={record.key}>
              <span className="saved-name">
                <strong>{record.conferenceName}</strong>
                <span className="hint">
                  {record.fileName} · saved {shortDate(record.savedAt)}
                </span>
              </span>
              <span className="btn-row">
                <button type="button" className="btn secondary" onClick={() => setOpen(record)}>
                  Open
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void remove(record)}
                  aria-label={`Delete the saved digest of ${record.conferenceName}`}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="status">No saved digests in this browser yet.</p>
      )}

      <label className="dropzone small">
        <input type="file" accept="application/json,.json" onChange={(e) => void openFile(e.target.files?.[0])} />
        <span className="label">Open a digest file (.json)</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {open && (
        <>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <DigestView key={open.key} digest={open.digest} />
        </>
      )}
    </section>
  )
}
