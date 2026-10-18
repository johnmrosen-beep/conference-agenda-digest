// A finished digest of a made-up conference. It has two jobs:
//   - Demo mode: visitors without an API key can explore the summary, charts, search and
//     agenda export for free.
//   - The public "golden" example for the evaluation harness: a later milestone prints this
//     data as a program-book PDF, runs extraction on that PDF, and scores the result against
//     this file, which is known to be correct.
//
// Everything here is fictional: the meeting, every person, hospital and university. It
// deliberately includes the tricky cases found in real program books: concurrent sessions in
// different rooms, posters under category headings, an oral abstract with no printed time,
// a withdrawn abstract, a "Poster of Distinction", accented names, and institutions spelled
// several ways (the aliases).

import {
  SCHEMA_VERSION,
  type Affiliation,
  type Digest,
  type Institution,
  type InstitutionType,
  type Person,
  type Presentation,
  type PresentationKind,
  type Session,
  type SessionType,
  type Theme,
} from '../lib/extraction/schema'

const FRI = '2026-04-17'
const SAT = '2026-04-18'

// ---------------------------------------------------------------- institutions
function institution(
  id: string,
  canonical_name: string,
  aliases: string[],
  city: string,
  type: InstitutionType,
): Institution {
  return { id, canonical_name, aliases, city, country: 'USA', type }
}

const institutions: Institution[] = [
  institution('bch', "Bayport Children's Hospital", ["The Bayport Children's Hospital", 'Bayport Childrens Hospital'], 'Bayport', 'childrens_hospital'),
  institution('lusm', 'Lakeshore University School of Medicine', ['Lakeshore Univ. School of Medicine'], 'Bayport', 'university'),
  institution('rchs', "Riverbend Children's Health", ["Riverbend Children's Hospital"], 'Millbrook', 'health_system'),
  institution('cvu', 'Cedar Valley University', [], 'Cedar Falls', 'university'),
  institution('sapi', 'St. Agnes Pediatric Institute', ['Saint Agnes Pediatric Institute'], 'Northfield', 'childrens_hospital'),
  institution('psu', 'Prairie State University Medical Center', ['Prairie State Univ. Medical Center'], 'Westover', 'university'),
  institution('hnl', 'Harbor Nutrition Labs', [], 'Bayport', 'industry'),
]

// ---------------------------------------------------------------- affiliations (as printed)
function affiliation(
  id: string,
  raw_text: string,
  department: string | null,
  institution_id: string,
  city: string,
  region: string,
): Affiliation {
  return { id, raw_text, department, institution_id, city, region, country: 'USA' }
}

const affiliations: Affiliation[] = [
  affiliation('aff-bch-gi', "Division of Gastroenterology, Hepatology and Nutrition, Bayport Children's Hospital, Bayport, MI, USA", 'Division of Gastroenterology, Hepatology and Nutrition', 'bch', 'Bayport', 'MI'),
  affiliation('aff-bch-peds', "Pediatrics, The Bayport Children's Hospital, Bayport, MI, USA", 'Pediatrics', 'bch', 'Bayport', 'MI'),
  affiliation('aff-bch-plain', 'Bayport Childrens Hospital, Bayport, MI, USA', null, 'bch', 'Bayport', 'MI'),
  affiliation('aff-lusm-peds', 'Department of Pediatrics, Lakeshore University School of Medicine, Bayport, MI, USA', 'Department of Pediatrics', 'lusm', 'Bayport', 'MI'),
  affiliation('aff-lusm-surg', 'Surgery, Lakeshore Univ. School of Medicine, Bayport, MI, USA', 'Surgery', 'lusm', 'Bayport', 'MI'),
  affiliation('aff-rchs-gi', "Pediatric Gastroenterology, Riverbend Children's Health, Millbrook, OH, USA", 'Pediatric Gastroenterology', 'rchs', 'Millbrook', 'OH'),
  affiliation('aff-rchs-hosp', "Riverbend Children's Hospital, Millbrook, OH, USA", null, 'rchs', 'Millbrook', 'OH'),
  affiliation('aff-cvu-nutr', 'Nutritional Sciences, Cedar Valley University, Cedar Falls, IA, USA', 'Nutritional Sciences', 'cvu', 'Cedar Falls', 'IA'),
  affiliation('aff-sapi-gi', 'Gastroenterology, St. Agnes Pediatric Institute, Northfield, MN, USA', 'Gastroenterology', 'sapi', 'Northfield', 'MN'),
  affiliation('aff-sapi-path', 'Pathology, Saint Agnes Pediatric Institute, Northfield, MN, USA', 'Pathology', 'sapi', 'Northfield', 'MN'),
  affiliation('aff-psu-peds', 'Pediatrics, Prairie State University Medical Center, Westover, KS, USA', 'Pediatrics', 'psu', 'Westover', 'KS'),
  affiliation('aff-psu-plain', 'Prairie State Univ. Medical Center, Westover, KS, USA', null, 'psu', 'Westover', 'KS'),
  affiliation('aff-hnl', 'Medical Affairs, Harbor Nutrition Labs, Bayport, MI, USA', 'Medical Affairs', 'hnl', 'Bayport', 'MI'),
]

// ---------------------------------------------------------------- people
function person(id: string, display_name: string, family_name: string, credentials: string | null = null): Person {
  return { id, display_name, family_name, credentials }
}

const people: Person[] = [
  person('okonkwo', 'Maya Okonkwo', 'Okonkwo', 'MD, MPH'),
  person('ferreira', 'Daniel Ferreira', 'Ferreira', 'MD'),
  person('raman', 'Priya Raman', 'Raman', 'MD, MSCI'),
  person('kowal', 'Tomasz Kowal', 'Kowal', 'MD'),
  person('varga', 'Elena Varga', 'Varga', 'MD, PhD'),
  person('osei', 'Samuel Osei', 'Osei', 'MD'),
  person('lindqvist', 'Hannah Lindqvist', 'Lindqvist', 'MS, RD'),
  person('moreno', 'Rafael Moreno-Ibáñez', 'Moreno-Ibáñez', 'MD'),
  person('whitfield', 'Grace Whitfield', 'Whitfield', 'MD'),
  person('arakawa', 'Kenji Arakawa', 'Arakawa', 'MD, PhD'),
  person('alsayed', 'Fatima Al-Sayed', 'Al-Sayed', 'DO'),
  person('brennan', 'Noah Brennan', 'Brennan'),
  person('cardoso', 'Isabel Cardoso', 'Cardoso'),
  person('meyer', 'Lucas Meyer', 'Meyer'),
  person('nwosu', 'Amara Nwosu', 'Nwosu'),
  person('gallagher', 'Owen Gallagher', 'Gallagher'),
  person('petrakis', 'Sofia Petrakis', 'Petrakis'),
  person('hale', 'Benjamin Hale', 'Hale'),
  person('haddad', 'Leila Haddad', 'Haddad'),
  person('thibodeaux', 'Marcus Thibodeaux', 'Thibodeaux'),
  person('tanabe', 'Yuki Tanabe', 'Tanabe'),
  person('jensen', 'Clara Jensen', 'Jensen'),
  person('salazar', 'Diego Salazar', 'Salazar'),
  person('kowalczyk', 'Ava Kowalczyk', 'Kowalczyk'),
  person('park', 'Ethan Park', 'Park'),
  person('yusuf', 'Zainab Yusuf', 'Yusuf'),
  person('feld', 'Miriam Feld', 'Feld'),
  person('ortiz', 'Julian Ortiz', 'Ortiz'),
  person('quinlan', 'Nora Quinlan', 'Quinlan', 'PhD'),
  person('adeyemi', 'Victor Adeyemi', 'Adeyemi', 'MD'),
]

// ---------------------------------------------------------------- themes
function theme(id: string, label: string, origin: Theme['origin'] = 'document'): Theme {
  return { id, label, description: null, origin }
}

const themes: Theme[] = [
  theme('ibd', 'Inflammatory Bowel Disease'),
  theme('hepatology', 'Hepatology'),
  theme('nutrition', 'Nutrition and Obesity'),
  theme('motility', 'Neurogastroenterology and Motility'),
  theme('endoscopy', 'Endoscopy'),
  theme('education', 'Medical Education'),
  theme('pancreas', 'Pancreas', 'generated'),
  theme('feeding', 'Feeding and Swallowing', 'generated'),
  theme('lifespan', 'Transition and Lifespan Care', 'generated'),
]

// ---------------------------------------------------------------- sessions
function session(
  id: string,
  title: string,
  session_type: SessionType,
  date: string,
  start_time: string,
  end_time: string,
  room: string,
  source_pages: number[],
  extra: Partial<Pick<Session, 'series' | 'moderator_ids' | 'is_scientific'>> = {},
): Session {
  return {
    id,
    title,
    series: extra.series ?? null,
    session_type,
    is_scientific: extra.is_scientific ?? true,
    date,
    start_time,
    end_time,
    room,
    moderator_ids: extra.moderator_ids ?? [],
    source_category: null,
    source_pages,
  }
}

const sessions: Session[] = [
  session('s-plenary-open', 'Opening Plenary', 'plenary', FRI, '08:00', '09:30', 'Lakeview Ballroom', [2], { moderator_ids: ['whitfield'] }),
  session('s-ca-ibd', 'Inflammatory Bowel Disease Today', 'symposium', FRI, '10:00', '11:30', 'Room 201', [3], { series: 'Concurrent Session A', moderator_ids: ['kowal', 'alsayed'] }),
  session('s-ca-nutrition', 'Feeding, Swallowing and Nutrition', 'symposium', FRI, '10:00', '11:30', 'Room 202', [4], { series: 'Concurrent Session A', moderator_ids: ['lindqvist'] }),
  session('s-posters-1', 'Poster Session 1', 'poster_session', FRI, '12:00', '13:30', 'Exhibit Hall B', [5, 6]),
  session('s-industry', 'Industry Symposium: Formula Science Update', 'industry', FRI, '18:00', '19:00', 'Room 105', [7], { is_scientific: false }),
  session('s-reception', 'Lakefront Welcome Reception', 'social', FRI, '19:00', '21:00', 'Harbor Terrace', [7], { is_scientific: false }),
  session('s-mtp', 'Meet the Professor Breakfast', 'meet_the_professor', SAT, '07:00', '08:00', 'Room 105', [8]),
  session('s-cb-liver', 'Liver and Pancreas', 'symposium', SAT, '09:00', '10:30', 'Room 201', [9], { series: 'Concurrent Session B', moderator_ids: ['varga'] }),
  session('s-cb-motility', 'Neurogastroenterology and Motility', 'symposium', SAT, '09:00', '10:30', 'Room 202', [10], { series: 'Concurrent Session B', moderator_ids: ['osei'] }),
  session('s-posters-2', 'Poster Session 2', 'poster_session', SAT, '11:00', '12:30', 'Exhibit Hall B', [11, 12]),
  session('s-business', 'Annual Business Meeting and Awards Lunch', 'business_meeting', SAT, '12:30', '13:30', 'Lakeview Ballroom', [13], { is_scientific: false }),
  session('s-plenary-close', 'Closing Plenary', 'plenary', SAT, '14:00', '15:00', 'Lakeview Ballroom', [13], { moderator_ids: ['raman'] }),
]

// ---------------------------------------------------------------- presentations
const sessionsById = new Map(sessions.map((s) => [s.id, s]))

interface PresentationInput {
  id: string
  session: string
  title: string
  kind: PresentationKind
  /** [start, end]; null when no time is printed, so the session's time is used. */
  time: [string, string] | null
  /** Speakers for talks; empty for abstracts. Each is [person id, affiliation ids]. */
  speakers?: [string, string[]][]
  /** Authors in printed order, for abstracts. */
  authors?: [string, string[]][]
  abstract_number?: string
  award_label?: string
  is_highlighted?: boolean
  withdrawn?: boolean
  source_category?: string
  themes: string[]
  pages: number[]
}

function presentation(input: PresentationInput): Presentation {
  const s = sessionsById.get(input.session)!
  const speakers = input.speakers ?? []
  const authorList = input.authors ?? speakers
  return {
    id: input.id,
    session_id: input.session,
    abstract_number: input.abstract_number ?? null,
    title: input.title,
    kind: input.kind,
    award_label: input.award_label ?? null,
    is_highlighted: input.is_highlighted ?? false,
    withdrawn: input.withdrawn ?? false,
    date: s.date,
    start_time: input.time ? input.time[0] : s.start_time,
    end_time: input.time ? input.time[1] : s.end_time,
    time_inferred: input.time === null,
    room: s.room,
    speaker_ids: speakers.map(([personId]) => personId),
    authors: authorList.map(([person_id, affiliation_ids], i) => ({ person_id, affiliation_ids, order: i + 1 })),
    source_category: input.source_category ?? null,
    theme_ids: input.themes,
    source_pages: input.pages,
  }
}

const IBD = 'INFLAMMATORY BOWEL DISEASE'
const HEP = 'HEPATOLOGY'
const NUT = 'NUTRITION AND OBESITY'
const MOT = 'NEUROGASTROENTEROLOGY/MOTILITY'
const ENDO = 'ENDOSCOPY'
const EDU = 'MEDICAL EDUCATION'

const presentations: Presentation[] = [
  // Opening Plenary
  presentation({ id: 'p-keynote-open', session: 's-plenary-open', kind: 'keynote', time: ['08:10', '08:55'], award_label: "Founders' Keynote Lecture", title: 'The Gut at Every Age: A Lifespan View of Pediatric Digestive Health', speakers: [['okonkwo', ['aff-bch-gi']]], themes: ['lifespan'], pages: [2] }),
  presentation({ id: 'p-101', session: 's-plenary-open', kind: 'oral_abstract', abstract_number: '101', time: ['09:00', '09:15'], award_label: "President's Prize", title: 'Early Fecal Calprotectin Trajectories Predict Steroid-Free Remission in Pediatric Crohn Disease', authors: [['brennan', ['aff-bch-gi']], ['cardoso', ['aff-bch-gi', 'aff-lusm-peds']], ['kowal', ['aff-bch-gi']]], themes: ['ibd'], pages: [2] }),

  // Concurrent Session A: IBD
  presentation({ id: 'p-ibd-talk-1', session: 's-ca-ibd', kind: 'invited_talk', time: ['10:00', '10:25'], title: 'Treat-to-Target in Pediatric Ulcerative Colitis: Where Are We Now?', speakers: [['ferreira', ['aff-rchs-gi']]], themes: ['ibd'], pages: [3] }),
  presentation({ id: 'p-102', session: 's-ca-ibd', kind: 'oral_abstract', abstract_number: '102', time: ['10:25', '10:37'], title: 'Transition Readiness Scores and Missed Visits in Adolescents with Inflammatory Bowel Disease', authors: [['meyer', ['aff-rchs-hosp']], ['nwosu', ['aff-rchs-gi']], ['ferreira', ['aff-rchs-gi']]], themes: ['ibd', 'lifespan'], pages: [3] }),
  presentation({ id: 'p-ibd-talk-2', session: 's-ca-ibd', kind: 'invited_talk', time: ['10:40', '11:05'], title: 'Surgery or Another Biologic? Shared Decisions in Refractory Crohn Disease', speakers: [['alsayed', ['aff-lusm-surg']]], themes: ['ibd'], pages: [3] }),

  // Concurrent Session A: Nutrition (one oral abstract has no printed time)
  presentation({ id: 'p-nut-talk-1', session: 's-ca-nutrition', kind: 'invited_talk', time: ['10:00', '10:25'], title: 'Blenderized Tube Feeding: Evidence, Safety and Practical Tips', speakers: [['lindqvist', ['aff-cvu-nutr']]], themes: ['nutrition', 'feeding'], pages: [4] }),
  presentation({ id: 'p-103', session: 's-ca-nutrition', kind: 'oral_abstract', abstract_number: '103', time: null, title: 'Oral Aversion After Prolonged Gastrostomy Feeding: A Multicenter Retrospective Cohort', authors: [['gallagher', ['aff-psu-peds']], ['petrakis', ['aff-psu-plain', 'aff-sapi-gi']], ['adeyemi', ['aff-psu-peds']]], themes: ['feeding'], pages: [4] }),
  presentation({ id: 'p-nut-talk-2', session: 's-ca-nutrition', kind: 'invited_talk', time: ['10:50', '11:15'], title: 'Weight Management Medications in Adolescents: What the Gastroenterologist Needs to Know', speakers: [['whitfield', ['aff-lusm-peds']]], themes: ['nutrition'], pages: [4] }),

  // Poster Session 1
  presentation({ id: 'p-1', session: 's-posters-1', kind: 'poster', abstract_number: '1', time: null, source_category: IBD, title: 'Iron Deficiency at Diagnosis of Pediatric Ulcerative Colitis in a Regional Cohort', authors: [['hale', ['aff-sapi-gi']], ['haddad', ['aff-sapi-gi']]], themes: ['ibd'], pages: [5] }),
  presentation({ id: 'p-2', session: 's-posters-1', kind: 'poster', abstract_number: '2', time: null, is_highlighted: true, source_category: IBD, title: 'Intestinal Ultrasound as a Bedside Monitor of Crohn Disease Activity in Children', authors: [['tanabe', ['aff-bch-peds']], ['jensen', ['aff-bch-plain']], ['kowal', ['aff-bch-gi']]], themes: ['ibd'], pages: [5] }),
  presentation({ id: 'p-3', session: 's-posters-1', kind: 'poster', abstract_number: '3', time: null, source_category: HEP, title: 'Serum Bile Acids After Kasai Portoenterostomy and Two-Year Native Liver Survival', authors: [['salazar', ['aff-rchs-gi']], ['varga', ['aff-rchs-gi', 'aff-lusm-peds']]], themes: ['hepatology'], pages: [5] }),
  presentation({ id: 'p-4', session: 's-posters-1', kind: 'poster', abstract_number: '4', time: null, source_category: HEP, title: 'Screening for Steatotic Liver Disease in Primary Care: Adherence to Guidelines', authors: [['kowalczyk', ['aff-psu-peds']], ['moreno', ['aff-psu-peds']]], themes: ['hepatology', 'nutrition'], pages: [5] }),
  presentation({ id: 'p-5', session: 's-posters-1', kind: 'poster', abstract_number: '5', time: null, withdrawn: true, source_category: NUT, title: 'WITHDRAWN', authors: [], themes: [], pages: [6] }),
  presentation({ id: 'p-6', session: 's-posters-1', kind: 'poster', abstract_number: '6', time: null, source_category: NUT, title: 'Food Insecurity Screening in a Pediatric Gastroenterology Clinic', authors: [['yusuf', ['aff-cvu-nutr']], ['quinlan', ['aff-cvu-nutr']], ['lindqvist', ['aff-cvu-nutr']]], themes: ['nutrition'], pages: [6] }),
  presentation({ id: 'p-7', session: 's-posters-1', kind: 'poster', abstract_number: '7', time: null, source_category: NUT, title: 'Micronutrient Status in Children on Long-Term Home Parenteral Nutrition', authors: [['feld', ['aff-sapi-gi']], ['park', ['aff-sapi-path']], ['hale', ['aff-sapi-gi']]], themes: ['nutrition'], pages: [6] }),

  // Industry symposium (not scientific)
  presentation({ id: 'p-industry', session: 's-industry', kind: 'other', time: ['18:00', '19:00'], title: 'What Is New in Peptide-Based Enteral Formulas', speakers: [['thibodeaux', ['aff-hnl']]], themes: ['nutrition'], pages: [7] }),

  // Meet the Professor
  presentation({ id: 'p-mtp', session: 's-mtp', kind: 'panel', time: ['07:00', '08:00'], title: 'Building a Pediatric Motility Program from Scratch', speakers: [['osei', ['aff-sapi-gi']], ['arakawa', ['aff-bch-gi']]], themes: ['motility'], pages: [8] }),

  // Concurrent Session B: Liver and Pancreas
  presentation({ id: 'p-liver-talk', session: 's-cb-liver', kind: 'invited_talk', time: ['09:00', '09:25'], title: 'Acute Recurrent Pancreatitis in Children: Genes, Ducts and Next Steps', speakers: [['raman', ['aff-lusm-peds']]], themes: ['pancreas'], pages: [9] }),
  presentation({ id: 'p-104', session: 's-cb-liver', kind: 'oral_abstract', abstract_number: '104', time: ['09:30', '09:42'], award_label: 'Young Investigator Award', title: 'A Urine Metabolite Panel to Detect Cholestasis in Infants', authors: [['ortiz', ['aff-rchs-gi']], ['salazar', ['aff-rchs-gi']], ['varga', ['aff-rchs-gi']]], themes: ['hepatology'], pages: [9] }),
  presentation({ id: 'p-105', session: 's-cb-liver', kind: 'oral_abstract', abstract_number: '105', time: ['09:45', '09:57'], title: 'Outcomes of Endoscopic Pancreatic Stenting in Children Under Ten Years', authors: [['petrakis', ['aff-sapi-gi']], ['moreno', ['aff-psu-peds']], ['raman', ['aff-lusm-peds']]], themes: ['pancreas', 'endoscopy'], pages: [9] }),

  // Concurrent Session B: Motility
  presentation({ id: 'p-mot-talk', session: 's-cb-motility', kind: 'invited_talk', time: ['09:00', '09:25'], title: 'Disorders of Gut-Brain Interaction: Making the Diagnosis with Confidence', speakers: [['arakawa', ['aff-bch-gi']]], themes: ['motility'], pages: [10] }),
  presentation({ id: 'p-106', session: 's-cb-motility', kind: 'oral_abstract', abstract_number: '106', time: ['09:30', '09:42'], title: 'Anorectal Manometry Findings in Children with Refractory Constipation and Autism', authors: [['jensen', ['aff-bch-peds']], ['tanabe', ['aff-bch-peds']], ['osei', ['aff-sapi-gi']]], themes: ['motility'], pages: [10] }),

  // Poster Session 2
  presentation({ id: 'p-8', session: 's-posters-2', kind: 'poster', abstract_number: '8', time: null, source_category: MOT, title: 'Gastric Emptying Scintigraphy Utilization Before and After a Clinical Pathway', authors: [['nwosu', ['aff-rchs-gi']], ['meyer', ['aff-rchs-hosp']]], themes: ['motility'], pages: [11] }),
  presentation({ id: 'p-9', session: 's-posters-2', kind: 'poster', abstract_number: '9', time: null, is_highlighted: true, source_category: MOT, title: 'Cyclic Vomiting Syndrome Admissions and Time to First Antiemetic', authors: [['haddad', ['aff-sapi-gi']], ['feld', ['aff-sapi-gi']]], themes: ['motility'], pages: [11] }),
  presentation({ id: 'p-10', session: 's-posters-2', kind: 'poster', abstract_number: '10', time: null, source_category: ENDO, title: 'Button Battery Ingestions: Time from Arrival to Endoscopic Removal', authors: [['park', ['aff-sapi-path']], ['petrakis', ['aff-sapi-gi']]], themes: ['endoscopy'], pages: [11] }),
  presentation({ id: 'p-11', session: 's-posters-2', kind: 'poster', abstract_number: '11', time: null, source_category: ENDO, title: 'Sedation-Free Transnasal Endoscopy for Eosinophilic Esophagitis Monitoring', authors: [['cardoso', ['aff-lusm-peds']], ['brennan', ['aff-bch-gi']]], themes: ['endoscopy'], pages: [12] }),
  presentation({ id: 'p-12', session: 's-posters-2', kind: 'poster', abstract_number: '12', time: null, source_category: EDU, title: 'A Simulation Curriculum for Foreign Body Retrieval in Gastroenterology Fellowship', authors: [['gallagher', ['aff-psu-peds']], ['kowalczyk', ['aff-psu-plain']], ['adeyemi', ['aff-psu-peds']]], themes: ['education', 'endoscopy'], pages: [12] }),
  presentation({ id: 'p-13', session: 's-posters-2', kind: 'poster', abstract_number: '13', time: null, source_category: EDU, title: 'Fellow Confidence in Delivering Difficult Diagnoses After a Communication Workshop', authors: [['yusuf', ['aff-cvu-nutr']], ['ortiz', ['aff-rchs-gi']]], themes: ['education'], pages: [12] }),

  // Closing Plenary
  presentation({ id: 'p-keynote-close', session: 's-plenary-close', kind: 'award_lecture', time: ['14:05', '14:50'], award_label: 'Lifetime Achievement Lecture', title: 'Forty Years of Pediatric Hepatology: Lessons for the Next Generation', speakers: [['varga', ['aff-rchs-gi']]], themes: ['hepatology', 'lifespan'], pages: [13] }),
]

// ---------------------------------------------------------------- the digest
export const demoDigest: Digest = {
  schema_version: SCHEMA_VERSION,
  source: {
    file_name: 'GLPDF 2026 Program Book (fictional).pdf',
    sha256: null,
    page_count: 13,
    doc_kind: 'program',
    extracted_with: null,
  },
  conference: {
    name: 'Great Lakes Pediatric Digestive Health Forum',
    acronym: 'GLPDF',
    year: 2026,
    organizers: ['Great Lakes Society for Pediatric Digestive Health'],
    start_date: FRI,
    end_date: SAT,
    venue: 'Bayport Lakefront Conference Center',
    city: 'Bayport',
    region: 'MI',
    country: 'USA',
    summary:
      'A two-day regional meeting on pediatric gastroenterology, hepatology and nutrition. ' +
      'Friday opens with a keynote on digestive health across the lifespan, then splits into ' +
      'concurrent sessions on inflammatory bowel disease and on feeding and nutrition, followed ' +
      'by the first poster session. Saturday covers liver and pancreas disease and ' +
      'neurogastroenterology, a second poster session focused on motility, endoscopy and ' +
      'medical education, and closes with a lifetime achievement lecture in hepatology. ' +
      '(This conference and everyone in it are fictional.)',
    highlights: [
      { text: "Founders' Keynote on digestive health from infancy to adulthood", presentation_ids: ['p-keynote-open'] },
      { text: "President's Prize abstract on calprotectin trajectories in Crohn disease", presentation_ids: ['p-101'] },
      { text: 'Two Posters of Distinction: intestinal ultrasound and cyclic vomiting care', presentation_ids: ['p-2', 'p-9'] },
      { text: 'Lifetime Achievement Lecture in pediatric hepatology', presentation_ids: ['p-keynote-close'] },
    ],
  },
  sessions,
  presentations,
  people,
  affiliations,
  institutions,
  themes,
  warnings: [],
}
