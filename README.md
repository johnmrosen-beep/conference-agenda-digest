# Conference Agenda Digest

Turn a medical conference program book (PDF) into something you can take in at a glance: a short
overview, charts of the main themes, presenters and institutions, and a searchable list you can
turn into your own agenda PDF.

**Live site:** https://johnmrosen-beep.github.io/conference-agenda-digest/ (try the free demo; no key needed)

Built by a pediatric gastroenterologist with an AI coding assistant (Claude Code), as a portfolio
project. The design plan is in [docs/plan.md](docs/plan.md).

## What it does

1. **Reads the PDF in your browser.** The text is extracted on your computer and cleaned up:
   superscript affiliation numbers are marked, watermarks and running headers are removed, and
   each page is put in reading order.
2. **Builds a digest with Claude**, using your own API key:
   - an *outline* pass maps the sessions, rooms, times and themes;
   - the pages are read in small groups, four at a time, for every talk, abstract and poster with
     its authors and affiliations;
   - plain code merges the answers, attaches each item to its session, and fills in numbers and
     times printed on the page that the model missed;
   - one small call merges institution spellings ("UAMS" and "University of Arkansas for Medical
     Sciences"), and one writes the overview.
3. **Checks everything before showing it.** Every title and name must actually appear on the page
   it came from, dates must fall within the conference, and so on. Anything doubtful is listed as
   a "thing to double-check" rather than silently trusted.
4. **Shows the digest**: overview and highlights, headline numbers, charts (click a bar to list its
   presentations), and search by keyword, day, type and theme.
5. **Exports your agenda**: tick presentations, and download a PDF grouped by day with clashes
   between rooms flagged.

A 329-page program book takes about 10 to 15 minutes and costs well under a dollar with the
default model. Finished digests are saved in your browser and reopen for free; an interrupted
build can be resumed without paying again for the finished part.

## How accurate is it?

Measured, not guessed. The [evaluation harness](eval/README.md) scores the app against 62
presentations from a real program book that were checked by hand against the PDF, running each
setting three times:

| Claude Haiku 5.5, medium effort | Score |
|---|---|
| Presentations found (F1) | 1.00 |
| Presenters, authors (F1) | 1.00 |
| Institutions (F1) | 0.99 |
| Date, start time, room | 0.99–1.00 |
| Cost for the 14 test pages | $0.04 |

The model was chosen with a rule written down before any results: use the cheaper Haiku unless
the larger Sonnet was clearly more accurate. It wasn't, at about 13 times the cost. The
[evaluation notes](eval/reports/2026-10-22-notes.md) tell the whole story, including the fixes the
measurements led to (text out of reading order, times on their own line, institution names) and
the two changes made to the answer key after seeing results.

## Your API key and your data

The app runs entirely in your browser. There is no server.

- **You bring your own Anthropic API key**, and it pays for the work. API use is billed through an
  [Anthropic Console](https://console.anthropic.com/) account; Claude.ai Free/Pro/Max plans don't
  include it. Use a dedicated key with a low monthly spend limit.
- **Before anything is sent**, the app counts the tokens (free) and shows an estimated cost and
  time. You set a spending limit, and the build stops before any request once it's reached.
- **The key is kept for the current tab only** by default. "Remember on this device" is opt-in
  (don't use it on a shared computer), and **Forget key** removes it. It is never saved with
  digests, build progress or downloaded files.
- **The key and the PDF text go only to `api.anthropic.com`.** A strict Content Security Policy
  enforces this, and the site loads no analytics, trackers or third-party scripts.
- **Saved digests stay in this browser** (IndexedDB), listed under "Your digests" with a Delete
  button.
- The project owner's key is never in the app, this repository or GitHub Actions.

## Copyrighted material is never committed

Real conference program books are copyrighted. They, the text extracted from them, the hand-made
answer keys and the raw model outputs all stay in git-ignored folders (`sample-pdfs/`,
`eval/private/`, `eval/runs/`). The public demo and the unit tests use a fictional conference
([src/demo/demoDigest.ts](src/demo/demoDigest.ts)), and the published evaluation reports contain
numbers only.

## Development

Nothing needs to be installed locally. Open the repository in a GitHub Codespace (Node.js 24) and run:

```bash
npm install
npm run dev        # local preview with live reload
npm run build      # typecheck, then production build into dist/
npm test           # unit tests (vitest), no API calls
```

Evaluation (needs `ANTHROPIC_API_KEY` as a Codespaces secret and the private dataset; see
[eval/README.md](eval/README.md)):

```bash
npm run eval:run -- --dataset eval/private/<dataset> --max-dollars 2   # runs, under a hard cap
npm run eval:report -- --dataset eval/private/<dataset> --runs eval/runs/<folder>   # free
npm run eval:remerge -- --dataset eval/private/<dataset> --runs eval/runs/<folder>  # free re-merge
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. CI (`ci.yml`)
typechecks and runs the unit tests. Neither workflow uses an API key.

**Stack:** React, Vite and TypeScript; pdf.js for reading PDFs; the Anthropic TypeScript SDK with
structured outputs; Zod for the data schema and validation; jsPDF for the agenda. Exact pinned
versions and self-hosted fonts.

**Code map:**

| Folder | What's there |
|---|---|
| `src/lib/pdf/` | reading the PDF and cleaning its text |
| `src/lib/extraction/` | the schema, prompts, Claude calls, merging, validation |
| `src/lib/digest/` | counting, search, and building the agenda |
| `src/lib/export/` | the agenda PDF |
| `src/lib/storage/` | saved digests and build progress |
| `src/components/` | the screens |
| `eval/` | the evaluation harness |
| `tests/` | unit tests |
