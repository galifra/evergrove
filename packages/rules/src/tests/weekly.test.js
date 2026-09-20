import { describe, it, expect } from 'vitest'
import { createEvent, localDate } from '@evergrove/core/events.js'
import { QUESTIONS, composeWeekly, weekRange, weeklyReadyLine } from '../weekly.js'
import { composeBriefing } from '../briefing.js'

// The weekly review (T-P7): built on the device, the same twice, and safe to send out.

const day = (y, m, d, hh = 12) => new Date(y, m - 1, d, hh, 0)
let n = 0
const ev = (type, data, when) => createEvent({ id: `w${n++}`, type, app: 'test', data, occurredAt: when.toISOString(), now: when })
const practice = (area, name, xp, when) => ev('skill.practiced', { domain: area, skillName: name, xp, text: name }, when)

// Sunday 20 September 2026, evening; the week is Monday 14 to Sunday 20.
const SUN = day(2026, 9, 20, 20)
const WED = day(2026, 9, 23, 10)

describe('which week it covers', () => {
  it('on a Sunday it is the week ending that day', () => {
    expect(weekRange(SUN)).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    expect(weekRange(day(2026, 9, 20, 0))).toEqual({ from: '2026-09-14', to: '2026-09-20' })
  })
  it('on any other day it is the last complete week', () => {
    expect(weekRange(day(2026, 9, 21))).toEqual({ from: '2026-09-14', to: '2026-09-20' }) // Monday
    expect(weekRange(WED)).toEqual({ from: '2026-09-14', to: '2026-09-20' })
    expect(weekRange(day(2026, 9, 26))).toEqual({ from: '2026-09-14', to: '2026-09-20' }) // Saturday
  })
})

describe('what grew and what stalled', () => {
  const events = [
    practice('health', 'Running', 20, day(2026, 9, 14)),
    practice('health', 'Running', 10, day(2026, 9, 16)),
    practice('craft', 'Guitar', 5, day(2026, 9, 20, 9)),
    practice('mind', 'Reading', 30, day(2026, 9, 10)), // last week, not this one
    practice('creativity', 'Painting', 4, day(2026, 8, 20)), // long quiet
  ]

  it('adds up growth by area inside the week only', () => {
    const r = composeWeekly(events, SUN)
    const grew = r.sections.find((s) => s.id === 'grew').lines.join(' ')
    expect(grew).toContain('Health & Fitness (30 xp)')
    expect(grew).toContain('Craft & Career (5 xp)')
    expect(grew).not.toContain('Mind & Learning (30')
    expect(grew).toContain('3 of 7 days') // three different days had growth
    expect(r.facts.totalXp).toBe(35)
    expect(r.facts.activeDays).toBe(3)
  })

  it('names the quiet areas, and skips a paused one', () => {
    const stalled = (evs) => composeWeekly(evs, SUN).sections.find((s) => s.id === 'stalled').lines.join(' ')
    expect(stalled(events)).toMatch(/Quiet this week:.*Mind & Learning.*Creativity|Quiet this week:.*Creativity.*Mind & Learning/)
    expect(stalled([...events, ev('area.paused', { area: 'creativity' }, day(2026, 9, 1))])).not.toContain('Creativity')
  })

  it('says so plainly when nothing grew', () => {
    const r = composeWeekly([practice('mind', 'Reading', 30, day(2026, 8, 1))], SUN)
    expect(r.sections.find((s) => s.id === 'grew').lines).toEqual(['Nothing grew this week, and that is allowed.'])
    expect(r.facts.totalXp).toBe(0)
  })

  it('is complete and never blank for an empty log', () => {
    const r = composeWeekly([], SUN)
    expect(r.sections.map((s) => s.id)).toEqual(['grew', 'stalled', 'wins', 'suggestion', 'question'])
    for (const s of r.sections) for (const l of s.lines) expect(l.trim().length).toBeGreaterThan(10)
    expect(r.text).toContain(r.title)
  })
})

describe('wins, the suggestion and the question', () => {
  it('folds several first-growth wins into one line', () => {
    const events = ['health', 'mind', 'craft'].map((a, i) => practice(a, `Skill ${i}`, 5, day(2026, 9, 15 + i)))
    const wins = composeWeekly(events, SUN).sections.find((s) => s.id === 'wins').lines
    expect(wins).toHaveLength(1)
    expect(wins[0]).toMatch(/First growth this week in .* and /)
  })

  it('suggests the most urgent open thing, with a way to act on it', () => {
    const bill = ev('money.bill.defined', { billId: 'rent', name: 'Rent', amountCents: 100000, cadence: 'once', dueDate: '2026-09-15' }, day(2026, 8, 1))
    const r = composeWeekly([bill], SUN)
    expect(r.sections.find((s) => s.id === 'suggestion').lines[0]).toContain('Rent')
    expect(r.suggestion).toMatchObject({ obsId: 'bill.overdue', private: true, cta: { route: '/money' } })
    expect(composeWeekly([], SUN).suggestion).toBeNull()
  })

  it('asks a different question in a different week, always from the fixed list', () => {
    const asked = new Set()
    for (let week = 0; week < 6; week++) {
      const q = composeWeekly([], day(2026, 9, 20 + 7 * week, 20)).question
      expect(QUESTIONS).toContain(q)
      asked.add(q)
    }
    expect(asked.size).toBe(QUESTIONS.length)
    expect(composeWeekly([], day(2026, 9, 20, 8)).question).toBe(composeWeekly([], day(2026, 9, 20, 22)).question) // same week, same question
  })
})

describe('the same data gives the same review', () => {
  it('built twice, word for word, and it writes nothing', () => {
    const events = [practice('health', 'Running', 20, day(2026, 9, 15)), ev('money.bill.defined', { billId: 'rent', name: 'Rent', amountCents: 1, cadence: 'once', dueDate: '2026-09-10' }, day(2026, 8, 1))]
    const frozen = JSON.stringify(events)
    expect(JSON.stringify(composeWeekly(events, SUN))).toBe(JSON.stringify(composeWeekly(events, SUN)))
    expect(JSON.stringify(events)).toBe(frozen)
  })
})

describe('what may be sent out for the optional polish', () => {
  const rent = ev('money.bill.defined', { billId: 'rent', name: 'Landlord Rent', amountCents: 1, cadence: 'once', dueDate: '2026-09-10' }, day(2026, 8, 1))
  const therapy = Array.from({ length: 4 }, (_, i) => ev('tracker.entry', { trackerId: 'mind', values: { kind: 'therapy', minutes: 60 } }, day(2026, 9, 15 + i)))

  it('leaves out a private bill and a private tracker\'s skill', () => {
    const r = composeWeekly([rent, ...therapy], SUN)
    expect(r.text).toContain('Landlord Rent') // on the device it is shown
    expect(r.aiText).not.toContain('Landlord')
    expect(r.aiText).toContain('Something in a private area is worth a look.')
    expect(r.aiText).not.toMatch(/therapy/i)
    expect(r.text).not.toMatch(/therapy/i) // even on screen, a private skill is shown as its area
  })

  it('stays short enough to send', () => {
    expect(composeWeekly([rent, ...therapy], SUN).aiText.length).toBeLessThan(1900)
  })
})

describe('the Sunday line and Jarvis\'s note in the evening briefing', () => {
  const bill = ev('money.bill.defined', { billId: 'rent', name: 'Landlord Rent', amountCents: 100000, cadence: 'once', dueDate: '2026-09-10' }, day(2026, 8, 1))

  it('says the review is ready on Sundays and not on other days', () => {
    expect(weeklyReadyLine(SUN)).toBe('Your weekly review is ready in Jarvis.')
    expect(weeklyReadyLine(WED)).toBeNull()
    expect(composeBriefing([], SUN).lines).toContain('Your weekly review is ready in Jarvis.')
    expect(composeBriefing([], WED).lines.join('\n')).not.toContain('weekly review')
  })

  it('adds one generic line for something private, never its name or amount', () => {
    const b = composeBriefing([bill], WED)
    const noteLines = b.lines.filter((l) => l.startsWith("Jarvis's note:"))
    expect(noteLines).toHaveLength(1)
    expect(noteLines[0]).not.toMatch(/Landlord|1,000|100000/)
    expect(b.body).not.toContain('Landlord')
    expect(b.note).toMatchObject({ obsId: 'bill.overdue', private: true })
  })

  it('is absent when he is set to never speak up, including the Sunday line', () => {
    const b = composeBriefing([bill], SUN, { speakUp: 'never' })
    expect(b.lines.join('\n')).not.toMatch(/Jarvis's note|weekly review/)
    expect(b.note).toBeNull()
  })

  it('leaves the rest of the briefing exactly as it was', () => {
    const plain = composeBriefing([], WED, { speakUp: 'never' })
    const withNotes = composeBriefing([], WED)
    expect(withNotes.lines).toEqual(plain.lines)
  })

  it('a day is a local date', () => {
    expect(localDate(SUN)).toBe('2026-09-20')
  })
})
