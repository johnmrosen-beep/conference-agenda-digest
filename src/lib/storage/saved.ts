// Keeps finished digests, and the progress of builds still under way, in this browser, so closing
// the tab doesn't throw away work that was paid for. Uses IndexedDB, the browser's built-in
// database, which can hold large records (a full digest is a few megabytes). Nothing leaves the
// computer, and every record can be deleted from the "Your digests" list.
//
// Storage can be unavailable (some private windows block it); every function then quietly does
// nothing, and the app works as before without saving.

import type { ChunkResult } from '../extraction/merge'
import type { OutlineOutput } from '../extraction/modelOutput'
import type { Effort, ModelId } from '../extraction/pricing'
import type { Digest } from '../extraction/schema'

const DB_NAME = 'conference-agenda-digest'
const DB_VERSION = 1
const DIGESTS = 'digests'
const PROGRESS = 'progress'

export interface SavedDigest {
  /** The PDF's fingerprint (or, for an opened file without one, its file name). */
  key: string
  fileName: string
  conferenceName: string
  savedAt: string
  digest: Digest
}

/** What a build has finished so far: enough to carry on without paying for it again. */
export interface SavedProgress {
  /** fingerprint|model|effort: a resume must use the same model and effort. */
  key: string
  sha256: string
  fileName: string
  model: ModelId
  effort: Effort
  outline: OutlineOutput | null
  chunks: ChunkResult[]
  /** How many page groups the build planned, for "12 of 47 done". */
  plannedChunks: number
  spentUsd: number
  updatedAt: string
}

export function progressKey(sha256: string, model: ModelId, effort: Effort): string {
  return `${sha256}|${model}|${effort}`
}

let opening: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DIGESTS)) db.createObjectStore(DIGESTS, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

/** Runs one request against a store; resolves to null if storage isn't available. */
async function run<T>(store: string, mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = make(db.transaction(store, mode).objectStore(store))
      request.onsuccess = () => resolve((request.result as T) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export const saveDigest = (record: SavedDigest) => run(DIGESTS, 'readwrite', (s) => s.put(record))
export const getDigest = (key: string) => run<SavedDigest>(DIGESTS, 'readonly', (s) => s.get(key))
export const deleteDigest = (key: string) => run(DIGESTS, 'readwrite', (s) => s.delete(key))

/** Every saved digest, newest first. */
export async function listDigests(): Promise<SavedDigest[]> {
  const all = (await run<SavedDigest[]>(DIGESTS, 'readonly', (s) => s.getAll())) ?? []
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export const saveProgress = (record: SavedProgress) => run(PROGRESS, 'readwrite', (s) => s.put(record))
export const deleteProgress = (key: string) => run(PROGRESS, 'readwrite', (s) => s.delete(key))

/** Unfinished builds of one PDF (any model or effort), most recent first. */
export async function progressFor(sha256: string): Promise<SavedProgress[]> {
  const all = (await run<SavedProgress[]>(PROGRESS, 'readonly', (s) => s.getAll())) ?? []
  return all.filter((p) => p.sha256 === sha256).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Tells other parts of the page that the saved digests changed, so lists can refresh. */
export function announceSavedChange() {
  window.dispatchEvent(new Event('saved-digests-changed'))
}
