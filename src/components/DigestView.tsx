import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatDay,
  NO_FILTERS,
  rankInstitutions,
  rankPeople,
  rankThemes,
  totals,
  type PeopleMode,
  type SearchFilters,
} from '../lib/digest/analysis'
import type { Digest } from '../lib/extraction/schema'
import PresentationSearch from './PresentationSearch'
import RankedBars from './RankedBars'

interface Props {
  digest: Digest
}

const number = new Intl.NumberFormat('en-US')

/** Picks are remembered in this browser only, per conference, as a convenience. */
function storageKey(digest: Digest): string {
  return `conference-agenda-digest.picks.${digest.source.sha256 ?? digest.source.file_name}`
}

function loadPicks(digest: Digest): Set<string> {
  try {
    const saved = localStorage.getItem(storageKey(digest))
    return new Set(saved ? (JSON.parse(saved) as string[]) : [])
  } catch {
    return new Set()
  }
}

// The finished digest: an overview, what the program is about (charts), and a searchable list
// to pick presentations for a personal agenda.
export default function DigestView({ digest }: Props) {
  const [mode, setMode] = useState<PeopleMode>('presenters')
  const [filters, setFilters] = useState<SearchFilters>(NO_FILTERS)
  const [picks, setPicks] = useState<Set<string>>(() => loadPicks(digest))
  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(digest), JSON.stringify([...picks]))
    } catch {
      // Storage can be unavailable (private windows); picks then last only for this visit.
    }
  }, [digest, picks])

  const stats = useMemo(() => totals(digest, mode), [digest, mode])
  const themes = useMemo(() => rankThemes(digest), [digest])
  const institutions = useMemo(() => rankInstitutions(digest, mode), [digest, mode])
  const people = useMemo(() => rankPeople(digest, mode), [digest, mode])
  const titles = useMemo(() => new Map(digest.presentations.map((p) => [p.id, p.title])), [digest])

  const c = digest.conference
  const place = [c.venue, c.city, c.region].filter(Boolean).join(', ')
  const dates = c.start_date ? `${formatDay(c.start_date)} – ${formatDay(c.end_date ?? c.start_date)} ${c.year}` : null

  // Clicking a bar shows its presentations in the list below.
  const showInList = (change: Partial<SearchFilters>) => {
    setFilters({ ...NO_FILTERS, peopleMode: mode, ...change })
    searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const toggle = (id: string) =>
    setPicks((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const peopleWord = mode === 'presenters' ? 'Presenters' : 'Authors'

  return (
    <div className="digest">
      <section className="overview" aria-labelledby="overview-heading">
        <p className="eyebrow">Overview</p>
        <h2 id="overview-heading">{c.name}</h2>
        {(dates || place) && <p className="status">{[dates, place].filter(Boolean).join(' · ')}</p>}
        {c.summary && <p className="lede-small">{c.summary}</p>}
        {c.highlights.length > 0 && (
          <>
            <h3>Highlights</h3>
            <ul className="highlights">
              {c.highlights.map((h, i) => (
                <li key={i}>
                  {h.text}
                  {h.presentation_ids.length > 0 && (
                    <span className="hint">
                      {' '}
                      ({h.presentation_ids.map((id) => titles.get(id)).filter(Boolean).join('; ')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="at-a-glance" aria-labelledby="glance-heading">
        <div className="glance-header">
          <div>
            <p className="eyebrow">At a glance</p>
            <h2 id="glance-heading">What the program covers</h2>
          </div>
          <div className="segmented" role="group" aria-label="Count people as">
            <button type="button" aria-pressed={mode === 'presenters'} onClick={() => setMode('presenters')}>
              Presenters
            </button>
            <button type="button" aria-pressed={mode === 'authors'} onClick={() => setMode('authors')}>
              All authors
            </button>
          </div>
        </div>
        <p className="hint">
          Scientific sessions only. "Presenters" means the speaker of a talk or the first author of an abstract (the
          program doesn't say who presents an abstract); "All authors" counts everyone listed.
        </p>

        <div className="tiles">
          <div className="tile">
            <span className="tile-label">Sessions</span>
            <span className="tile-value">{number.format(stats.sessions)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">Presentations</span>
            <span className="tile-value">{number.format(stats.presentations)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">{peopleWord}</span>
            <span className="tile-value">{number.format(stats.people)}</span>
          </div>
          <div className="tile">
            <span className="tile-label">Institutions</span>
            <span className="tile-value">{number.format(stats.institutions)}</span>
          </div>
        </div>

        <div className="charts">
          <RankedBars
            title="Themes"
            unit="presentations"
            items={themes}
            selectedId={filters.themeId}
            onSelect={(t) => showInList({ themeId: t.id })}
          />
          <RankedBars
            title="Institutions"
            unit={mode === 'presenters' ? 'presentations by their presenters' : 'presentations by their authors'}
            items={institutions}
            selectedId={filters.institutionId}
            onSelect={(i) => showInList({ institutionId: i.id })}
          />
          <RankedBars
            title={peopleWord}
            unit="presentations"
            items={people}
            selectedId={filters.personId}
            onSelect={(p) => showInList({ personId: p.id })}
          />
        </div>
      </section>

      <div ref={searchRef}>
        <PresentationSearch
          digest={digest}
          filters={filters}
          onFiltersChange={setFilters}
          selected={picks}
          onToggle={toggle}
        />
      </div>
    </div>
  )
}
