// Draws the personal agenda as a PDF, in the same look as the app: a small uppercase label, a
// serif title, a thin gold rule, teal times. Laid out by hand with jsPDF (no table plugin), so
// every line is placed exactly. Runs in the browser; nothing is uploaded.

import { jsPDF } from 'jspdf'
import { formatDay, formatTime } from '../digest/analysis'
import type { AgendaDay, AgendaItem } from '../digest/agenda'
import type { Digest } from '../extraction/schema'

// Colors from the app's design tokens (src/styles/tokens.css).
const INK: [number, number, number] = [18, 34, 29]
const MUTED: [number, number, number] = [78, 99, 93]
const BRAND: [number, number, number] = [11, 93, 82]
const SIGNAL: [number, number, number] = [201, 138, 43]
const WARN: [number, number, number] = [154, 52, 18]
const HAIRLINE: [number, number, number] = [217, 226, 222]

// US Letter, in points.
const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 54
const TIME_W = 78
const TEXT_X = MARGIN + TIME_W
const TEXT_W = PAGE_W - MARGIN - TEXT_X
const BOTTOM = PAGE_H - MARGIN - 18 // leave room for the footer

const KIND_LABEL: Record<string, string> = {
  keynote: 'Keynote',
  invited_talk: 'Talk',
  oral_abstract: 'Oral abstract',
  poster: 'Poster',
  video_abstract: 'Video abstract',
  panel: 'Panel',
  award_lecture: 'Named lecture',
  other: 'Session item',
}

/**
 * The PDF's built-in fonts only cover Western European letters. Accented names (é, ñ) are fine;
 * a few common symbols are spelled out, and anything else becomes "?" rather than garbage.
 */
const SPELLED: Record<string, string> = {
  '≥': '>=', '≤': '<=', '≠': '!=', '±': '+/-', '→': '->', '←': '<-', 'α': 'alpha', 'β': 'beta',
  'γ': 'gamma', 'δ': 'delta', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'micro', 'σ': 'sigma', 'χ': 'chi',
  ' ': ' ', ' ': ' ', '−': '-', '�': '-',
}
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
export function pdfSafe(text: string): string {
  return [...text.normalize('NFC')]
    .map((ch) => SPELLED[ch] ?? (ch.charCodeAt(0) <= 0xff || WIN_ANSI_EXTRAS.has(ch) ? ch : '?'))
    .join('')
}

function timeLabel(item: AgendaItem): string {
  if (item.timeNotPrinted) return 'Time TBA'
  if (!item.start) return ''
  if (item.presentation.kind === 'poster' && item.end) return `${formatTime(item.start)}–\n${formatTime(item.end)}`
  return formatTime(item.start)
}

function whereLine(item: AgendaItem): string {
  const p = item.presentation
  const parts = [
    KIND_LABEL[p.kind] ?? p.kind,
    p.award_label,
    item.session?.title,
    p.room,
    item.timeNotPrinted && item.session?.start_time && item.session.end_time
      ? `session runs ${formatTime(item.session.start_time)}–${formatTime(item.session.end_time)}`
      : null,
  ]
  return parts.filter(Boolean).join(' · ')
}

export function agendaPdf(digest: Digest, days: AgendaDay[], madeOn = new Date()): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const c = digest.conference
  let y = MARGIN

  const text = (value: string, x: number, size: number, style: 'normal' | 'bold', font: 'helvetica' | 'times' | 'courier', color: [number, number, number], width: number): number => {
    doc.setFont(font, style)
    doc.setFontSize(size)
    doc.setTextColor(...color)
    const lines = doc.splitTextToSize(pdfSafe(value), width) as string[]
    doc.text(lines, x, y, { baseline: 'top' })
    return lines.length * size * 1.25
  }
  const measure = (value: string, size: number, style: 'normal' | 'bold', font: 'helvetica' | 'times', width: number): number => {
    doc.setFont(font, style)
    doc.setFontSize(size)
    return (doc.splitTextToSize(pdfSafe(value), width) as string[]).length * size * 1.25
  }
  const newPage = () => {
    doc.addPage()
    y = MARGIN
  }

  // ---- Header
  y += text('CONFERENCE AGENDA DIGEST  ·  MY AGENDA', MARGIN, 8, 'normal', 'courier', BRAND, PAGE_W - 2 * MARGIN) + 6
  y += text(c.name, MARGIN, 20, 'bold', 'times', INK, PAGE_W - 2 * MARGIN) + 4
  const dates = c.start_date ? `${formatDay(c.start_date)} – ${formatDay(c.end_date ?? c.start_date)}, ${c.year}` : null
  const place = [c.venue, c.city, c.region].filter(Boolean).join(', ')
  const count = days.reduce((n, d) => n + d.items.length, 0)
  y += text([dates, place].filter(Boolean).join('  ·  '), MARGIN, 10, 'normal', 'helvetica', MUTED, PAGE_W - 2 * MARGIN)
  y += text(`${count} ${count === 1 ? 'presentation' : 'presentations'} picked · made ${madeOn.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, MARGIN, 9, 'normal', 'helvetica', MUTED, PAGE_W - 2 * MARGIN) + 10
  doc.setDrawColor(...SIGNAL)
  doc.setLineWidth(1.5)
  doc.line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 18

  if (count === 0) {
    text('No presentations picked yet. Tick some in the app, then download again.', MARGIN, 11, 'normal', 'helvetica', MUTED, PAGE_W - 2 * MARGIN)
  }

  // ---- Days and items
  for (const day of days) {
    const headingHeight = 13 * 1.25 + 10
    const firstHeight = blockHeight(day.items[0]!)
    if (y + headingHeight + firstHeight > BOTTOM) newPage()
    y += text(formatDay(day.date), MARGIN, 13, 'bold', 'times', INK, PAGE_W - 2 * MARGIN) + 3
    doc.setDrawColor(...SIGNAL)
    doc.setLineWidth(1)
    doc.line(MARGIN, y, MARGIN + 120, y)
    y += 10

    for (const item of day.items) {
      if (y + blockHeight(item) > BOTTOM) newPage()
      const top = y
      text(timeLabel(item), MARGIN, 9.5, 'bold', 'helvetica', BRAND, TIME_W - 8)
      const p = item.presentation
      y += text(`${p.abstract_number ? `${p.abstract_number}  ` : ''}${p.title}`, TEXT_X, 10.5, 'bold', 'helvetica', INK, TEXT_W) + 2
      const who = [item.presenters.join(', '), item.institutions.join('; ')].filter(Boolean).join(' · ')
      if (who) y += text(who, TEXT_X, 9, 'normal', 'helvetica', INK, TEXT_W) + 1
      y += text(whereLine(item), TEXT_X, 8.5, 'normal', 'helvetica', MUTED, TEXT_W)
      for (const clash of item.clashes) {
        y += 2 + text(`Overlaps with: ${clash.title}${clash.start ? ` (${formatTime(clash.start)})` : ''}`, TEXT_X, 8.5, 'normal', 'helvetica', WARN, TEXT_W)
      }
      y = Math.max(y, top + 24) + 8
      doc.setDrawColor(...HAIRLINE)
      doc.setLineWidth(0.5)
      doc.line(TEXT_X, y - 4, PAGE_W - MARGIN, y - 4)
      y += 4
    }
    y += 8
  }

  // ---- Footer on every page
  const pages = doc.getNumberOfPages()
  for (let n = 1; n <= pages; n++) {
    doc.setPage(n)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(
      pdfSafe(`Made with Conference Agenda Digest from ${digest.source.file_name}. Check times and rooms against the official program.`),
      MARGIN,
      PAGE_H - MARGIN + 6,
      { baseline: 'top', maxWidth: PAGE_W - 2 * MARGIN - 60 },
    )
    doc.text(`${n} / ${pages}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 6, { baseline: 'top', align: 'right' })
  }
  return doc

  function blockHeight(item: AgendaItem): number {
    const p = item.presentation
    let h = measure(`${p.abstract_number ?? ''}  ${p.title}`, 10.5, 'bold', 'helvetica', TEXT_W) + 2
    h += measure([item.presenters.join(', '), item.institutions.join('; ')].join(' · '), 9, 'normal', 'helvetica', TEXT_W) + 1
    h += measure(whereLine(item), 8.5, 'normal', 'helvetica', TEXT_W)
    h += item.clashes.length * (8.5 * 1.25 + 4)
    return Math.max(h, 24) + 12
  }
}

/** A file name like "My agenda - NASPGHAN 2026.pdf". */
export function agendaFileName(digest: Digest): string {
  const c = digest.conference
  const name = c.acronym ? `${c.acronym} ${c.year}` : c.name
  return `My agenda - ${name.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.pdf`
}
