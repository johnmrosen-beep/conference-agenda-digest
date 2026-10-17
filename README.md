# Conference Agenda Digest

Turn a medical conference program book (PDF) into a short summary, charts of the main themes, presenters and institutions, and a searchable list you can export as your own agenda PDF.

**Live site:** https://johnmrosen-beep.github.io/conference-agenda-digest/

> Status: early preview. This is the empty, styled app shell. PDF reading, extraction, charts and export arrive in later milestones (see [docs/plan.md](docs/plan.md)).

## Bring your own API key

The app runs entirely in your browser. There is no server.

- To build a digest, you paste **your own** Anthropic API key. Your key pays for the work. API usage is billed through an Anthropic Console account; Claude.ai Free/Pro/Max plans don't include it.
- The key is kept **for the current tab only** by default. "Remember on this device" is opt-in, and **Forget key** removes it.
- The page can only send requests to `api.anthropic.com`. A strict Content Security Policy enforces this, and the site loads no analytics, trackers or third-party scripts.
- The project owner's key is never in the app, this repository or GitHub Actions.
- No key? **Demo mode** (coming soon) shows a finished digest of a made-up conference for free.

Use a dedicated key with a low spending limit.

## Sample PDFs are never committed

Real conference books are copyrighted. They stay in the git-ignored `sample-pdfs/` folder on the owner's computer and are never committed, together with any text extracted from them. The repository's `.gitignore` blocks `*.pdf`. The public demo uses a fictional conference.

## Development

Nothing needs to be installed locally. Open the repository in a GitHub Codespace, which comes with Node.js 24, and run:

```bash
npm install
npm run dev        # local preview with live reload
npm run build      # typecheck, then production build into dist/
npm test           # unit tests (vitest)
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. CI (`ci.yml`) typechecks and runs the unit tests. Neither workflow uses an API key.

Stack: React, Vite and TypeScript, with exact pinned versions and self-hosted fonts.
