import { useMemo, useState } from 'react'
import { roughTokenCount, toPromptText, type CleanDocument } from '../lib/pdf/cleanText'

interface Props {
  fileName: string
  doc: CleanDocument
}

const number = new Intl.NumberFormat('en-US')

// Shows what was read from the PDF, page by page, so you can check the text came out right
// before any of it is sent to Claude. Nothing here costs anything or leaves the browser.
export default function TextPreview({ fileName, doc }: Props) {
  const [index, setIndex] = useState(0)
  const promptText = useMemo(() => toPromptText(doc.pages), [doc])
  const pageCount = doc.pages.length
  const page = doc.pages[index]

  // Pages with no text at all are usually scanned images, which this app can't read.
  const mostlyEmpty = doc.emptyPages.length > pageCount * 0.2

  function download() {
    const blob = new Blob([promptText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName.replace(/\.pdf$/i, '') + ' - text.txt'
    link.click()
    // Give the browser a moment to start the download before releasing the file from memory.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="preview">
      <p className="status">
        {number.format(pageCount)} pages · {number.format(promptText.length)} characters · about{' '}
        {number.format(roughTokenCount(promptText))} tokens
      </p>

      {mostlyEmpty && (
        <p className="error" role="alert">
          {number.format(doc.emptyPages.length)} of {number.format(pageCount)} pages have no
          readable text. This PDF may be scanned images, which this app can't read.
        </p>
      )}

      {(doc.removedLines.length > 0 || doc.rotatedItemsDropped > 0) && (
        <details className="cleanup">
          <summary>What was cleaned up</summary>
          <ul>
            {doc.rotatedItemsDropped > 0 && (
              <li>
                {number.format(doc.rotatedItemsDropped)} pieces of sideways text removed (usually
                margin watermarks).
              </li>
            )}
            {doc.removedLines.map((line) => (
              <li key={line.example}>
                Repeating header or footer removed from {number.format(line.removedCount)} pages
                (first copy kept): <q>{line.example}</q>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="pager">
        <button
          type="button"
          className="btn secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          ← Previous
        </button>
        <label className="pager-jump">
          Page{' '}
          <input
            type="number"
            min={1}
            max={pageCount}
            value={index + 1}
            onChange={(e) => {
              const wanted = Number(e.target.value)
              if (Number.isInteger(wanted)) setIndex(Math.min(pageCount, Math.max(1, wanted)) - 1)
            }}
          />{' '}
          of {number.format(pageCount)}
        </label>
        <button
          type="button"
          className="btn secondary"
          onClick={() => setIndex((i) => Math.min(pageCount - 1, i + 1))}
          disabled={index >= pageCount - 1}
        >
          Next →
        </button>
      </div>

      <pre className="page-text" aria-label={`Text of page ${index + 1}`}>
        {page?.text || '(No text on this page.)'}
      </pre>

      <div className="btn-row">
        <button type="button" className="btn secondary" onClick={download}>
          Download all text (.txt)
        </button>
      </div>
    </div>
  )
}
