import assert from 'node:assert/strict';
import test from 'node:test';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { facts, healthRotation } from '../content/facts.js';
import { awardCatalog } from '../content/achievements.js';
import { DAY } from '../src/time.js';
import { renderHtml } from '../src/telegram.js';
import { bar, view } from '../src/views.js';

const now = Date.parse('2026-03-10T08:00Z');
const state = { profile: { zone: 'UTC', historyZone: 'UTC' }, neutral: false, episodes: [], habits: [],
  intervals: [{ start: now - 9 * DAY - 3 * 3_600_000, end: null, precision: 'minute' }] };

test('HTML экранирует теги, амперсанд и оставляет только собственное выделение', () => {
  assert.equal(renderHtml('**Мой прогресс** <a> A&B'), '<b>Мой прогресс</b> &lt;a&gt; A&amp;B');
  assert.match(renderHtml(bar(45)), /^█{5}░{5} <b>45%<\/b>$/);
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
    assert.equal(expected.size, 15);
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
      const advice = item.text.split('\n\n')[2];
      assert.ok(entries.includes(advice) && !seen.has(advice));
      seen.add(advice);
      route = item.buttons.flat().find(b => b.text.includes('Другой совет')).callback_data.slice(2);
    }
  }
  assert.doesNotMatch(view('crave.work', { ...state, neutral: true }, now, 1).text, /Попробуй сейчас/);
});
