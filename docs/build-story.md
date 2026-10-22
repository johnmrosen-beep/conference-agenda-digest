# Building a Conference Agenda Digest

---

## Portfolio card (draft)

**LATEST BUILD**

**Making sense of a 300-page conference program**

A web app built with Claude and Claude Code that reads a medical conference program book (PDF)
and turns it into an overview, charts of the main themes, presenters and institutions, and a
searchable list you can export as your own agenda PDF. Visitors use their own Anthropic API key,
or try a free demo.

The part I'll remember: before trusting the AI, we measured it, the same way we'd validate a new
lab test. This third project had far more real coding structure than the first two, and I learned
it by doing the same steps over and over.

*Use the app →* · *Read the full build story →*

---

## Purpose

I'm writing this while attending the 2026 NASPGHAN Annual Meeting. I love this meeting. It's
packed with good content, but between the science, the education and the social side, it gets
hectic, and the program book runs to hundreds of pages, with several sessions going at once in
different rooms. Planning my time before I arrive makes all the difference.

So I wanted a tool that could take any conference program PDF and answer two questions quickly:
what is this meeting actually about, and which of these presentations should I see?

So the goal had two halves. First, a digest: the conference at a glance, with the main themes,
the most represented institutions, and the people presenting. Second, a way to search, pick, and
export a personal agenda with times and rooms.

I also had a learning goal. For my third project I wanted to try something an experienced
developer would actually do: not just build the thing, but **measure how well it works**.

## The Process

**Planning first.** Before any code, Claude read two real sample PDFs (a 329-page program book and
a 900-page abstract supplement) and described how they were laid out, and where extraction would
be hard: superscript numbers glued to names, a poster's time printed 20 pages before the poster,
the same hospital spelled five ways. Then we agreed on a written plan: a data format, an
architecture, and spending safeguards.

**Built in ten milestones**, each on its own branch, checked by automated tests before it could
reach the live site:

1. An empty, styled app shell matching this portfolio.
2. Reading the PDF's text in the browser, and cleaning it up.
3. The data format, validation checks, and a made-up demo conference.
4. The AI extraction itself: an outline of the sessions, then the pages in small groups, four at
   a time.
5. An evaluation harness to measure accuracy (more below).
6. Fixing the start times the evaluation showed were wrong.
7. Merging different spellings of the same institution.
8. The screens: overview, charts and search.
9. The personal agenda PDF, with clashes between rooms flagged.
10. Surviving a closed browser window: saved digests, and builds that resume where they stopped.

**Measuring instead of guessing.** I hand-checked 62 presentations from the program book against
the PDF to make an answer key. A script then ran the app's own extraction on those pages, three
times for each setting, and scored it: precision (how much of what it reported was right, like
positive predictive value) and recall (how much of what was there it found, like sensitivity).

Before seeing any results, we wrote down a rule for choosing the AI model: use the cheaper one
(Claude Haiku) unless the larger one (Claude Sonnet) was clearly more accurate. It wasn't, at
about 13 times the cost, so the app uses Haiku. The final scores were 1.00 for finding
presentations, presenters and authors, 0.99 for institutions, and 0.99 to 1.00 for dates, times
and rooms. A full program book takes 10 to 15 minutes and costs well under a dollar.

**Bring your own key.** The app runs entirely in the browser with no server, and each visitor
uses their own Anthropic API key, so a stranger can't run up a bill on mine. Nothing is sent until
the app has shown an estimated cost and the user has set a spending limit.

## Barriers Along the Way

**The measurements kept finding real problems**, and that was the point:

- Start times were wrong about 1 time in 10. Tracing them found that one page of the PDF stores
  its text bottom-half-first, so the AI was reading a scrambled page. Putting every page in
  reading order took start-time accuracy from 0.92 to 1.00.
- The first attempt at merging institution names made accuracy *worse* (0.98 to 0.89), because I
  had asked the AI for each organization's "official name," and it wrote names that appear nowhere
  in the program. Letting the AI only decide which names belong together, and keeping a name that
  is actually printed, brought it to 0.99.
- Early full runs silently lost a whole poster session (about 300 abstracts), dropped abstracts
  that were split across groups of pages, and gave posters to the wrong day. Each was caught by
  checking the results against the program, and each became a rule in the code and a test.

**The answer key had mistakes too.** The evaluation flagged a poster that the AI kept finding and
my answer key didn't have. The AI was right. We fixed the key and wrote down that we'd changed it
after seeing results, which is the kind of thing an honest evaluation has to disclose.

**Copyright and privacy.** Conference program books are copyrighted, so the real PDFs, their
text, my answer key and every AI output stay off the public repository. The public demo uses a
completely made-up conference.

**Everyday friction.** The online workspace I used (a GitHub Codespace) shut itself down partway
through long runs until I found the idle-timeout setting. I typed the next command into a terminal
that was still busy with the last one. My first "merge conflict" turned out to be the same file
saved in two places. And the first full build looked frozen for minutes, until we added a live
display of progress and time remaining. None of these were hard once explained, but each one was
new to me.

## What I Learned

**Validate the AI like a diagnostic test.** "It seems to work" is not a result. A small,
hand-checked reference standard, a rule fixed before looking, and repeated runs turned "I think
it's accurate" into numbers I can defend, and they pointed straight at what to fix.

**Most fixes weren't AI fixes.** The AI's reading was rarely the weak link. Scrambled page text,
how pages were grouped, and how answers were merged caused most errors, and plain code fixed them.
The AI is one part of a system, and the system is what has to be right.

**Cost and trust are design decisions.** Bring-your-own-key, an estimate before every run, a hard
spending limit, and saving progress so a closed tab doesn't waste money were as much a part of
the product as the charts.

**Why AI, rather than classic programming?** There are really two uses of AI here.

*Inside the app, Claude reads the program.* The traditional approach would be hand-written rules:
"the speaker's name follows the time," "a superscript number points to an affiliation," "a poster
belongs to the session header above it." Rules like that can be made to work for one program
book, and they break on the next, because every conference lays out its program differently, and
even one book can scramble its own page order. A language model reads a page roughly the way a
person does, so it copes with a layout it has never seen. Traditional code is like a form that
only fits one hospital's paperwork; the AI is more like a trained reader who can make sense of
any hospital's chart. What the AI is not good at is bookkeeping, so the app splits the work:
Claude reads, and plain code does the counting, merging, time arithmetic and checking.

*Outside the app, Claude Code wrote the software.* A physician with no programming background
built a working, tested, deployed web app in a couple of weeks of part-time work, something that
would normally take a developer, or a team, much longer. My time went into the clinical problem
and the judgment calls rather than the syntax.

**Is this "vibe coding"?** The term, coined in 2025, means describing what you want to an AI,
accepting the code it writes without really reading it, and judging it only by whether it seems
to work. By that definition, part of this project fits: I didn't write the code, and I haven't
read most of it. But the way the work was checked is what separates it:

- **A written plan came first.** The data format, the architecture and the spending safeguards
  were proposed, discussed and approved before any code existed.
- **Every change was tested automatically.** Each piece of work lived on its own branch, and
  automated tests and type checks had to pass before it could reach the live site. They caught
  real mistakes along the way.
- **Accuracy was measured against an independent standard.** I checked 62 presentations against
  the PDF myself, and the app was scored against that answer key, with the rule for choosing a
  model written down before seeing any results. Vibe coding trusts that it seems right; this
  measured how right it is.
- **Fixes followed evidence, not trial and error.** The wrong start times were traced to a
  scrambled page, fixed, and re-measured, taking accuracy from 0.92 to 1.00.

One honest caveat: the AI also wrote the automated tests, so they mainly check that the code does
what it was meant to do. The answer key I built from the PDF is the truly independent check,
because it came from the source and was verified by me, not by the AI.

So the fairest description is *AI-assisted development, directed and validated by a domain
expert*. I defined the problem, made the judgment calls (which hospitals count as one
institution, what counts as a presentation), approved each step, and verified the results. It
felt less like asking for an app and more like learning how software actually gets built.

**Why not just upload the PDF to a chatbot?** It's a fair question, since the app uses the same
kind of AI. For a quick question about a short agenda ("what's on IBD Friday morning?"), a chatbot
works well and may be simpler. For a full program book, there are real differences:

- **Size.** A 300-page program holds over a thousand presentations. That is more than a chatbot
  can carefully read and write back in one reply, so it summarizes, samples, or stops partway,
  often without saying so. The app works through the book a few pages at a time, so every page is
  read closely, and a group that gets cut off is split and sent again.
- **Knowing what's missing.** A chatbot's answer looks complete whether or not it is. The app's
  results were scored against a hand-checked answer key (0.99 to 1.00), and every build runs
  automatic checks, such as confirming that each name and title actually appears in the PDF. The
  errors this project found, a lost session of 300 posters, scrambled page text, wrong start
  times, are exactly the kind a chatbot would make silently.
- **Exact, not approximate.** A chatbot can blur a title, guess a time, or "tidy up" a hospital's
  name. The app copies text as printed, and plain code does the arithmetic and the bookkeeping:
  start and end times, room clashes, merging one hospital's five spellings.
- **A tool, not a conversation.** The result is a saved digest you can search, filter by person,
  institution or theme, pick from, and export as a clean agenda PDF with clashes flagged. It is
  the same every time you open it, rather than a new answer each time you ask.

The trade-off is cost and setup: the app needs an API key and spends well under a dollar per
book, while a chatbot may already be part of a subscription. For planning a large meeting, I
think completeness and accuracy are worth it.

**Real structure, learned by repetition.** This third project had much more of the scaffolding
real software uses: a separate branch for each piece of work, automated tests that run before
anything goes live, pull requests, and a workspace in the cloud. None of it made sense to me the
first time. By the tenth branch, the routine (switch, pull, test, commit, open a pull request,
wait for the green check, merge) had become second nature.

The timing was a little ironic: I finished the app after this year's NASPGHAN meeting had already
started. But it's ready for DDW, ANMS, and the next NASPGHAN, and for anyone else who wants to see
a packed program at a glance before they go.

*View the project →*
