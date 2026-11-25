import assert from 'node:assert/strict';
import test from 'node:test';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { facts, healthRotation } from '../content/facts.js';
import { awardCatalog } from '../content/achievements.js';
import { DAY } from '../src/time.js';
import { renderHtml } from '../src/telegram.js';
import { bar, report, view } from '../src/views.js';

const now = Date.parse('2026-03-10T08:00Z');
const state = { profile: { zone: 'UTC', historyZone: 'UTC' }, neutral: false, episodes: [], habits: [],
  intervals: [{ start: now - 9 * DAY - 3 * 3_600_000, end: null, precision: 'minute' }] };

test('HTML экранирует теги, амперсанд и оставляет только собственное выделение', () => {
  assert.equal(renderHtml('**Мой прогресс** <a> A&B'), '<b>Мой прогресс</b> &lt;a&gt; A&amp;B');
  assert.match(renderHtml(bar(45)), /^▰{5}▱{5} <b>45%<\/b>$/);
});

test('Достижения на одном экране, разные названия и точный отсчёт', () => {
  const awards = view('awards', state, now, 1);
  for (const [, title] of Object.values(awardCatalog)) assert.ok(awards.text.includes(title));
  assert.equal(new Set(Object.values(awardCatalog).map(row => row[0])).size, 12);
  assert.match(awards.text, /3 из 12/);
  assert.match(awards.text, /4 дня 21 час/);
  assert.equal(awards.buttons.flat().length, 1);
});

test('Все подборки проходят полный цикл без смены категории и соседних повторов', () => {
  assert.deepEqual(new Set(healthRotation.map(row => row.id)), new Set(facts.map(row => row.id)));
  for (const [, group] of lifeLabels) {
    const expected = new Set(ideas.filter(row => row.category === group).map(row => row.text));
    let route = 'life.' + group;
    const seen = new Set();
    assert.equal(expected.size, 25);
    for (let i = 0; i < expected.size; i++) {
      const item = view(route, state, now, 1);
      const advice = item.text.split('\n\n').at(-1);
      assert.ok(expected.has(advice) && !seen.has(advice));
      seen.add(advice);
      route = item.buttons.flat().find(b => b.text.includes('Другая идея')).callback_data.slice(2);
    }
  }
  for (const [group, entries] of Object.entries(cravings)) {
    assert.equal(new Set(entries).size, 15);
    let route = 'crave.' + group;
    const seen = new Set();
    for (let i = 0; i < entries.length; i++) {
      const item = view(route, state, now, 1);
      const advice = item.text.split('\n\n')[3];
      assert.ok(entries.includes(advice) && !seen.has(advice));
      seen.add(advice);
      route = item.buttons.flat().find(b => b.text.includes('Другой совет')).callback_data.slice(2);
    }
  }
  assert.doesNotMatch(view('crave.work', { ...state, neutral: true }, now, 1).text, /Попробуй сейчас/);
});

test('Текст и клавиатуры отделяют медицинскую помощь от статистики и советов', () => {
  const recovery = view('recovery', state, now, 1).text;
  assert.match(recovery, /наблюдения в группах/);
  assert.match(recovery, /😴 \*\*Сон\*\*[\s\S]+❤️ \*\*Давление\*\*[\s\S]+🧠 \*\*Память\*\*/);
  assert.doesNotMatch(recovery, /На этом этапе|Что может измениться дальше|180 дней/);
  const craving = view('craving', state, now, 1);
  assert.ok(craving.text.indexOf('физически плохо') < craving.text.indexOf('отложить решение'));
  assert.deepEqual(craving.buttons.slice(0, 2).map(row => row[0].callback_data), ['n:physical', 'n:emergency']);
  const progress = view('progress', state, now, 1);
  assert.match(progress.text, /Участок: 7 дней → 14 дней/);
  assert.match(progress.text, /дней: \*\*\d+\*\*\n☀️/);
  assert.equal(progress.buttons[0].length, 1);
});

test('Нулевое календарное начисление и неизвестная привычка отображаются по-разному', () => {
  const from = state.intervals[0].start;
  const make = (mode, portions) => ({
    ...state, habits: [{ effective: from, mode, period: 7, budget: null, currency: 'RUB',
      items: [{ drink: null, portions, ml: 1000, abv: 5, price: null, weekday: 6 }] }]
  });
  const short = from + 3_600_000;
  const progress = view('progress', make('average', 7), short, 1).text;
  assert.match(progress, /Менее одной порции\*\* по 1 л/);
  assert.doesNotMatch(progress, /≈0 порций|порции напитка/);
  assert.match(view('details', make('calendar', 7), short, 1).text, /пока не начислены/);
  assert.ok(view('details', make('calendar', 7), short, 1).buttons.flat().some(button => button.text === 'Уточнить напиток'));
  assert.doesNotMatch(view('details', state, short, 1).text, /Невыпитые порции/);
  assert.match(view('progress', make('average', 7), now, 1).text, /≈9 порций\*\* по 1 л/);
});

test('Ручной отчёт поздравляет в местную дату достижения рубежа', () => {
  const end = Date.parse('2026-03-10T22:00Z');
  const start = end - 30 * DAY;
  const sample = { ...state, profile: { ...state.profile, zone: 'Europe/Moscow', privatePush: true },
    intervals: [{ start, end: null, precision: 'minute' }] };
  assert.match(view('morning', sample, end + 60_000, 1).text, new RegExp(awardCatalog[30][2]));
  assert.doesNotMatch(view('morning', sample, end + DAY, 1).text, new RegExp(awardCatalog[30][2]));
});

test('Расширенная ротация проходит весь набор до повторов и отделяет непроверенные факты', () => {
  assert.equal(facts.length, 45);
  assert.equal(ideas.length, 200);
  const sample = { ...state, closedTest: true, profile: { ...state.profile, content: 'both' } };
  const reportDays = Array.from({ length: 365 }, (_, index) => {
    const ms = now + index * DAY, day = new Date(ms).toISOString().slice(0, 10);
    const rendered = report(sample, ms, 1, day).text;
    assert.equal(report(sample, ms, 1, day).text, rendered);
    assert.doesNotMatch(report(sample, ms, 1, day, { automatic: true }).text, /Предварительный материал/);
    const [, fact, idea] = /Факт о здоровье\*\*\n\n([^\n]+)[\s\S]*Идея дня\*\*\n\n([^\n]+)/.exec(rendered);
    return [fact, idea, rendered];
  });
  assert.ok(reportDays.some(row => row[2].includes('Предварительный материал')));
  for (const horizon of [30, 90, 180, 365]) for (const [index, length] of [[0, 45], [1, 200]]) {
    assert.equal(new Set(reportDays.slice(0, horizon).map(row => row[index])).size, Math.min(horizon, length));
    assert.equal(new Set(reportDays.slice(0, length).map(row => row[index])).size, length);
  }
});

test('Личная цель поздравляет в день достижения; нулевая и малая экономия различаются', () => {
  const end = now, start = end - 7 * DAY;
  const sample = { ...state, profile: { ...state.profile, goal: 7 },
    intervals: [{ start, end: null, precision: 'minute' }] };
  const text = view('morning', sample, end, 1).text;
  assert.match(text, /Твоя личная цель достигнута/);
  assert.doesNotMatch(view('morning', sample, end + DAY, 1).text, /Твоя личная цель достигнута/);
  const get = budget => view('progress', {
    ...sample, habits: [{ effective: start, mode: 'average', period: 7, currency: 'RUB', items: [], budget }]
  }, end, 1).text;
  assert.doesNotMatch(get(null), /Сэкономлено|По указанным расходам/);
  assert.match(get(0), /По указанным расходам.*0\s₽/);
  assert.match(get(5), /Сэкономлено.*меньше 1\s₽/);
});
