// Scores saved runs (from run.ts) against the golden slices and writes a comparison table.
// Costs nothing: it only reads files.
//
// Usage:
//   npm run eval:report -- --dataset eval/private/naspghan-2026 --runs eval/runs/<folder>
//
// Writes two files:
//   eval/reports/<folder>.md         numbers only, safe to publish
//   eval/runs/<folder>/details.md    which titles were missed or invented (private: these are
//                                    the conference's own titles)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import { formatUsd, MODELS, type ModelId } from '../src/lib/extraction/pricing'
import type { ExtractionResult } from '../src/lib/extraction/pipeline'
import { loadDataset } from './run'
import { FIELDS, scoreSlice, sumPrf, type PRF, type SliceScore } from './scoring'

interface SavedRun extends ExtractionResult {
  slice: string
  model: ModelId
  effort: string
  repeat: number
}

/** The headline numbers for one complete pass over all slices. */
interface RepeatScore {
  presentations: PRF
  presenters: PRF
  authors: PRF
  institutions: PRF
  distinctInstitutions: PRF
  sessions: PRF
  fieldAccuracy: Record<string, number>
  costUsd: number
  seconds: number
}

// The decision rule, written down before any results were seen (docs/plan.md): choose Haiku
// unless Sonnet is clearly better on the things a reader of the digest cares about most.
const RULE = {
  presentersF1: 0.05,
  institutionsF1: 0.05,
  presentationRecall: 0.03,
}

function combine(scores: SliceScore[], runs: SavedRun[]): RepeatScore {
  const fieldAccuracy: Record<string, number> = {}
  for (const field of FIELDS) {
    const correct = scores.reduce((n, s) => n + s.fields[field].correct, 0)
    const total = scores.reduce((n, s) => n + s.fields[field].total, 0)
    fieldAccuracy[field] = total === 0 ? 1 : correct / total
  }
  return {
    presentations: sumPrf(scores.map((s) => s.presentations)),
    presenters: sumPrf(scores.map((s) => s.presenters)),
    authors: sumPrf(scores.map((s) => s.authors)),
    institutions: sumPrf(scores.map((s) => s.institutions)),
    distinctInstitutions: sumPrf(scores.map((s) => s.distinctInstitutions)),
    sessions: sumPrf(scores.map((s) => s.sessions)),
    fieldAccuracy,
    costUsd: runs.reduce((n, r) => n + r.spentUsd, 0),
    seconds: runs.reduce((n, r) => n + r.seconds, 0),
  }
}

/** "0.94 (0.91-0.96)": the average over repeats, with the lowest and highest in brackets. */
function spread(values: number[], format = (v: number) => v.toFixed(2)): string {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  if (values.length === 1) return format(mean)
  return `${format(mean)} (${format(Math.min(...values))}-${format(Math.max(...values))})`
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length

async function main() {
  const { values } = parseArgs({ options: { dataset: { type: 'string' }, runs: { type: 'string' } } })
  if (!values.dataset || !values.runs) {
    console.error('Usage: npm run eval:report -- --dataset <folder> --runs <eval/runs/folder>')
    process.exit(1)
  }
  const { slices } = await loadDataset(values.dataset)
  const bySlice = new Map(slices.map((s) => [s.id, s]))

  const files = (await readdir(values.runs)).filter((f) => f.endsWith('.json') && !f.endsWith('.error.json'))
  const runs: SavedRun[] = []
  for (const file of files) runs.push(JSON.parse(await readFile(join(values.runs, file), 'utf8')) as SavedRun)
  const failures = (await readdir(values.runs)).filter((f) => f.endsWith('.error.json')).length

  // Group: configuration (model + effort) -> repeat -> runs over the slices.
  const configs = new Map<string, Map<number, SavedRun[]>>()
  for (const run of runs) {
    const key = `${run.model}|${run.effort}`
    const repeats = configs.get(key) ?? new Map<number, SavedRun[]>()
    repeats.set(run.repeat, [...(repeats.get(run.repeat) ?? []), run])
    configs.set(key, repeats)
  }

  const results: { model: ModelId; effort: string; repeats: RepeatScore[]; details: string[] }[] = []
  for (const [key, repeats] of configs) {
    const [model, effort] = key.split('|') as [ModelId, string]
    const repeatScores: RepeatScore[] = []
    const details: string[] = []
    for (const [repeat, repeatRuns] of [...repeats].sort((a, b) => a[0] - b[0])) {
      const scores = repeatRuns.flatMap((run) => {
        const golden = bySlice.get(run.slice)
        return golden ? [scoreSlice(golden, run.digest)] : []
      })
      repeatScores.push(combine(scores, repeatRuns))
      for (const s of scores) {
        if (s.missed.length + s.extra.length === 0) continue
        details.push(`### ${MODELS[model].label}, effort ${effort}, repeat ${repeat}, slice ${s.slice}`)
        details.push(...s.missed.map((t) => `- missed: ${t}`), ...s.extra.map((t) => `- extra: ${t}`), '')
      }
    }
    results.push({ model, effort, repeats: repeatScores, details })
  }
  results.sort((a, b) => a.model.localeCompare(b.model) || a.effort.localeCompare(b.effort))

  // ---- The table
  const lines: string[] = []
  const name = basename(values.runs)
  lines.push(`# Evaluation report: ${name}`, '')
  lines.push(
    `Golden slices: ${slices.map((s) => `${s.id} (${s.presentations.length} presentations${s.reviewed ? '' : ', NOT YET REVIEWED'})`).join(', ')}.`,
    `Runs scored: ${runs.length}. Failed runs: ${failures}.`,
    '',
    'Each cell is the average over repeats, with the lowest and highest in brackets. F1 balances',
    'precision (how much of what was reported is right) and recall (how much of what is there was found).',
    '',
  )
  lines.push(
    '| Model | Effort | Repeats | Presentations F1 | Presentation recall | Presenters F1 | Authors F1 | Institutions F1 | Distinct institutions F1 | Sessions F1 | Cost per pass | Time per pass |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  )
  for (const r of results) {
    const col = (pick: (s: RepeatScore) => number) => spread(r.repeats.map(pick))
    lines.push(
      `| ${MODELS[r.model].label.split(' (')[0]} | ${r.effort} | ${r.repeats.length} | ${col((s) => s.presentations.f1)} | ${col((s) => s.presentations.recall)} | ${col((s) => s.presenters.f1)} | ${col((s) => s.authors.f1)} | ${col((s) => s.institutions.f1)} | ${col((s) => s.distinctInstitutions.f1)} | ${col((s) => s.sessions.f1)} | ${spread(r.repeats.map((s) => s.costUsd), formatUsd)} | ${spread(r.repeats.map((s) => s.seconds), (v) => `${v.toFixed(0)}s`)} |`,
    )
  }

  lines.push('', '## Field accuracy on matched presentations', '')
  lines.push(`| Model | Effort | ${FIELDS.join(' | ')} |`, `|---|---|${FIELDS.map(() => '---').join('|')}|`)
  for (const r of results) {
    lines.push(
      `| ${MODELS[r.model].label.split(' (')[0]} | ${r.effort} | ${FIELDS.map((f) => spread(r.repeats.map((s) => s.fieldAccuracy[f]!))).join(' | ')} |`,
    )
  }

  // ---- The decision rule
  const strength = (r: (typeof results)[number]) =>
    mean(r.repeats.map((s) => s.presentations.f1 + s.presenters.f1 + s.institutions.f1))
  const best = (model: ModelId) =>
    results.filter((r) => r.model === model).sort((a, b) => strength(b) - strength(a))[0]
  const haiku = best('claude-haiku-5-5')
  const sonnet = best('claude-sonnet-5-5')
  lines.push('', '## Decision', '')
  lines.push(
    `Rule, set before seeing results: use Haiku unless Sonnet beats it by at least ${RULE.presentersF1 * 100} points of presenter F1,`,
    `${RULE.institutionsF1 * 100} points of institution F1, or ${RULE.presentationRecall * 100} points of presentation recall.`,
    '',
  )
  if (haiku && sonnet) {
    const gap = (pick: (s: RepeatScore) => number) => mean(sonnet.repeats.map(pick)) - mean(haiku.repeats.map(pick))
    const gaps = {
      presenters: gap((s) => s.presenters.f1),
      institutions: gap((s) => s.institutions.f1),
      recall: gap((s) => s.presentations.recall),
    }
    const sonnetWins =
      gaps.presenters >= RULE.presentersF1 ||
      gaps.institutions >= RULE.institutionsF1 ||
      gaps.recall >= RULE.presentationRecall
    const points = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} points`
    lines.push(
      `Best Haiku setting: effort ${haiku.effort}. Best Sonnet setting: effort ${sonnet.effort}.`,
      `Sonnet minus Haiku: presenter F1 ${points(gaps.presenters)}, institution F1 ${points(gaps.institutions)}, presentation recall ${points(gaps.recall)}.`,
      '',
      `**Verdict: use ${sonnetWins ? 'Claude Sonnet 5.5' : 'Claude Haiku 5.5'}, effort ${sonnetWins ? sonnet.effort : haiku.effort}.**`,
    )
  } else {
    lines.push('Both models need results before the rule can be applied.')
  }

  const report = lines.join('\n') + '\n'
  await mkdir(join('eval', 'reports'), { recursive: true })
  await writeFile(join('eval', 'reports', `${name}.md`), report)
  await writeFile(join(values.runs, 'details.md'), results.flatMap((r) => r.details).join('\n') + '\n')
  console.log(report)
  console.log(`Saved eval/reports/${name}.md (numbers only) and ${join(values.runs, 'details.md')} (private titles).`)
}

await main()
