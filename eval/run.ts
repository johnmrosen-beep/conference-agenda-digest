// Runs the app's extraction on each golden slice, for every model and effort level, several
// times, and saves every result for scoring (report.ts). Scoring is separate on purpose: the
// expensive part (API calls) runs once, and scoring can be changed and re-run for free.
//
// Usage (in a Codespace, with ANTHROPIC_API_KEY set as a Codespaces secret):
//   npm run eval:run -- --dataset eval/private/naspghan-2026 --max-dollars 5 --dry-run
//   npm run eval:run -- --dataset eval/private/naspghan-2026 --max-dollars 5
// Options: --models haiku,sonnet  --efforts low,medium  --repeats 3  --slices plenary,posters-1
//
// Spending protection: --max-dollars is required. The script estimates the whole run first and
// refuses to start if even the low estimate is over the cap; during the run, every request
// checks the money left and the run stops when it is gone. Runs go one full repeat at a time,
// so stopping at the cap leaves complete repeats rather than a scattering of pieces.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createClient, SpendGuard, SpendLimitReached } from '../src/lib/extraction/claude'
import { estimateCost, runExtraction } from '../src/lib/extraction/pipeline'
import { formatUsd, MODELS, type Effort, type ModelId } from '../src/lib/extraction/pricing'
import { GoldenSlice } from './golden'
import { readPdfText } from './readPdf'

const MODEL_ALIASES: Record<string, ModelId> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  'claude-haiku-5-5': 'claude-haiku-5-5',
  'claude-sonnet-5-5': 'claude-sonnet-5-5',
}
const EFFORTS: Effort[] = ['low', 'medium', 'high']

function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}

export async function loadDataset(dir: string, only?: string[]) {
  const config = JSON.parse(await readFile(join(dir, 'dataset.json'), 'utf8')) as { pdf: string; name: string }
  const files = (await readdir(join(dir, 'golden'))).filter((f) => f.endsWith('.json')).sort()
  const slices: GoldenSlice[] = []
  for (const file of files) {
    const parsed = GoldenSlice.safeParse(JSON.parse(await readFile(join(dir, 'golden', file), 'utf8')))
    if (!parsed.success) fail(`${file} is not a valid golden file:\n${parsed.error.message}`)
    if (!only || only.includes(parsed.data.id)) slices.push(parsed.data)
  }
  return { config, slices }
}

async function main() {
  const { values } = parseArgs({
    options: {
      dataset: { type: 'string' },
      models: { type: 'string', default: 'haiku,sonnet' },
      efforts: { type: 'string', default: 'low,medium' },
      repeats: { type: 'string', default: '3' },
      'max-dollars': { type: 'string' },
      slices: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  })

  if (!values.dataset) fail('Please give --dataset (for example eval/private/naspghan-2026).')
  const maxDollars = Number(values['max-dollars'])
  if (!(maxDollars > 0)) fail('Please give a spending cap, for example --max-dollars 5.')
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) fail('ANTHROPIC_API_KEY is not set. Add it as a Codespaces secret, then restart the Codespace.')

  const models = values.models.split(',').map((m) => MODEL_ALIASES[m.trim()] ?? fail(`Unknown model "${m}".`))
  const efforts = values.efforts.split(',').map((e) => {
    const effort = e.trim() as Effort
    return EFFORTS.includes(effort) ? effort : fail(`Unknown effort "${e}".`)
  })
  const repeats = Number(values.repeats)
  if (!(repeats >= 1)) fail('--repeats must be 1 or more.')

  const { config, slices } = await loadDataset(values.dataset, values.slices?.split(','))
  if (slices.length === 0) fail('No golden slices found.')
  const unreviewed = slices.filter((s) => !s.reviewed).map((s) => s.id)
  if (unreviewed.length > 0) console.warn(`Note: not yet reviewed by a person: ${unreviewed.join(', ')}`)

  console.log(`Reading ${config.pdf}...`)
  const allPages = await readPdfText(join(values.dataset, config.pdf))
  const docFor = (slice: GoldenSlice) => ({
    fileName: config.pdf,
    sha256: null,
    pages: allPages.filter((p) => slice.pages.includes(p.pageNumber)),
  })

  // ---- Estimate everything before spending anything
  const client = createClient(apiKey)
  let low = 0
  let high = 0
  console.log('\nEstimated cost per run (low to high), from free token counts:')
  for (const model of models) {
    for (const slice of slices) {
      const { lowUsd, highUsd } = await estimateCost(docFor(slice), client, model)
      console.log(`  ${MODELS[model].label.padEnd(48)} ${slice.id.padEnd(20)} ${formatUsd(lowUsd)} to ${formatUsd(highUsd)}`)
      low += lowUsd * efforts.length * repeats
      high += highUsd * efforts.length * repeats
    }
  }
  const runCount = models.length * efforts.length * repeats * slices.length
  console.log(`\n${runCount} runs, estimated ${formatUsd(low)} to ${formatUsd(high)}. Cap: ${formatUsd(maxDollars)}.`)
  if (values['dry-run']) return console.log('Dry run: nothing was spent.')
  // The high estimate has proved cautious (real Haiku runs cost about a third of it), and the
  // cap itself stops spending, so only refuse when even the low estimate cannot fit.
  if (low > maxDollars) {
    fail('Even the low estimate is over your cap. Use fewer --repeats, --models or --slices, or raise --max-dollars.')
  }
  if (high > maxDollars) {
    console.log('The high estimate is over the cap, so the run may stop early at the cap. Completed repeats are kept.')
  }

  // ---- Run
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outDir = join('eval', 'runs', stamp)
  await mkdir(outDir, { recursive: true })
  // One guard for the whole evaluation: every request, in every run, checks the same budget,
  // so money spent by a run that fails partway still counts.
  const guard = new SpendGuard(maxDollars)

  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const model of models) {
      for (const effort of efforts) {
        for (const slice of slices) {
          const name = `${slice.id}__${model}__${effort}__r${repeat}`
          process.stdout.write(`${name.padEnd(56)} `)
          try {
            const result = await runExtraction(docFor(slice), {
              client,
              model,
              effort,
              spendLimitUsd: maxDollars,
              guard,
            })
            await writeFile(
              join(outDir, `${name}.json`),
              JSON.stringify({ slice: slice.id, model, effort, repeat, ...result }, null, 2),
            )
            console.log(
              `${formatUsd(result.spentUsd).padStart(8)} ${result.seconds.toFixed(0).padStart(4)}s  total ${formatUsd(guard.spentUsd)}`,
            )
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.log(`FAILED: ${message}`)
            await writeFile(join(outDir, `${name}.error.json`), JSON.stringify({ slice: slice.id, model, effort, repeat, error: message }, null, 2))
            if (error instanceof SpendLimitReached) {
              console.log(`\nStopped at the cap. Spent ${formatUsd(guard.spentUsd)}. Results so far are in ${outDir}.`)
              return
            }
          }
        }
      }
    }
  }
  console.log(`\nDone. Spent ${formatUsd(guard.spentUsd)}. Results: ${outDir}`)
  console.log(`Next: npm run eval:report -- --dataset ${values.dataset} --runs ${outDir}`)
}

// Run only when started from the command line (report.ts imports loadDataset from here).
if (process.argv[1]?.endsWith('run.ts')) await main()
