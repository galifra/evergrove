import { describe, it, expect } from 'vitest'
import { createEvent, localDate } from '@evergrove/core/events.js'
import { xpForLevel } from '@evergrove/core/lib/treeEngine.js'
import { AREAS } from '@evergrove/core/events.js'
import { CATALOG, MUTE_DAYS, SPEAK_UP, briefingNote, chooseNotes, feedbackState, inQuietHours, notificationLine, observe, wording } from '../observations.js'
import { deriveToday } from '../today.js'

// The observation engine (T-P7): each observation fires exactly when its threshold is crossed
// and not before, the limits hold over a month, and the privacy and silence rules are absolute.
// These build events directly (with chosen times) so the days can be moved without a real clock.

const NOW = new Date(2026, 8, 19, 19, 0) // Saturday 19 September 2026, 7pm
const TODAY = '2026-09-19'
let n = 0
const day = (offset, hh = 12, mm = 0) => new Date(2026, 8, 19 + offset, hh, mm)
const ymd = (offset) => localDate(day(offset))
const ev = (type, data, when = day(-30), extra = {}) =>
  createEvent({ id: `t${n++}`, type, app: extra.app ?? 'test', area: extra.area ?? null, data, occurredAt: when.toISOString(), now: when })

const bill = (name, dueDate, extra = {}, when = day(-40)) => ev('money.bill.defined', { billId: name.toLowerCase().replace(/\W+/g, '-'), name, amountCents: 5000, cadence: 'once', dueDate, ...extra }, when)
const task = (id, title, due, extra = {}, when = day(-40)) => ev('task.created', { taskId: id, title, due, effort: 1, ...extra }, when)
const habit = (id, name, area = 'health', when = day(-60)) => ev('habit.defined', { habitId: id, name, area, cadence: 'daily' }, when)
const check = (id, offset) => ev('habit.checked', { habitId: id, date: ymd(offset) }, day(offset))
const practice = (area, name, xp, when) => ev('skill.practiced', { domain: area, skillName: name, xp, text: name }, when)
const kinds = (events, when = NOW, opts) => observe(events, when, opts).map((o) => o.obsId)
const has = (events, id, when = NOW, opts) => kinds(events, when, opts).includes(id)

describe('time-sensitive observations fire at their threshold, not before', () => {
  it('a bill: overdue from the day after, "soon" within 3 days, nothing at 4', () => {
    expect(has([bill('Rent', ymd(-1))], 'bill.overdue')).toBe(true)
    expect(has([bill('Rent', ymd(0))], 'bill.overdue')).toBe(false)
    expect(has([bill('Rent', ymd(0))], 'bill.soon')).toBe(true)
    expect(has([bill('Rent', ymd(3))], 'bill.soon')).toBe(true)
    expect(kinds([bill('Rent', ymd(4))])).toEqual([])
  })

  it('a paid bill says nothing', () => {
    const events = [bill('Rent', ymd(-1)), ev('money.bill.paid', { billId: 'rent', period: 'once', paidOn: TODAY, amountCents: 5000 }, day(0, 9))]
    expect(kinds(events)).toEqual([])
  })

  it('a tax or insurance bill is a deadline, not just a bill', () => {
    const events = [bill('Car insurance', ymd(2), { category: 'insurance' })]
    expect(kinds(events)).toEqual(['deadline.soon'])
  })

  it('a clash in the next 7 days, but not in 8, and never for all-day events', () => {
    const cal = (id, title, start, extra = {}) => ev('calendar.event.created', { eventId: id, title, start, ...extra })
    expect(has([cal('a', 'Dentist', `${ymd(2)}T10:00`, { end: `${ymd(2)}T11:00` }), cal('b', 'Lunch', `${ymd(2)}T10:30`, { end: `${ymd(2)}T11:30` })], 'event.clash')).toBe(true)
    expect(has([cal('a', 'Dentist', `${ymd(8)}T10:00`, { end: `${ymd(8)}T11:00` }), cal('b', 'Lunch', `${ymd(8)}T10:30`, { end: `${ymd(8)}T11:30` })], 'event.clash')).toBe(false)
    expect(has([cal('a', 'Dentist', `${ymd(2)}T10:00`, { end: `${ymd(2)}T11:00` }), cal('b', 'Lunch', `${ymd(2)}T11:00`, { end: `${ymd(2)}T12:00` })], 'event.clash')).toBe(false)
    expect(has([cal('a', 'Holiday', ymd(2), { allDay: true }), cal('b', 'Lunch', `${ymd(2)}T11:00`, { end: `${ymd(2)}T12:00` })], 'event.clash')).toBe(false)
  })

  it('a task: more than 3 days late fires, exactly 3 does not', () => {
    expect(has([task('t1', 'File taxes', ymd(-4))], 'task.overdue')).toBe(true)
    expect(has([task('t1', 'File taxes', ymd(-3))], 'task.overdue')).toBe(false)
    expect(has([task('t1', 'File taxes', ymd(-9)), ev('task.completed', { taskId: 't1', title: 'File taxes', date: TODAY }, day(0, 8))], 'task.overdue')).toBe(false)
  })

  it('reviews: 10 due fires, 9 does not', () => {
    const entries = (count) => Array.from({ length: count }, (_, i) => ev('tracker.entry', { trackerId: 'learning', values: { subject: `Topic ${i}`, remember: `Fact ${i}`, type: 'lesson', date: ymd(-20) } }, day(-20)))
    expect(has(entries(10), 'review.overflow')).toBe(true)
    expect(has(entries(9), 'review.overflow')).toBe(false)
  })
})

describe('pattern observations', () => {
  const run = (id, n2, area = 'health') => [habit(id, 'Stretch', area), ...Array.from({ length: n2 }, (_, i) => check(id, -(i + 1)))]

  it('a streak at risk: 5 or more days, unchecked, after 6pm only', () => {
    expect(has(run('h', 5), 'streak.risk')).toBe(true)
    expect(has(run('h', 4), 'streak.risk')).toBe(false)
    expect(has(run('h', 5), 'streak.risk', day(0, 17, 59))).toBe(false)
    expect(has(run('h', 5), 'streak.risk', day(0, 18, 0))).toBe(true)
    expect(has([...run('h', 5), check('h', 0)], 'streak.risk')).toBe(false)
  })

  it('a goal stalls at 10 days without progress, and any progress resets it', () => {
    const goal = (when) => ev('goal.created', { goalId: 'g', title: 'Write a book', area: 'craft', milestones: [{ id: 'm1', text: 'Outline' }] }, when)
    expect(has([goal(day(-10))], 'goal.stalled')).toBe(true)
    expect(has([goal(day(-9))], 'goal.stalled')).toBe(false)
    expect(has([goal(day(-20)), ev('goal.milestone.done', { goalId: 'g', milestoneId: 'm1', text: 'Outline' }, day(-9))], 'goal.stalled')).toBe(false)
    expect(has([goal(day(-20)), task('t9', 'Draft ch1', null, { goalId: 'g' }, day(-19)), ev('task.completed', { taskId: 't9', title: 'Draft ch1', date: ymd(-3) }, day(-3))], 'goal.stalled')).toBe(false)
    expect(has([goal(day(-20))], 'goal.stalled')).toBe(true)
  })

  it('a goal that is finished is not stalled', () => {
    expect(has([ev('goal.created', { goalId: 'g', title: 'X', area: 'craft', milestones: [] }, day(-30)), ev('goal.completed', { goalId: 'g' }, day(-1))], 'goal.stalled')).toBe(false)
  })

  it('a budget over for the second month in a row', () => {
    const budget = ev('money.budget.set', { category: 'food', monthlyCents: 10000 })
    const buy = (offset, cents) => ev('money.purchase.logged', { purchaseId: `p${n++}`, amountCents: cents, category: 'food', date: ymd(offset) }, day(offset))
    expect(has([budget, buy(-2, 12000), buy(-25, 12000)], 'budget.over')).toBe(true)
    expect(has([budget, buy(-2, 12000)], 'budget.over')).toBe(false)
    expect(has([budget, buy(-2, 8000), buy(-25, 12000)], 'budget.over')).toBe(false)
  })

  it('an area silent for 14 days, not 13', () => {
    expect(has([practice('craft', 'Guitar', 10, day(-14))], 'area.silent')).toBe(true)
    expect(has([practice('craft', 'Guitar', 10, day(-13))], 'area.silent')).toBe(false)
  })

  it('a habit dip: steady for 3 weeks, then under 30% of that rate', () => {
    const base = (recent) => {
      const events = [habit('h', 'Stretch')]
      for (let i = 7; i < 28; i++) events.push(check('h', -i))
      for (let i = 0; i < recent; i++) events.push(check('h', -i))
      return events
    }
    expect(has(base(0), 'habit.dip')).toBe(true)
    expect(has(base(2), 'habit.dip')).toBe(true)
    expect(has(base(3), 'habit.dip')).toBe(false)
    // not enough history to call it a dip
    expect(has([habit('h', 'Stretch', 'health', day(-20)), ...Array.from({ length: 13 }, (_, i) => check('h', -(i + 7)))], 'habit.dip')).toBe(false)
  })

  it('a lopsided month: 70% in one area and two areas silent, not 69%', () => {
    const grow = (a, b) => [practice('health', 'Running', 40, day(-5)), ...(a > 40 ? [practice('health', 'Running', a - 40, day(-4))] : []), practice('mind', 'Reading', b, day(-3))]
    expect(has(grow(70, 30), 'focus.skew')).toBe(true)
    expect(has(grow(69, 31), 'focus.skew')).toBe(false)
    expect(has([practice('health', 'Running', 20, day(-5))], 'focus.skew')).toBe(false) // too little to say anything
  })
})

describe('wins', () => {
  const XP_TO_L5 = [1, 2, 3, 4, 5].reduce((sum, l) => sum + xpForLevel(l), 0)
  const upTo = (xp, lastAt) => {
    const events = []
    let left = xp
    while (left > 40) {
      events.push(practice('craft', 'Guitar', 40, day(-40)))
      left -= 40
    }
    events.push(practice('craft', 'Guitar', Math.max(1, left), lastAt))
    return events
  }

  it('a level that is a multiple of five, in the last 2 days only', () => {
    expect(has(upTo(XP_TO_L5, day(-1)), 'win.level')).toBe(true)
    expect(has(upTo(XP_TO_L5, day(-3)), 'win.level')).toBe(false)
    expect(has(upTo(XP_TO_L5 - 1, day(-1)), 'win.level')).toBe(false)
  })

  it('the skill of a private tracker is never named, in the app or out of it', () => {
    const entries = []
    let xp = 0
    while (xp < XP_TO_L5) {
      entries.push(ev('tracker.entry', { trackerId: 'mind', values: { kind: 'therapy', minutes: 60 } }, day(-1, 8 + (entries.length % 3))))
      xp += 20
    }
    const wins = observe(entries, NOW).filter((o) => o.obsId === 'win.level')
    expect(wins).toHaveLength(1)
    expect(wins[0].private).toBe(true)
    expect(wins[0].params.skill).toBe('Mind & Learning')
    expect(wording(wins[0], 0)).not.toMatch(/therapy/i)
    expect(notificationLine(wins[0], 0)).not.toMatch(/therapy/i)
  })

  it('an ordinary skill is named', () => {
    const wins = observe(upTo(XP_TO_L5, day(-1)), NOW).filter((o) => o.obsId === 'win.level')
    expect(wins[0].params.skill).toBe('Guitar')
  })

  it('a streak milestone within a day of being reached', () => {
    const run = (len) => [habit('h', 'Stretch'), ...Array.from({ length: len }, (_, i) => check('h', -(i + 1)))]
    expect(has(run(6), 'win.streak')).toBe(false)
    expect(has([...run(6), check('h', 0)], 'win.streak')).toBe(true)
    expect(has(run(8), 'win.streak')).toBe(true)
    expect(has(run(9), 'win.streak')).toBe(false)
  })

  it('a finished goal milestone in the last 2 days', () => {
    const goal = ev('goal.created', { goalId: 'g', title: 'Write a book', area: 'craft', milestones: [{ id: 'm1', text: 'Outline' }] }, day(-30))
    expect(has([goal, ev('goal.milestone.done', { goalId: 'g', milestoneId: 'm1', text: 'Outline' }, day(-1))], 'win.goal')).toBe(true)
    expect(has([goal, ev('goal.milestone.done', { goalId: 'g', milestoneId: 'm1', text: 'Outline' }, day(-3))], 'win.goal')).toBe(false)
  })

  it('the first growth in an area', () => {
    expect(has([practice('craft', 'Guitar', 5, day(-1))], 'win.first')).toBe(true)
    expect(has([practice('craft', 'Guitar', 5, day(-20)), practice('craft', 'Guitar', 5, day(-1))], 'win.first')).toBe(false)
  })
})

describe('paused areas stay silent', () => {
  it('nothing about a paused area\'s habits, goals, skills or wins', () => {
    const paused = ev('area.paused', { area: 'health' }, day(-1))
    const habits = [habit('h', 'Stretch', 'health'), ...Array.from({ length: 5 }, (_, i) => check('h', -(i + 1)))]
    expect(kinds([...habits, paused])).not.toContain('streak.risk')
    expect(kinds([...habits, paused])).not.toContain('win.streak')
    expect(has([practice('health', 'Running', 10, day(-20)), paused], 'area.silent')).toBe(false)
    expect(has([practice('health', 'Running', 10, day(-1)), paused], 'win.first')).toBe(false)
    expect(has([ev('goal.created', { goalId: 'g', title: 'Run a 10k', area: 'health', milestones: [] }, day(-30)), paused], 'goal.stalled')).toBe(false)
    // and it comes back when the area does
    expect(kinds([...habits, paused, ev('area.resumed', { area: 'health' }, day(0, 9))])).toContain('streak.risk')
  })
})

describe('what is allowed to be shown (limits, cooldowns, quiet hours, muting)', () => {
  const many = () => [
    bill('Rent', ymd(-2)),
    bill('Phone', ymd(1)),
    task('t1', 'File taxes', ymd(-6)),
    practice('craft', 'Guitar', 5, day(-1)), // a win, priority 6
  ]
  const shownEvent = (obsId, key, offset) => ev('note.shown', { obsId, key, date: ymd(offset) }, day(offset, 9))

  it('shows at most 2 a day when only necessary, 4 when more often, none when never', () => {
    const events = many()
    const candidates = observe(events, NOW)
    expect(candidates.length).toBeGreaterThan(3)
    expect(chooseNotes(candidates, events, NOW, { speakUp: 'necessary' }).show).toHaveLength(2)
    expect(chooseNotes(candidates, events, NOW, { speakUp: 'often' }).show).toHaveLength(4)
    expect(chooseNotes(candidates, events, NOW, { speakUp: 'never' }).show).toEqual([])
  })

  it('"only when necessary" leaves out the wins and the balance notes', () => {
    const events = [practice('craft', 'Guitar', 5, day(-1))]
    const c = observe(events, NOW)
    expect(chooseNotes(c, events, NOW, { speakUp: 'necessary' }).show).toEqual([])
    expect(chooseNotes(c, events, NOW, { speakUp: 'often' }).show).toHaveLength(1)
  })

  it('most urgent first', () => {
    const events = many()
    const shown = chooseNotes(observe(events, NOW), events, NOW).show
    expect(shown.map((x) => x.obsId)).toEqual(['bill.overdue', 'bill.soon'])
  })

  it('a note already shown today stays, and counts against today\'s limit', () => {
    const events = many()
    const first = chooseNotes(observe(events, NOW), events, NOW)
    const withLog = [...events, ...first.fresh.map((c) => ev('note.shown', { obsId: c.obsId, key: c.key, date: TODAY }, day(0, 9)))]
    const again = chooseNotes(observe(withLog, NOW), withLog, NOW)
    expect(again.fresh).toEqual([])
    expect(again.show.map((x) => x.key)).toEqual(first.show.map((x) => x.key))
    expect(again.show.map((x) => x.text)).toEqual(first.show.map((x) => x.text)) // and reads the same on a second look
  })

  it('a cooldown holds for its whole length and ends on the day', () => {
    const events = [ev('goal.created', { goalId: 'g', title: 'Write a book', area: 'craft', milestones: [] }, day(-40))]
    const key = 'goal.stalled:g'
    for (const [ago, expected] of [[1, 0], [9, 0], [10, 1]]) {
      const log = [...events, shownEvent('goal.stalled', key, -ago)]
      expect(chooseNotes(observe(log, NOW), log, NOW).show).toHaveLength(expected)
    }
  })

  it('a win is said once and never again', () => {
    const events = [practice('craft', 'Guitar', 5, day(-1))]
    const log = [...events, shownEvent('win.first', 'win.first:craft', -1)]
    expect(chooseNotes(observe(log, NOW), log, NOW, { speakUp: 'often' }).show).toEqual([])
  })

  it('quiet hours (10pm to 7am) allow only the most urgent', () => {
    const events = many()
    for (const hour of [22, 23, 3, 6]) {
      const when = day(0, hour)
      expect(inQuietHours(when)).toBe(true)
      expect(chooseNotes(observe(events, when), events, when).show.map((x) => x.obsId)).toEqual(['bill.overdue'])
    }
    const morning = day(0, 7)
    expect(inQuietHours(morning)).toBe(false)
    expect(chooseNotes(observe(events, morning), events, morning).show).toHaveLength(2)
  })

  it('"not useful" mutes that kind for 30 days, then lets it back; "unmute" ends it early', () => {
    const events = many()
    const mute = (offset) => ev('feedback.given', { targetKind: 'note', targetId: 'bill.overdue', value: 'not_useful' }, day(offset, 9))
    const at = (offset) => {
      const log = [...events, mute(-offset)]
      return chooseNotes(observe(log, NOW), log, NOW).show.map((x) => x.obsId)
    }
    expect(at(1)).not.toContain('bill.overdue')
    expect(at(MUTE_DAYS - 1)).not.toContain('bill.overdue')
    expect(at(MUTE_DAYS)).toContain('bill.overdue')
    const log = [...events, mute(-1), ev('feedback.given', { targetKind: 'note', targetId: 'bill.overdue', value: 'unmuted' }, day(0, 10))]
    expect(chooseNotes(observe(log, NOW), log, NOW).show.map((x) => x.obsId)).toContain('bill.overdue')
    expect(feedbackState([...events, mute(-1)], NOW).muted[0]).toMatchObject({ obsId: 'bill.overdue', until: ymd(29) })
  })

  it('a thumbs down alone does not mute anything, and a rating on a reply is not a mute', () => {
    const events = [...many(), ev('feedback.given', { targetKind: 'note', targetId: 'bill.overdue', value: 'down' }, day(0, 9)), ev('feedback.given', { targetKind: 'reply', targetId: 'bill.overdue', value: 'not_useful' }, day(0, 9))]
    expect(chooseNotes(observe(events, NOW), events, NOW).show.map((x) => x.obsId)).toContain('bill.overdue')
  })

  it('a month of busy data never exceeds the daily limits', () => {
    // A full life: bills, late tasks, clashing events, stalled goals, dips, all at once, for 45 days.
    const base = []
    for (let i = 0; i < 6; i++) base.push(bill(`Bill ${i}`, ymd(-45 + i * 3)))
    for (let i = 0; i < 6; i++) base.push(task(`t${i}`, `Task ${i}`, ymd(-40 + i)))
    base.push(ev('goal.created', { goalId: 'g', title: 'Write a book', area: 'craft', milestones: [] }, day(-60)))
    base.push(practice('craft', 'Guitar', 5, day(-50)), practice('mind', 'Reading', 5, day(-45)))
    for (const setting of ['necessary', 'often']) {
      const log = [...base]
      const perDay = []
      for (let d = -30; d <= 0; d++) {
        const now = day(d, 20)
        // The person opens Jarvis several times a day; only the first opening can add anything.
        let added = 0
        for (let opening = 0; opening < 3; opening++) {
          const { fresh } = chooseNotes(observe(log, now), log, now, { speakUp: setting })
          for (const c of fresh) log.push(ev('note.shown', { obsId: c.obsId, key: c.key, date: ymd(d) }, day(d, 20, opening)))
          added += fresh.length
        }
        const shownToday = log.filter((e) => e.type === 'note.shown' && e.data.date === ymd(d)).length
        perDay.push(shownToday)
        expect(shownToday).toBeLessThanOrEqual(SPEAK_UP[setting].perDay)
        expect(added).toBeLessThanOrEqual(SPEAK_UP[setting].perDay)
      }
      expect(perDay.some((c) => c > 0)).toBe(true)
    }
  })
})

describe('wordings', () => {
  const SAMPLE = {
    name: 'Rent', days: 3, when: 'tomorrow', a: 'Dentist', b: 'Lunch', day: 'Monday', title: 'Write a book', category: 'food', count: 12,
    area: 'Health', recent: 1, usual: 6, percent: 80, silent: 3, skill: 'Guitar', level: 5, milestone: 'Outline', done: false,
  }
  const obs = (obsId, params = SAMPLE) => ({ obsId, key: obsId, ...CATALOG[obsId], params })

  it('every observation has three distinct, non-empty wordings in the house voice', () => {
    for (const id of Object.keys(CATALOG)) {
      const lines = [0, 1, 2].map((i) => wording(obs(id), i))
      expect(new Set(lines).size, id).toBe(3)
      for (const l of lines) {
        expect(l.trim().length, id).toBeGreaterThan(15)
        expect(l.length, id).toBeLessThanOrEqual(220)
        expect(l, id).not.toMatch(/!/)
        expect(l, id).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u)
        expect(l, id).not.toMatch(/undefined|NaN|\[object/)
        expect(l, id).not.toMatch(/\b(should have|you must|you failed|lazy|nag)\b/i)
        expect(l, id).not.toMatch(/\b(diagnos|therap|invest in)/i)
      }
    }
    for (const done of [true, false]) for (let i = 0; i < 3; i++) expect(wording(obs('win.goal', { ...SAMPLE, done }), i).trim().length).toBeGreaterThan(10)
  })

  it('rotates so the same wording is never used twice in a row', () => {
    const events = [bill('Rent', ymd(-2))]
    const said = []
    let log = [...events]
    for (let d = -6; d <= 0; d++) {
      const now = day(d, 20)
      const { show, fresh } = chooseNotes(observe(log, now), log, now)
      if (show[0]) said.push(show[0].text)
      for (const c of fresh) log.push(ev('note.shown', { obsId: c.obsId, key: c.key, date: ymd(d) }, day(d, 20)))
    }
    expect(said.length).toBeGreaterThan(3)
    for (let i = 1; i < said.length; i++) expect(said[i]).not.toBe(said[i - 1])
  })

  it('never repeats a Today line word for word: Today gives the fact, the note adds the offer', () => {
    const events = [bill('Rent', ymd(-2)), task('t1', 'File taxes', ymd(-6))]
    const today = deriveToday(events, NOW).map((i) => i.text)
    for (const o of observe(events, NOW)) for (let i = 0; i < 3; i++) expect(today).not.toContain(wording(o, i))
  })

  it('a private observation leaves the app only as a generic line', () => {
    const o = observe([bill('Rent', ymd(-2))], NOW)[0]
    expect(o.private).toBe(true)
    expect(wording(o, 0)).toContain('Rent')
    const line = notificationLine(o, 0)
    expect(line).not.toContain('Rent')
    expect(line).toMatch(/Money/)
    for (const id of Object.keys(CATALOG).filter((k) => CATALOG[k].private)) expect(notificationLine(obs(id), 0)).not.toMatch(/Rent|food|Dentist/)
    expect(notificationLine(obs('task.overdue'), 0)).toContain('Write a book')
  })
})

describe('the evening briefing line', () => {
  it('is one line, generic for private things, and follows the same rules', () => {
    const events = [bill('Rent', ymd(-2)), task('t1', 'File taxes', ymd(-6))]
    const line = briefingNote(events, NOW)
    expect(line.private).toBe(true)
    expect(line.text).not.toContain('Rent')
    expect(line.text.split('\n')).toHaveLength(1)
  })

  it('is silent for "never", for a muted kind, and when there is nothing', () => {
    const events = [bill('Rent', ymd(-2))]
    expect(briefingNote(events, NOW, { speakUp: 'never' })).toBeNull()
    expect(briefingNote([], NOW)).toBeNull()
    const muted = [...events, ev('feedback.given', { targetKind: 'note', targetId: 'bill.overdue', value: 'not_useful' }, day(-1))]
    expect(briefingNote(muted, NOW)).toBeNull()
  })

  it('leaves out wins unless he is set to speak more often', () => {
    const events = [practice('craft', 'Guitar', 5, day(-1))]
    expect(briefingNote(events, NOW)).toBeNull()
    expect(briefingNote(events, NOW, { speakUp: 'often' }).obsId).toBe('win.first')
  })
})

describe('the engine is pure', () => {
  it('gives the same answer twice, never writes anything, and covers every area name', () => {
    const events = [bill('Rent', ymd(-2)), practice('craft', 'Guitar', 5, day(-20))]
    const frozen = JSON.stringify(events)
    expect(JSON.stringify(observe(events, NOW))).toBe(JSON.stringify(observe(events, NOW)))
    expect(JSON.stringify(events)).toBe(frozen)
    expect(AREAS.length).toBe(7)
  })
})
