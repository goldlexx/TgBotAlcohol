import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate } from '../src/calculations.js';
import { parseHabit } from '../src/habits.js';
import { timeline } from '../src/history.js';
import { DAY, clockOn, localDay, nextReport, parseDate } from '../src/time.js';
import { facts, sources } from '../content/facts.js';
import { ideas } from '../content/ideas.js';

const date = Date.parse;
const epoch = date('2025-01-01T00:00Z');
const range = (start, end = null, precision = 'instant') => ({ start, end, precision });
const habit = (value, effective = epoch, mode = 'average') => ({ ...parseHabit(value, mode), effective });
const close = (value, expected) => assert.ok(Math.abs(value.toNumber() - expected) < 1e-6, String(value));

for (const [schedule, grams, kcal, rub] of [
  ['7 RUB\n7 1000 5 300', 1183.5, 8284.5, 9000],
  ['7 RUB\n3 300 12 160', 365.1942857, 2556.36, 2057.142857],
  ['7 RUB\n1 200 40 240', 270.5142857, 1893.6, 1028.5714286]
]) {
  test('30 суток · ' + schedule.split('\n')[1], () => {
    const result = calculate([range(epoch)], [habit(schedule)], 'UTC', epoch + 30 * DAY);
    close(result.grams, grams);
    close(result.calories, kcal);
    close(result.money.get('RUB').div(100), rub);
  });
}

test('Четыре полных субботы, будний день ничего не добавляет', () => {
  const calendar = habit('7 RUB\n6 1 200 40 240', epoch, 'calendar');
  const before = calculate([range(epoch)], [calendar], 'UTC', date('2025-01-26T00:00Z'));
  const after = calculate([range(epoch)], [calendar], 'UTC', date('2025-01-28T00:00Z'));
  close(before.grams, 252.48);
  close(before.calories, 1767.36);
  close(before.money.get('RUB').div(100), 960);
  close(after.grams, 252.48);
  assert.equal(calculate([range(date('2025-01-04T01:00Z'))], [calendar], 'UTC', date('2025-01-05T00:00Z')).grams, null);
});

test('Неполные данные и несколько строк, общий бюджет исключает цены', () => {
  const mixed = habit('7 RUB\n2 100 10 -\n1 200 - 100\n1 100 15 20');
  const stats = calculate([range(epoch)], [mixed], 'UTC', epoch + DAY / 2);
  close(stats.grams, 27.615 / 14);
  close(stats.money.get('RUB'), 12000 / 14);
  assert.equal(stats.days, 0);
  assert.ok(stats.partialGrams);
  assert.ok(stats.partialCurrencies.has('RUB'));
  assert.throws(() => habit('7 RUB 1000\n1 100 1 100'));
  assert.throws(() => habit('7 JPY 100.12'));
  assert.equal(habit('7 KWD 1.234').budget, 1234);
  const budget = calculate([range(epoch)], [habit('7 EUR 140')], 'UTC', epoch + DAY);
  assert.equal(budget.grams, null);
  assert.equal(budget.calories, undefined);
});

test('Версии средняя и календарная, валюты и граница дня', () => {
  const history = [
    habit('7 RUB 1400'),
    habit('7 EUR\n6 1 - - 15', date('2025-01-04T00:00Z'), 'calendar'),
    habit('28 USD 280', date('2025-01-05T00:00Z'))
  ];
  const stats = calculate([range(epoch)], history, 'UTC', date('2025-01-06T00:00Z'));
  assert.deepEqual([...stats.money].map(([code, amount]) => [code, amount.toNumber()]), [['RUB', 60000], ['EUR', 1500], ['USD', 1000]]);
  assert.equal(stats.days, 4);
});

test('Эпизод приостанавливает и поздняя коррекция пересчитывает историю и награды', () => {
  const base = { ms: epoch, precision: 'minute' };
  const open = { start: epoch + DAY * 8, last: null, precision: null };
  const calc = events => calculate(timeline(base, events), [habit('7 RUB 700')], 'UTC', epoch + DAY * 12);
  assert.deepEqual(calc([open]).awards, [1, 3, 7]);
  assert.equal(calc([open]).current, 0);
  const closed = { ...open, start: epoch + DAY * 6, last: epoch + DAY * 10, precision: 'minute' };
  const stats = calc([closed]);
  assert.deepEqual(stats.awards, [1, 3]);
  assert.equal(stats.current, 2 * DAY);
  assert.equal(stats.days, 6);
  close(stats.money.get('RUB'), 80000);
  assert.throws(() => timeline(base, [open, { ...closed, start: epoch + DAY * 9 }]));
});

test('Границы шкалы и последняя награда', () => {
  assert.equal(calculate([range(epoch)], [], 'UTC', epoch + DAY).percent, 0);
  assert.equal(calculate([range(epoch)], [], 'UTC', epoch + 2 * DAY).percent, 50);
  const final = calculate([range(epoch)], [], 'UTC', epoch + 1825 * DAY);
  assert.equal(final.percent, 100);
  assert.equal(final.next, undefined);
  assert.equal(final.awards.length, 12);
});

test('DST весной и осенью, несуществующее и двусмысленное время', () => {
  const zone = 'America/New_York', now = date('2026-01-01T00:00Z');
  assert.throws(() => parseDate('2025-03-09 02:30', zone, now, 'minute'), /gap/);
  assert.throws(() => parseDate('2025-11-02 01:30', zone, now, 'minute'), /ambiguous/);
  const a = parseDate('2025-11-02 01:30 1', zone, now, 'minute');
  const b = parseDate('2025-11-02 01:30 2', zone, now, 'minute');
  assert.equal(b.ms - a.ms, 3_600_000);
  assert.throws(() => parseDate('2027-01-01 00:00', zone, now, 'minute'), /future/);
  const day = localDay(date('2025-03-09T12:00Z'), zone);
  assert.equal(clockOn(day, zone, '02:30'), date('2025-03-09T07:30Z'));
  assert.equal(nextReport(date('2025-11-02T05:40Z'), { zone, clock: '01:30', frequency: 'daily' }), date('2025-11-03T06:30Z'));
});

test('Неизвестное время: следующая полночь, текущая дата исключена', () => {
  const now = date('2025-01-02T10:00Z');
  const observed = parseDate('2025-01-02', 'Europe/Moscow', now, 'day');
  assert.equal(observed.ms, date('2025-01-02T21:00Z'));
  assert.equal(calculate([range(observed.ms, null, 'day')], [], 'Europe/Moscow', now).current, 0);
  const result = calculate([range(observed.ms, null, 'day')], [], 'Europe/Moscow', observed.ms + DAY);
  assert.equal(result.days, 1);
  assert.equal(result.current, DAY);
});

test('Каталоги: уникальные идентификаторы, источники, медицинская редакция ожидается', () => {
  assert.equal(new Set(ideas.map(i => i.text)).size, 120);
  assert.equal(new Set(facts.map(f => f.id)).size, facts.length);
  assert.ok(facts.every(f => sources[f.source_id] && f.population && f.limitations && f.clinical_status === 'pending'));
});
