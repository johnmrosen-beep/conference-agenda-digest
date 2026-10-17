import { useState, type SubmitEvent } from 'react'
import {
  browserStores,
  forgetKey,
  looksLikeAnthropicKey,
  maskKey,
  saveKey,
  type SavedKey,
} from '../lib/apiKeyStore'

interface Props {
  saved: SavedKey | null
  onChange: (saved: SavedKey | null) => void
}

// Lets the visitor paste their own Anthropic API key. No API calls happen yet:
// this milestone only stores and forgets the key.
export default function ApiKeyPanel({ saved, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSave(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!looksLikeAnthropicKey(draft)) {
      setError('That doesn’t look like an Anthropic API key. Keys start with “sk-ant-”.')
      return
    }
    try {
      saveKey(browserStores(), draft, remember)
      onChange({ key: draft.trim(), remembered: remember })
      setDraft('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function handleForget() {
    forgetKey(browserStores())
    onChange(null)
    setRemember(false)
  }

  return (
    <section className="card" aria-labelledby="key-heading">
      <p className="eyebrow">Step 1 · Your API key</p>
      <h2 id="key-heading">Bring your own Claude API key</h2>

      {saved ? (
        <>
          <p className="status">
            Key {maskKey(saved.key)} saved{' '}
            {saved.remembered ? 'on this device' : 'for this tab only'}.
          </p>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={handleForget}>
              Forget key
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={handleSave}>
          <p className="hint">
            The app runs entirely in your browser and sends your key only to Anthropic
            (api.anthropic.com). Usage is billed to your Anthropic Console account; Claude.ai
            subscriptions don’t include API use. A dedicated key with a low spending limit is
            safest.
          </p>
          <label className="field" htmlFor="api-key">
            Anthropic API key
          </label>
          <input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              Remember on this device. Leave unchecked to keep the key only until you close
              this tab.
            </span>
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="btn-row">
            <button type="submit" className="btn" disabled={!draft.trim()}>
              Save key
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
