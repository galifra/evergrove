// Compute "today" and "now" in an arbitrary IANA timezone without pulling in
// a date library — Intl handles DST correctly on its own.

export function localDateString(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()) // en-CA formats as YYYY-MM-DD
}

export function localHourMinute(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date())
  const hour = parts.find((p) => p.type === 'hour').value
  const minute = parts.find((p) => p.type === 'minute').value
  return `${hour === '24' ? '00' : hour}:${minute}`
}

// Minutes between two "HH:MM" times, wrapping is not needed since both are
// same-day local times.
export function minutesBetween(a, b) {
  const [ah, am] = a.split(':').map(Number)
  const [bh, bm] = b.split(':').map(Number)
  return Math.abs(ah * 60 + am - (bh * 60 + bm))
}
