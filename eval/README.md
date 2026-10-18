# Evaluation harness

Measures how accurately the app extracts a conference program, so the choice of model is a
measurement, not a guess.

## How it works

1. **Golden slices**: a few pages of a real program book, with every presentation and session
   on them written out correctly and checked by a person (`golden.ts` describes the format).
2. **Run** (`run.ts`): the app's own extraction code runs on just those pages, for each model
   and effort level, several times. Every answer is saved, including Claude's raw output.
3. **Score** (`scoring.ts`, `report.ts`): each run is compared with the golden slices.
   - *Precision*: of what the model reported, the share that is right (positive predictive value).
   - *Recall*: of what is really there, the share the model found (sensitivity).
   - *F1*: one number balancing the two.

   Scored separately: presentations, presenters, all authors, institutions (per presentation
   and as distinct names), sessions, and each field (number, kind, session, date, time, room).
4. **Decide**: the report applies a rule written down before any results were seen: use Haiku
   unless Sonnet beats it by at least 5 points of presenter or institution F1, or 3 points of
   presentation recall.

Repeats matter: the same model and settings can give different answers on different runs, so
each configuration is run several times and the report shows the average and the range.

## Privacy

Real program books are copyrighted, so everything derived from them stays out of the public repo:

| Folder | Contents | In git? |
|---|---|---|
| `eval/private/<dataset>/` | the PDF, `dataset.json`, `golden/*.json` | no (gitignored) |
| `eval/runs/<timestamp>/` | every run's digest and raw answers, `details.md` with missed titles | no (gitignored) |
| `eval/reports/` | the comparison tables: numbers only | yes |

The public example is the fictional demo conference (`src/demo/demoDigest.ts`), whose golden
file is generated from it; the unit tests in `tests/scoring.test.ts` use it.

## Running it (in a Codespace)

One-time setup:
- Add `ANTHROPIC_API_KEY` as a Codespaces secret for this repository, then restart the Codespace.
- Drag the program book PDF into `eval/private/naspghan-2026/`.

```bash
npm run eval:run -- --dataset eval/private/naspghan-2026 --max-dollars 5 --dry-run
npm run eval:run -- --dataset eval/private/naspghan-2026 --max-dollars 5
npm run eval:report -- --dataset eval/private/naspghan-2026 --runs eval/runs/<folder printed by the run>
```

Options for `eval:run`: `--models haiku,sonnet`, `--efforts low,medium`, `--repeats 3`,
`--slices plenary,posters-thu`. `--max-dollars` is required: the run is estimated first and
refused if the estimate is over the cap, and one spending guard covers every request.
