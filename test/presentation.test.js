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
      const advice = item.text.split('\n').at(-1);
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
      const advice = item.text.split('\n\n').find(b => b.startsWith('**Попробуй сейчас**')).split('\n')[1];
      assert.ok(entries.includes(advice) && !seen.has(advice));
      seen.add(advice);
      route = item.buttons.flat().find(b => b.text.includes('Другой совет')).callback_data.slice(2);
    }
  }
  const neutralCrave = view('crave.work', { ...state, neutral: true }, now, 1).text;
  assert.match(neutralCrave, /Попробуй сейчас/);
  assert.match(neutralCrave, /При симптомах отмены/);
});

test('Текст и клавиатуры отделяют медицинскую помощь от статистики и советов', () => {
  const recovery = view('recovery', state, now, 1).text;
  assert.match(recovery, /Общие ориентиры/);
  assert.match(recovery, /😴 \*\*Сон\*\*[\s\S]+☀️ \*\*Энергия\*\*[\s\S]+🌿 \*\*Самочувствие\*\*/);
  const craving = view('craving', state, now, 1);
  assert.ok(craving.text.indexOf('физически плохо') < craving.text.indexOf('отложить решение'));
  assert.deepEqual(craving.buttons.slice(2, 4).map(row => row[0].callback_data), ['n:physical', 'n:emergency']);
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
    const [, fact, idea] = /Факт о здоровье\*\*\n([^\n]+)[\s\S]*Идея дня\*\*\n([^\n]+)/.exec(rendered);
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

test('Восстановление подбирает период серии, не дублирует шкалу и избегает сухого канцелярита', () => {
  for (const [days, period] of [[0.5, 'Первые дни'], [1, 'Первые дни'], [3, 'Первые дни'], [7, 'Первые недели'],
    [14, 'Первые недели'], [23, 'Первые недели'], [30, 'Первый месяц'], [90, 'Несколько месяцев'],
    [180, 'Полгода и дальше'], [365, 'Год и дольше'], [1000, 'Год и дольше'], [1825, 'Год и дольше']]) {
    const sample = seriesState(days);
    const before = statsFor(sample, now);
    const recovery = view('recovery', sample, now, 1);
    assert.ok(recovery.text.includes('📍 **Текущий период · ' + period + '**'));
    assert.ok(renderHtml(recovery.text).replace(/<\/?b>/g, '').length <= 700);
    assert.doesNotMatch(recovery.text, /https?:\/\/|Предварительный материал|уже очистил|полностью восстановил|риск исчез|опасный период позади|участник.*исследован|в среднем|взрослых без алкогольной зависимости/i);
    assert.doesNotMatch(recovery.text, /▰|▱/);
    assert.deepEqual(statsFor(sample, now), before);
    if (days < 365) assert.match(recovery.text, /Ближайший ориентир/);
    else assert.match(recovery.text, /Все базовые ориентиры пройдены/);
    assert.equal(recovery.buttons.flat().find(b => b.text === 'Главное меню').callback_data, 'n:menu');
  }
  assert.match(view('recovery', seriesState(23), now, 1).text, /Идёт четвёртая неделя[\s\S]+Ближайший ориентир — 1 месяц[\s\S]+\*\*7 дней\*\*/);
  assert.match(view('recovery', seriesState(30), now, 1).text, /Текущий период · Первый месяц[\s\S]+\*\*Печень\*\*/);
});

test('Содержательная шкала восстановления листается, открывает детали и источники этапов', () => {
  const sample = seriesState(23);
  const first = view('stages', sample, now, 1);
  assert.match(first.text, /✅ \*\*Первые дни \(0–7 дней\)\*\*[\s\S]+📍 \*\*Первые недели \(1–4 недели\)\*\*[\s\S]+⏳ \*\*Первый месяц \(30 дней\)\*\*/);
  assert.match(first.text, /Страница 1 из 2/);
  assert.match(view('stages', seriesState(1), now, 1).text, /📍 \*\*Первые дни \(0–7 дней\)\*\*/);
  const turn = (screen, label) => view(screen.buttons.flat().find(button => button.text === label).callback_data.slice(2), sample, now, 1);
  const second = turn(first, 'Далее →');
  assert.match(second.text, /⏳ \*\*Несколько месяцев \(3–6 мес\.\)\*\*[\s\S]+⏳ \*\*Год и долгосрочно \(12\+ мес\.\)\*\*/);
  assert.match(second.text, /Страница 2 из 2/);
  assert.deepEqual(turn(second, '← Назад'), first);
  const detail = turn(first, '📖 Первый месяц');
  assert.match(detail.text, /Первый месяц \(30 дней\)[\s\S]+Ориентир впереди[\s\S]+Печень[\s\S]+Давление/);
  const ev = turn(detail, '🔬 Печень');
  assert.match(ev.text, /Mehta|АЛТ и ГГТ/);
  assert.deepEqual(turn(ev, 'Назад'), detail);
  assert.deepEqual(turn(detail, '← К этапам'), first);
  const detail2 = turn(second, '📖 Полгода');
  assert.deepEqual(turn(detail2, '← К этапам'), second);
  assert.match(turn(second, 'Главное меню').text, /Мой прогресс/);
  assert.match(view('stages.0', seriesState(30), now, 1).text, /📍 \*\*Первый месяц/);
  assert.match(view('stages.1', seriesState(365), now, 1).text, /✅ \*\*Полгода и далее[\s\S]+📍 \*\*Год и долгосрочно/);
});

test('Восстановление сохраняет приоритет помощи и берёт серию после завершённого эпизода', () => {
  const old = { start: now - 100 * DAY, end: now - 5 * DAY, precision: 'minute' };
  const resumed = { ...seriesState(3), intervals: [old, ...seriesState(3).intervals],
    episodes: [{ start: old.end, last: now - 3 * DAY }] };
  assert.match(view('recovery', resumed, now, 1).text, /3 дня без алкоголя[\s\S]+Первые дни/);
  assert.match(view('progress', resumed, now, 1).text, /Всего трезвых дней: \*\*96\*\*/);
  const open = { ...resumed, intervals: [old], episodes: [{ start: old.end, last: null }] };
  const paused = view('recovery', open, now, 1);
  assert.match(paused.text, /Серия на паузе[\s\S]+достижения сохранены[\s\S]+Общие материалы[\s\S]+При симптомах отмены/);
  assert.doesNotMatch(paused.text, /Следующий рубеж|0 часов без алкоголя/);
  for (const route of ['n:awards', 'n:sources.recovery', 'n:physical', 'n:emergency']) {
    assert.ok(paused.buttons.flat().some(button => button.callback_data === route));
  }
  const manual = view('morning', open, now, 1);
  assert.match(manual.text, /Серия на паузе[\s\S]+Факт о здоровье[\s\S]+Идея дня[\s\S]+При симптомах отмены/);
  assert.doesNotMatch(manual.text, /Следующий рубеж|Резкое прекращение/);
  assert.equal(view('morning.preview', { ...open, profile: { ...open.profile, privatePush: true } }, now, 1).text,
    'Автоматическая отправка на паузе.');
  assert.match(view('stages', open, now, 1).text, /• \*\*Первые дни/);
  const medical = { ...seriesState(365), profile: { ...state.profile, medicalHold: true } };
  assert.match(view('recovery', medical, now, 1).text, /365 дней без алкоголя[\s\S]+Год и дольше[\s\S]+При симптомах отмены/);
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
  const fact = text => text.match(/Факт о здоровье\*\*\n([^\n]+)/)[1];
  const first = report(sample, now, 1, day);
  const later = report(sample, now + 2 * 3_600_000, 1, day);
  assert.equal(fact(first.text), fact(later.text));
  assert.deepEqual(first.buttons.at(-1), later.buttons.at(-1));
  assert.equal(first.buttons.at(-1)[0].text, '🔬 Подробнее и источники');
  const destination = first.buttons.at(-1)[0].callback_data.slice(2);
  assert.ok(view(destination, sample, now, 1).text.includes(fact(first.text)));
});

test('Медицинская помощь показывает первым действие при опасных симптомах, возвращает назад и отделяет справочники', () => {
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
  const careFromPhysical = view('care.physical', state, now, 1);
  assert.equal(careFromPhysical.buttons.flat().filter(b => b.url?.startsWith('https://')).length, 6);
  assert.ok(careFromPhysical.buttons.flat().some(b => b.callback_data === 'n:physical'));
  assert.match(careFromPhysical.text, /8 800 2000 200[\s\S]+не являются медицинской организацией/);
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

test('Оформление статистики, достижений, истории, настроек, уведомлений и кнопки утреннего отчёта', () => {
  const from = now - 23 * DAY - 20 * 3_600_000;
  const baseSample = {
    ...state,
    user: { generation: 'g1' },
    profile: { ...state.profile, base: { ms: from, precision: 'minute' }, frequency: 'off', clock: '06:00', goal: null },
    intervals: [{ start: from, end: null, precision: 'minute' }],
    habits: [{ effective: from, mode: 'average', period: 7, budget: 72_000, currency: 'RUB',
      items: [{ drink: 'beer', weekday: null, portions: 1, ml: 3000, abv: 5, price: null }] }]
  };
  const prog = view('progress', baseSample, now, 1).text;
  assert.match(prog, /🍺 Не выпито: \*\*≈/);
  assert.doesNotMatch(prog, /🥤 Не выпито: 🍺/);
  const det = view('details', baseSample, now, 1).text;
  assert.match(det, /Самая длинная серия[\s\S]+\n\n💰 Сэкономлено[\s\S]+\n\n🍺 Не выпито[\s\S]+Чистый спирт \(этанол\), оценка[\s\S]+Энергия этанола, оценка[\s\S]+фактическую энергетическую ценность всего напитка[\s\S]+\n\n🏆 Достижения/);
  const aw = view('awards', baseSample, now, 1).text;
  assert.match(aw, /\*\*🔒 30 дней — Месяц новой жизни\*\*/);
  const fullAwards = view('awards', seriesState(2000), now, 1).text;
  assert.match(fullAwards, /12 из 12 наград[\s\S]+Коллекция собрана/);
  const hist = view('history', baseSample, now, 1).text;
  assert.match(hist, /Эпизодов употребления не зарегистрировано[\s\S]+Начало отслеживания: \*\*/);
  const per = view('periods', baseSample, now, 1).text;
  assert.match(per, /🟢 \*\*Текущая серия\*\*\n\*\*23 дня 20 часов\*\*/);
  const sett = view('settings', baseSample, now, 1).text;
  assert.match(sett, /Личная цель: не установлена[\s\S]*\n\n🔔 Подписка: выключена\.\n🕒 Предпочтительное время: 06:00/);
  const notif = view('notifications', baseSample, now, 1);
  assert.match(notif.text, /Подписка: выключена\.\n🕒 Предпочтительное время: 06:00/);
  assert.ok(notif.buttons.flat().some(b => b.text === 'Пример уведомления'));
  const morn = view('morning', baseSample, now, 1);
  assert.equal(morn.buttons[0][0].text, '🫀 Восстановление');
  assert.equal(morn.buttons[0][0].callback_data, 'n:recovery');
});

test('Матрица 10 медицинских состояний: доступность разделов, тяги и приоритет помощи', () => {
  const baseStart = now - 10 * DAY;
  const make = (patch = {}) => ({
    user: { generation: 'g' },
    profile: { zone: 'UTC', historyZone: 'UTC', frequency: 'daily', clock: '08:00', base: { ms: baseStart, precision: 'minute' }, ...patch.profile },
    neutral: Boolean(patch.neutral),
    episodes: patch.episodes ?? [],
    intervals: patch.intervals ?? [{ start: baseStart, end: null, precision: 'minute' }],
    habits: [],
    job: patch.job ?? null
  });
  const cases = [
    ['normal', make()],
    ['medicalHold', make({ profile: { medicalHold: true } })],
    ['neutral', make({ neutral: true })],
    ['bothFlags', make({ neutral: true, profile: { medicalHold: true } })],
    ['legacyPaused', make({ profile: { trackingPaused: true } })],
    ['openEpisode', make({ intervals: [{ start: baseStart, end: now - DAY, precision: 'minute' }], episodes: [{ id: 1, start: now - DAY, last: null }] })],
    ['guest', { user: null, profile: null, neutral: false, episodes: [], intervals: [], habits: [] }]
  ];
  for (const [name, sample] of cases) {
    assert.ok(view('recovery', sample, now, 1).text.includes('Восстановление организма'), name);
    assert.ok(view('stages', sample, now, 1).text.includes('Этапы восстановления'), name);
    const cr = view('craving', sample, now, 1);
    assert.ok(cr.buttons.flat().some(b => b.callback_data === 'n:crave.work'), name);
    assert.ok(cr.buttons.flat().some(b => b.callback_data === 'n:physical'), name);
    assert.ok(cr.buttons.flat().some(b => b.callback_data === 'n:emergency'), name);
    assert.match(view('crave.work', sample, now, 1).text, /Попробуй сейчас/, name);
    assert.match(view('physical', sample, now, 1).text, /Немедленно вызови скорую/, name);
    assert.match(view('emergency', sample, now, 1).text, /112 или 103/, name);
    assert.match(view('care.help', sample, now, 1).text, /8 800 2000 200/, name);
    assert.match(view('morning', sample, now, 1).text, sample.profile ? /Утренний отчёт|Доброе утро|Отчёт|Паузе|паузе/i : /Начни отслеживание/, name);
    assert.ok(view('help', sample, now, 1).buttons.flat().some(b => b.callback_data === 'n:menu'), name);
  }
  assert.match(view('medicalPause', make({ neutral: true, profile: { medicalHold: true } }), now, 1).text, /Уведомления/);
});

test('v2.4.1 полировка: единое предупреждение тяги, 60 карточек, чистый язык восстановления и объяснение версий', () => {
  const med = { ...seriesState(23), profile: { ...state.profile, medicalHold: true }, neutral: true };
  for (const route of ['craving', 'crave.work', 'crave.stress']) {
    const out = view(route, med, now, 1);
    assert.equal((out.text.match(/При симптомах отмены/g) ?? []).length, 1);
    assert.doesNotMatch(out.text, /медицинский флаг|в профиле сохранена медицинская пауза/i);
  }
  const normalCrave = view('craving', state, now, 1);
  assert.equal((normalCrave.text.match(/физически плохо/g) ?? []).length, 1);
  assert.ok(view('relief', med, now, 1).buttons.flat().some(b => b.callback_data === 'n:emergency'));
  for (const card of Object.values(cravings).flat()) {
    assert.doesNotMatch(card, /прими душ|приготовь еду|снимок на прогулке|детокс|выпей пива/i);
  }
  for (const d of [1, 7, 23, 30, 90, 180, 365]) {
    const rec = view('recovery', seriesState(d), now, 1).text;
    assert.doesNotMatch(rec, /ресурс|тонус|выравнивается обмен веществ|ясность мыслей и устойчивость режима сна закрепляются/i);
  }
  for (const p of ['stages.0', 'stages.1']) {
    const st = view(p, seriesState(90), now, 1).text;
    assert.doesNotMatch(st, /ресурс|тонус|выравнивается обмен веществ|ясность мыслей и устойчивость режима сна закрепляются/i);
  }
  const baseStart = Date.parse('2026-11-02T23:00:00Z');
  const v1 = Date.parse('2026-11-14T16:00:00Z');
  const v2 = Date.parse('2026-11-25T02:20:48.563Z');
  const tNow = baseStart + (23 * 24 + 21) * 3_600_000 + 20 * 60_000;
  const ownerLike = {
    user: { generation: 'g' },
    profile: { zone: 'Europe/Moscow', historyZone: 'Europe/Moscow', frequency: 'off', clock: '08:00',
      base: { ms: baseStart, precision: 'minute' } },
    neutral: true,
    episodes: [],
    intervals: [{ start: baseStart, end: null, precision: 'minute' }],
    habits: [
      { effective: v1, mode: 'average', period: 7, budget: null, currency: 'RUB',
        items: [{ drink: 'beer', portions: 6, ml: 500, abv: 5, price: 15000 }] },
      { effective: v2, mode: 'average', period: 7, budget: null, currency: 'RUB',
        items: [{ drink: 'beer', portions: 6, ml: 500, abv: 5, price: 12000 }] }
    ]
  };
  const detText = view('details', ownerLike, tNow, 1).text;
  assert.match(detText, /1[\s\u00a0]?52[01]\s₽/);
  assert.match(detText, /5,22 л пива/);
  assert.match(detText, /по версиям привычки с даты их сохранения/);
  assert.match(view('method.details', ownerLike, tNow, 1).text, /по своей версии/);
  for (const from of ['physical', 'help']) {
    assert.ok(view('care.' + from, med, now, 1).buttons.flat().some(b => b.callback_data === 'n:' + from));
  }
});
