import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { makeChunks } from '../src/lib/extraction/chunk'
import type { ChunkPresentation, OutlineOutput } from '../src/lib/extraction/modelOutput'
import { planResume, runExtraction, type Checkpoint } from '../src/lib/extraction/pipeline'

const pages = [1, 2, 3].map((n) => ({ pageNumber: n, text: `Poster Session 1. Text of page ${n}.` }))

const outline: OutlineOutput = {
  conference: {
    name: 'Example Forum',
    acronym: null,
    year: 2026,
    organizers: [],
    start_date: '2026-04-17',
    end_date: '2026-04-17',
    venue: null,
    city: null,
    region: null,
    country: null,
  },
  doc_kind: 'program',
  sessions: [
    {
      title: 'Poster Session 1',
      series: null,
      session_type: 'poster_session',
      is_scientific: true,
      date: '2026-04-17',
      start_time: '12:00',
      end_time: '13:30',
      room: 'Hall B',
      moderators: [],
      first_page: 1,
      last_page: 3,
    },
  ],
  themes: [],
  skip_pages: [],
}

const poster: ChunkPresentation = {
  page: 1,
  session_title: 'Poster Session 1',
  abstract_number: '1',
  title: 'A POSTER ABOUT SOMETHING',
  kind: 'poster',
  award_label: null,
  is_highlighted: false,
  withdrawn: false,
  date: null,
  start_time: null,
  end_time: null,
  room: null,
  people_are_speakers: false,
  people: [{ name: 'Ada Example', credentials: null, affiliation_markers: [] }],
  affiliations: [],
  source_category: null,
  themes: [],
}

describe('planResume', () => {
  const planned = makeChunks(pages, { maxChars: 60 }) // one page per group
  const answered = (extractPages: number[]) => ({
    chunk: { index: 0, extractPages, contextPages: [], text: '' },
    presentations: [],
  })

  it('sends only the page groups a saved run did not finish', () => {
    const { todo } = planResume(planned, [answered([1])])
    expect(todo.map((c) => c.extractPages)).toEqual([[2], [3]])
  })

  it('counts a group as done when smaller saved answers cover all of its pages', () => {
    const wholeBook = makeChunks(pages)
    expect(planResume(wholeBook, [answered([1, 2]), answered([3])]).todo).toEqual([])
  })

  it('sends everything when nothing was saved', () => {
    expect(planResume(planned, []).todo).toHaveLength(3)
  })
})

describe('resuming a build', () => {
  it('finishes a fully saved build without calling the API at all', async () => {
    // A client that fails if anything tries to use it: resuming must not send a single request.
    const noApi = new Proxy({}, { get: () => { throw new Error('The API was called') } }) as unknown as Anthropic
    const planned = makeChunks(pages)
    const checkpoints: Checkpoint[] = []

    const result = await runExtraction(
      { fileName: 'example.pdf', sha256: 'abc', pages },
      {
        client: noApi,
        model: 'claude-haiku-5-5',
        effort: 'medium',
        spendLimitUsd: 1,
        resolveInstitutions: false,
        summarize: false,
        resumeFrom: { outline, chunks: [{ chunk: planned[0]!, presentations: [poster] }] },
        onCheckpoint: (c) => checkpoints.push(c),
      },
    )

    expect(result.calls).toHaveLength(0)
    expect(result.spentUsd).toBe(0)
    expect(result.digest.presentations.map((p) => p.abstract_number)).toEqual(['1'])
    expect(checkpoints.at(-1)?.chunks).toHaveLength(1)
  })
})
