import { recoveryFacts, recoveryPeriods, recoveryStages, sources, healthRotation } from '../content/facts.js';
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
export const reportButtons = [[nav('🫀 Восстановление', 'recovery'), nav('📊 Мой прогресс', 'progress')]];
export const screen = (text, ...buttons) => ({ text, buttons });
const menuButton = [nav('Главное меню', 'menu')];
const careButton = (from = 'help') => [nav('Куда обратиться', 'care.' + from)];
const evidenceLabel = '🔬 Подробнее и источники';
const symptomNote = '⚕️ **При симптомах отмены** обратись за медицинской помощью.';
export const welcome = screen('☀️ **Счастье без алкоголя**\n\nВ жизни без алкоголя можно открыть для себя что-то новое.\n\nСледи за прогрессом, замечай положительные изменения и находи новые способы радоваться жизни.\n\nБесплатно. Без рекламы. Без осуждения.',
  [nav('☀️ Начать', 'begin'), nav('🆘 Помощь сейчас', 'help')], [nav('🔐 О моих данных', 'privacy')], ...helpButtons.map(b => [b]));
export const help = screen('🆘 **Помощь сейчас**\n\nЕсли физически плохо или нужна срочная помощь, выбери подходящий маршрут.',
  ...helpButtons.map(b => [b]), [nav('Хочу выпить', 'craving'), nav('🔐 Мои данные', 'privacy')], menuButton);
const emergencyView = screen('🚑 **Экстренная помощь**\n\n' + emergency, menuButton);
const riskView = screen('⚕️ **Медицинская помощь**\n\n' + risk, [helpButtons[1]], careButton('help'), menuButton);
const careSteps = [
  '**Немедленно вызови скорую** при судорогах, галлюцинациях, сильной спутанности сознания или резком ухудшении.\n' + emergencyNumbers,
  '**Обратись за медицинской оценкой сегодня**, если после перерыва или сокращения алкоголя появились дрожь, потливость, тошнота или сильная тревога. При других симптомах или сомнениях тоже обратись за оценкой сегодня.',
  '**Резкое прекращение употребления при зависимости может быть опасно.** Если ещё употребляешь, обсуди изменения с врачом заранее. Если уже был перерыв или употребление сократилось, обратись за медицинской оценкой сегодня.'
].join('\n\n');
const physicalView = screen('⚕️ **Мне физически плохо**\n\n' + careSteps, [helpButtons[1]], careButton('physical'), menuButton);
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
      const singleIcon = drinks.length === 1 && /^(?:🍺|🍷|🥃|🥤)\s+/.exec(drinks[0]);
      if (singleIcon) {
        lines.push(singleIcon[0].trim() + ' Не выпито' + partial(stats.partialDrinks) + ': ' + drinks[0].slice(singleIcon[0].length) + more);
      } else {
        lines.push('🥤 Не выпито' + partial(stats.partialDrinks) + ':' + (drinks.length > 1 ? '\n' : ' ') + drinks.join('\n') + more);
      }
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
  if (show('grams') && stats.grams !== null) lines.push('⚖️ Чистый спирт (этанол), оценка: **≈' +
    number.format(stats.grams.toNumber()) + ' г**' + partial(stats.partialGrams));
  if (show('calories') && stats.calories !== undefined) lines.push('🔥 Энергия этанола, оценка: **≈' +
    number.format(stats.calories.toNumber()) + ' ккал**' + partial(stats.partialGrams) +
    (mode === 'details' ? '\nЭто оценка энергии этанола. Она не определяет дефицит калорий, снижение веса или фактическую энергетическую ценность всего напитка.' : ''));
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
const recoveryNote = 'Общие ориентиры. Темп восстановления индивидуален.';
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
  const showHelp = paused || hasMedicalRisk(state);
  const links = [[nav('📅 Все этапы восстановления', 'stages')], [nav(evidenceLabel, 'sources.recovery')], menuButton];
  if (paused) {
    return screen([heading, '**Серия на паузе**\nПрежние трезвые дни и достижения сохранены.',
      '**Общие материалы**\nКарточки по темам доступны в разделе «Подробнее и источники».',
      symptomNote].join('\n\n'),
    ...helpButtons.map(button => [button]), [nav('🏆 Достижения', 'awards')], ...links);
  }
  const days = (stats?.current ?? 0) / DAY;
  const [, period, ids, horizon] = recoveryPeriods.findLast(([start]) => days >= start);
  const week = ['вторая', 'третья', 'четвёртая', 'пятая'][Math.floor(days / 7) - 1];
  const count = stats ? series(stats) + (days >= 7 && days < 30 ? '\nИдёт ' + week + ' неделя твоего пути.' : '')
    : state.profile ? 'Отсчёт текущей серии ещё не начался.' : 'Начни отслеживание, чтобы увидеть срок своей серии.';
  const cards = ids.map(id => recoveryFacts.find(fact => fact.id === id)).filter(Boolean).map(recoveryCard);
  let nextBlock = null;
  if (horizon) {
    const left = stats && horizon.targetDays * DAY > stats.current
      ? ' · осталось **' + duration(horizon.targetDays * DAY - stats.current, true) + '**' : '';
    nextBlock = '🔭 **Ближайший ориентир — ' + horizon.title + '**' + left + '\n' + horizon.text;
  } else if (stats) {
    nextBlock = '🎯 Все базовые ориентиры пройдены — каждый новый год укрепляет этот результат.';
  }
  return screen([heading, count, (stats ? '📍 **Текущий период · ' + period + '**' : 'ℹ️ **' + period + '**'),
    ...cards, nextBlock, recoveryNote, showHelp && symptomNote].filter(Boolean).join('\n\n'),
    ...links.slice(0, 2), showHelp ? helpButtons : [helpButtons[0]], links[2]);
}

export function report(state, now, id, day, { automatic = false, milestone = null, afterEpisode = false } = {}) {
  if (!state.profile) return screen('☀️ **Утренний отчёт**\n\nНачни отслеживание, чтобы увидеть свой отчёт.', [nav('☀️ Начать', 'begin')]);
  const p = state.profile;
  const paused = openEpisode(state);
  const showHelp = hasMedicalRisk(state) || paused;
  if (automatic && showHelp) return screen('Автоматическая отправка на паузе.');
  if (automatic && p.privatePush) return screen('Твой отчёт готов', [nav('Открыть отчёт', 'morning')]);
  const stats = statsFor(state, now);
  if (!automatic && stats.earlier && today(state.intervals.at(-1).start + stats.earlier * DAY, p.zone) === day) milestone = stats.earlier;
  const greeting = milestone ? '🏆 **' + awardCatalog[milestone][2] + '**'
    : afterEpisode ? '☀️ **Твой путь продолжается**' : '☀️ **Доброе утро!**';
  const lines = [greeting, progressText(state, stats, 'morning')];
  if (!paused && p.goal && stats.current >= p.goal * DAY &&
      today(state.intervals.at(-1).start + p.goal * DAY, p.zone) === day) {
    lines.push('🎉 **Твоя личная цель достигнута!** ' + label(p.goal) + ' без алкоголя. Счётчик продолжает работать.');
  }
  const content = p.content ?? 'both';
  const fact = ['fact', 'both'].includes(content) ? pick(healthRotation, day, id) : null;
  if (fact) lines.push('🫀 **Факт о здоровье**\n' + fact.text);
  if (['idea', 'both'].includes(content)) lines.push('💡 **Идея дня**\n' + idea(day, id));
  if (showHelp) lines.push(symptomNote);
  return screen(lines.join('\n\n'), ...reportButtons,
    fact ? [nav(evidenceLabel, 'evidence.' + fact.id + '.health')] : [],
    ...(showHelp ? helpButtons.map(button => [button]) : []));
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
  const subscription = p.frequency === 'off' ? 'Подписка: выключена.' : 'Подписка: включена (' + freq[p.frequency] + ').';
  const clockLabel = p.frequency === 'off' ? 'Предпочтительное время' : 'Время отчёта';
  const clockLine = '🕒 ' + clockLabel + ': ' + p.clock + ' · ' + zoneLabel(p.zone, now);
  const next = planned ? '📅 Следующий отчёт: ' + displayTime(job.next_due_at, p.zone) + '.' : '';
  const deliveryLine = hasMedicalRisk(state)
    ? '⚕️ Автоматическая доставка ограничена по соображениям безопасности. Ручной отчёт доступен.'
    : pause || next || (p.frequency !== 'off' ? '📅 Ближайшая отправка пока не запланирована.' : '');
  return {
    planned,
    next,
    subscription,
    clockLine,
    deliveryLine,
    text: [subscription, clockLine, deliveryLine].filter(Boolean).join('\n')
  };
}

export function reportSaved(state, now, connecting) {
  const p = state.profile;
  const status = reportStatus(state, now);
  const title = connecting && status.planned
    ? '✅ **' + (p.frequency === 'daily' ? 'Ежедневный отчёт подключён' : 'Отчёты подключены') + '**'
    : '🔔 **Время отчёта сохранено**';
  const daily = connecting && status.planned && p.frequency === 'daily';
  const body = daily
    ? '🕒 Каждый день в ' + p.clock + ' · ' + zoneLabel(p.zone, now) + '\n\n' + status.next
    : status.text;
  return screen(title + '\n\n' + body,
    [nav('⚙️ К уведомлениям', 'notifications'), nav('📊 Мой прогресс', 'progress')],
    hasMedicalRisk(state) ? [nav('⚕️ Почему отчёты на паузе?', 'medicalPause')] : [],
    hasMedicalRisk(state) ? [nav('⚕️ Медицинская помощь', 'help')] : []);
}
const cause = { work: '💼 После работы', company: '👥 В компании', stress: '😟 Стресс', habit: '🔄 Скука или привычка' };
const causeTitle = { work: '💼 Вечер после работы', company: '👥 Тяга в компании', stress: '😟 Напряжённый момент', habit: '🔄 Меняем привычный ритуал' };
const noteEpisode = nav('📝 Отметить эпизод', 'episode');
const contentNames = { both: 'статистика, факт и идея', fact: 'статистика и факт', idea: 'статистика и идея', numbers: 'только статистика' };
const cravingSafety = 'Если после паузы или сокращения алкоголя тебе физически плохо, сначала открой медицинскую помощь.';
const cravingMedicalBanner = state => {
  if (!hasMedicalRisk(state) && !openEpisode(state)) return '';
  return '⚠️ **Важно про самочувствие:** ' + (hasMedicalRisk(state)
    ? 'в профиле сохранена медицинская пауза. ' : 'сейчас открыт эпизод употребления. ') +
    'Если есть дрожь, потливость, тошнота, сильная тревога или другие симптомы — не терпи их, сразу открой **⚕️ Мне плохо** или **🚑 Экстренная помощь**.';
};

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
    case 'care': {
      const returnRoute = ['help', 'physical', 'medicalPause'].includes(arg) ? arg : null;
      return { ...screen('⚕️ **Куда обратиться**\n\n' + careSteps +
        '\n\n• **Россия:** горячая линия Минздрава России `8 800 2000 200` (бесплатно, в том числе по отказу от алкоголя); портал Минздрава «Так здорово»; памятка МЧС о вызове скорой (112/103). Помощь при зависимости можно обсудить с врачом-наркологом.\n' +
        '• **Группы взаимопомощи (не являются медицинской организацией):** «Анонимные алкоголики» (Россия и международный поиск). При физических симптомах нужна медицинская помощь.',
        [helpButtons[1]],
        [{ text: 'Минздрав РФ · Так здорово', url: 'https://www.takzdorovo.ru/' }],
        [{ text: 'МЧС России · Как вызвать скорую', url: 'https://mchs.gov.ru/deyatelnost/bezopasnost-grazhdan/kak-pravilno-vyzvat-skoruyu_5' }],
        [{ text: 'АА России · Группы поддержки', url: 'https://aarussia.ru/' }],
        [{ text: 'NHS · Помощь в Англии', url: 'https://www.nhs.uk/nhs-services/find-alcohol-addiction-support-services/' }],
        [{ text: 'NIAAA · Помощь в США', url: 'https://alcoholtreatment.niaaa.nih.gov/how-to-find-alcohol-treatment' }],
        [{ text: 'АА · Международный поиск встреч', url: 'https://www.aa.org/faq/how-can-i-find-meeting-information' }],
        returnRoute ? back(returnRoute) : [],
        menuButton), readOnly: true };
    }
    case 'medicalPause': {
      if (!p) return welcome;
      return screen([
        '⚕️ **Медицинская пауза**',
        hasMedicalRisk(state)
          ? 'Автоматические утренние отчёты сейчас ограничены из-за сохранённого медицинского флага. В ранних версиях причина могла не сохраниться — сама по себе эта метка **не является диагнозом** и не доказывает наличие симптомов сейчас.'
          : 'Сейчас в профиле нет активной медицинской паузы.',
        '**Что доступно без ограничений**\n• Мой прогресс, подробная статистика и история.\n• Восстановление, достижения и «Жизнь без алкоголя».\n• Психологическая поддержка при тяге («Хочу выпить»).\n• Ручной утренний отчёт командой /morning и сохранение предпочтительного времени уведомлений.',
        '**Почему не снимается обычной кнопкой**\nОграничение защищает от автоматической рассылки при возможном риске отмены. Обычный переключатель уведомлений и длительность серии паузу не снимают — пересмотр требует врачебного согласования критериев безопасности.',
        '**Что можно сделать сейчас**\nЕсли появились физические симптомы или сомнения — сразу открой медицинскую помощь. При обычной тяге используй «Хочу выпить», а отчёты можно открывать вручную.'
      ].join('\n\n'),
      helpButtons, [nav('🆘 Хочу выпить', 'craving')], [nav('🔔 К уведомлениям', 'notifications')], menuButton);
    }
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
      const lines = metricLines(p, stats, 'details');
      const economy = lines.filter(line => line.startsWith('💰') || line.startsWith('📅') || line.startsWith('☀️'));
      const drinksAndCalc = lines.filter(line => !economy.includes(line)).flatMap(line => line.split('\n'));
      const allRows = [...(economy.length ? [...economy, ''] : []), ...drinksAndCalc];
      const chunk = paginate(allRows, arg, 'details', 20);
      return screen(['📊 **Подробная статистика**',
        'Текущая серия: ' + (openEpisode(state) ? '**на паузе**' : series(stats)) +
          '\nСамая длинная серия: **' + duration(stats.longest) + '**',
        chunk.rows.join('\n').trim(),
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
      const status = reportStatus(state, now);
      return screen([
        '⚙️ **Настройки**',
        '📅 Последнее употребление: ' + date,
        [
          '📊 Прежняя привычка: ' + (summary.length ? summary.slice(0, 4).join(', ') + period + (summary.length > 4 ? ' и другие' : '') : 'напитки не указаны'),
          '💰 Расходы: ' + (spend === null ? 'не указаны' : '≈' + formatMoney(spend, h.currency, true) + period +
            (h.budget === null && !calendarBudget && costs.length < h.items.length ? ' (частично)' : '')),
          '🎯 Личная цель: ' + (p.goal ? label(p.goal) : 'не установлена')
        ].join('\n'),
        ['🔔 ' + status.subscription, status.clockLine, status.deliveryLine].filter(Boolean).join('\n')
      ].join('\n\n'),
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
    case 'notifications': {
      if (!p) return welcome;
      const status = reportStatus(state, now);
      return screen('🔔 **Уведомления**\n\n' + status.text +
        '\n\nСодержание: ' + contentNames[p.content ?? 'both'] +
        '\nПревью: ' + (p.privatePush ? 'Твой отчёт готов' : 'обычный отчёт') + '\n\nКоманда /morning открывает отчёт вручную.',
      p.frequency === 'off' ? [nav('Подключить ежедневные отчёты', 'edit.subscribe')] : [],
      [nav('Изменить время', 'edit.clock'), nav(p.frequency === 'off' ? 'Другая частота' : 'Изменить частоту', 'edit.notify')],
      [nav('Содержание', 'edit.content'), nav('Формат превью', 'edit.push')],
      hasMedicalRisk(state) ? [nav('⚕️ Почему отчёты на паузе?', 'medicalPause')] : [],
      p.frequency === 'off' ? [] : [offButton(state)], [nav('Открыть отчёт', 'morning'), nav('Пример уведомления', 'morning.preview')], back('settings'));
    }
    case 'history': {
      if (!p) return welcome;
      const rows = state.episodes.map((e, i) => ({ id: e.id, number: i + 1,
        date: displayDay(today(e.start, p.historyZone)), text: (i + 1) + '. ' + displayTime(e.start, p.historyZone) + ' → ' +
        (e.last === null ? 'продолжается' : observation({ ms: e.last, precision: e.precision }, p.historyZone)) })).reverse();
      rows.push({ id: 'base', text: 'Начало отслеживания: **' + observation(p.base, p.historyZone) + '**' });
      const chunk = paginate(rows, arg, 'history');
      return screen('📅 **История прогресса**\n\n' + zoneLabel(p.historyZone, now) + '\nПолных трезвых дней: **' + statsFor(state, now).days + '**\n\n' +
        (state.episodes.length ? '' : 'Эпизодов употребления не зарегистрировано.\n\n') +
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
      const items = chunk.rows.map(row => {
        const active = row.end === null;
        const len = duration(Math.max(0, (active ? now : row.end) - row.start));
        const head = active ? '🟢 **Текущая серия**' : '⚪ **Завершённая серия**';
        return head + '\n**' + len + '**\n' + displayTime(row.start, p.historyZone) + ' → ' +
          (active ? 'сейчас' : displayTime(row.end, p.historyZone));
      });
      return screen('📅 **Серии без алкоголя**\n\n' + (items.join('\n\n') || 'Пока нет известных периодов.'), chunk.buttons, back('history'));
    }
    case 'awards': {
      const awards = stats?.awards ?? [], future = MILESTONES.filter(d => !awards.includes(d));
      const lines = ['🏆 **Твои достижения**', '**' + awards.length + ' из ' + MILESTONES.length + ' наград**',
        bar(Math.round(100 * awards.length / MILESTONES.length)),
        'Достигнутые рубежи сохраняются после нового эпизода.',
        awards.length ? '✅ **Полученные награды**\n\n' + awards.map(d => awardLine(d)).join('\n') : '',
        future.length ? '🎯 **Впереди**\n\n' + future.map((d, i) => i === 0 ? '**' + awardLine(d, true) + '**' : awardLine(d, true)).join('\n') : '🎉 Коллекция собрана!'];
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
      return screen('☀️ **Жизнь без алкоголя**\n\n' + (category ? '**' + category[0] + '**\n' :
        'Открывай новые способы отдыхать, общаться и радоваться жизни.\n\n💡 **Идея дня**\n') + idea(day, id, category?.[1], offset),
      ...[0, 2, 4, 6].map(i => choices.slice(i, i + 2)), [nav('🔄 Другая идея', 'life.' + (category?.[1] ?? 'all') + '.' + ((offset + 1) % length))], back());
    }
    case 'craving': {
      const banner = cravingMedicalBanner(state);
      const action = openEpisode(state) ? nav('Завершить эпизод', 'episode.time') : noteEpisode;
      return screen(['🆘 **Хочется выпить?**', banner, cravingSafety, cravingStats(state, now),
        'Если это привычная тяга, попробуй сменить обстановку и отложить решение на несколько минут.',
        'Что сейчас происходит?'].filter(Boolean).join('\n\n'),
      [nav(cause.work, 'crave.work'), nav(cause.company, 'crave.company')],
      [nav(cause.stress, 'crave.stress'), nav(cause.habit, 'crave.habit')],
      ...helpButtons.map(b => [b]),
      [nav('✅ Отпустило', 'relief')], [action], back());
    }
    case 'crave': {
      if (!Object.hasOwn(cravings, arg)) return view('craving', state, now, id);
      const list = cravings[arg], offset = offsetFor(other, list.length);
      const banner = cravingMedicalBanner(state);
      const action = openEpisode(state) ? nav('Завершить эпизод', 'episode.time') : noteEpisode;
      return screen(['**' + causeTitle[arg] + '**', banner, cravingSafety,
        '**Попробуй сейчас**\n' + pick(list, day, id, offset),
        p && !openEpisode(state) ? '☀️ ' + series(statsFor(state, now)) : ''].filter(Boolean).join('\n\n'),
      ...helpButtons.map(b => [b]), [nav('✅ Отпустило', 'relief'), nav('💡 Другой совет', 'crave.' + arg + '.' + ((offset + 1) % list.length))],
      [action], back('craving'));
    }
    case 'relief': return screen([
      'Ещё одна волна позади. Продолжай в своём темпе. ☀️',
      (hasMedicalRisk(state) || openEpisode(state)) ? symptomNote : ''
    ].filter(Boolean).join('\n\n'), back('craving'));
    case 'recovery': return recoveryView(state, now);
    case 'stages': {
      const stats = recoveryStats(state, now);
      const size = 3;
      const totalPages = Math.ceil(recoveryStages.length / size);
      const pageNum = Math.max(0, Math.min(totalPages - 1, Number(arg) || 0));
      const slice = recoveryStages.slice(pageNum * size, (pageNum + 1) * size);
      const days = (stats?.current ?? 0) / DAY;
      const currentIdx = stats ? recoveryStages.findLastIndex(s => days >= s.minDays) : -1;
      const rows = slice.map((stage, offset) => {
        const index = pageNum * size + offset;
        const mark = !stats ? '•' : index < currentIdx ? '✅' : index === currentIdx ? '📍' : '⏳';
        return mark + ' **' + stage.title + '**\n' + stage.summary;
      });
      const stageButtons = slice.map(s => nav('📖 ' + s.shortTitle, 'stage.' + s.id + '.' + pageNum));
      const pager = [];
      if (pageNum > 0) pager.push(nav('← Назад', 'stages.' + (pageNum - 1)));
      if (pageNum < totalPages - 1) pager.push(nav('Далее →', 'stages.' + (pageNum + 1)));
      return screen(['📅 **Этапы восстановления**', ...rows,
        '✅ Пройдено · 📍 Сейчас · ⏳ Впереди\nОтметки показывают только время (1 мес. = 30 дн., год = 365 дн.), а не состояние органов.',
        'Страница ' + (pageNum + 1) + ' из ' + totalPages].join('\n\n'),
        stageButtons.slice(0, 2), stageButtons.slice(2), pager,
        [nav(evidenceLabel, 'sources.recovery')], [nav('🫀 К восстановлению', 'recovery')], menuButton);
    }
    case 'stage': {
      const stage = recoveryStages.find(s => s.id === arg) ?? recoveryStages[0];
      const pageNum = Math.max(0, Number(other) || 0);
      const stats = recoveryStats(state, now);
      const days = (stats?.current ?? 0) / DAY;
      const currentIdx = stats ? recoveryStages.findLastIndex(s => days >= s.minDays) : -1;
      const stageIdx = recoveryStages.indexOf(stage);
      const status = !stats ? null
        : stageIdx < currentIdx ? '✅ Этот временной этап пройден'
        : stageIdx === currentIdx ? '📍 Твой текущий период'
        : '⏳ Ориентир впереди · осталось **' + duration(stage.minDays * DAY - stats.current, true) + '**';
      const stageFacts = stage.factIds.map(fid => recoveryFacts.find(f => f.id === fid)).filter(Boolean);
      const sourceLinks = stageFacts.map(f => nav('🔬 ' + f.category, 'evidence.' + f.id + '.recovery'));
      return screen(['📅 **' + stage.title + '**', status, ...stageFacts.map(recoveryCard), recoveryNote].filter(Boolean).join('\n\n'),
        ...[0, 2].map(i => sourceLinks.slice(i, i + 2)),
        [nav('← К этапам', 'stages.' + pageNum), nav('🫀 К восстановлению', 'recovery')], menuButton);
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
