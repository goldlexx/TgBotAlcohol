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
  assert.equal(stats.days, 5);
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
  assert.equal(stats.days, 8);
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
  assert.equal(new Set(ideas.map(i => i.text)).size, 200);
  assert.equal(new Set(facts.map(f => f.id)).size, facts.length);
  assert.ok(facts.every(f => sources[f.source_id] && f.population && f.limitations && f.clinical_status === 'pending'));
});

test('Невыпитые порции разделены по напитку и объёму в обоих режимах', () => {
  const items = [
    { drink: 'beer', ml: 500, portions: 2, weekday: 6, abv: null, price: null },
    { drink: 'beer', ml: 1000, portions: 1, weekday: 6, abv: 5, price: null },
    { drink: 'wine', ml: 150, portions: 3, weekday: 7, abv: 12, price: null },
    { drink: 'vodka', ml: null, portions: 5, weekday: 4, abv: 40, price: null },
    { drink: 'budget', ml: null, portions: 1, weekday: 4, abv: null, price: 200 }
  ];
  const end = date('2025-01-05T00:00Z');
  const counts = mode => {
    const stats = calculate([range(epoch)], [{ effective: epoch, mode, items, period: 7, budget: null, currency: 'RUB' }], 'UTC', end);
    assert.equal(stats.partialDrinks, true);
    return [...stats.drinks].map(([key, amount]) => [JSON.parse(key), Number(amount)]);
  };
  assert.deepEqual(counts('average'), [[['beer', 500], 8 / 7], [['beer', 1000], 4 / 7], [['wine', 150], 12 / 7]]);
  assert.deepEqual(counts('calendar'), [[['beer', 500], 2], [['beer', 1000], 1], [['wine', 150], 0]]);
});

test('Полные выходные учитывают пояс, DST, границы и разрыв серии', () => {
  const zone = 'America/New_York', before = date('2025-03-10T03:59:59Z'), monday = date('2025-03-10T04:00Z');
  const base = { ms: date('2025-03-08T04:00Z'), precision: 'minute' };
  const all = timeline(base, []);
  assert.equal(calculate(all, [], 'UTC', before, zone).weekends, 0);
  const completed = calculate(all, [], 'UTC', monday, zone);
  assert.equal(completed.days, 2);
  assert.equal(completed.weekends, 1);
  const open = { start: date('2025-03-15T19:00Z'), last: null, precision: null };
  const later = date('2025-03-24T04:00Z');
  const paused = calculate(timeline(base, [open]), [], 'UTC', later, zone);
  assert.equal(paused.days, 7);
  assert.equal(paused.weekends, 1);
  assert.equal(paused.current, 0);
  const resumed = calculate(timeline(base, [{ ...open, last: date('2025-03-17T04:00Z'), precision: 'day' }]), [], 'UTC', later, zone);
  assert.equal(resumed.days, 14);
  assert.equal(resumed.weekends, 2);
  assert.equal(resumed.current, 7 * DAY);
});

test('Полночь включает дату, 00:01 исключает её, календарный день переживает DST', () => {
  const zone = 'America/New_York';
  const start = Date.parse('2025-03-09T05:00Z'), end = Date.parse('2025-03-10T04:00Z');
  const calendar = habit('7 RUB\n7 1 500 5 200', start, 'calendar');
  const full = calculate([range(start)], [calendar], zone, end);
  assert.equal(full.current, 23 * 3_600_000);
  assert.equal(full.days, 1);
  close(full.money.get('RUB'), 20_000);
  assert.equal(calculate([range(start + 60_000)], [calendar], zone, end).days, 0);
  assert.equal(calculate([range(start)], [calendar], zone, end - 1).days, 0);
  assert.equal(calculate([range(start)], [calendar], zone, end, 'UTC').days, 0);
  const split = timeline({ ms: start - DAY, precision: 'minute' },
    [{ start: start - DAY / 2, last: start, precision: 'minute' }]);
  const totals = calculate(split, [calendar], zone, end);
  assert.equal(totals.days, 1);
  assert.equal(totals.weekends, 0);
});

test('Календарный бюджет старой версии имеет приоритет; смена в середине дня не начисляет ни одну цену', () => {
  const saturday = Date.parse('2025-01-04T00:00Z');
  const mixed = {
    effective: saturday, mode: 'calendar', budget: null, currency: 'RUB', period: 7, items: [
      { drink: 'budget', weekday: 6, portions: 1, ml: null, abv: null, price: 100_000 },
      { drink: 'beer', weekday: 6, portions: 1, ml: 500, abv: 5, price: 50_000 }
    ]
  };
  const end = saturday + DAY;
  const full = calculate([range(saturday)], [mixed], 'UTC', end);
  close(full.money.get('RUB'), 100_000);
  close(full.drinks.get('["beer",500]'), 1);
  assert.equal(full.partialGrams, false);
  close(full.calories, full.grams.times(7).toNumber());
  const next = { ...mixed, effective: saturday + DAY / 2, items: mixed.items.slice(1) };
  const between = calculate([range(saturday)], [mixed, next], 'UTC', end);
  assert.equal(between.money.size, 0);
  close(between.drinks.get('["beer",500]'), 0);
  assert.equal(between.days, 1);
  close(calculate([range(saturday)], [mixed, next], 'UTC', end + 7 * DAY).money.get('RUB'), 50_000);
});

test('Бюджет без напитков оставляет объём и этанол неизвестными, в смешанном среднем расчёте бюджет не влияет на полноту', () => {
  const budget = { effective: epoch, mode: 'average', period: 7, currency: 'RUB', budget: 7000, items: [] };
  const full = calculate([range(epoch)], [budget], 'UTC', epoch + DAY);
  assert.equal(full.grams, null);
  assert.equal(full.calories, undefined);
  assert.equal(full.drinks.size, 0);
  const rows = [
    { drink: 'budget', weekday: null, portions: 1, ml: null, abv: null, price: null },
    { drink: 'wine', weekday: null, portions: 7, ml: 150, abv: 12, price: null }
  ];
  const mixed = calculate([range(epoch)], [{ ...budget, items: rows }], 'UTC', epoch + DAY);
  assert.equal(mixed.partialGrams, false);
  assert.equal(mixed.partialDrinks, false);
  close(mixed.money.get('RUB'), 1000);
});

test('Исторические версии привычки объясняют расхождение суммы и объёма в 23 дн. 20 ч. без ошибки формул', () => {
  const streakMs = (23 * 24 + 20) * 3_600_000;
  const now = epoch + streakMs;
  const beerEffective = now - Math.round(5.21 / 3 * 7 * DAY);
  const priorBudgetEffective = now - Math.round(1518 / 720 * 7 * DAY);
  const versions = [
    { effective: priorBudgetEffective, mode: 'average', period: 7, currency: 'RUB', budget: 72_000, items: [] },
    { effective: beerEffective, mode: 'average', period: 7, currency: 'RUB', budget: 72_000,
      items: [{ drink: 'beer', weekday: null, portions: 1, ml: 3000, abv: 5, price: null }] }
  ];
  const stats = calculate([range(epoch)], versions, 'UTC', now);
  assert.ok(Math.abs(stats.drinks.get('["beer",3000]').toNumber() * 3 - 5.21) < 0.02);
  assert.ok(Math.abs(stats.grams.toNumber() - 205.5) < 1);
  assert.ok(Math.abs(stats.calories.toNumber() - 1438.7) < 5);
  assert.ok(Math.abs(stats.money.get('RUB').div(100).toNumber() - 1518) < 2);
});
