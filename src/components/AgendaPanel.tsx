import { useMemo, useState } from 'react'
import { buildAgenda } from '../lib/digest/agenda'
import { formatDay, formatTime } from '../lib/digest/analysis'
import type { Digest } from '../lib/extraction/schema'

interface Props {
  digest: Digest
  picks: Set<string>
  onRemove: (presentationId: string) => void
  onClear: () => void
}

// The presentations someone has picked, by day, with clashes called out, and the PDF download.
export default function AgendaPanel({ digest, picks, onRemove, onClear }: Props) {
  const days = useMemo(() => buildAgenda(digest, picks), [digest, picks])
  const [making, setMaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const clashes = days.reduce((n, d) => n + d.items.filter((i) => i.clashes.length > 0).length, 0)

  async function download() {
    setMaking(true)
    setError(null)
    try {
      // Loaded only when needed, so the PDF library doesn't slow down opening the app.
      const { agendaPdf, agendaFileName } = await import('../lib/export/agendaPdf')
      agendaPdf(digest, days).save(agendaFileName(digest))
    } catch (err) {
      setError(err instanceof Error ? `Couldn't make the PDF: ${err.message}` : "Couldn't make the PDF.")
    } finally {
      setMaking(false)
    }
  }

  return (
    <section className="agenda" aria-labelledby="agenda-heading">
      <p className="eyebrow">Your agenda</p>
      <h2 id="agenda-heading">
        {picks.size === 0 ? 'Nothing picked yet' : `${picks.size} ${picks.size === 1 ? 'presentation' : 'presentations'} picked`}
      </h2>
      {picks.size === 0 ? (
        <p className="hint">Tick presentations in the list below, or click a bar above to find them. They'll gather here.</p>
      ) : (
        <>
          {clashes > 0 && (
            <p className="error">
              {clashes} {clashes === 1 ? 'pick overlaps' : 'picks overlap'} with another in a different room. They're
              marked below and in the PDF.
            </p>
          )}
          {days.map((day) => (
            <div key={day.date ?? 'undated'} className="agenda-day">
              <h3 className="day-heading">{formatDay(day.date)}</h3>
              <ul>
                {day.items.map((item) => (
                  <li key={item.presentation.id} className={item.clashes.length > 0 ? 'clash' : undefined}>
                    <span className="result-when">{item.timeNotPrinted ? 'Time TBA' : formatTime(item.start)}</span>
                    <span className="agenda-title">
                      {item.presentation.title}
                      {item.clashes.length > 0 && (
                        <span className="agenda-clash">
                          Overlaps with {item.clashes.map((c) => c.title).join('; ')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => onRemove(item.presentation.id)}
                      aria-label={`Remove ${item.presentation.title} from your agenda`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={download} disabled={picks.size === 0 || making}>
          {making ? 'Making the PDF…' : 'Download my agenda (PDF)'}
        </button>
        {picks.size > 0 && (
          <button type="button" className="btn secondary" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
