// Re-runs our own code (merge, number recovery, checks) on Claude's saved answers, without any
// new API calls. When a fix is in our code rather than in what Claude is asked, this measures it
// for free: re-merge the saved runs, then score the new folder with report.ts.
//
// Usage:
//   npm run eval:remerge -- --dataset eval/private/naspghan-2026 --runs eval/runs/<folder>
// Writes eval/runs/<folder>-remerged/ with the same file names, ready for eval:report.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { applyInstitutionGroups, listInstitutions } from '../src/lib/extraction/institutions'
import { mergeDigest, recoverAbstractNumbers, recoverStartTimes } from '../src/lib/extraction/merge'
import type { ExtractionResult } from '../src/lib/extraction/pipeline'
import { checkDigest } from '../src/lib/extraction/validate'
import { readPdfText } from './readPdf'
import { loadDataset } from './run'

const { values } = parseArgs({ options: { dataset: { type: 'string' }, runs: { type: 'string' } } })
if (!values.dataset || !values.runs) {
  console.error('Usage: npm run eval:remerge -- --dataset <folder> --runs <eval/runs/folder>')
  process.exit(1)
}

const { config } = await loadDataset(values.dataset)
const pages = await readPdfText(join(values.dataset, config.pdf))
const pageTexts = new Map(pages.map((p) => [p.pageNumber, p.text]))

const outDir = `${values.runs.replace(/[\\/]+$/, '')}-remerged`
await mkdir(outDir, { recursive: true })

let count = 0
for (const file of (await readdir(values.runs)).filter((f) => f.endsWith('.json') && !f.endsWith('.error.json'))) {
  const run = JSON.parse(await readFile(join(values.runs, file), 'utf8')) as ExtractionResult & Record<string, unknown>
  const digest = mergeDigest({ source: run.digest.source, outline: run.raw.outline, chunks: run.raw.chunks })
  recoverAbstractNumbers(digest, pageTexts)
  recoverStartTimes(digest, pageTexts)
  // Re-apply the saved institution grouping, if the run made one (no new call needed).
  if (run.raw.institutionGroups) {
    applyInstitutionGroups(digest, listInstitutions(digest), run.raw.institutionGroups)
  }
  const issues = checkDigest(digest, { pageTexts })
  for (const issue of issues) {
    digest.warnings.push({ code: issue.code, message: issue.message, ref_id: issue.refId, pages: issue.pages })
  }
  await writeFile(join(outDir, file), JSON.stringify({ ...run, digest, issues }, null, 2))
  count++
}
console.log(`Re-merged ${count} runs into ${outDir} (no API calls, nothing spent).`)
console.log(`Next: npm run eval:report -- --dataset ${values.dataset} --runs ${outDir}`)
