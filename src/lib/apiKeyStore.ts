// Where the visitor's Anthropic API key lives inside their own browser.
//
// - Default: sessionStorage. The key disappears when the tab is closed.
// - Opt-in "remember on this device": localStorage. The key stays until "Forget key".
// The key is never sent anywhere except, in a later milestone, directly to api.anthropic.com.

/** The three storage methods we use. Real browser storage and the test fakes both provide them. */
export type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface KeyStores {
  session: KeyStorage | null
  local: KeyStorage | null
}

export interface SavedKey {
  key: string
  remembered: boolean
}

export const STORAGE_NAME = 'conference-agenda-digest.anthropic-api-key'

/** Returns the browser's storage areas, or null for any that are blocked (e.g. strict privacy settings). */
export function browserStores(): KeyStores {
  const tryGet = (get: () => Storage): KeyStorage | null => {
    try {
      return get()
    } catch {
      return null
    }
  }
  return {
    session: tryGet(() => window.sessionStorage),
    local: tryGet(() => window.localStorage),
  }
}

export function loadKey(stores: KeyStores): SavedKey | null {
  const fromSession = stores.session?.getItem(STORAGE_NAME)
  if (fromSession) return { key: fromSession, remembered: false }
  const fromLocal = stores.local?.getItem(STORAGE_NAME)
  if (fromLocal) return { key: fromLocal, remembered: true }
  return null
}

/** Saves the key in exactly one place and clears the other, so "remember" can be switched off cleanly. */
export function saveKey(stores: KeyStores, key: string, remember: boolean): void {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('The API key is empty.')
  const [keep, clear] = remember ? [stores.local, stores.session] : [stores.session, stores.local]
  if (!keep) throw new Error('This browser is blocking storage, so the key cannot be kept.')
  keep.setItem(STORAGE_NAME, trimmed)
  clear?.removeItem(STORAGE_NAME)
}

export function forgetKey(stores: KeyStores): void {
  stores.session?.removeItem(STORAGE_NAME)
  stores.local?.removeItem(STORAGE_NAME)
}

/** A gentle format check only. Whether the key actually works is checked later, against the API. */
export function looksLikeAnthropicKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim())
}

/** Shows only the last four characters, e.g. "sk-ant-…9xQz". */
export function maskKey(key: string): string {
  return `sk-ant-…${key.slice(-4)}`
}
