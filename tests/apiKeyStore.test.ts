import { describe, expect, it } from 'vitest'
import {
  STORAGE_NAME,
  forgetKey,
  loadKey,
  looksLikeAnthropicKey,
  maskKey,
  saveKey,
  type KeyStorage,
  type KeyStores,
} from '../src/lib/apiKeyStore'

// A stand-in for the browser's sessionStorage / localStorage, so tests run without a browser.
class MemoryStorage implements KeyStorage {
  private items = new Map<string, string>()
  getItem(name: string) {
    return this.items.get(name) ?? null
  }
  setItem(name: string, value: string) {
    this.items.set(name, value)
  }
  removeItem(name: string) {
    this.items.delete(name)
  }
}

const FAKE_KEY = 'sk-ant-test-0000000000000000000000abcd'

function freshStores(): KeyStores {
  return { session: new MemoryStorage(), local: new MemoryStorage() }
}

describe('apiKeyStore', () => {
  it('keeps the key for this tab only by default', () => {
    const stores = freshStores()
    saveKey(stores, FAKE_KEY, false)
    expect(stores.session?.getItem(STORAGE_NAME)).toBe(FAKE_KEY)
    expect(stores.local?.getItem(STORAGE_NAME)).toBeNull()
    expect(loadKey(stores)).toEqual({ key: FAKE_KEY, remembered: false })
  })

  it('uses device storage only when "remember" is chosen', () => {
    const stores = freshStores()
    saveKey(stores, FAKE_KEY, true)
    expect(stores.session?.getItem(STORAGE_NAME)).toBeNull()
    expect(loadKey(stores)).toEqual({ key: FAKE_KEY, remembered: true })
  })

  it('switching "remember" off removes the key from device storage', () => {
    const stores = freshStores()
    saveKey(stores, FAKE_KEY, true)
    saveKey(stores, FAKE_KEY, false)
    expect(stores.local?.getItem(STORAGE_NAME)).toBeNull()
    expect(loadKey(stores)?.remembered).toBe(false)
  })

  it('"Forget key" clears both places', () => {
    const stores = freshStores()
    stores.session?.setItem(STORAGE_NAME, FAKE_KEY)
    stores.local?.setItem(STORAGE_NAME, FAKE_KEY)
    forgetKey(stores)
    expect(loadKey(stores)).toBeNull()
  })

  it('refuses an empty key and trims spaces', () => {
    const stores = freshStores()
    expect(() => saveKey(stores, '   ', false)).toThrow()
    saveKey(stores, `  ${FAKE_KEY}  `, false)
    expect(loadKey(stores)?.key).toBe(FAKE_KEY)
  })

  it('explains when the browser blocks storage', () => {
    expect(() => saveKey({ session: null, local: null }, FAKE_KEY, false)).toThrow(/blocking storage/)
  })

  it('checks the key format and masks it for display', () => {
    expect(looksLikeAnthropicKey(FAKE_KEY)).toBe(true)
    expect(looksLikeAnthropicKey('not-a-key')).toBe(false)
    expect(maskKey(FAKE_KEY)).toBe('sk-ant-…abcd')
  })
})
