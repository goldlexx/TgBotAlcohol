import { Temporal } from '@js-temporal/polyfill';

export const DAY = 86_400_000;
const instant = ms => Temporal.Instant.fromEpochMilliseconds(ms);
export const local = (ms, zone) => instant(ms).toZonedDateTimeISO(zone);
export const localDay = (ms, zone) => local(ms, zone).toPlainDate();
export const midnight = (day, zone) => day.toZonedDateTime(zone).epochMilliseconds;
export const today = (ms, zone) => localDay(ms, zone).toString();

export function zoneName(value) {
  if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(value)) throw new Error('zone');
  return new Intl.DateTimeFormat('ru', { timeZone: value }).resolvedOptions().timeZone;
}

export function parseDate(value, zone, now, precision) {
  if (precision === 'day') {
    if (!/^\d{4}-\d\d-\d\d$/.test(value)) throw new Error('date');
    const day = Temporal.PlainDate.from(value);
    if (Temporal.PlainDate.compare(day, localDay(now, zone)) > 0) throw new Error('future');
    const start = midnight(day, zone);
    if (!localDay(start, zone).equals(day)) throw new Error('skipped day');
    return { ms: midnight(day.add({ days: 1 }), zone), precision, day: day.toString() };
  }
  const match = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d)(?: ([12]))?$/.exec(value);
  if (!match || !validClock(match[2])) throw new Error('date');
  const date = Temporal.PlainDateTime.from(match[1] + 'T' + match[2]);
  const first = date.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const last = date.toZonedDateTime(zone, { disambiguation: 'later' });
  if (!first.toPlainDateTime().equals(date) || !last.toPlainDateTime().equals(date)) throw new Error('gap');
  if (first.epochMilliseconds !== last.epochMilliseconds && !match[3]) throw new Error('ambiguous');
  const ms = (match[3] === '2' ? last : first).epochMilliseconds;
  if (ms > now) throw new Error('future');
  return { ms, precision };
}

export const validClock = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const displayTime = (ms, zone) => local(ms, zone).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ');
export const observation = (date, zone) => date.precision === 'day'
  ? (date.day ?? localDay(date.ms - 1, zone).toString()) + ' (время неизвестно)'
  : displayTime(date.ms, zone);

export function completeDates(start, end, zone, excludeStart = false) {
  let first = localDay(start, zone);
  if (excludeStart || midnight(first, zone) < start) first = first.add({ days: 1 });
  const count = Math.max(0, first.until(localDay(end, zone)).days);
  return { first, count };
}

export function clockOn(day, zone, clock) {
  return day.toPlainDateTime(clock).toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds;
}

export function nextReport(now, profile, afterDay = null) {
  if (profile.frequency === 'off') return null;
  let day = localDay(now, profile.zone);
  for (let i = 0; i < 8; i++, day = day.add({ days: 1 })) {
    if (afterDay && day.toString() <= afterDay) continue;
    if (['weekly', 'selected'].includes(profile.frequency) && !profile.weekdays.includes(day.dayOfWeek)) continue;
    const slot = clockOn(day, profile.zone, profile.clock);
    if (slot > now && today(slot, profile.zone) === day.toString()) return slot;
  }
  return null;
}
