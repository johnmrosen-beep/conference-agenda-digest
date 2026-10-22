import { useMemo, useState } from 'react'
import {
  conferenceDays,
  formatDay,
  formatTime,
  institutionsOf,
  searchPresentations,
  type KindFilter,
  type SearchFilters,
} from '../lib/digest/analysis'
import { presenterIds, type Digest } from '../lib/extraction/schema'

interface Props {
  digest: Digest
  filters: SearchFilters
  onFiltersChange: (filters: SearchFilters) => void
  selected: Set<string>
  onToggle: (presentationId: string) => void
}

const PAGE = 50

const KIND_LABEL: Record<string, string> = {
  keynote: 'Keynote',
  invited_talk: 'Talk',
  oral_abstract: 'Oral abstract',
  poster: 'Poster',
  video_abstract: 'Video abstract',
  panel: 'Panel',
  award_lecture: 'Named lecture',
  other: 'Session item',
}

// Search and pick: filter the presentations, then tick the ones for your own agenda.
export default function PresentationSearch({ digest, filters, onFiltersChange, selected, onToggle }: Props) {
  const [limit, setLimit] = useState(PAGE)
  const results = useMemo(() => searchPresentations(digest, filters), [digest, filters])
  const days = useMemo(() => conferenceDays(digest), [digest])
  const lookup = useMemo(
    () => ({
      people: new Map(digest.people.map((p) => [p.id, p.display_name])),
      institutions: new Map(digest.institutions.map((i) => [i.id, i.canonical_name])),
      sessions: new Map(digest.sessions.map((s) => [s.id, s])),
      themes: new Map(digest.themes.map((t) => [t.id, t.label])),
      warned: new Set(digest.warnings.map((w) => w.ref_id).filter(Boolean)),
    }),
    [digest],
  )

  const set = (change: Partial<SearchFilters>) => {
    setLimit(PAGE)
    onFiltersChange({ ...filters, ...change })
  }

  const chips = [
    filters.themeId && { label: `Theme: ${lookup.themes.get(filters.themeId)}`, clear: { themeId: null } },
    filters.institutionId && {
      label: `Institution: ${lookup.institutions.get(filters.institutionId)}`,
      clear: { institutionId: null },
    },
    filters.personId && { label: `Person: ${lookup.people.get(filters.personId)}`, clear: { personId: null } },
  ].filter(Boolean) as { label: string; clear: Partial<SearchFilters> }[]

  let lastDay: string | null | undefined
  return (
    <section className="search" aria-labelledby="search-heading">
      <p className="eyebrow">Find and pick</p>
      <h2 id="search-heading">Presentations</h2>

      <div className="filters">
        <label className="field grow">
          Search
          <input
            type="text"
            value={filters.query}
            placeholder="Title, name, institution, topic or abstract number"
            onChange={(e) => set({ query: e.target.value })}
          />
        </label>
        <label className="field">
          Day
          <select value={filters.day ?? ''} onChange={(e) => set({ day: e.target.value || null })}>
            <option value="">All days</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatDay(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select value={filters.kind} onChange={(e) => set({ kind: e.target.value as KindFilter })}>
            <option value="all">Everything</option>
            <option value="talks">Talks and lectures</option>
            <option value="abstracts">Oral abstracts</option>
            <option value="posters">Posters</option>
          </select>
        </label>
        <label className="field">
          Theme
          <select value={filters.themeId ?? ''} onChange={(e) => set({ themeId: e.target.value || null })}>
            <option value="">All themes</option>
            {digest.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((chip) => (
            <button key={chip.label} type="button" className="chip" onClick={() => set(chip.clear)}>
              {chip.label} <span aria-hidden="true">×</span>
              <span className="visually-hidden"> (remove filter)</span>
            </button>
          ))}
        </div>
      )}

      <p className="status" role="status">
        {results.length.toLocaleString('en-US')} {results.length === 1 ? 'presentation' : 'presentations'} ·{' '}
        {selected.size} in your agenda
      </p>

      <ol className="results">
        {results.slice(0, limit).map((p) => {
          const showDay = p.date !== lastDay
          lastDay = p.date
          const session = p.session_id ? lookup.sessions.get(p.session_id) : undefined
          const presenters = presenterIds(p).map((id) => lookup.people.get(id)).filter(Boolean)
          const places = [...institutionsOf(digest, p, 'presenters')].map((id) => lookup.institutions.get(id))
          const others = p.authors.length - presenters.length
          return (
            <li key={p.id} className={selected.has(p.id) ? 'picked' : undefined}>
              {showDay && <h3 className="day-heading">{formatDay(p.date)}</h3>}
              <label className="result">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} />
                <span className="result-when">
                  {formatTime(p.start_time)}
                  {p.time_inferred && p.kind === 'poster' && p.end_time ? `–${formatTime(p.end_time)}` : ''}
                </span>
                <span className="result-body">
                  <span className="result-title">
                    {p.abstract_number && <span className="result-number">{p.abstract_number}</span>}
                    {p.title}
                    {lookup.warned.has(p.id) && (
                      <span className="warn-badge" title="Something about this item needs double-checking">
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="result-meta">
                    {presenters.join(', ')}
                    {others > 0 ? ` +${others} more` : ''}
                    {places.length > 0 ? ` · ${places.join('; ')}` : ''}
                  </span>
                  <span className="result-meta muted">
                    {KIND_LABEL[p.kind] ?? p.kind}
                    {p.award_label ? ` · ${p.award_label}` : ''}
                    {session ? ` · ${session.title}` : ''}
                    {p.room ? ` · ${p.room}` : ''}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ol>

      {results.length > limit && (
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, results.length - limit)} more
          </button>
        </div>
      )}
    </section>
  )
}
