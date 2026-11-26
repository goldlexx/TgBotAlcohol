import assert from 'node:assert/strict';
import test from 'node:test';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { facts, healthRotation, recoveryFacts, sources } from '../content/facts.js';
import { awardCatalog } from '../content/achievements.js';
import { DAY } from '../src/time.js';
import { renderHtml } from '../src/telegram.js';
import { bar, report, statsFor, view } from '../src/views.js';

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
  assert.deepEqual(new Set(facts.map(row => row.section)), new Set(['recovery', 'health', 'risk']));
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
  assert.match(recovery, /Общие ориентиры/);
  assert.match(recovery, /🫀 \*\*Печень\*\*[\s\S]+😴 \*\*Сон\*\*[\s\S]+❤️ \*\*Давление\*\*/);
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

test('Ротация проходит доступный набор до повторов; риски и черновики отделены', () => {
  assert.equal(facts.length, 45);
  assert.equal(ideas.length, 200);
  const sample = { ...state, closedTest: true, profile: { ...state.profile, content: 'both' } };
  const reportDays = Array.from({ length: 365 }, (_, index) => {
    const ms = now + index * DAY, day = new Date(ms).toISOString().slice(0, 10);
    const rendered = report(sample, ms, 1, day).text;
    assert.equal(report(sample, ms, 1, day).text, rendered);
    assert.doesNotMatch(report(sample, ms, 1, day, { automatic: true }).text, /Предварительный материал/);
    const [, fact, idea] = /Факт о здоровье\*\*\n\n([^\n]+)[\s\S]*Идея дня\*\*\n\n([^\n]+)/.exec(rendered);
    assert.doesNotMatch(rendered, /Предварительный материал|https?:\/\//);
    return [fact, idea];
  });
  assert.ok(healthRotation.every(fact => !fact.previewOnly && fact.section !== 'risk'));
  for (const horizon of [30, 90, 180, 365]) for (const [index, length] of [[0, healthRotation.length], [1, 200]]) {
    assert.equal(new Set(reportDays.slice(0, horizon).map(row => row[index])).size, Math.min(horizon, length));
    assert.equal(new Set(reportDays.slice(0, length).map(row => row[index])).size, length);
  }
});

test('Все карточки восстановления связаны со своими источниками и медицинским статусом', () => {
  for (const [section, entries] of [['recovery', recoveryFacts], ['health', healthRotation]]) {
    const routes = Array.from({ length: Math.ceil(entries.length / 5) }, (_, index) =>
      view('sources.' + section + '.' + index, state, now, 1).buttons.flat()
        .filter(button => button.callback_data?.startsWith('n:evidence.')).map(button => button.callback_data.slice(2))).flat();
    assert.deepEqual(routes, entries.map(fact => 'evidence.' + fact.id + '.' + section));
    for (const [index, route] of routes.entries()) {
      const expected = entries[index];
      const detail = view(route, state, now, 1);
      assert.ok(detail.text.includes(expected.text) && detail.text.includes(expected.study));
      assert.match(detail.text, /Кого изучали:[^\n]+\nСрок наблюдения:[^\n]+[\s\S]+Клиническая проверка: ожидается/);
      assert.ok(detail.buttons.flat().some(button => button.url === sources[expected.source_id][2]));
      assert.doesNotMatch(detail.text, /https?:\/\/|Предварительный материал/);
    }
  }
  assert.match(view('evidence.mouth.recovery', state, now, 1).text, /IARC сочло доказательства снижения риска достаточными/);
  assert.equal(view('evidence.new-memory.health', state, now, 1).text, view('sources.recovery', state, now, 1).text);
});

const seriesState = days => ({
  ...state, intervals: [{ start: now - days * DAY, end: null, precision: 'minute' }]
});

test('Восстановление подбирает период серии и использует общую шкалу на всех рубежах', () => {
  for (const [days, period] of [[0.5, 'Первые сутки'], [1, 'Первые дни'], [3, 'Первые дни'], [7, 'Первые недели'],
    [14, 'Первые недели'], [23, 'Первые недели'], [30, 'После первых 30 дней'], [90, 'Несколько месяцев'],
    [180, 'Полгода и дальше'], [365, 'Год и дольше'], [1000, 'Год и дольше'], [1825, 'Год и дольше']]) {
    const sample = seriesState(days);
    const before = statsFor(sample, now);
    const recovery = view('recovery', sample, now, 1);
    assert.ok(recovery.text.includes('📍 **' + period + '**'));
    assert.ok(renderHtml(recovery.text).replace(/<\/?b>/g, '').length <= 700);
    assert.doesNotMatch(recovery.text, /https?:\/\/|Предварительный материал|уже очистил|полностью восстановил|риск исчез|опасный период позади/i);
    assert.deepEqual(statsFor(sample, now), before);
    const comparison = view('progress', sample, now, 1).text.match(/🎯 Следующий рубеж — [\s\S]+?До рубежа — \*\*[^*]+\*\*/)?.[0];
    if (comparison) {
      assert.ok(recovery.text.includes(comparison));
      assert.ok(view('morning', sample, now, 1).text.includes(comparison));
    } else {
      assert.match(recovery.text, /Все временные рубежи пройдены/);
    }
    assert.equal(recovery.buttons.flat().find(b => b.text === 'Главное меню').callback_data, 'n:menu');
  }
  assert.match(view('recovery', seriesState(23), now, 1).text, /Идёт четвёртая неделя[\s\S]+▰{6}▱{4} \*\*56%\*\*[\s\S]+\*\*7 дней\*\*/);
  for (const days of [1, 7, 23]) {
    assert.match(view('recovery', seriesState(days), now, 1).text, /Впереди · ориентиры первого месяца[\s\S]+\*\*Печень\*\*/);
  }
  assert.doesNotMatch(view('recovery', seriesState(30), now, 1).text, /Впереди · ориентиры первого месяца/);
  assert.match(view('recovery', seriesState(30 - 1000 / DAY), now, 1).text, /\*\*99%\*\*/);
  assert.match(view('recovery', seriesState(30), now, 1).text, /60 дней[\s\S]+\*\*0%\*\*/);
});

test('Полная шкала листается по порядку и отмечает только пройденное время', () => {
  const sample = seriesState(23);
  const first = view('stages', sample, now, 1);
  assert.match(first.text, /✅ Первые сутки · начало серии\n✅ 1 день · рубеж в 24 часа[\s\S]+✅ 7 дней · 1 неделя\n📍 14 дней · 2 недели/);
  assert.match(view('stages', seriesState(1), now, 1).text, /✅ Первые сутки · начало серии\n📍 1 день · рубеж в 24 часа/);
  const turn = (screen, label) => view(screen.buttons.flat().find(button => button.text === label).callback_data.slice(2), sample, now, 1);
  const second = turn(first, '→');
  assert.match(second.text, /⏳ 30 дней[\s\S]+⏳ 180 дней\n⏳ 365 дней · 1 год/);
  assert.match(second.text, /30 дней — фиксированный отрезок/);
  assert.deepEqual(turn(second, '←'), first);
  const last = turn(second, '→');
  assert.match(last.text, /⏳ 2 года[\s\S]+⏳ 5 лет/);
  assert.ok(last.buttons.flat().some(button => button.text === '🛡 Долгосрочные преимущества'));
  assert.deepEqual(last, view('stages.99', sample, now, 1));
  assert.match(turn(last, 'Главное меню').text, /Мой прогресс/);
  assert.match(view('stages.1', seriesState(30), now, 1).text, /📍 30 дней/);
  assert.match(view('stages.1', seriesState(365), now, 1).text, /✅ 180 дней\n📍 365 дней/);
});

test('Восстановление сохраняет приоритет помощи и берёт серию после завершённого эпизода', () => {
  const old = { start: now - 100 * DAY, end: now - 5 * DAY, precision: 'minute' };
  const resumed = { ...seriesState(3), intervals: [old, ...seriesState(3).intervals],
    episodes: [{ start: old.end, last: now - 3 * DAY }] };
  assert.match(view('recovery', resumed, now, 1).text, /3 дня без алкоголя[\s\S]+Первые дни/);
  assert.match(view('progress', resumed, now, 1).text, /Всего трезвых дней: \*\*96\*\*/);
  const open = { ...resumed, intervals: [old], episodes: [{ start: old.end, last: null }] };
  const paused = view('recovery', open, now, 1);
  assert.match(paused.text, /Серия на паузе[\s\S]+достижения сохранены[\s\S]+При симптомах отмены[\s\S]+Общие материалы/);
  assert.doesNotMatch(paused.text, /Следующий рубеж|0 часов без алкоголя/);
  for (const route of ['n:awards', 'n:sources.recovery', 'n:physical', 'n:emergency']) {
    assert.ok(paused.buttons.flat().some(button => button.callback_data === route));
  }
  const manual = view('morning', open, now, 1);
  assert.match(manual.text, /Серия на паузе[\s\S]+Факт о здоровье[\s\S]+Идея дня[\s\S]+При симптомах отмены/);
  assert.doesNotMatch(manual.text, /Следующий рубеж|Резкое прекращение/);
  assert.equal(view('morning.preview', { ...open, profile: { ...open.profile, privatePush: true } }, now, 1).text,
    'Автоматическая отправка на паузе.');
  assert.doesNotMatch(view('stages', open, now, 1).text, /📍 Первые сутки/);
  const medical = { ...seriesState(365), profile: { ...state.profile, medicalHold: true } };
  assert.match(view('recovery', medical, now, 1).text, /365 дней без алкоголя[\s\S]+При симптомах отмены[\s\S]+Год и дольше/);
  assert.ok(view('recovery', medical, now, 1).buttons.flat().some(button => button.callback_data === 'n:emergency'));
  assert.match(view('morning', medical, now, 1).text, /При симптомах отмены/);
  assert.match(view('recovery', { ...state, intervals: [{ start: now + 1000, end: null }] }, now, 1).text, /ещё не начался/);
  assert.match(view('recovery', { ...state, profile: null, intervals: [] }, now, 1).text, /Начни отслеживание/);
});

test('До регистрации доступны справка, общие материалы восстановления и возврат к приветствию', () => {
  const guest = { ...state, profile: null, intervals: [] };
  const educational = view('recovery', guest, now, 1);
  assert.match(educational.text, /Начни отслеживание[\s\S]+Сон в первые дни/);
  assert.doesNotMatch(educational.text, /Следующий рубеж|без алкоголя\*\*/);
  assert.match(view('morning', guest, now, 1).text, /Начни отслеживание/);
  assert.match(view('progress', guest, now, 1).text, /Начни отслеживание/);
  assert.match(view('notifications', guest, now, 1).text, /Счастье без алкоголя/);
  assert.match(view('physical', guest, now, 1).text, /Немедленно вызови скорую/);
  assert.match(view('menu', guest, now, 1).text, /Счастье без алкоголя/);
});

test('Факт дня и его источник сохраняются при изменении срока серии в течение дня', () => {
  const day = '2026-03-10';
  const sample = seriesState(7 - 1 / 24);
  const fact = text => text.match(/Факт о здоровье\*\*\n\n([^\n]+)/)[1];
  const first = report(sample, now, 1, day);
  const later = report(sample, now + 2 * 3_600_000, 1, day);
  assert.equal(fact(first.text), fact(later.text));
  assert.deepEqual(first.buttons.at(-1), later.buttons.at(-1));
  assert.equal(first.buttons.at(-1)[0].text, '🔬 Подробнее и источники');
  const destination = first.buttons.at(-1)[0].callback_data.slice(2);
  assert.ok(view(destination, sample, now, 1).text.includes(fact(first.text)));
});

test('Медицинская помощь показывает первым действие при опасных симптомах и отделяет справочники', () => {
  for (const route of ['physical', 'care']) {
    const result = view(route, state, now, 1);
    const html = renderHtml(result.text);
    assert.match(html, /<b>Немедленно вызови скорую<\/b> при судорогах, галлюцинациях, сильной спутанности сознания или резком ухудшении\.\nВ России звони 112 или 103/);
    assert.match(html, /\n\n<b>Обратись за медицинской оценкой сегодня<\/b>[\s\S]*дрожь, потливость, тошнота или сильная тревога/);
    assert.match(html, /\n\n<b>Резкое прекращение употребления при зависимости может быть опасно\.<\/b>/);
    assert.deepEqual(result.buttons[0].map(b => b.callback_data), ['n:emergency']);
    assert.deepEqual(result.buttons.at(-1).map(b => b.callback_data), ['n:menu']);
    assert.doesNotMatch(html, /https?:\/\//);
  }
  assert.equal(view('care', state, now, 1).buttons.flat().filter(b => b.url?.startsWith('https://')).length, 4);
});

test('Кнопки истории различают эпизоды одной даты и сохраняют полную дату', () => {
  const date = Date.parse('2026-03-09T08:00Z');
  const sample = { ...state, profile: { ...state.profile, base: { ms: now - 10 * DAY, precision: 'instant' } },
    episodes: [{ id: 701, start: date, last: date + 1 }, { id: 702, start: date + 1000, last: null }] };
  const history = view('history', sample, now, 1);
  assert.match(history.text, /2\. 09\.03\.2026[\s\S]+1\. 09\.03\.2026/);
  assert.match(history.text, /Нажми дату эпизода, чтобы исправить запись/);
  assert.deepEqual(history.buttons.slice(0, 2).map(row => row.map(b => [b.text, b.callback_data])), [
    [['2. 09.03.2026', 'n:correct.702'], ['Удалить 2', 'n:remove.702']],
    [['1. 09.03.2026', 'n:correct.701'], ['Удалить 1', 'n:remove.701']]
  ]);
});

test('Приватность скрывает отключение отчётов, когда подписка уже выключена', () => {
  const sample = { ...state, user: { generation: 'fixture' } };
  const hasOff = frequency => view('privacy', { ...sample, profile: { ...sample.profile, frequency } }, now, 1)
    .buttons.flat().some(b => b.callback_data === 'n:off.fixture');
  assert.equal(hasOff('off'), false);
  assert.equal(hasOff('daily'), true);
});

test('Пиво без данных об упаковке, крепкие напитки и склонение бокалов едины на трёх экранах', () => {
  const display = (drink, ml, count) => {
    const from = now - 7 * DAY;
    const sample = { ...state, profile: { ...state.profile, content: 'numbers' },
      intervals: [{ start: from, end: null, precision: 'minute' }],
      habits: [{ effective: from, mode: 'average', period: 7, budget: null, currency: 'RUB',
        items: [{ drink, ml, portions: count, abv: 5, price: null }] }] };
    return ['progress', 'details', 'morning'].map(route => view(route, sample, now, 1).text);
  };
  for (const text of display('beer', 500, 10)) {
    assert.match(text, /≈5 л пива/);
    assert.doesNotMatch(text, /бутыл|порций пива/);
  }
  for (const text of display('whisky', 50, 30)) assert.match(text, /≈1,5 л виски/);
  for (const [count, unit] of [[1, 'бокал'], [2, 'бокала'], [6, 'бокалов'], [11, 'бокалов'], [21, 'бокал']]) {
    for (const text of display('wine', 150, count)) assert.ok(text.includes(`≈${count} ${unit} вина`));
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
