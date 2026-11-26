import { recoveryFacts, recoveryPeriods, sources, healthRotation } from '../content/facts.js';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { awardCatalog } from '../content/achievements.js';
import { calculate, MILESTONES } from './calculations.js';
import { digits, drinkName, formatMoney, hasCalendarBudget, volume } from './habits.js';
import { DAY, displayDay, displayTime, hasReportDays, observation, today, zoneLabel } from './time.js';
import { emergency, emergencyNumbers, hasMedicalRisk, risk, privacy } from './safety.js';
import { FRESH } from './schedule.js';

export const sections = [
  [['📊 Мой прогресс', 'progress'], ['🆘 Хочу выпить', 'craving']],
  [['🫀 Восстановление', 'recovery']],
  [['☀️ Жизнь без алкоголя', 'life']],
  [['🏆 Достижения', 'awards'], ['⚙️ Настройки', 'settings']]
];

export const nav = (text, data) => ({ text, callback_data: 'n:' + data });
export const back = (where = 'menu') => [nav('Назад', where)];
export const helpButtons = [nav('⚕️ Мне плохо', 'physical'), nav('🚑 Экстренная помощь', 'emergency')];
export const reportButtons = [[nav('🫀 Здоровье', 'recovery'), nav('📊 Мой прогресс', 'progress')]];
export const screen = (text, ...buttons) => ({ text, buttons });
const menuButton = [nav('Главное меню', 'menu')];
const careButton = [nav('Куда обратиться', 'care')];
const evidenceLabel = '🔬 Подробнее и источники';
export const welcome = screen('☀️ **Счастье без алкоголя**\n\nВ жизни без алкоголя можно открыть для себя что-то новое.\n\nСледи за прогрессом, замечай положительные изменения и находи новые способы радоваться жизни.\n\nБесплатно. Без рекламы. Без осуждения.',
  [nav('☀️ Начать', 'begin'), nav('🆘 Помощь сейчас', 'help')], [nav('🔐 О моих данных', 'privacy')], ...helpButtons.map(b => [b]));
export const help = screen('🆘 **Помощь сейчас**\n\nЕсли физически плохо или нужна срочная помощь, выбери подходящий маршрут.',
  ...helpButtons.map(b => [b]), [nav('Хочу выпить', 'craving'), nav('🔐 Мои данные', 'privacy')], menuButton);
const emergencyView = screen('🚑 **Экстренная помощь**\n\n' + emergency, menuButton);
const riskView = screen('⚕️ **Медицинская помощь**\n\n' + risk, [helpButtons[1]], careButton, menuButton);
const careSteps = [
  '**Немедленно вызови скорую** при судорогах, галлюцинациях, сильной спутанности сознания или резком ухудшении.\n' + emergencyNumbers,
  '**Обратись за медицинской оценкой сегодня**, если после перерыва или сокращения алкоголя появились дрожь, потливость, тошнота или сильная тревога. При других симптомах или сомнениях тоже обратись за оценкой сегодня.',
  '**Резкое прекращение употребления при зависимости может быть опасно.** Если ещё употребляешь, обсуди изменения с врачом заранее. Если уже был перерыв или употребление сократилось, обратись за медицинской оценкой сегодня.'
].join('\n\n');
const physicalView = screen('⚕️ **Мне физически плохо**\n\n' + careSteps, [helpButtons[1]], careButton, menuButton);
export const offButton = state => nav('Отключить уведомления', 'off.' + state.user.generation);

const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 0 });
const plurals = new Intl.PluralRules('ru');
function plural(n, words) {
  return n + ' ' + (words[plurals.select(n)] ?? words.many);
}
export const label = n => n === 1 ? '24 часа' : n >= 730 ? (n / 365) + (n === 1825 ? ' лет' : ' года')
  : plural(n, { one: 'день', few: 'дня', many: 'дней' });
export function duration(ms, remaining = false) {
  if (remaining && ms > 0 && ms < 3_600_000) return 'меньше часа';
  const hours = (remaining ? Math.ceil : Math.floor)(ms / 3_600_000);
  const d = Math.floor(hours / 24), h = hours % 24;
  return [d && plural(d, { one: 'день', few: 'дня', many: 'дней' }),
    (h || !d) && plural(h, { one: 'час', few: 'часа', many: 'часов' })].filter(Boolean).join(' ');
}
export function bar(percent) {
  const filled = Math.round(percent / 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled) + ' **' + percent + '%**';
}

export function statsFor(state, now) {
  return calculate(state.intervals, state.habits, state.profile.historyZone, now, state.profile.zone);
}
const openEpisode = state => state.episodes.at(-1)?.last === null;
export function reportPause(state) {
  const reason = hasMedicalRisk(state) ? 'Из-за возможного медицинского риска.'
    : openEpisode(state) ? 'Пока открыт эпизод употребления.'
      : state.profile && !hasReportDays(state.profile) ? 'Дни прежнего расписания неизвестны. Выбери дни заново.'
        : state.profile && state.profile.frequency !== 'off' && state.intervals.at(-1)?.end !== null ? 'Нет активного периода отслеживания.' : '';
  return reason ? '**Автоматические отчёты на паузе.** ' + reason + ' Ручной отчёт и статистика доступны.' : '';
}
const series = stats => '**' + duration(stats.current) + ' без алкоголя**';
const partial = value => value ? ' (частично)' : '';
const moneyLines = stats => [...stats.money].map(([currency, amount]) => {
  const unit = 10 ** digits(currency);
  if (amount.isZero()) return '💰 По указанным расходам: **' + formatMoney(0, currency, true) + '**' + partial(stats.partialCurrencies.has(currency));
  const text = amount.lt(unit) ? 'меньше ' + formatMoney(unit, currency, true) : '≈' + formatMoney(amount, currency, true);
  return '💰 Сэкономлено: **' + text + '**' + partial(stats.partialCurrencies.has(currency));
});
const awardLine = (d, locked = false) => (locked ? '🔒' : awardCatalog[d][0]) + ' ' + label(d) + ' — ' + awardCatalog[d][1];
const nextText = stats => 'До рубежа — **' + duration(stats.next * DAY - stats.current, true) + '**';
const milestoneText = stats => '🎯 Следующий рубеж — ' + label(stats.next) + '\n' +
  (stats.earlier ? 'Участок: ' + label(stats.earlier) + ' → ' + label(stats.next) + '\n' : '') +
  bar(stats.percent) + '\n' + nextText(stats);

export const metricOptions = {
  money: 'Экономия', drinks: 'Невыпитые напитки', weekends: 'Трезвые выходные',
  days: 'Общие трезвые дни', grams: 'Чистый этанол', calories: 'Калории'
};
export const reportMetrics = ['grams', 'calories'];
const portion = ['порция', 'порции', 'порций'];
const litersNumber = new Intl.NumberFormat('ru', { maximumFractionDigits: 2 });
const drinkGenitives = { beer: 'пива', wine: 'вина', sparkling: 'игристого вина', vodka: 'водки',
  whisky: 'виски', brandy: 'коньяка', cocktail: 'коктейля', other: 'другого напитка' };
function drinkLine(key, amount) {
  const [drink, ml] = JSON.parse(key);
  const name = drinkGenitives[drink];
  if (name && drink !== 'other') {
    if ((drink === 'wine' || drink === 'sparkling') && ml === 150 && amount.gte(1)) {
      const count = Math.round(amount.toNumber());
      const glasses = { one: 'бокал', few: 'бокала', many: 'бокалов' };
      return '🍷 **≈' + number.format(count) + ' ' + glasses[plurals.select(count)] + ' ' + name + '** (по 150 мл)';
    }
    const total = amount.times(ml);
    const icon = drink === 'beer' ? '🍺' : ['vodka', 'whisky', 'brandy'].includes(drink) ? '🥃' : '🥤';
    const display = total.gte(1000) ? litersNumber.format(total.div(1000).toNumber()) + ' л'
      : number.format(total.toNumber()) + ' мл';
    return icon + ' **' + (total.lt(1) ? 'меньше 1 мл' : '≈' + display) + ' ' + name + '**';
  }
  const forms = portion.map(word => name ? word + ' ' + name : word);
  const serving = ' по ' + volume(ml) + (name ? '' : ' · тип не указан');
  if (amount.lt(1)) return '**Менее одной порции**' + (name ? ' ' + name : '') + serving;
  const count = Math.round(amount.toNumber());
  const index = { one: 0, few: 1, many: 2 }[plurals.select(count)] ?? 2;
  return '**≈' + number.format(count) + ' ' + forms[index] + '**' + serving;
}
const unnamedDrinks = state => state.habits.flatMap(habit => habit.items
  .filter(row => row.drink == null).map(row => ({ ...row, effective: habit.effective })));
const nameButton = state => unnamedDrinks(state).length ? [nav('Уточнить напиток', 'drinkNames')] : [];

function metricLines(profile, stats, mode) {
  const enabled = profile.metrics ?? {};
  const limit = mode === 'morning' ? 3 : mode === 'progress' ? 16 : Infinity;
  const lines = enabled.money === false ? [] : moneyLines(stats).slice(0, limit);
  if (enabled.drinks !== false && stats.drinks.size) {
    const earned = [...stats.drinks].filter(([, amount]) => amount.gt(0));
    const drinks = earned.slice(0, limit).map(([key, amount]) => drinkLine(key, amount));
    const more = earned.length > limit ? '\nЕщё ' + (earned.length - limit) + ' в подробной статистике' : '';
    if (drinks.length) {
      lines.push('🥤 Не выпито' + partial(stats.partialDrinks) + ':' + (drinks.length > 1 ? '\n' : ' ') + drinks.join('\n') + more);
    } else if (mode === 'details') {
      lines.push('🥤 Невыпитые порции' + partial(stats.partialDrinks) + ' · пока не начислены');
    }
    if (mode === 'details' && [...stats.drinks.keys()].some(key => JSON.parse(key)[0] === null)) {
      lines.push('У старых записей может быть указан объём без названия.');
    }
  }
  if (enabled.days !== false) lines.push('📅 Всего трезвых дней: **' + number.format(stats.days) + '**');
  if (enabled.weekends !== false) lines.push('☀️ Трезвых выходных: **' + number.format(stats.weekends) + '**');
  const show = key => mode === 'details' ? enabled[key] !== false : mode === 'morning' && enabled[key] === true;
  if (show('grams') && stats.grams !== null) lines.push('⚖️ Чистый этанол: **≈' +
    number.format(stats.grams.toNumber()) + ' г**' + partial(stats.partialGrams));
  if (show('calories') && stats.calories !== undefined) lines.push('🔥 Калории из этанола: **≈' +
    number.format(stats.calories.toNumber()) + ' ккал**' + partial(stats.partialGrams) +
    (mode === 'details' ? '\nЭто оценка энергии этанола. Дефицит калорий и снижение веса по ней не определяются.' : ''));
  return lines;
}

function progressText(state, stats, mode = 'progress') {
  const paused = openEpisode(state);
  const lines = [paused ? '**Серия на паузе**' : series(stats)];
  if (!paused && (mode !== 'onboarding' || !hasMedicalRisk(state))) {
    if (stats.next) lines.push(milestoneText(stats));
    const goal = state.profile.goal;
    if (goal && mode !== 'morning') lines.push(stats.current >= goal * DAY ? '🎯 Личная цель выполнена · ' + label(goal)
      : '🎯 Личная цель — ' + label(goal) + ' · осталось ' + duration(goal * DAY - stats.current, true));
  }
  const metrics = metricLines(state.profile, stats, mode === 'morning' ? mode : 'progress');
  if (mode !== 'morning') metrics.push('🏆 Достижения: **' + stats.awards.length + ' из ' + MILESTONES.length + '**');
  if (metrics.length) lines.push(metrics.join('\n'));
  return lines.join('\n\n');
}

function pick(list, day, id, offset = 0) {
  const serial = Math.floor(Date.parse(day) / DAY);
  return list[((serial + (id % 997) + offset) % list.length + list.length) % list.length];
}
const ideasByCategory = Map.groupBy(ideas, row => row.category);
function idea(day, id, group, offset) {
  return pick(ideasByCategory.get(group) ?? ideas, day, id, offset).text;
}
const offsetFor = (text, length) => (/^\d{1,4}$/.test(text) ? Number(text) : 0) % length;
const recoveryNote = 'Общие ориентиры. Шкала показывает время, а темп восстановления у каждого свой.';
const recoveryCard = fact => fact.icon + ' **' + fact.category + '**\n' + fact.text;
const evidenceFacts = { recovery: recoveryFacts, health: healthRotation };
const sourceButton = id => {
  const [, title, url] = sources[id];
  return { text: title, url };
};

function recoveryStats(state, now) {
  const latest = state.intervals.at(-1);
  return state.profile && !openEpisode(state) && latest?.end === null && latest.start <= now ? statsFor(state, now) : null;
}

function recoveryView(state, now) {
  const heading = '🫀 **Восстановление организма**';
  const stats = recoveryStats(state, now);
  const paused = openEpisode(state);
  const links = [[nav('📅 Все этапы восстановления', 'stages')], [nav(evidenceLabel, 'sources.recovery')], menuButton];
  if (paused || hasMedicalRisk(state)) {
    const time = paused ? '**Серия на паузе**\nПрежние трезвые дни остаются в истории.' : stats && series(stats);
    return screen([heading, '⚕️ **Медицинская помощь**\n' + risk, time].filter(Boolean).join('\n\n'),
      ...helpButtons.map(button => [button]), ...links);
  }
  const days = (stats?.current ?? 0) / DAY;
  const [, period, ids] = recoveryPeriods.findLast(([start]) => days >= start);
  const week = ['вторая', 'третья', 'четвёртая', 'пятая'][Math.floor(days / 7) - 1];
  const count = stats ? series(stats) + (days >= 7 && days < 30 ? '\nИдёт ' + week + ' неделя твоего пути.' : '')
    : state.profile ? 'Отсчёт текущей серии ещё не начался.' : 'Начни отслеживание, чтобы увидеть срок своей серии.';
  const facts = ids.map(id => recoveryFacts.find(fact => fact.id === id)).filter(Boolean);
  const monthly = facts.filter(fact => days < 30 && (fact.days === 30 || fact.id === 'sleep-quality'));
  const cards = facts.filter(fact => !monthly.includes(fact)).map(recoveryCard);
  if (monthly.length) cards.push('**Впереди · ориентиры первого месяца**\n\n' + monthly.map(recoveryCard).join('\n\n'));
  const milestone = stats && (stats.next ? milestoneText(stats) : '🎯 Все временные рубежи пройдены.');
  return screen([heading, count, (stats ? '📍' : 'ℹ️') + ' **' + period + '**', ...cards, milestone, recoveryNote].filter(Boolean).join('\n\n'),
    [helpButtons[0]], ...links);
}

export function report(state, now, id, day, { automatic = false, milestone = null, afterEpisode = false } = {}) {
  if (!state.profile) return screen('☀️ **Утренний отчёт**\n\nНачни отслеживание, чтобы увидеть свой отчёт.', [nav('☀️ Начать', 'begin')]);
  const p = state.profile;
  if (automatic && p.privatePush) return screen('Твой отчёт готов', [nav('Открыть отчёт', 'morning')]);
  const paused = openEpisode(state);
  const medical = hasMedicalRisk(state) || paused;
  if (automatic && medical) return screen('Автоматическая отправка на паузе.');
  const stats = statsFor(state, now);
  if (!automatic && stats.earlier && today(state.intervals.at(-1).start + stats.earlier * DAY, p.zone) === day) milestone = stats.earlier;
  const greeting = milestone ? '🏆 **' + awardCatalog[milestone][2] + '**'
    : afterEpisode ? '☀️ **Твой путь продолжается**' : '☀️ **Доброе утро!**';
  const lines = [...(medical ? ['⚕️ **Медицинская помощь**\n\n' + risk] : []), greeting, progressText(state, stats, 'morning')];
  if (!medical && p.goal && stats.current >= p.goal * DAY &&
      today(state.intervals.at(-1).start + p.goal * DAY, p.zone) === day) {
    lines.push('🎉 **Твоя личная цель достигнута!** ' + label(p.goal) + ' без алкоголя. Счётчик продолжает работать.');
  }
  const content = p.content ?? 'both';
  const fact = ['fact', 'both'].includes(content) ? pick(healthRotation, day, id) : null;
  if (fact) lines.push('🫀 **Факт о здоровье**\n\n' + fact.text);
  if (['idea', 'both'].includes(content)) lines.push('💡 **Идея дня**\n\n' + idea(day, id));
  return screen(lines.join('\n\n'), ...reportButtons,
    fact ? [nav(evidenceLabel, 'evidence.' + fact.id + '.health')] : []);
}

function paginate(rows, page, route, size = 5) {
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  page = Math.max(0, Math.min(last, Number(page) || 0));
  const buttons = [];
  if (page) buttons.push(nav('←', route + '.' + (page - 1)));
  if (page < last) buttons.push(nav('→', route + '.' + (page + 1)));
  return { rows: rows.slice(page * size, (page + 1) * size), buttons };
}
const freq = { off: 'выключен', daily: 'ежедневно', selected: 'по выбранным дням', weekly: 'еженедельно', milestones: 'на рубежах' };

function reportStatus(state, now) {
  const p = state.profile;
  const pause = reportPause(state);
  const job = state.job;
  const planned = p.frequency !== 'off' && !pause && job && job.next_due_at >= now &&
    job.next_due_at - job.slot <= FRESH && !state.reportedDays?.includes(today(job.slot, p.zone));
  const next = planned ? '📅 Следующий отчёт: ' + displayTime(job.next_due_at, p.zone) + '.' : '';
  const details = pause || next || (p.frequency !== 'off' ? 'Ближайшая отправка пока не запланирована.' : '');
  return {
    planned,
    next,
    text: [
      p.frequency === 'off' ? 'Утренний отчёт выключен.' : 'Расписание: ' + freq[p.frequency] + ' в ' + p.clock + '.',
      details
    ].filter(Boolean).join('\n')
  };
}

export function reportSaved(state, now, connecting) {
  const p = state.profile;
  const { planned, next, text } = reportStatus(state, now);
  const title = connecting && planned
    ? '✅ **' + (p.frequency === 'daily' ? 'Ежедневный отчёт подключён' : 'Отчёты подключены') + '**'
    : '🔔 **Время отчёта сохранено**';
  const daily = connecting && planned && p.frequency === 'daily';
  const clock = daily ? 'Каждый день в ' + p.clock : p.clock;
  return screen(title + '\n\n🕒 ' + clock + ' · ' + zoneLabel(p.zone, now) + '\n\n' + (daily ? next : text),
    hasMedicalRisk(state) ? [nav('📊 Мой прогресс', 'progress'), nav('⚕️ Медицинская помощь', 'help')]
      : [nav('⚙️ Настройки уведомлений', 'notifications'), nav('Главное меню', 'menu')]);
}
const cause = { work: '💼 После работы', company: '👥 В компании', stress: '😟 Стресс', habit: '🔄 Скука или привычка' };
const causeTitle = { work: '💼 Вечер после работы', company: '👥 Тяга в компании', stress: '😟 Напряжённый момент', habit: '🔄 Меняем привычный ритуал' };
const noteEpisode = nav('📝 Отметить эпизод', 'episode');
const contentNames = { both: 'статистика, факт и идея', fact: 'статистика и факт', idea: 'статистика и идея', numbers: 'только статистика' };
const cravingSafety = 'Если после паузы или сокращения алкоголя тебе физически плохо, сначала открой медицинскую помощь.';

function cravingStats(state, now) {
  if (!state.profile || openEpisode(state) || hasMedicalRisk(state)) return '';
  const stats = statsFor(state, now);
  return [series(stats), ...moneyLines(stats), '🏆 Наград получено: **' + stats.awards.length + '**'].join('\n');
}

export function view(route, state, now, id) {
  const [page, arg, other] = route.split('.');
  const p = state.profile;
  const stats = ['progress', 'details', 'awards'].includes(page) && p ? statsFor(state, now) : null;
  const day = today(now, p?.zone ?? 'UTC');
  switch (page) {
    case 'menu': return p ? view('progress', state, now, id) : welcome;
    case 'help': return { ...help, readOnly: true };
    case 'emergency': return { ...emergencyView, readOnly: true };
    case 'physical': return { ...physicalView, readOnly: true };
    case 'care': return { ...screen('⚕️ **Куда обратиться**\n\n' + careSteps +
      '\n\n• Для оценки сегодня обратись к врачу или в отделение неотложной помощи.\n' +
      '• Помощь при зависимости можно обсудить с врачом-наркологом.\n' +
      '• Группы взаимопомощи могут поддержать. При симптомах нужна медицинская помощь.',
      [helpButtons[1]],
      [{ text: 'МЧС России · Как вызвать скорую', url: 'https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/kak-pravilno-vyzvat-skoruyu_5' }],
      [{ text: 'NHS · Помощь в Англии', url: 'https://www.nhs.uk/nhs-services/find-alcohol-addiction-support-services/' }],
      [{ text: 'NIAAA · Помощь в США', url: 'https://alcoholtreatment.niaaa.nih.gov/how-to-find-alcohol-treatment' }],
      [{ text: 'АА · Поиск встреч', url: 'https://www.aa.org/faq/how-can-i-find-meeting-information' }],
      menuButton), readOnly: true };
    case 'privacy': return screen('🔐 **Мои данные**\n\n' + privacy,
      [p && p.frequency !== 'off' && offButton(state), nav('Удалить данные', 'delete')].filter(Boolean), back(p ? 'settings' : 'menu'));
    case 'morning': return { ...report(state, now, id, day, { automatic: arg === 'preview' }), readOnly: true };
    case 'progress': {
      if (!p) return screen('☀️ **Мой прогресс**\n\nНачни отслеживание, чтобы видеть свой прогресс.', [nav('☀️ Начать', 'begin')], helpButtons);
      return { ...screen('☀️ **Мой прогресс**\n\n' + progressText(state, stats, arg === 'new' ? 'onboarding' : 'progress'),
        [nav('📊 Подробная статистика', 'details')], [nav('📅 История', 'history'), nav('ℹ️ Как считаем', 'method.progress')],
        openEpisode(state) ? [nav('Завершить эпизод', 'episode.time')] : [noteEpisode]), accrueAwards: true };
    }
    case 'details': {
      if (!p) return welcome;
      const lines = metricLines(p, stats, 'details').flatMap(line => line.split('\n'));
      const chunk = paginate(lines, arg, 'details', 20);
      return screen(['📊 **Подробная статистика**',
        'Текущая серия: ' + (openEpisode(state) ? '**на паузе**' : series(stats)),
        'Самая длинная серия: **' + duration(stats.longest) + '**',
        chunk.rows.join('\n'),
        '🏆 Достижения: **' + stats.awards.length + ' из ' + MILESTONES.length + '**' +
          (stats.awards.length ? '\n' + stats.awards.map(d => awardLine(d)).join('\n') : '')
      ].filter(Boolean).join('\n\n'), chunk.buttons, nameButton(state), [nav('ℹ️ Как считаем', 'method.details')], back('progress'));
    }
    case 'drinkNames': {
      if (!p) return welcome;
      const rows = unnamedDrinks(state);
      const chunk = paginate(rows, arg, 'drinkNames');
      return screen('🥤 **Уточнить напиток**\n\n' + (rows.length ? 'Выбери запись. Объём, крепость, частота и расходы сохранятся.' : 'Все сохранённые напитки уже подписаны.'),
        ...chunk.rows.map(row => [nav(displayTime(row.effective, p.historyZone) + ' · ' + volume(row.ml) + ' · №' + (row.line + 1),
          'name.' + row.effective + '.' + row.line)]), chunk.buttons, back('details'));
    }
    case 'metrics': {
      if (!p) return welcome;
      return screen('📊 **Показатели прогресса**\n\nНажми на показатель, чтобы изменить его отображение.',
        ...Object.entries(metricOptions).map(([key, title]) => {
          const value = p.metrics?.[key];
          const status = value === false ? 'выкл.' : reportMetrics.includes(key)
            ? value ? 'и в отчёте' : 'подробно' : 'вкл.';
          return [nav(title + ' · ' + status, 'metric.' + key)];
        }), back('settings'));
    }
    case 'settings': {
      if (!p) return screen('⚙️ **Настройки**', [nav('☀️ Начать', 'begin')], helpButtons);
      const h = state.habits.at(-1);
      const latest = state.episodes.at(-1);
      const date = latest ? (latest.last === null ? 'эпизод продолжается' : observation({ ms: latest.last, precision: latest.precision }, p.historyZone)) : observation(p.base, p.historyZone);
      const drinkRows = h?.items.filter(row => row.drink !== 'budget') ?? [];
      const summary = [...Map.groupBy(drinkRows, row => row.drink)].map(([key, rows]) => {
        const ml = rows.every(row => row.ml !== null) ? rows.reduce((n, row) => n + row.portions * row.ml, 0) : null;
        return drinkName(key) + (ml === null ? '' : ' · ' + volume(ml));
      });
      const calendarBudget = h && hasCalendarBudget(h);
      const costs = h?.items.filter(row => row.price !== null && (!calendarBudget || row.drink === 'budget')) ?? [];
      const period = h?.period === 28 ? ' за 28 дней' : ' за неделю';
      const spend = h?.budget ?? (costs.length ? costs.reduce((n, row) => n + row.portions * row.price, 0) : null);
      return screen([
        '⚙️ **Настройки**\n', '📅 Последнее употребление: ' + date,
        '📊 Прежняя привычка: ' + (summary.length ? summary.slice(0, 4).join(', ') + period + (summary.length > 4 ? ' и другие' : '') : 'напитки не указаны'),
        '💰 Расходы: ' + (spend === null ? 'не указаны' : '≈' + formatMoney(spend, h.currency, true) + period +
          (h.budget === null && !calendarBudget && costs.length < h.items.length ? ' (частично)' : '')),
        '🔔 ' + reportStatus(state, now).text,
        '🌍 Часовой пояс: ' + zoneLabel(p.zone, now), '🎯 Цель: ' + (p.goal ? label(p.goal) : 'без ограничений')
      ].join('\n'),
      [nav('📅 Дата и история', 'history')],
      [nav('💰 Привычка и экономия', 'habitSettings')],
      [nav('🎯 Цель и показатели', 'goalSettings')],
      [nav('🔔 Уведомления', 'notifications'), nav('🌍 Часовой пояс', 'edit.zone')],
      [nav('ℹ️ О боте и мои данные', 'aboutSettings')],
      [nav('⚕️ Медицинская помощь', 'help')], menuButton);
    }
    case 'habitSettings': return p ? screen('💰 **Привычка и экономия**', [nav('Прежняя привычка', 'edit.habit')],
      [nav('Способ расчёта', 'edit.mode')], [nav('Прошлые версии', 'habits')], nameButton(state), back('settings')) : welcome;
    case 'goalSettings': return p ? screen('🎯 **Цель и показатели**', [nav('Личная цель', 'edit.goal')],
      [nav('📊 Показатели прогресса', 'metrics')], back('settings')) : welcome;
    case 'aboutSettings': return screen('ℹ️ **О боте и мои данные**\n\nНЕ ПЬЮ | Счастье без алкоголя',
      [nav('Как считаем', 'method.settings'), nav('Мои данные', 'privacy')], back('settings'));
    case 'notifications':
      if (!p) return welcome;
      return screen('🔔 **Уведомления**\n\n' + reportStatus(state, now).text +
        '\n\n🕒 Время: ' + p.clock + ' · ' + zoneLabel(p.zone, now) +
        '\nСодержание: ' + contentNames[p.content ?? 'both'] +
        '\nПревью: ' + (p.privatePush ? 'Твой отчёт готов' : 'обычный отчёт') + '\n\nКоманда /morning открывает отчёт вручную.',
      p.frequency === 'off' ? [nav('Подключить ежедневные отчёты', 'edit.subscribe')] : [],
      [nav('Изменить время', 'edit.clock'), nav(p.frequency === 'off' ? 'Другая частота' : 'Изменить частоту', 'edit.notify')],
      [nav('Содержание', 'edit.content'), nav('Формат превью', 'edit.push')],
      p.frequency === 'off' ? [] : [offButton(state)], [nav('Открыть отчёт', 'morning'), nav('Превью', 'morning.preview')], back('settings'));
    case 'history': {
      if (!p) return welcome;
      const rows = state.episodes.map((e, i) => ({ id: e.id, number: i + 1,
        date: displayDay(today(e.start, p.historyZone)), text: (i + 1) + '. ' + displayTime(e.start, p.historyZone) + ' → ' +
        (e.last === null ? 'продолжается' : observation({ ms: e.last, precision: e.precision }, p.historyZone)) })).reverse();
      rows.push({ id: 'base', text: 'Начало отслеживания · ' + observation(p.base, p.historyZone) });
      const chunk = paginate(rows, arg, 'history');
      return screen('📅 **История прогресса**\n\n' + zoneLabel(p.historyZone, now) + '\nПолных трезвых дней: **' + statsFor(state, now).days + '**\n\n' +
        chunk.rows.map(row => row.text).join('\n') +
        (chunk.rows.some(row => row.number) ? '\n\nНажми дату эпизода, чтобы исправить запись.' : ''), ...chunk.rows.map(row => row.id === 'base'
          ? [nav('Исправить начальную дату', 'correct.base')] : [nav(row.number + '. ' + row.date, 'correct.' + row.id),
            nav('Удалить ' + row.number, 'remove.' + row.id)]),
      openEpisode(state) ? [nav('Завершить эпизод', 'episode.time')] : [noteEpisode],
      [nav('Серии без алкоголя', 'periods')], chunk.buttons, back('progress'));
    }
    case 'periods': {
      if (!p) return welcome;
      const chunk = paginate([...state.intervals].reverse(), arg, 'periods');
      return screen('📅 **Серии без алкоголя**\n\n' + (chunk.rows.map(row => displayTime(row.start, p.historyZone) + ' → ' +
        (row.end === null ? 'сейчас' : displayTime(row.end, p.historyZone))).join('\n') || 'Пока нет известных периодов.'), chunk.buttons, back('history'));
    }
    case 'awards': {
      const awards = stats?.awards ?? [], future = MILESTONES.filter(d => !awards.includes(d));
      const lines = ['🏆 **Твои достижения**', '**' + awards.length + ' из ' + MILESTONES.length + ' наград**',
        bar(Math.round(100 * awards.length / MILESTONES.length)),
        'Достигнутые рубежи сохраняются после нового эпизода.',
        awards.length ? '✅ **Полученные награды**\n\n' + awards.map(d => awardLine(d)).join('\n') : '',
        future.length ? '🎯 **Впереди**\n\n' + future.map(d => awardLine(d, true)).join('\n') : '🎉 Коллекция собрана!'];
      const nextAward = future[0];
      if (p && !openEpisode(state) && nextAward > stats.current / DAY) {
        lines.push('🎁 До следующей награды — **' + duration(nextAward * DAY - stats.current, true) + '**');
      }
      return { ...screen(lines.filter(Boolean).join('\n\n'), back()), accrueAwards: true };
    }
    case 'life': {
      const category = lifeLabels.find(([, key]) => key === arg);
      const length = (ideasByCategory.get(category?.[1]) ?? ideas).length;
      const offset = offsetFor(other, length);
      const choices = lifeLabels.map(([text, key]) => nav(text, 'life.' + key));
      return screen('☀️ **Жизнь без алкоголя**\n\n' + (category ? '**' + category[0] + '**' :
        'Открывай новые способы отдыхать, общаться и радоваться жизни.\n\n💡 **Идея дня**') + '\n\n' + idea(day, id, category?.[1], offset),
      ...[0, 2, 4, 6].map(i => choices.slice(i, i + 2)), [nav('🔄 Другая идея', 'life.' + (category?.[1] ?? 'all') + '.' + ((offset + 1) % length))], back());
    }
    case 'craving': return hasMedicalRisk(state) || openEpisode(state) ? riskView : screen(['🆘 **Хочется выпить?**', cravingSafety, cravingStats(state, now),
      'Если это привычная тяга, попробуй сменить обстановку и отложить решение на несколько минут.',
      'Что вызвало желание выпить?'].filter(Boolean).join('\n\n'),
      ...helpButtons.map(b => [b]),
      [nav(cause.work, 'crave.work'), nav(cause.company, 'crave.company')], [nav(cause.stress, 'crave.stress')], [nav(cause.habit, 'crave.habit')],
      [nav('✅ Отпустило', 'relief')], [noteEpisode], back());
    case 'crave': {
      if (hasMedicalRisk(state) || openEpisode(state)) return riskView;
      if (!Object.hasOwn(cravings, arg)) return view('craving', state, now, id);
      const list = cravings[arg], offset = offsetFor(other, list.length);
      return screen('**' + causeTitle[arg] + '**\n\n' + cravingSafety + '\n\n**Попробуй сейчас**\n\n' + pick(list, day, id, offset) +
        (p ? '\n\n☀️ ' + series(statsFor(state, now)) : ''),
      ...helpButtons.map(b => [b]), [nav('✅ Отпустило', 'relief'), nav('💡 Другой совет', 'crave.' + arg + '.' + ((offset + 1) % list.length))],
      [noteEpisode], back('craving'));
    }
    case 'relief': return hasMedicalRisk(state) || openEpisode(state) ? riskView : screen('Ещё одна волна позади. Продолжай в своём темпе. ☀️', back('craving'));
    case 'recovery': return recoveryView(state, now);
    case 'stages': {
      const stats = recoveryStats(state, now);
      const chunk = paginate([0, ...MILESTONES], arg, 'stages');
      const knownLabels = { 0: 'Первые сутки · начало серии', 1: '1 день · рубеж в 24 часа', 7: '7 дней · 1 неделя', 14: '14 дней · 2 недели',
        365: '365 дней · 1 год' };
      const rows = chunk.rows.map(days => {
        const mark = !stats ? '•' : days < stats.earlier ? '✅' : days === stats.earlier ? '📍' : '⏳';
        return mark + ' ' + (knownLabels[days] ?? label(days));
      });
      return screen(['📅 **Этапы восстановления**', rows.join('\n'),
        '✅ Пройдено · 📍 Сейчас · ⏳ Впереди\nРубежи показывают только время. Сутки — 24 часа. 30 дней — фиксированный отрезок.'].join('\n\n'),
        chunk.buttons, chunk.rows.includes(MILESTONES.at(-1)) ? [nav('🛡 Долгосрочные преимущества', 'evidence.mouth.recovery')] : [],
        [nav(evidenceLabel, 'sources.recovery')], back('recovery'), menuButton);
    }
    case 'method':
      if (arg === 'recovery' || arg === 'health') {
        return screen('ℹ️ **Методика и источники**\n\n' + recoveryNote,
          [nav('🔬 Научные источники', 'sources.' + arg)], back(arg === 'recovery' ? 'recovery' : 'morning'));
      }
      return screen('ℹ️ **Как считаем**\n\n💰 Экономия и 🥤 невыпитые напитки — оценки по прежней привычке.\n⚖️ Чистый этанол — по объёму и крепости напитков.\n🔥 Калории — по энергетической ценности этанола.\n📅 Трезвые дни и выходные — по указанной истории употребления.',
        [nav('📖 Методика расчётов', 'formulas'), nav('🔬 Научные источники', 'sources.method')], back(['progress', 'details', 'settings'].includes(arg) ? arg : 'menu'));
    case 'formulas': return screen('📖 **Методика расчётов**\n\nСутки серии — 24 часа. Трезвый день — целая местная дата внутри известного периода воздержания. Выходные — полностью завершённые суббота и воскресенье внутри одного такого периода. Если известно только число, отсчёт начинается со следующей полуночи.\n\n**Чистый этанол** = порции × мл × крепость / 100 × 0,789 г по каждому напитку. Энергия этанола = граммы × 7. В эту цифру входит только этанол.\n\n**Пример**\n1 400 ₽ и 7 порций за неделю дают ≈200 ₽ и ≈1 порцию за каждые 24 часа. В календарном расчёте день засчитывается, если целиком попадает и в период воздержания, и в одну версию привычки. День смены привычки посреди дня пропускается в этой оценке.\n\nЭкономия берётся из общего бюджета или отдельных цен. Расходы самого эпизода не вычитаются. При неполных сведениях оценка может быть частичной. Рубежи в годах считаются по 365 суток.',
      [nav('🔬 Научные источники', 'sources.method')], back('method'));
    case 'sources': {
      const topics = Object.hasOwn(evidenceFacts, arg) && evidenceFacts[arg];
      if (topics) {
        const chunk = paginate(topics, other, 'sources.' + arg);
        return screen('🔬 **Подробнее и источники**\n\nВыбери тему, чтобы прочитать, что именно изучали.',
          ...chunk.rows.map(fact => [nav(fact.category, 'evidence.' + fact.id + '.' + arg)]),
          chunk.buttons, back(arg === 'recovery' ? 'recovery' : 'morning'), menuButton);
      }
      const chunk = paginate(Object.keys(sources), other, 'sources.method');
      return screen('🔬 **Научные источники**\n\nВыбери публикацию.',
        ...chunk.rows.map(id => [sourceButton(id)]), chunk.buttons, back('method'));
    }
    case 'evidence': {
      const fact = Object.hasOwn(evidenceFacts, other) && evidenceFacts[other].find(row => row.id === arg);
      if (!fact) return view('sources.recovery', state, now, id);
      return screen(['🔬 **' + fact.category + '**', fact.text, fact.study,
        'Кого изучали: ' + fact.population + '\nСрок наблюдения: ' + fact.duration,
        fact.limitations, fact.evidence, 'Клиническая проверка: ' + (fact.clinical_status === 'approved' ? 'пройдена' : 'ожидается')].filter(Boolean).join('\n\n'),
        [sourceButton(fact.source_id)], fact.id === 'liver' ? [sourceButton('body')] : [],
        [nav('Все источники', 'sources.' + other)], back(other === 'recovery' ? 'recovery' : 'morning'), menuButton);
    }
    default: return screen('Это меню устарело. Открой нужный раздел ещё раз.', back());
  }
}
