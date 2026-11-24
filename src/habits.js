import Decimal from 'decimal.js';

export function currencyCode(value) {
  const code = value === '₽' ? 'RUB' : value.toUpperCase();
  if (!Intl.supportedValuesOf('currency').includes(code)) throw new Error('currency');
  return code;
}

function decimal(value, min, max) {
  if (!/^\d{1,9}(?:[.,]\d{1,4})?$/.test(value)) throw new Error('number');
  const n = new Decimal(value.replace(',', '.'));
  if (n.lt(min) || n.gt(max)) throw new Error('range');
  return n;
}

export function digits(currency) {
  return new Intl.NumberFormat('ru', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}

function minor(value, currency) {
  const amount = decimal(value, 0, 100_000_000).times(10 ** digits(currency));
  if (!amount.isInteger()) throw new Error('minor units');
  return amount.toNumber();
}

export function parseHabit(text, mode) {
  const lines = text.trim().split(/\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length || lines.length > 16) throw new Error('rows');
  const [periodText, curr, total, ...extra] = lines.shift().split(/\s+/);
  const period = mode === 'calendar' ? 7 : Number(periodText);
  if (extra.length || ![7, 28].includes(period) || (mode === 'calendar' && (periodText !== '7' || total))) throw new Error('header');
  const currency = currencyCode(curr ?? 'RUB');
  const budget = total && total !== '-' ? minor(total, currency) : null;
  const items = lines.map(line => {
    const cols = line.split(/\s+/);
    const weekday = mode === 'calendar' ? Number(cols.shift()) : null;
    if (weekday !== null && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) throw new Error('weekday');
    const [n, ml, abv, price, ...rest] = cols;
    if (rest.length || !ml || !abv || (budget !== null && price && price !== '-')) throw new Error('row');
    const item = {
      weekday, portions: decimal(n, 0.0001, 10_000).toNumber(),
      ml: ml === '-' ? null : decimal(ml, 0.01, 100_000).toNumber(),
      abv: abv === '-' ? null : decimal(abv, 0, 100).toNumber(),
      price: price && price !== '-' ? minor(price, currency) : null
    };
    if (item.price === null && (item.ml === null || item.abv === null) && budget === null) throw new Error('empty row');
    return item;
  });
  if (!items.length && budget === null) throw new Error('empty habit');
  return { mode, period, currency, budget, items };
}

export const presets = [
  ['Пиво · 500 мл, 5%', '500 5'], ['Вино · 150 мл, 12%', '150 12'],
  ['Крепкий напиток · 50 мл, 40%', '50 40']
];
