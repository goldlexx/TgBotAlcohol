import Decimal from 'decimal.js';
import { DAY, completeDates } from './time.js';

export const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825];
export const reached = ms => MILESTONES.filter(days => days * DAY <= ms);
const elapsed = (p, now) => Math.max(0, Math.min(p.end ?? now, now) - p.start);

export function achievements(intervals, now) {
  return reached(Math.max(0, ...intervals.map(period => elapsed(period, now))));
}

function estimate(habit, start, end, zone, excludeStart) {
  let grams = null;
  let money = habit.budget === null ? null : new Decimal(habit.budget);
  const dates = habit.mode === 'calendar' ? completeDates(start, end, zone, excludeStart) : null;
  for (const row of habit.items) {
    let count = new Decimal(row.portions);
    if (dates) {
      const offset = (row.weekday - dates.first.dayOfWeek + 7) % 7;
      if (offset >= dates.count) continue;
      count = count.times(1 + Math.floor((dates.count - 1 - offset) / 7));
    }
    if (row.ml !== null && row.abv !== null) {
      grams = (grams ?? new Decimal(0)).plus(count.times(row.ml).times(row.abv).times('0.00789'));
    }
    if (habit.budget === null && row.price !== null) {
      money = (money ?? new Decimal(0)).plus(count.times(row.price));
    }
  }
  const factor = dates ? 1 : new Decimal(end - start).div(habit.period * DAY);
  return {
    grams: grams?.times(factor), money: money?.times(factor),
    partialGrams: habit.items.some(row => row.ml === null || row.abv === null) || !habit.items.length,
    partialMoney: habit.budget === null && (!habit.items.length || habit.items.some(row => row.price === null))
  };
}

export function calculate(intervals, habits, zone, now) {
  let days = 0, grams = null, partialGrams = false;
  const money = new Map(), partialCurrencies = new Set();
  for (const period of intervals) {
    const end = Math.min(period.end ?? now, now);
    if (end <= period.start) continue;
    days += completeDates(period.start, end, zone, period.precision !== 'day').count;
    for (const [index, habit] of habits.entries()) {
      const from = Math.max(period.start, habit.effective);
      const to = Math.min(end, habits[index + 1]?.effective ?? end);
      if (to <= from) continue;
      const values = estimate(habit, from, to, zone, from === period.start && period.precision !== 'day');
      partialGrams ||= values.partialGrams;
      if (values.partialMoney) partialCurrencies.add(habit.currency);
      if (values.grams) grams = (grams ?? new Decimal(0)).plus(values.grams);
      if (values.money) money.set(habit.currency, (money.get(habit.currency) ?? new Decimal(0)).plus(values.money));
    }
  }
  const latest = intervals.at(-1);
  const current = latest?.end === null ? elapsed(latest, now) : 0;
  const earlier = reached(current).at(-1) ?? 0;
  const next = MILESTONES.find(d => d * DAY > current);
  const percent = next ? Math.round((current - earlier * DAY) / ((next - earlier) * DAY) * 100) : 100;
  return { current, days, grams, calories: grams?.times(7), money, partialGrams, partialCurrencies, next, percent, awards: achievements(intervals, now) };
}
