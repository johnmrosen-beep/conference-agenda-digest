import { useState } from 'react'
import ApiKeyPanel from './components/ApiKeyPanel'
import DemoEntry from './components/DemoEntry'
import SignalRule from './components/SignalRule'
import Upload from './components/Upload'
import { browserStores, loadKey, type SavedKey } from './lib/apiKeyStore'

const PORTFOLIO_URL = 'https://johnmrosen-beep.github.io/johnmrosen-beep/'
const SOURCE_URL = 'https://github.com/johnmrosen-beep/conference-agenda-digest'

export default function App() {
  // Pick up a key saved earlier in this tab (or remembered on this device).
  const [savedKey, setSavedKey] = useState<SavedKey | null>(() => loadKey(browserStores()))

  return (
    <>
      <div className="wrap">
        <nav className="topbar" aria-label="Site">
          <span className="wordmark">Conference Agenda Digest</span>
          <a href={PORTFOLIO_URL}>← Portfolio</a>
        </nav>

        <header className="hero">
          <p className="eyebrow">Medical conferences · Program books</p>
          <h1>Make sense of a 300-page program book.</h1>
          <p className="lede">
            Upload a conference program PDF and get a short summary, charts of the main themes,
            presenters and institutions, and a searchable list you can turn into your own agenda
            PDF.
          </p>
          <p className="hint">
            Early preview: the app can read a PDF and build a digest you can download. The
            summary, charts, search and agenda export arrive in the next milestones.
          </p>
        </header>

        <SignalRule />

        <main className="steps">
          <ApiKeyPanel saved={savedKey} onChange={setSavedKey} />
          <Upload apiKey={savedKey?.key ?? null} />
          <DemoEntry />
        </main>
      </div>

      <footer className="footer wrap">
        Your PDF and API key stay in your browser. No analytics, no trackers. ·{' '}
        <a href={SOURCE_URL}>Source on GitHub</a>
      </footer>
    </>
  )
}
