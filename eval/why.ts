// Shows what the code sees for one presentation in a saved run: the page Claude recorded, its
// session and time, and the page text around its number (as the app reads it with pdf.js).
// For tracking down a specific error from details.md. No API calls.
//
// Usage:
//   npm run eval:why -- --dataset eval/private/naspghan-2026 --runs eval/runs/<folder> --number 957

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { ExtractionResult } from '../src/lib/extraction/pipeline'
import { readPdfText } from './readPdf'
import { loadDataset } from './run'

const { values } = parseArgs({
  options: { dataset: { type: 'string' }, runs: { type: 'string' }, number: { type: 'string' } },
})
if (!values.dataset || !values.runs || !values.number) {
  console.error('Usage: npm run eval:why -- --dataset <folder> --runs <eval/runs/folder> --number <abstract number>')
  process.exit(1)
}

const { config } = await loadDataset(values.dataset)
const pages = await readPdfText(join(values.dataset, config.pdf))
const pageText = new Map(pages.map((p) => [p.pageNumber, p.text]))

const files = (await readdir(values.runs)).filter((f) => f.endsWith('.json') && !f.endsWith('.error.json'))
let shownText = false
for (const file of files.sort()) {
  const run = JSON.parse(await readFile(join(values.runs, file), 'utf8')) as ExtractionResult
  const p = run.digest.presentations.find((x) => x.abstract_number === values.number)
  if (!p) continue
  const session = run.digest.sessions.find((s) => s.id === p.session_id)
  console.log(
    `${file}: page ${p.source_pages.join(',')} | start ${p.start_time} | session "${session?.title}" ${session?.start_time}-${session?.end_time} | pages ${session?.source_pages.at(0)}-${session?.source_pages.at(-1)}`,
  )
  if (shownText) continue
  shownText = true
  // The page text once, with line numbers, around every line that mentions the number or a time.
  const page = p.source_pages[0]!
  for (const n of [page - 1, page, page + 1]) {
    const lines = (pageText.get(n) ?? '').split('\n')
    console.log(`\n--- page ${n} (${lines.length} lines) ---`)
    lines.forEach((line, i) => {
      if (line.includes(values.number!) || /\d{1,2}:\d{2}\s*[AP]M/i.test(line)) {
        console.log(`${String(i).padStart(4)}: ${line.slice(0, 110)}`)
      }
    })
  }
  console.log('')
}
