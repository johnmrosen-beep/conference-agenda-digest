import { useState } from 'react'
import { demoDigest } from '../demo/demoDigest'
import DigestView from './DigestView'

// Demo mode: opens a ready-made digest of a fictional conference, so visitors without an API
// key can try the overview, charts and search for free.
export default function DemoEntry() {
  const [opened, setOpened] = useState(false)

  return (
    <section className="card" aria-labelledby="demo-heading">
      <p className="eyebrow">No key? · Demo mode</p>
      <h2 id="demo-heading">Try it with a sample conference</h2>
      <p className="hint">
        Explore a finished digest of a fictional meeting: the overview, charts, search and picking presentations for
        your agenda. It costs nothing and needs no key. (The meeting and everyone in it are made up.)
      </p>
      {opened ? (
        <>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setOpened(false)}>
              Close the demo
            </button>
          </div>
          <DigestView digest={demoDigest} />
        </>
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
