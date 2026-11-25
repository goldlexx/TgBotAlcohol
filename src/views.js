import { facts, sources, healthRotation, recoveryMilestones } from '../content/facts.js';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { awardCatalog } from '../content/achievements.js';
import { calculate, MILESTONES } from './calculations.js';
import { drinkName, formatMoney, volume } from './habits.js';
import { DAY, displayTime, observation, today, zoneLabel } from './time.js';
import { emergency, medicalHold, risk, symptoms, privacy } from './safety.js';

export const sections = [
  [['📊 Мой прогресс', 'progress'], ['🆘 Хочу выпить', 'craving']],
  [['🫀 Восстановление', 'recovery'], ['☀️ Жизнь без алкоголя', 'life']],
  [['🏆 Достижения', 'awards'], ['⚙️ Настройки', 'settings']]
];

export const nav = (text, data) => ({ text, callback_data: 'n:' + data });
export const back = (where = 'menu') => [nav('Назад', where)];
export const helpButtons = [nav('⚕️ Мне плохо', 'physical'), nav('🚑 Экстренная помощь', 'emergency')];
export const reportButtons = [[nav('🫀 Здоровье', 'recovery'), nav('📊 Мой прогресс', 'progress')]];
export const screen = (text, ...buttons) => ({ text, buttons });
const menuButton = [nav('Главное меню', 'menu')];
const careButton = [nav('Куда обратиться', 'care')];
export const welcome = screen('☀️ **Счастье без алкоголя**\n\nВ жизни без алкоголя можно открыть для себя что-то новое.\n\nСледи за прогрессом, замечай положительные изменения и находи новые способы радоваться жизни.\n\nБесплатно. Без рекламы. Без осуждения.',
  [nav('☀️ Начать', 'begin'), nav('🆘 Помощь сейчас', 'help')], [nav('🔐 О моих данных', 'privacy')], ...helpButtons.map(b => [b]));
export const help = screen('🆘 **Помощь сейчас**\n\nЕсли физически плохо или нужна срочная помощь, выбери подходящий маршрут.',
  ...helpButtons.map(b => [b]), [nav('Хочу выпить', 'craving'), nav('🔐 О моих данных', 'privacy')], menuButton);
const emergencyView = screen('🚑 **Экстренная помощь**\n\n' + emergency, menuButton);
const riskView = screen('⚕️ **Медицинская помощь**\n\n' + risk, [helpButtons[1]], careButton, menuButton);
const physicalView = screen('⚕️ **Мне физически плохо**\n\n' + symptoms + '\n\n' + risk, [helpButtons[1]], careButton, menuButton);
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
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ' **' + percent + '%**';
}

export function statsFor(state, now) {
  return calculate(state.intervals, state.habits, state.profile.historyZone, now, state.profile.zone);
}
const openEpisode = state => state.episodes.at(-1)?.last === null;
const series = stats => '**' + duration(stats.current) + ' без алкоголя**';
const partial = value => value ? ' (частично)' : '';
const moneyLines = stats => [...stats.money].map(([currency, amount]) =>
  '💰 Сэкономлено: **≈' + formatMoney(amount, currency, true) + '**' + partial(stats.partialCurrencies.has(currency)));
const awardLine = (d, locked = false) => (locked ? '🔒' : awardCatalog[d][0]) + ' ' + label(d) + ' — ' + awardCatalog[d][1];
const nextText = stats => 'До рубежа — **' + duration(stats.next * DAY - stats.current, true) + '**';

export const metricOptions = {
  money: 'Экономия', drinks: 'Невыпитые напитки', weekends: 'Трезвые выходные',
  days: 'Общие трезвые дни', grams: 'Чистый этанол', calories: 'Калории'
};
export const reportMetrics = ['grams', 'calories'];
const portion = ['порция', 'порции', 'порций'];
const beerBottle = ['бутылка пива', 'бутылки пива', 'бутылок пива'];
const drinkUnits = {
  beer: { 330: beerBottle, 500: beerBottle },
  wine: { 150: ['бокал вина', 'бокала вина', 'бокалов вина'], 750: ['бутылка вина', 'бутылки вина', 'бутылок вина'] },
  sparkling: { 150: ['бокал игристого вина', 'бокала игристого вина', 'бокалов игристого вина'],
    750: ['бутылка игристого вина', 'бутылки игристого вина', 'бутылок игристого вина'] }
};
const drinkGenitives = { beer: 'пива', wine: 'вина', sparkling: 'игристого вина', vodka: 'водки',
  whisky: 'виски', brandy: 'коньяка', cocktail: 'коктейля', other: 'другого напитка' };
const formatVolume = new Intl.NumberFormat('ru', { maximumFractionDigits: 4 });
function drinkLine(key, amount) {
  const [drink, ml] = JSON.parse(key);
  const count = Math.round(amount.toNumber());
  const forms = drinkUnits[drink]?.[ml];
  const index = { one: 0, few: 1, many: 2 }[plurals.select(count)] ?? 2;
  const unit = forms?.[index] ?? portion[index] + ' ' + (drinkGenitives[drink] ?? 'напитка');
  return '**≈' + number.format(count) + ' ' + unit + '** по ' + formatVolume.format(ml) + ' мл';
}

function metricLines(profile, stats, mode) {
  const enabled = profile.metrics ?? {};
  const limit = mode === 'morning' ? 3 : mode === 'progress' ? 16 : Infinity;
  const lines = enabled.money === false ? [] : moneyLines(stats).slice(0, limit);
  if (enabled.drinks !== false && stats.drinks.size) {
    const drinks = [...stats.drinks].slice(0, limit).map(([key, amount]) => drinkLine(key, amount));
    const more = stats.drinks.size > limit ? '\nЕщё ' + (stats.drinks.size - limit) + ' в подробной статистике' : '';
    lines.push('🥤 Не выпито' + partial(stats.partialDrinks) + ':' + (drinks.length > 1 ? '\n' : ' ') + drinks.join('\n') + more);
  }
  if (mode !== 'morning' && enabled.days !== false) lines.push('📅 Всего трезвых дней: **' + number.format(stats.days) + '**');
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
  if (!paused && (mode === 'progress' || (!state.neutral && !medicalHold(state.profile)))) {
    if (stats.next) lines.push('🎯 Следующий рубеж — ' + label(stats.next) + '\n\n' + bar(stats.percent) + '\n' + nextText(stats));
    const goal = state.profile.goal;
    if (goal && !state.neutral && mode !== 'morning') lines.push(stats.current >= goal * DAY ? '🎯 Личная цель достигнута'
      : '🎯 Личная цель — ' + label(goal) + ' · осталось ' + duration(goal * DAY - stats.current, true));
  }
  lines.push(...metricLines(state.profile, stats, mode === 'morning' ? mode : 'progress'));
  if (mode !== 'morning') lines.push('🏆 Достижения: **' + stats.awards.length + ' из ' + MILESTONES.length + '**');
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

export function report(state, now, id, milestone, day, afterEpisode = false) {
  if (!state.profile) return screen('☀️ **Утренний отчёт**\n\nНачни отслеживание, чтобы увидеть свой отчёт.', [nav('☀️ Начать', 'begin')]);
  if (openEpisode(state)) return screen('☀️ **Утренний отчёт на паузе**\n\nОтмечен продолжающийся эпизод.', [nav('📅 История', 'history')], ...helpButtons.map(b => [b]));
  if (medicalHold(state.profile)) return screen('☀️ **Утренний отчёт**\n\n' + progressText(state, statsFor(state, now), 'morning'), ...reportButtons);
  if (state.profile.privatePush || state.neutral) return screen('Твой отчёт готов', [nav('Открыть статистику', 'progress')]);
  const stats = statsFor(state, now);
  const p = state.profile;
  const greeting = afterEpisode ? '☀️ **Твой путь продолжается**' : milestone
    ? '🏆 **' + awardCatalog[milestone][2] + '**\n\nСегодня новый рубеж.' : '☀️ **Доброе утро!**';
  const lines = [greeting, progressText(state, stats, 'morning')];
  if (!afterEpisode && ['fact', 'both'].includes(p.content)) lines.push('🫀 **Факт о здоровье**\n\n' + pick(healthRotation, day, id).text);
  if (!afterEpisode && ['idea', 'both'].includes(p.content)) lines.push('💡 **Идея дня**\n\n' + idea(day, id));
  return screen(lines.join('\n\n'), ...reportButtons);
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
const cause = { work: '💼 После работы', company: '👥 В компании', stress: '😟 Стресс', habit: '🔄 Скука или привычка' };
const causeTitle = { work: '💼 Вечер после работы', company: '👥 Тяга в компании', stress: '😟 Напряжённый момент', habit: '🔄 Меняем привычный ритуал' };
const noteEpisode = nav('📝 Отметить эпизод', 'episode');
const contentNames = { both: 'статистика, факт и идея', fact: 'статистика и факт', idea: 'статистика и идея', numbers: 'только статистика' };
const recoveryEmoji = { Сон: '😴', Давление: '❤️', Печень: '🫀', Память: '🧠', Внимание: '🧠', Вес: '⚖️', 'Обмен веществ': '🌿', Энергия: '☀️' };

function cravingStats(state, now) {
  if (!state.profile || openEpisode(state) || medicalHold(state.profile)) return '';
  const stats = statsFor(state, now);
  return [series(stats), ...moneyLines(stats), '🏆 Наград получено: **' + stats.awards.length + '**'].join('\n');
}

export function view(route, state, now, id) {
  const [page, arg, other] = route.split('.');
  const p = state.profile;
  const stats = ['progress', 'details', 'awards', 'recovery'].includes(page) && p ? statsFor(state, now) : null;
  const day = today(now, p?.zone ?? 'UTC');
  switch (page) {
    case 'menu': return p ? screen('☀️ **Счастье без алкоголя**', ...helpButtons.map(b => [b])) : welcome;
    case 'help': return { ...help, readOnly: true };
    case 'emergency': return { ...emergencyView, readOnly: true };
    case 'physical': return { ...physicalView, readOnly: true };
    case 'care': return { ...screen('⚕️ **Куда обратиться**\n\n' + risk +
      '\n\nДля оценки сегодня обратись к врачу или в отделение неотложной помощи. Обсудить помощь при зависимости можно с врачом-наркологом.',
      [helpButtons[1]], menuButton), readOnly: true };
    case 'privacy': return screen('🔐 **Мои данные**\n\n' + privacy, [p && offButton(state), nav('Удалить данные', 'delete')].filter(Boolean), back('settings'));
    case 'morning': return { ...report(state, now, id, null, day), readOnly: true };
    case 'progress': {
      if (!p) return screen('☀️ **Мой прогресс**\n\nНачни отслеживание, чтобы видеть свой прогресс.', [nav('☀️ Начать', 'begin')], helpButtons);
      return screen((arg === 'new' ? '☀️ **Твой путь начался!**' : '☀️ **Мой прогресс**') + '\n\n' + progressText(state, stats, arg === 'new' ? 'onboarding' : 'progress'),
        [nav('📊 Подробная статистика', 'details')], [nav('📅 История', 'history'), nav('ℹ️ Как считаем', 'method.progress')],
        [noteEpisode], openEpisode(state) ? [nav('Завершить эпизод', 'episode.time')] : []);
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
      ].filter(Boolean).join('\n\n'), chunk.buttons, [nav('ℹ️ Как считаем', 'method.details')], back('progress'));
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
      const costs = h?.items.filter(row => row.price !== null) ?? [];
      const period = h?.period === 28 ? ' за 28 дней' : ' за неделю';
      const spend = h?.budget ?? (costs.length ? costs.reduce((n, row) => n + row.portions * row.price, 0) : null);
      return screen([
        '⚙️ **Настройки**\n', '📅 Последнее употребление: ' + date,
        '📊 Прежняя привычка: ' + (summary.length ? summary.slice(0, 4).join(', ') + period + (summary.length > 4 ? ' и другие' : '') : 'напитки не указаны'),
        '💰 Расходы: ' + (spend === null ? 'не указаны' : '≈' + formatMoney(spend, h.currency, true) + period + (h.budget === null && costs.length < h.items.length ? ' (частично)' : '')),
        '🔔 Утренний отчёт: ' + freq[p.frequency] + (p.frequency === 'off' ? '' : ' в ' + p.clock),
        '🌍 Часовой пояс: ' + zoneLabel(p.zone, now), '🎯 Цель: ' + (state.neutral ? 'нейтральный режим' : p.goal ? label(p.goal) : 'без ограничений')
      ].join('\n'),
      [nav('📅 Дата и история', 'history'), nav('📊 Прежняя привычка', 'edit.habit')],
      [nav('💰 Расчёт экономии', 'edit.mode'), nav('🎯 Моя цель', 'edit.goal')],
      [nav('🔔 Уведомления', 'notifications'), nav('🌍 Часовой пояс', 'edit.zone')],
      [nav('📊 Показатели прогресса', 'metrics')],
      [nav('ℹ️ Как считаем', 'method.settings'), nav('🔐 Мои данные', 'privacy')],
        [noteEpisode], [nav('🆘 Медицинская помощь', 'help')], ...helpButtons.map(b => [b]), back());
    }
    case 'notifications':
      if (!p) return welcome;
      return screen('🔔 **Уведомления**\n\nУтренний отчёт: ' + freq[p.frequency] + (p.frequency === 'off' ? '' : ' в ' + p.clock) +
        (medicalHold(p) ? '\nАвтоматическая отправка на паузе.' : '') +
        '\nСодержание: ' + (state.neutral ? 'нейтральное' : contentNames[p.content]) +
        '\nПревью: ' + (p.privatePush || state.neutral ? 'Твой отчёт готов' : 'обычный отчёт'),
      [nav(p.frequency === 'off' ? 'Включить отчёты' : 'Частота и время', 'edit.notify')],
      state.neutral ? [] : [nav('Содержание', 'edit.content'), nav('Формат превью', 'edit.push')],
      p.frequency === 'off' ? [] : [offButton(state)], [nav('Посмотреть отчёт', 'morning')], back('settings'));
    case 'history': {
      if (!p) return welcome;
      const rows = state.episodes.map(e => ({ id: e.id, text: displayTime(e.start, p.historyZone) + ' → ' +
        (e.last === null ? 'продолжается' : observation({ ms: e.last, precision: e.precision }, p.historyZone)) })).reverse();
      rows.push({ id: 'base', text: 'Начало отслеживания · ' + observation(p.base, p.historyZone) });
      const chunk = paginate(rows, arg, 'history');
      return screen('📅 **История прогресса**\n\n' + zoneLabel(p.historyZone, now) + '\nПолных трезвых дней: **' + statsFor(state, now).days + '**\n\n' +
        chunk.rows.map(row => row.text).join('\n'), ...chunk.rows.map(row => [nav(row.id === 'base' ? 'Исправить начальную дату' : 'Исправить · ' + row.text.slice(0, 17), 'correct.' + row.id)]),
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
        awards.length ? '✅ **Полученные награды**\n\n' + awards.map(d => awardLine(d)).join('\n') : '',
        future.length ? '🎯 **Впереди**\n\n' + future.map(d => awardLine(d, true)).join('\n') : '🎉 Коллекция собрана!'];
      const nextAward = future[0];
      if (p && !state.neutral && !openEpisode(state) && nextAward > stats.current / DAY) {
        lines.push('🎁 До следующей награды — **' + duration(nextAward * DAY - stats.current, true) + '**');
      }
      return screen(lines.filter(Boolean).join('\n\n'), back());
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
    case 'craving': return state.neutral || openEpisode(state) ? riskView : screen(['🆘 **Хочется выпить?**', cravingStats(state, now),
      '**Не нужно принимать решение на всю жизнь. Достаточно не пить сейчас.**',
      'Если это привычная тяга, попробуй сменить обстановку и отложить решение на несколько минут. Если физически плохо, выбери медицинскую помощь.',
      'Что вызвало желание выпить?'].filter(Boolean).join('\n\n'),
      [nav(cause.work, 'crave.work'), nav(cause.company, 'crave.company')], [nav(cause.stress, 'crave.stress'), nav(cause.habit, 'crave.habit')],
      [nav('✅ Отпустило', 'relief')], [noteEpisode], ...helpButtons.map(b => [b]), back());
    case 'crave': {
      if (state.neutral || openEpisode(state)) return riskView;
      if (!Object.hasOwn(cravings, arg)) return view('craving', state, now, id);
      const list = cravings[arg], offset = offsetFor(other, list.length);
      return screen('**' + causeTitle[arg] + '**\n\n**Попробуй сейчас**\n\n' + pick(list, day, id, offset) +
        '\n\nЕсли физически плохо, выбери медицинскую помощь.' +
        (p ? '\n\n☀️ ' + series(statsFor(state, now)) : ''),
      [nav('✅ Отпустило', 'relief'), nav('💡 Другой совет', 'crave.' + arg + '.' + ((offset + 1) % list.length))],
      [noteEpisode], helpButtons, back('craving'));
    }
    case 'relief': return state.neutral || openEpisode(state) ? riskView : screen('Ещё одна волна позади. Продолжай в своём темпе. ☀️', back('craving'));
    case 'recovery': {
      const elapsed = (stats?.current ?? 0) / DAY;
      const current = recoveryMilestones.filter(f => f.days <= elapsed).slice(-2);
      const next = recoveryMilestones.filter(f => f.days > elapsed).slice(0, 3);
      const lines = entries => entries.map(f => (recoveryEmoji[f.category] ?? '🌿') + ' **' + f.category + '** — ' + f.text).join('\n');
      return screen(['🫀 **Восстановление организма**', stats && !openEpisode(state) ? series(stats) : '',
        '🌱 **На этом этапе**\n\n' + lines(current.length ? current : [facts.find(f => f.id === 'sleep-quality')]),
        next.length ? '🎯 **Что может измениться дальше**\n\n' + lines(next) : '',
        'Это ориентиры из исследований. Темпы восстановления индивидуальны.'].filter(Boolean).join('\n\n'),
      [nav('📅 Все этапы восстановления', 'stages')], [nav('ℹ️ Методика и источники', 'method.recovery')], back());
    }
    case 'stages': {
      const chunk = paginate(facts, arg, 'stages', 4);
      return screen('🫀 **Наблюдения о восстановлении**\n\n' + chunk.rows.map(f => '**' + f.category + '**\n' + f.text).join('\n\n'),
        chunk.buttons, [nav('🔬 Научные источники', 'sources.recovery')], back('recovery'));
    }
    case 'method': return screen('ℹ️ **Как считаем**\n\n💰 Экономия и 🥤 невыпитые порции — оценки по прежней привычке и указанным объёмам.\n⚖️ Чистый этанол — по объёму и крепости напитков.\n🔥 Калории — по энергетической ценности этанола.\n📅 Трезвые дни и выходные — по указанной истории употребления.',
      [nav('📖 Методика расчётов', 'formulas'), nav('🔬 Научные источники', 'sources.method')], back(['progress', 'details', 'settings', 'recovery'].includes(arg) ? arg : 'menu'));
    case 'formulas': return screen('📖 **Методика расчётов**\n\nСутки серии — 24 часа. Трезвый день — целая местная дата внутри известного периода воздержания. Выходные — полностью завершённые суббота и воскресенье внутри одного такого периода. Если известно только число, отсчёт начинается со следующей полуночи.\n\n**Чистый этанол** = порции × мл × крепость / 100 × 0,789 г по каждому напитку. Энергия этанола = граммы × 7. В эту цифру входит только этанол.\n\n**Пример**\n1 400 ₽ и 7 порций за неделю дают ≈200 ₽ и ≈1 порцию за каждые 24 часа. Так работает среднесуточная оценка. В календарном расчёте засчитываются полные дни по указанному графику. Порции разных видов и объёмов показываются отдельно.\n\nПри смене привычки прежние оценки сохраняются по её прошлой версии. Расходы самого эпизода не вычитаются. При неполных сведениях оценка может быть частичной. Рубежи в годах считаются по 365 суток.',
      [nav('🔬 Научные источники', 'sources.method')], back('method'));
    case 'sources': {
      const chunk = paginate(Object.values(sources), other, 'sources.' + (arg ?? 'method'), 5);
      return screen('🔬 **Научные источники**\n\n' + [...Map.groupBy(chunk.rows, row => row[0])].map(([section, rows]) =>
        '**' + section + '**\n' + rows.map(([, text, url]) => text + '\n' + url).join('\n')).join('\n\n'),
        chunk.buttons, back(arg === 'recovery' ? 'recovery' : 'method'));
    }
    default: return screen('Это меню устарело. Открой нужный раздел ещё раз.', back());
  }
}
