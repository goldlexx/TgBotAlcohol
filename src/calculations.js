import Decimal from 'decimal.js';
import { DAY, completeDates } from './time.js';
import { hasCalendarBudget } from './habits.js';

export const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 730, 1095, 1825];
export const reached = ms => MILESTONES.filter(days => days * DAY <= ms);
const elapsed = (p, now) => Math.max(0, Math.min(p.end ?? now, now) - p.start);

export function achievements(intervals, now) {
  return reached(Math.max(0, ...intervals.map(period => elapsed(period, now))));
}

function estimate(habit, start, end, zone) {
  let grams = null;
  const drinks = new Map();
  let money = habit.budget === null ? null : new Decimal(habit.budget);
  const dates = habit.mode === 'calendar' ? completeDates(start, end, zone) : null;
  const calendarBudget = hasCalendarBudget(habit);
  for (const row of habit.items) {
    let count = new Decimal(row.portions);
    if (dates) {
      const offset = (row.weekday - dates.first.dayOfWeek + 7) % 7;
      count = count.times(offset >= dates.count ? 0 : 1 + Math.floor((dates.count - 1 - offset) / 7));
    }
    if (row.ml !== null && row.drink !== 'budget') {
      const key = JSON.stringify([row.drink ?? null, row.ml]);
      drinks.set(key, (drinks.get(key) ?? new Decimal(0)).plus(count));
    }
    if (count.isZero()) continue;
    if (row.ml !== null && row.abv !== null) {
      grams = (grams ?? new Decimal(0)).plus(count.times(row.ml).times(row.abv).times('0.00789'));
    }
    if (habit.budget === null && row.price !== null && (!calendarBudget || row.drink === 'budget')) {
      money = (money ?? new Decimal(0)).plus(count.times(row.price));
    }
  }
  const factor = dates ? 1 : new Decimal(end - start).div(habit.period * DAY);
  return {
    grams: grams?.times(factor), money: money?.times(factor), drinks, factor,
    partialGrams: habit.items.some(row => row.drink !== 'budget' && (row.ml === null || row.abv === null)),
    partialMoney: habit.budget === null && !calendarBudget && (!habit.items.length || habit.items.some(row => row.price === null))
  };
}

export function calculate(intervals, habits, zone, now, progressZone = zone) {
  let days = 0, weekends = 0, longest = 0, grams = null, partialGrams = false, partialDrinks = false;
  const money = new Map(), partialCurrencies = new Set();
  const drinks = new Map();
  for (const period of intervals) {
    const end = Math.min(period.end ?? now, now);
    if (end <= period.start) continue;
    const { first, count } = completeDates(period.start, end, progressZone);
    days += count;
    const untilSaturday = (6 - first.dayOfWeek + 7) % 7;
    weekends += Math.max(0, Math.floor((count - untilSaturday + 5) / 7));
    longest = Math.max(longest, end - period.start);
    for (const [index, habit] of habits.entries()) {
      const from = Math.max(period.start, habit.effective);
      const to = Math.min(end, habits[index + 1]?.effective ?? end);
      if (to <= from) continue;
      const values = estimate(habit, from, to, zone);
      partialDrinks ||= habit.items.some(row => row.drink !== 'budget' && row.ml === null);
      for (const [key, count] of values.drinks) {
        drinks.set(key, (drinks.get(key) ?? new Decimal(0)).plus(count.times(values.factor)));
      }
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
  const percent = next ? Math.min(99, Math.round((current - earlier * DAY) / ((next - earlier) * DAY) * 100)) : 100;
  return { current, longest, days, weekends, drinks, partialDrinks, grams, calories: grams?.times(7),
    money, partialGrams, partialCurrencies, earlier, next, percent, awards: reached(longest) };
}
