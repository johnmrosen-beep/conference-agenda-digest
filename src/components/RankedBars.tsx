import { useState } from 'react'
import type { Ranked } from '../lib/digest/analysis'

interface Props {
  title: string
  /** What each bar counts, for the tooltip and screen readers ("presentations"). */
  unit: string
  items: Ranked[]
  /** How many rows to show before "Show more". */
  initial?: number
  /** Clicking a row filters the presentation list to it. */
  onSelect?: (item: Ranked) => void
  selectedId?: string | null
}

// A ranked horizontal bar chart built from plain HTML: one bar per row, the count at the bar's
// tip, a tooltip on hover, and the label as real text (so it reads aloud and never relies on
// color). One measure per chart, so a single color and no legend.
export default function RankedBars({ title, unit, items, initial = 10, onSelect, selectedId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? items.slice(0, 50) : items.slice(0, initial)
  const max = Math.max(1, ...items.map((i) => i.count))

  return (
    <figure className="ranked">
      <figcaption>
        <h3>{title}</h3>
        <span className="hint">{items.length === 0 ? 'Nothing to count yet.' : `by number of ${unit}`}</span>
      </figcaption>
      <ol className="ranked-list">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`ranked-row${selectedId === item.id ? ' selected' : ''}`}
              onClick={() => onSelect?.(item)}
              title={`${item.label}: ${item.count} ${unit}${onSelect ? '. Click to list them.' : ''}`}
              aria-label={`${item.label}, ${item.count} ${unit}`}
            >
              <span className="ranked-label">{item.label}</span>
              <span className="ranked-track" aria-hidden="true">
                <span className="ranked-bar" style={{ width: `${(item.count / max) * 100}%` }} />
                <span className="ranked-value">{item.count}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {items.length > initial && (
        <button type="button" className="link-button" onClick={() => setExpanded((e) => !e)}>
          {expanded ? 'Show fewer' : `Show more (${Math.min(items.length, 50) - initial} more)`}
        </button>
      )}
    </figure>
  )
}
