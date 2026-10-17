import { useState } from 'react'
import { demoDigest } from '../demo/demoDigest'
import { checkDigest } from '../lib/extraction/validate'

// Demo mode: opens a ready-made digest of a fictional conference, so visitors without an API
// key can try the app for free. For now it shows a short overview; the summary, charts,
// search and agenda export arrive in later milestones.
export default function DemoEntry() {
  const [opened, setOpened] = useState(false)
  const digest = demoDigest
  const { conference } = digest

  return (
    <section className="card" aria-labelledby="demo-heading">
      <p className="eyebrow">No key? · Demo mode</p>
      <h2 id="demo-heading">Try it with a sample conference</h2>
      <p className="hint">
        Explore a finished digest of a fictional meeting: the summary, charts, search and agenda
        export. It costs nothing and needs no key.
      </p>
      {opened ? (
        <div className="demo-overview">
          <p className="status">
            {conference.name} · {conference.city}, {conference.region} · {conference.start_date} to{' '}
            {conference.end_date}
          </p>
          <p>{conference.summary}</p>
          <p className="status">
            {digest.sessions.length} sessions · {digest.presentations.length} presentations ·{' '}
            {digest.people.length} people · {digest.institutions.length} institutions ·{' '}
            {checkDigest(digest).length} validation issues
          </p>
          <p className="hint">Charts, search and agenda export for this demo arrive in a later milestone.</p>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => setOpened(true)}>
            Open the demo →
          </button>
        </div>
      )}
    </section>
  )
}
