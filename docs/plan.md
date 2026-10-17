# Conference Agenda Digest — Design Plan (draft for sign-off)

Status: **approved 2026-10-17.** No app code has been written yet.

Decisions made at sign-off:
- **Golden data:** golden files for the real (copyrighted) samples stay private in `eval/private/`. The public repo gets a made-up conference PDF and its golden file.
- **Presenter:** for talks, the listed speaker(s). For abstracts, the first author, labelled as an assumption, with a chart toggle to count all authors.
- **Scope:** version 1 is built and tested on program books. Linking an abstract book to its program by abstract number is phase 2.
- **Demo mode:** a bundled digest of the made-up conference, so visitors without an API key can try the app.
- **Billing:** whoever's API key is used pays. Claude.ai Free/Pro plans don't include API usage.

---

## 1. What the sample PDFs look like

Two samples, both from the NASPGHAN 2026 Annual Meeting (San Diego, Oct 21–24, 2026):

| | Program Book | Abstract Book (JPGN Reports supplement) |
|---|---|---|
| Pages | 329 | 907 (192 MB, mostly figure images) |
| Text size | ~565k characters (~140k tokens) | ~2.5M characters (~600k tokens) |
| Has dates / times / rooms | Yes | **No** |
| Has abstract bodies | No (title + authors + affiliations only) | Yes (Background / Methods / Results / Conclusions) |
| Abstracts covered | All ~973, including case reports | ~500 research abstracts. Case reports are mostly left out. |
| Shared key | Abstract number (e.g. "611") | Same abstract number ("611.") |

### Program Book: how it is organized
- **Front matter, roughly pp. 1–17, is mostly not program content:** registration hours, CE credits, sponsor lists, exhibitor booths, committee meetings, industry satellite symposia (labelled "not official NASPGHAN events"), and the Baby Shark Tank competition.
- **Posters (Poster Sessions I–III).** Each poster session starts with a header block: session name, date, time window and room ("Pacific Ballroom"). The posters follow underneath, grouped by **category headings** such as IBD, Hepatology, EGID, Neurogastroenterology/Motility, Nutrition and Obesity, and Trials in Progress. Each poster is a number, an ALL-CAPS title, the authors, and numbered affiliations. An asterisk after the number means "Poster of Distinction". Each poster session runs for dozens of pages, but the date and time are printed only once, at the top.
- **Talk sessions** (Plenary, Concurrent Sessions I–VI, Meet-the-Professor, LASPGHAN). Each block has a session title, date, time range, room and moderators. Under it is a list of time slots. A slot is one of two things:
  - an **invited talk**: time, title, then "Name, credentials, institution", followed by learning objectives, or
  - an **oral abstract**: time, abstract number, title, then the full author list and affiliations.
- Several concurrent sessions run **at the same time in different rooms**, which is exactly why a personal agenda is useful.
- **Awards and keynotes** appear as labels in front of a talk ("William F Balistreri Keynote Lecture", "Richard J. Grand and John B. Watkins Prize", "Young Faculty Investigator Award").
- **An author index** at the end lists "Surname, Initial" with abstract numbers. It's useful as a free cross-check.
- **The Postgraduate Course and Single Topic Symposia (Wed/Thu) are not in this book.** Only the CE credit page mentions them. The digest can only summarize what the PDF actually contains.

### Abstract Book: how it is organized
- About one abstract per page. Each one has the number and title, the authors with superscript affiliation numbers, the affiliations, and then structured body text. Figures and tables come through as jumbled text fragments.
- **No schedule information at all.** On its own, an abstract book can only give you topics, people and institutions. A personal agenda with times and rooms needs the Program Book.
- Every page has a download watermark containing **the downloader's name** and the download date. Together with the copyright line, this is another reason these files must never be committed.
- Withdrawn abstracts still appear, as for example "312. WITHDRAWN".

### Things that will make extraction hard
1. **Superscript affiliation numbers get flattened into the text.** "Hassan⁵" becomes "Hassan5", and "¹DHQ Hospital" becomes "1DHQ Hospital". The model has to work out which digits are markers. *Mitigation:* when we read the PDF in the browser we can see each character's size and position, so we can mark superscripts explicitly as `^5` before sending the text.
2. **Context lives far from the item.** A poster on page 40 belongs to the "Poster Session I, Thu Oct 22, 5–7 PM, Pacific Ballroom" header printed on page 18. If we cut the document into chunks, later chunks lose that context. *Mitigation:* a first "outline" pass (see §3).
3. **Multi-column and wrapped layouts.** The participant name grid splits names across lines ("Behbahani-" / "Nejad"). In at least one oral-abstract session, the extracted text order is scrambled: one abstract's number and title start disappear. A few oral abstracts have no time printed.
4. **Mistakes in the source itself.** Examples: "Saturday, October 8" in the Speaker Ready Room hours, "Friday October 24" on the committee page, and the word "breakfast" spliced into a title ("INTEbreakfastSTINAL"). Validation should flag these, not trust them.
5. **Institution name variants (entity resolution).** "Children's Hospital of Philadelphia" vs "The Children's Hospital of Philadelphia". "Childrens Hospital Colorado" vs "Children's Hospital Colorado". "Rady Children's Hospital/UCSD" vs "Rady Children's Health". "University of Alabama at Birmingham Health System" vs "The University of Alabama at Birmingham". Affiliations also mix in departments ("Pediatrics, University at Buffalo, Buffalo, NY, USA").
6. **Person name variants.** Talks show "Carlo Di Lorenzo, MD", author lists show "Carlo Di Lorenzo", and the index shows "Di Lorenzo, C". There is also inconsistent capitalization ("farya subhani", "moshood omotayo").
7. **Accented characters** (Spanish-language LASPGHAN session, Mexican and Latin American institutions) must survive extraction intact: "Nestlé", "León", "Cancún".
8. **Lots of non-scientific content** (sponsors, exhibitors, CE text, committee meetings, socials, breaks) has to be labelled so it doesn't skew the charts.
9. **"Presenter" is ambiguous for abstracts.** Talks name a speaker. For posters and oral abstracts, the book lists all authors but doesn't mark who is presenting.
10. **Size.** These files are far too big for one response. A 973-abstract book produces roughly 120k+ tokens of structured output, so extraction must be split into chunks.

---

## 2. Proposed data schema

One JSON "digest" per uploaded PDF. The model never makes up IDs. It returns plain records, and our code assigns IDs and links everything together.

```text
Digest
├─ schema_version, source { file_name, sha256, page_count, doc_kind: program | abstract_book | mixed,
│                           extracted_with { model, effort, date } }
├─ conference { name, acronym, year, organizers[], start_date, end_date, venue, city, region, country,
│               summary (generated paragraph), highlights[] { text, presentation_ids[] } }
├─ sessions[] { id, title, series ("Concurrent Session II"), session_type, is_scientific,
│               date, start_time, end_time, room, moderator_ids[], source_category?, source_pages[] }
├─ presentations[] { id, session_id?, abstract_number?, title, kind, award_label?,
│                    is_highlighted (e.g. Poster of Distinction), withdrawn,
│                    date, start_time, end_time, time_inferred (true = copied from the session),
│                    room, speaker_ids[], authors[] { person_id, affiliation_ids[], order },
│                    source_category? (verbatim heading, e.g. "INFLAMMATORY BOWEL DISEASE"),
│                    theme_ids[], source_pages[] }
├─ people[] { id, display_name, family_name, credentials? ("MD, MPH") }
├─ affiliations[] { id, raw_text (verbatim), department?, institution_id, city?, region?, country? }
├─ institutions[] { id, canonical_name, aliases[], city?, country?, type? (children's hospital |
│                   university | health system | industry | society | other) }
├─ themes[] { id, label, description, origin: document | generated }
└─ warnings[] { code, message, pages[] }   (e.g. DATE_OUTSIDE_CONFERENCE, TITLE_NOT_IN_SOURCE)
```

- `session_type`: `plenary | symposium | oral_abstracts | poster_session | workshop | meet_the_professor | industry | business_meeting | social | break | other`
- `kind`: `keynote | invited_talk | oral_abstract | poster | video_abstract | panel | award_lecture | other`
- **Presenter definition (proposed):** for talks, the listed speaker(s). For abstracts, the **first author**, marked as an assumption in the UI. Charts can switch between "presenters" and "all authors".
- **Themes** use two layers. `source_category` keeps the conference's own heading word for word. `themes` is a cleaned-up, conference-wide list, seeded from the document's categories when they exist and generated when they don't. Both are kept so we can measure how well the theme labelling agrees with the conference's own categories.

---

## 3. Architecture

**Stack:** React + Vite + **TypeScript** (same setup as the RVU app, plus types). Other pieces:
- `pdfjs-dist` to read PDF text in the browser
- the official `@anthropic-ai/sdk`
- **Zod** for schemas
- Recharts for charts
- jsPDF + autoTable for the agenda PDF
- IndexedDB to cache results

Deployed to GitHub Pages by a GitHub Actions workflow (`base: '/conference-agenda-digest/'`).

### How a PDF becomes a digest (all inside the viewer's browser)
1. **Read text (no AI, free).** pdf.js reads every page. We rebuild the lines, mark superscripts as `^n`, remove lines repeated on most pages (watermarks, running headers), join words hyphenated across line breaks, and add `=== PAGE n ===` markers.
2. **Pass 1, "Outline" (one call).** The model reads the whole text and returns:
   - the conference details
   - the list of sessions with dates, times, rooms and **page ranges**
   - the category headings
   - which pages are non-program material to skip

   This solves the "context lives far from the item" problem.
3. **Pass 2, "Detail" (many calls, several at a time).** The text is cut into chunks of about 10 pages with a one-page overlap. Each call gets its chunk plus the matching part of the outline and returns presentations, authors, affiliations and theme labels.
4. **Merge (code, free).** Remove duplicates from the overlaps (match by abstract number, or by title + time). Copy session date, time and room into presentations that don't print their own, and mark those `time_inferred`.
5. **Entity resolution.** Fix institution and person name variants in two steps:
   - Free, rule-based cleanup: drop "The", unify apostrophes, map "Childrens" to "Children's", and apply a small alias list.
   - One small model call that groups the remaining near-duplicate institution names and picks a canonical name.
6. **Pass 3, "Summary" (one small call).** Uses the assembled digest (keynotes, plenaries, award lectures, theme counts) to write the summary paragraph and highlights.
7. **Cache.** Save in IndexedDB under the PDF's fingerprint (SHA-256), so reopening the same PDF costs nothing. Digests can also be exported and imported as JSON.

### Calling Claude from the browser (BYO key)
- The SDK is created with `dangerouslyAllowBrowser: true`. The key is kept in the viewer's browser only. The default is "this tab only" (sessionStorage), with an opt-in "remember on this device" (localStorage). Requests go straight to `api.anthropic.com`.
- **Who pays:** whoever's key is used. API usage is billed through an Anthropic Console account with prepaid credits, separately from Claude.ai Free/Pro/Max subscriptions. A Pro subscription does *not* cover API calls.
- **Demo mode (decided):** a bundled, already-extracted digest of a made-up conference, so portfolio visitors without an API key can try the summary, charts, search and export at no cost. It uses the same synthetic conference as the public eval example.
- **The honest risk:** any script running on the page could read the key. So the site loads no analytics or third-party scripts, and the setup screen recommends a dedicated key with a spending limit.
- Before running, the app counts tokens and shows an **estimated cost** for the user to confirm.
- **Rough cost estimates, which the eval harness will replace with measured numbers:**

  | Document | Haiku 5.5 | Sonnet 5.5 |
  |---|---|---|
  | Program Book | ~$0.10–0.40 | ~$2–4 |
  | Abstract Book | Under $1 | ~$3–6 |

  Haiku is $0.10/$0.50 per million input/output tokens for prompts up to 100k tokens, and $0.50/$2.50 above that, which is another reason to keep chunks small. Sonnet 5.5 is $2/$10.

### Validation (every extraction is checked before the app uses it)
1. **Shape:** structured outputs (`output_config.format` with a strict JSON schema generated from the Zod schema) make the response valid JSON in our format. We also re-parse it with Zod, which catches cut-off responses (`max_tokens`) and refusals.
2. **Grounding (catches made-up content):** every title, name and abstract number must actually appear in that chunk's source text, using fuzzy matching. Anything that isn't found gets flagged.
3. **Logic checks:**
   - dates fall within the conference dates
   - start time is before end time
   - abstract numbers are unique
   - every author's affiliation marker matches a listed affiliation
   - each presentation's page falls inside its session's page range
4. **What happens on failure:** the chunk is retried once with the error messages included. If it still fails, the item is kept but shown with a ⚠ badge and listed in `warnings`. Nothing fails silently.

### Folder layout
```text
conference-agenda-digest/
  .github/workflows/  deploy.yml (build → Pages), ci.yml (typecheck + unit tests, no API calls)
  src/
    components/       ApiKeyPanel, Upload, Progress, Summary, Charts/, Search, AgendaExport
    styles/tokens.css portfolio palette: cream, serif headings, mono eyebrows, teal, gold rule
    lib/pdf/          extractText.ts, cleanText.ts
    lib/extraction/   schema.ts (Zod: single source of truth), prompts.ts, chunk.ts,
                      outline.ts, detail.ts, merge.ts, validate.ts
    lib/entities/     normalize.ts, resolve.ts
    lib/export/       agendaPdf.ts
    lib/cache/        db.ts
  eval/
    golden/           public synthetic example (fake conference) + its golden JSON
    private/          gitignored: real PDFs, extracted text, golden files for copyrighted samples
    runs/             gitignored raw model outputs
    reports/          committed comparison tables (numbers only, no source text)
    run.ts  score.ts  compare.ts  scoring/ (pure, unit-tested functions)
  tests/              vitest unit tests (scoring, validation, normalization)
  docs/               plan.md, build-story.md (later)
```

### Spend safeguards (requirement: the owner's personal cost must be strictly capped)
The goal is that no visitor, fork or leaked file can spend the owner's money, and that the owner's own spending has hard limits.

**Built into the design (no setup needed):**
- **The owner's key never ships anywhere.** It is not in the app, the repo or GitHub Actions. There is no server or proxy. The deployed site has no key it could use on anyone's behalf, so the "malicious visitor" attack has nothing to target. This is a permanent rule: the project never adds a backend that holds the owner's key.
- **CI never gets a key.** GitHub Actions only builds, type-checks and runs unit tests, none of which call the API. So a pull request from a fork cannot trigger paid calls.
- **No third-party scripts, plus a strict Content Security Policy.** The page may only send requests to `api.anthropic.com`. This protects keys that people type into the app.
- **Dependencies are few and pinned** with a lockfile, to reduce the risk of a compromised package.
- **The key is kept only for the current tab by default.** "Remember on this device" is opt-in, and there is a visible "Forget key" button.
- **Cost check before every run.** The app counts tokens, shows an estimate, and needs a click to confirm. It also stops partway through if actual spend goes over the estimate by a set margin.
- **The eval scripts have a hard budget.** They take a `--max-dollars` cap (default $5), estimate cost before starting, refuse to start if the estimate is over the cap, add up the real cost from each response, and stop the moment the total reaches the cap. A `--dry-run` mode shows the estimate without calling the API.

**One-time account settings (done by the owner):**
- **Anthropic Console:**
  - Create a dedicated workspace for this project, with a low monthly spend limit (e.g. $10).
  - Create a separate API key in that workspace.
  - Load only small amounts of prepaid credit, and keep **auto-reload off**. The credit balance then becomes the worst-case loss.
  - Delete the key when the eval work is finished.
- **GitHub:**
  - Store the key only as a Codespaces secret limited to this one repo, never as an Actions secret.
  - Keep the Codespaces spending limit at $0, so Codespaces stops at the free allowance instead of charging.
  - Keep secret scanning and push protection turned on.

---

## 4. Evaluation harness (the main learning goal)

**Idea:** before trusting a model, measure it against answers we know are correct (the "golden" files), the same way you'd test a new diagnostic against a reference standard.

- **Golden slices.** Instead of hand-labeling all 973 abstracts, we label representative page ranges where we know every right answer:
  - (a) Plenary + Concurrent Session I (invited talks, keynote, prize)
  - (b) a Concurrent Session II block (talks mixed with oral abstracts)
  - (c) a few pages of Poster Session I (long author lists, category headings, superscripts)
  - (d) the Research Abstracts session (prize labels, missing times, scrambled text order)
  - (e) about 10 pages of the Abstract Book, including a withdrawn abstract

  That's about 60–100 presentations in total. **Decided:** golden files for the real NASPGHAN samples stay private in the gitignored `eval/private/` folder. The public repo gets a small made-up conference PDF plus its golden file, so the eval can be demonstrated end to end. I draft each golden file by reading the source directly (not through the app). **You review and correct it** against the PDF. That human review step is what makes it "golden", and it guards against grading Claude with Claude's own answers.
- **Free whole-document checks**, which need no labeling:
  - abstract-number coverage: every number from 1 to 973 should appear exactly once
  - an author-index cross-check: each "Surname, Initial → abstract numbers" entry should match the extracted authors
- **Matching:** a predicted presentation matches a golden one if the abstract numbers are equal, or if the normalized titles are at least 90% similar.
- **Metrics, explained in clinical terms:**
  - **Precision** is the positive predictive value: of everything the model extracted, what fraction is real and correct.
  - **Recall** is sensitivity: of everything really in the PDF, what fraction did the model find.
  - **F1** is a single number that balances the two.

  These are computed for presentations, presenters, institutions and sessions. On top of that we measure:
  - accuracy for each field (date, time, room, session)
  - entity resolution: pairwise precision/recall on "are these two strings the same institution?"
  - theme agreement with the conference's own categories
  - validation-failure rate
  - **cost and time per document**
- **Comparison:** Haiku 5.5 vs Sonnet 5.5, each at two effort levels, with 3 repeat runs each so we can see how much results vary from run to run. Output is a table in `eval/reports/`.
- **Decision rule written down before we see results:** choose Haiku unless Sonnet beats it by ≥5 F1 points on presenters or institutions, or by ≥3 points on presentation recall. Fixing the rule in advance keeps us from talking ourselves into whichever result we happen to like. We can adjust the thresholds now, but not after the runs.
- **Where it runs:** Node scripts in a GitHub Codespace, with the API key stored as a Codespaces secret. The sample PDFs are dragged into the gitignored `eval/private/` folder inside the Codespace. The scripts use **the same extraction code as the app**, so we test exactly what ships. The scoring functions also have unit tests that run in CI for free.
