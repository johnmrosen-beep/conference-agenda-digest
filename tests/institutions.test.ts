import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import { demoDigest } from '../src/demo/demoDigest'
import {
  applyInstitutionGroups,
  InstitutionGroups,
  listInstitutions,
} from '../src/lib/extraction/institutions'
import { institutionsUserMessage } from '../src/lib/extraction/prompts'
import type { Digest } from '../src/lib/extraction/schema'
import { checkDigest } from '../src/lib/extraction/validate'

// A copy of the demo digest where one hospital appears under a second, unmerged name, the way
// a real extraction leaves "BCH" apart from "Bayport Children's Hospital".
function digestWithDuplicate(): Digest {
  const digest = structuredClone(demoDigest)
  digest.institutions.push({
    id: 'bch-short',
    canonical_name: 'BCH',
    aliases: [],
    city: 'Bayport',
    country: 'USA',
    type: 'childrens_hospital',
  })
  digest.affiliations.find((a) => a.id === 'aff-bch-plain')!.institution_id = 'bch-short'
  return digest
}

function numberOf(listed: ReturnType<typeof listInstitutions>, name: string): number {
  return listed.find((l) => l.institution.canonical_name === name)!.number
}

describe('listInstitutions', () => {
  it('numbers every institution once, most mentioned first', () => {
    const listed = listInstitutions(demoDigest)
    expect(listed.map((l) => l.number)).toEqual(listed.map((_, i) => i + 1))
    expect(listed).toHaveLength(demoDigest.institutions.length)
    expect(listed[0]!.mentions).toBeGreaterThanOrEqual(listed.at(-1)!.mentions)
  })

  it('shows Claude the numbers, names and locations', () => {
    const message = institutionsUserMessage(listInstitutions(demoDigest))
    expect(message).toMatch(/^Institutions/)
    expect(message).toContain("Bayport Children's Hospital (Bayport, USA)")
  })
})

describe('applyInstitutionGroups', () => {
  it('merges a group into one institution and points its affiliations at it', () => {
    const digest = digestWithDuplicate()
    const listed = listInstitutions(digest)
    const others = listed.filter((l) => !['BCH', "Bayport Children's Hospital"].includes(l.institution.canonical_name))
    const answer: InstitutionGroups = {
      groups: [
        {
          name: "Bayport Children's Hospital",
          type: 'childrens_hospital',
          members: [numberOf(listed, "Bayport Children's Hospital"), numberOf(listed, 'BCH')],
        },
        ...others.map((l) => ({ name: l.institution.canonical_name, type: l.institution.type, members: [l.number] })),
      ],
    }
    const { before, after } = applyInstitutionGroups(digest, listed, answer)
    expect([before, after]).toEqual([8, 7])
    const bch = digest.institutions.find((i) => i.canonical_name === "Bayport Children's Hospital")!
    expect(bch.aliases).toContain('BCH')
    expect(digest.affiliations.find((a) => a.id === 'aff-bch-plain')!.institution_id).toBe(bch.id)
    expect(checkDigest(digest).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('keeps a name Claude left out as its own institution', () => {
    const digest = digestWithDuplicate()
    const listed = listInstitutions(digest)
    const { after } = applyInstitutionGroups(digest, listed, { groups: [] })
    expect(after).toBe(8)
    expect(checkDigest(digest).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('ignores numbers that are not on the list, and names placed twice', () => {
    const digest = digestWithDuplicate()
    const listed = listInstitutions(digest)
    const first = listed[0]!.number
    const answer: InstitutionGroups = {
      groups: [
        { name: 'Group A', type: 'other', members: [first, 999] },
        { name: 'Group B', type: 'other', members: [first] },
      ],
    }
    const { after } = applyInstitutionGroups(digest, listed, answer)
    expect(after).toBe(8) // Group A holds the first name; Group B is empty and dropped
    expect(digest.institutions.some((i) => i.canonical_name === 'Group B')).toBe(false)
  })
})

describe('the grouping answer format', () => {
  it('converts into a format the API accepts', () => {
    expect(JSON.stringify(zodOutputFormat(InstitutionGroups).schema)).toContain('"additionalProperties":false')
  })
})
