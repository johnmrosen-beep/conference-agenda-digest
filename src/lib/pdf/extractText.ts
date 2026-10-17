// Reads the text out of a PDF inside the browser, using Mozilla's pdf.js (the same engine
// Firefox uses to show PDFs). Nothing leaves the computer here: the file is read from disk
// into memory, and pdf.js works on it in a background thread (a "web worker") so the page
// stays responsive while it reads hundreds of pages.

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fromPdfJsItem, type RawPage } from './cleanText'

GlobalWorkerOptions.workerSrc = workerUrl

export interface ReadProgress {
  page: number
  pageCount: number
}

/** A problem reading the PDF, with a message written for the person using the app. */
export class PdfReadError extends Error {}

function friendlyMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'PasswordException') {
    return 'This PDF is password-protected. Please use a copy without a password.'
  }
  if (name === 'InvalidPDFException') {
    return "This file doesn't look like a valid PDF."
  }
  return 'Something went wrong while reading this PDF.'
}

/** Reads every page's text pieces, reporting progress after each page. */
export async function readPdfPages(
  file: File,
  onProgress?: (progress: ReadProgress) => void,
  signal?: AbortSignal,
): Promise<RawPage[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  // useWasm: false - WebAssembly only speeds up image decoding, which text reading never needs,
  // and leaving it off keeps the page's strict security policy simple.
  const task = getDocument({ data, useWasm: false, enableXfa: false })
  try {
    const doc = await task.promise.catch((error: unknown) => {
      throw new PdfReadError(friendlyMessage(error))
    })
    const pages: RawPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      signal?.throwIfAborted()
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const items = content.items.flatMap((item) => ('str' in item ? [fromPdfJsItem(item)] : []))
      pages.push({ pageNumber: n, items })
      page.cleanup()
      onProgress?.({ page: n, pageCount: doc.numPages })
    }
    return pages
  } finally {
    await task.destroy()
  }
}
