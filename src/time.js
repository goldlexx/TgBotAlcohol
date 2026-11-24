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
export const displayDay = iso => iso.split('-').reverse().join('.');
export const displayTime = (ms, zone) => displayDay(today(ms, zone)) + ', ' + local(ms, zone).toPlainTime().toString({ smallestUnit: 'minute' });
export const observation = (date, zone) => date.precision === 'day'
  ? displayDay(date.day ?? today(date.ms - 1, zone)) + ' (время неизвестно)'
  : displayTime(date.ms, zone);

export const popularZones = [
  ['Москва', 'Europe/Moscow'], ['Калининград', 'Europe/Kaliningrad'], ['Екатеринбург', 'Asia/Yekaterinburg'],
  ['Новосибирск', 'Asia/Novosibirsk'], ['Владивосток', 'Asia/Vladivostok']
];
const otherZones = [
  ['Санкт-Петербург', 'Europe/Moscow'], ['Минск', 'Europe/Minsk'], ['Алматы', 'Asia/Almaty'], ['Тбилиси', 'Asia/Tbilisi'],
  ['Ереван', 'Asia/Yerevan'], ['Баку', 'Asia/Baku'], ['Ташкент', 'Asia/Tashkent'], ['Киев', 'Europe/Kyiv'],
  ['Лондон', 'Europe/London'], ['Берлин', 'Europe/Berlin'], ['Париж', 'Europe/Paris'], ['Нью-Йорк', 'America/New_York'],
  ['Стамбул', 'Europe/Istanbul'], ['Дубай', 'Asia/Dubai'], ['Токио', 'Asia/Tokyo'], ['Самара', 'Europe/Samara']
];
export function cityZone(value) {
  const city = [...popularZones, ...otherZones].find(([name]) => name.toLocaleLowerCase('ru') === value.toLocaleLowerCase('ru'));
  if (city) return zoneName(city[1]);
  if (/^[a-z _-]+$/i.test(value) && value.toUpperCase() !== 'UTC') {
    const wanted = value.replaceAll(' ', '_').toLowerCase();
    const match = Intl.supportedValuesOf('timeZone').find(zone => zone.split('/').at(-1).toLowerCase() === wanted);
    if (match) return match;
  }
  return zoneName(value.toUpperCase() === 'UTC' ? 'UTC' : value);
}
export const zoneOffset = (zone, now) => 'UTC' + local(now, zone).offset.replace(/:00$/, '').replace(/^(\W)0(?=\d)/, '$1');
export function zoneLabel(zone, now) {
  if (zone === 'UTC') return 'Всемирное время (UTC)';
  const city = [...popularZones, ...otherZones].find(([, key]) => zone === key);
  if (city) return city[0];
  return new Intl.DateTimeFormat('ru', { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(now)
    .find(part => part.type === 'timeZoneName')?.value ?? zoneOffset(zone, now);
}
export const dateInput = raw => raw.replace(/^(\d\d)\.(\d\d)\.(\d{4})\b/, '$3-$2-$1');

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
