// Reads a PDF's text in Node (for the evaluation scripts), with the same cleanup the app uses
// in the browser. Uses pdf.js's "legacy" build, which runs outside a browser.

import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { cleanDocument, fromPdfJsItem, type CleanPage, type RawPage } from '../src/lib/pdf/cleanText'

export async function readPdfText(path: string): Promise<CleanPage[]> {
  const data = new Uint8Array(await readFile(path))
  const task = getDocument({ data, useWasm: false, enableXfa: false, verbosity: 0 })
  try {
    const doc = await task.promise
    const pages: RawPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      pages.push({
        pageNumber: n,
        items: content.items.flatMap((item) => ('str' in item ? [fromPdfJsItem(item)] : [])),
      })
      page.cleanup()
    }
    return cleanDocument(pages).pages
  } finally {
    await task.destroy()
  }
}
