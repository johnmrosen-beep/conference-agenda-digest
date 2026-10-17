import { useState } from 'react'

// Placeholder for demo mode: later this opens a ready-made digest of a made-up conference,
// so visitors without an API key can try everything for free.
export default function DemoEntry() {
  const [opened, setOpened] = useState(false)

  return (
    <section className="card" aria-labelledby="demo-heading">
      <p className="eyebrow">No key? · Demo mode</p>
      <h2 id="demo-heading">Try it with a sample conference</h2>
      <p className="hint">
        Explore a finished digest of a fictional meeting: the summary, charts, search and agenda
        export. It costs nothing and needs no key.
      </p>
      {opened ? (
        <p className="status">The demo digest will appear here in a later milestone.</p>
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
