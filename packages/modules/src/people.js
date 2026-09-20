import { effectiveEvents, localDate } from '@evergrove/core/events.js'
import { findOne } from '@evergrove/core/match.js'
import { slugify } from '@evergrove/core/lib/treeEngine.js'

const DAY = 86400000

export function derivePeople(events, now = new Date()) {
  const today = localDate(now)
  const people = new Map()
  for (const e of effectiveEvents(events)) {
    const d = e.data
    if (e.type === 'people.person.saved') {
      const prev = people.get(d.personId) ?? { id: d.personId, likes: [], dislikes: [], giftIdeas: [], contacts: [] }
      people.set(d.personId, {
        ...prev,
        ...Object.fromEntries(Object.entries(d).filter(([k, v]) => k !== 'personId' && v !== undefined)),
        id: d.personId,
      })
    } else if (e.type === 'people.contact.logged') {
      people.get(d.personId)?.contacts.push({ date: d.date, kind: d.kind, text: d.text })
    }
  }

  const list = [...people.values()].map((p) => {
    const last = p.contacts.map((c) => c.date).sort().at(-1) ?? null
    const daysSince = last ? Math.floor((new Date(today) - new Date(last)) / DAY) : null
    return { ...p, lastContact: last, daysSince, nextBirthday: p.birthday ? nextBirthday(p.birthday, today) : null }
  })

  const upcomingBirthdays = list
    .filter((p) => p.nextBirthday && p.nextBirthday.inDays <= 30)
    .sort((a, b) => a.nextBirthday.inDays - b.nextBirthday.inDays)
  const overdueContact = list.filter((p) => p.daysSince === null || p.daysSince > 30)
  return { people: list.sort((a, b) => a.name.localeCompare(b.name)), upcomingBirthdays, overdueContact }
}

// birthday is "MM-DD"
export function nextBirthday(birthday, today) {
  const [y] = today.split('-').map(Number)
  const [m, d] = birthday.split('-').map(Number)
  let target = new Date(y, m - 1, d)
  const base = new Date(today)
  if (target < base) target = new Date(y + 1, m - 1, d)
  return { date: localDate(target), inDays: Math.round((target - base) / DAY) }
}

export const peopleModule = {
  id: 'people',
  name: 'People',
  icon: 'users',
  area: 'social',
  description: 'The people who matter: birthdays, what they like, and when you last connected.',
  sensitive: true,
  derive: derivePeople,
  context(state) {
    const lines = []
    if (state.upcomingBirthdays.length) {
      lines.push('Birthdays soon: ' + state.upcomingBirthdays.map((p) => `${p.name} ${p.nextBirthday.date}`).join('; '))
    }
    return lines.join('\n')
  },
  actions: [
    {
      name: 'save_person',
      tier: 'auto',
      description: 'Save or update a person: birthday (MM-DD), relationship, likes, dislikes, gift ideas.',
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 60 },
          relationship: { type: 'string', maxLength: 40 },
          birthday: { type: 'string', pattern: '^\\d{2}-\\d{2}$', description: 'MM-DD' },
          likes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } },
          dislikes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 60 } },
          giftIdeas: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
          notes: { type: 'string', maxLength: 200 },
        },
        required: ['name'],
      },
      run(args, { moduleState }) {
        const existing = moduleState().people.find((p) => p.name.toLowerCase() === args.name.toLowerCase())
        const merge = (key) => (args[key] ? [...new Set([...(existing?.[key] ?? []), ...args[key]])] : undefined)
        return {
          summary: `${existing ? 'Updated' : 'Saved'} ${args.name}.`,
          events: [
            {
              type: 'people.person.saved',
              data: {
                personId: existing?.id ?? slugify(args.name),
                name: args.name,
                relationship: args.relationship,
                birthday: args.birthday,
                likes: merge('likes'),
                dislikes: merge('dislikes'),
                giftIdeas: merge('giftIdeas'),
                notes: args.notes,
              },
            },
          ],
        }
      },
    },
    {
      name: 'log_contact',
      tier: 'auto',
      description: 'Record that you connected with someone (call, text, visit, gift).',
      input: {
        type: 'object',
        properties: {
          person: { type: 'string', maxLength: 60 },
          kind: { type: 'string', enum: ['call', 'text', 'visit', 'gift', 'other'] },
          note: { type: 'string', maxLength: 120 },
        },
        required: ['person'],
      },
      run(args, { moduleState, now }) {
        const r = findOne(moduleState().people, args.person, { label: (p) => p.name, noun: 'person' })
        if (r.error) return { error: r.error }
        return {
          summary: `Logged a ${args.kind ?? 'contact'} with ${r.item.name}.`,
          events: [
            {
              type: 'people.contact.logged',
              area: 'social',
              data: { personId: r.item.id, kind: args.kind ?? 'other', text: args.note || `Connected with ${r.item.name}`, date: localDate(now) },
            },
          ],
        }
      },
    },
  ],
}
