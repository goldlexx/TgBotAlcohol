import { facts, sources } from '../content/facts.js';
import { ideas, cravings } from '../content/ideas.js';
import { calculate, MILESTONES } from './calculations.js';
import { digits } from './habits.js';
import { DAY, displayTime, observation, today } from './time.js';
import { emergency, risk, privacy } from './safety.js';

export const sections = [
  [['📊 Мой прогресс', 'progress'], ['🆘 Хочу выпить', 'craving']],
  [['🫀 Восстановление', 'recovery'], ['☀️ Жизнь без алкоголя', 'life']],
  [['🏆 Достижения', 'awards'], ['⚙️ Настройки', 'settings']]
];

export const nav = (text, data) => ({ text, callback_data: 'n:' + data });
export const back = (where = 'menu') => [nav('Назад', where)];
export const helpButtons = [nav('Мне физически плохо', 'physical'), nav('Экстренная помощь', 'emergency')];
export const reportButtons = [[nav('Мой прогресс', 'progress'), nav('Восстановление', 'recovery'), nav('Как считаем', 'method')]];
export const screen = (text, ...buttons) => ({ text, buttons });
export const welcome = screen('☀️ Счастье без алкоголя\nСледи за своими днями, замечай положительные изменения и находи новые способы радоваться жизни. Бесплатно.',
  [nav('Начать', 'begin'), nav('Помощь сейчас', 'help'), nav('О данных', 'privacy')], helpButtons);
export const help = screen('Если физически плохо или нужна срочная помощь, выбери подходящий маршрут.',
  helpButtons, [nav('Хочу выпить', 'craving'), nav('О данных', 'privacy')], back());
export const emergencyView = screen(emergency, back('help'));
export const riskView = screen(risk, [nav('Экстренная помощь', 'emergency')], back('help'));
const offButton = state => nav('Отключить уведомления', 'off.' + state.user.generation);

const number = new Intl.NumberFormat('ru', { maximumFractionDigits: 0 });
function plural(n, words) {
  const ending = new Intl.PluralRules('ru').select(n);
  return n + ' ' + (words[ending] ?? words.many);
}
const label = n => n === 1 ? '24 часа' : n >= 730 ? (n / 365) + (n === 1825 ? ' лет' : ' года')
  : plural(n, { one: 'день', few: 'дня', many: 'дней' });
export function duration(ms) {
  const d = Math.floor(ms / DAY), h = Math.floor(ms % DAY / 3_600_000);
  return [d && plural(d, { one: 'день', few: 'дня', many: 'дней' }),
    plural(h, { one: 'час', few: 'часа', many: 'часов' })].filter(Boolean).join(' ');
}

export function statsFor(state, now) {
  return calculate(state.intervals, state.habits, state.profile.historyZone, now);
}
function progressText(state, stats, report = false) {
  const p = state.profile;
  const paused = state.episodes.at(-1)?.last === null;
  const lines = [paused ? 'Серия на паузе' : duration(stats.current) + ' без алкоголя'];
  if (!state.neutral && !paused) {
    if (p.goal) lines.push(stats.current >= p.goal * DAY ? '🎯 Цель достигнута'
      : '🎯 Цель ' + label(p.goal) + ' · осталось ' + duration(p.goal * DAY - stats.current));
    const blocks = Math.round(stats.percent / 10);
    lines.push('▓'.repeat(blocks) + '░'.repeat(10 - blocks) + ' ' + stats.percent + '%');
  }
  if (state.episodes.length) lines.push('Полных трезвых дней за всю историю: ' + stats.days);
  const partial = value => value ? ' (частично)' : '';
  for (const [currency, amount] of stats.money) {
    const formatted = new Intl.NumberFormat('ru', { style: 'currency', currency, maximumFractionDigits: 0 })
      .format(amount.div(10 ** digits(currency)).toNumber());
    lines.push('💰 ' + (report ? 'Сэкономлено' : 'По прежним расходам') + ': ≈ ' + formatted + partial(stats.partialCurrencies.has(currency)));
  }
  if (stats.grams !== null && !report) lines.push('⚖️ Не употреблено этанола: ≈ ' + number.format(stats.grams.toNumber()) + ' г' + partial(stats.partialGrams));
  if (stats.calories !== undefined) lines.push('🔥 Калории из этанола: ≈ ' + number.format(stats.calories.toNumber()) + ' ккал' + partial(stats.partialGrams));
  if (!report) lines.push('🏆 Награды: ' + stats.awards.length + (stats.next ? ' · далее ' + label(stats.next) : ''));
  return lines.join('\n');
}

function pick(list, day, id, offset = 0) {
  const serial = Math.floor(Date.parse(day) / DAY);
  return list[((serial + (id % 997) + offset) % list.length + list.length) % list.length];
}
function idea(day, id, group, offset) {
  return pick(group ? ideas.filter(row => row.category === group) : ideas, day, id, offset).text;
}

export function report(state, now, id, milestone, day) {
  if (state.profile.privatePush || state.neutral) return screen('Твой отчёт готов', [nav('Открыть статистику', 'progress')]);
  const stats = statsFor(state, now);
  const p = state.profile;
  const lines = ['☀️ Доброе утро!', progressText(state, stats, true)];
  if (milestone) lines.push('🏆 Новый рубеж · ' + label(milestone));
  if (['fact', 'both'].includes(p.content)) lines.push('🫀 Факт дня\n' + pick(facts, day, id).text);
  if (['idea', 'both'].includes(p.content)) lines.push('🌱 Идея дня\n' + idea(day, id));
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
const freq = { off: 'выключены', daily: 'ежедневно', selected: 'выбранные дни', weekly: 'еженедельно', milestones: 'только рубежи' };
const lifeLabels = [['Вечер без алкоголя', 'evening'], ['Встреча с друзьями', 'company'], ['Отдых после работы', 'work'], ['Новые привычки', 'habit']];

export function view(route, state, now, id) {
  const [page, arg, other] = route.split('.');
  const p = state.profile;
  const stats = ['progress', 'awards', 'crave', 'recovery'].includes(page) && p ? statsFor(state, now) : null;
  const day = today(now, p?.zone ?? 'UTC');
  switch (page) {
    case 'menu': return p ? screen('☀️ Счастье без алкоголя', ...sections.map(row => row.map(([text, target]) => nav(text, target))), helpButtons) : welcome;
    case 'help': return help;
    case 'emergency': return emergencyView;
    case 'privacy': return screen(privacy, [p && offButton(state), nav('Удалить данные', 'delete')].filter(Boolean), back());
    case 'progress': return screen(p?.trackingPaused ? 'Отслеживание на паузе. Сейчас доступна медицинская помощь.' : p ? progressText(state, stats) : 'Начни отслеживание, чтобы видеть свой прогресс.',
      p ? [nav('Все достижения', 'awards'), nav('История', 'history')] : [nav('Начать', 'begin')],
      [nav('Отметить употребление', 'episode'), nav('Как считаем', 'method.progress')], back());
    case 'settings': {
      const h = state.habits.at(-1);
      const latest = state.episodes.at(-1);
      const date = latest ? (latest.last === null ? 'эпизод продолжается' : observation({ ms: latest.last, precision: latest.precision }, p.historyZone)) : p && observation(p.base, p.historyZone);
      return screen(p ? [
        '⚙️ Настройки', 'Последняя дата: ' + date,
        'Привычка: ' + (h ? (h.mode === 'average' ? 'средняя' : 'календарная') + ' · ' + h.currency + (h.budget === null ? ' · строк ' + h.items.length
          : ' · ' + new Intl.NumberFormat('ru', { style: 'currency', currency: h.currency }).format(h.budget / 10 ** digits(h.currency)) + ' за ' + h.period + ' дней') : 'не задана'),
        'Уведомления: ' + freq[p.frequency] + (p.frequency === 'off' ? '' : ' · ' + p.clock), 'Часовой пояс: ' + p.zone,
        'Цель: ' + (state.neutral ? 'нейтральный режим' : p.goal ? label(p.goal) : 'без конечной цели')
      ].join('\n') : '⚙️ Настройки',
      p ? [nav('Дата и история', 'history'), nav('Отметить употребление', 'episode')] : [nav('Начать', 'begin')],
      p ? [nav('Привычка и напитки', 'edit.habit'), nav('Бюджет и валюта', 'edit.budget')] : [],
      p ? [nav('Режим расчёта', 'edit.mode'), nav('Часовой пояс', 'edit.zone')] : [],
      p ? [nav('Цель', 'edit.goal'), nav('Уведомления и контент', 'edit.notify')] : [],
      p && p.frequency !== 'off' ? [offButton(state)] : [],
      [nav('Как считаем', 'method.settings'), nav('Мои данные', 'privacy')], helpButtons, back());
    }
    case 'history': {
      if (!p) return welcome;
      const rows = state.episodes.map(e => ({ id: e.id, text: displayTime(e.start, p.historyZone) + ' → ' + (e.last === null ? 'продолжается' : observation({ ms: e.last, precision: e.precision }, p.historyZone)) })).reverse();
      rows.push({ id: 'base', text: 'Начало отслеживания · ' + observation(p.base, p.historyZone) });
      const chunk = paginate(rows, arg, 'history');
      return screen('История · ' + p.historyZone + '\nПолных трезвых дней: ' + statsFor(state, now).days + '\n\n' +
        chunk.rows.map(row => row.text).join('\n'), ...chunk.rows.map(row => [nav(row.id === 'base' ? 'Исправить начальную дату' : 'Исправить · ' + row.text.slice(0, 16), 'correct.' + row.id)]),
        [nav('Серии без алкоголя', 'periods')], chunk.buttons, back('progress'));
    }
    case 'periods': {
      if (!p) return welcome;
      const chunk = paginate([...state.intervals].reverse(), arg, 'periods');
      return screen('Серии без алкоголя\n\n' + (chunk.rows.map(row => displayTime(row.start, p.historyZone) + ' → ' +
        (row.end === null ? 'сейчас' : displayTime(row.end, p.historyZone))).join('\n') || 'Пока нет известных периодов.'), chunk.buttons, back('history'));
    }
    case 'awards': {
      const awards = stats?.awards ?? [];
      const chunk = paginate(MILESTONES, arg, 'awards');
      return screen('🏆 Достижения · ' + awards.length + ' из ' + MILESTONES.length + (stats?.next ? '\nСледующий рубеж: ' + label(stats.next) : '') +
        '\n\n' + chunk.rows.map(d => (awards.includes(d) ? '🏅 ' : '🔒 ') + label(d)).join('\n'), chunk.buttons, back());
    }
    case 'life': {
      const group = lifeLabels.some(([, key]) => key === arg) ? arg : undefined;
      const offset = (Number(other) || 0) % 32;
      return screen('☀️ Жизнь без алкоголя\nНайди то, что радует.\n\n' + idea(day, id, group, offset),
        ...lifeLabels.map(([text, key]) => [nav(text, 'life.' + key)]),
        [nav('Другая идея', 'life.' + (group ?? 'all') + '.' + (offset + 1))], back());
    }
    case 'craving': return state.neutral ? riskView : screen('🆘 Хочу выпить\nВыбери, что может помочь сейчас.', helpButtons,
      [nav('После работы', 'crave.work'), nav('В компании', 'crave.company')],
      [nav('Стресс', 'crave.stress'), nav('Скука или привычка', 'crave.habit')],
      [nav('Мой прогресс', 'progress'), nav('Отметить употребление', 'episode')], back());
    case 'crave': {
      if (state.neutral) return riskView;
      if (!Object.hasOwn(cravings, arg)) return view('craving', state, now, id);
      const alternate = other === '1' ? 1 : 0;
      return screen(cravings[arg][alternate] + (stats?.current ? '\n\nТекущая серия · ' + duration(stats.current) : ''),
        helpButtons, [nav('Отпустило', 'relief'), nav('Другая идея', 'crave.' + arg + '.' + (1 - alternate))],
        [nav('Отметить употребление', 'episode')], back('craving'));
    }
    case 'relief': return state.neutral ? riskView : screen('Ещё один сложный момент позади.', back('craving'));
    case 'recovery': {
      const elapsed = (stats?.current ?? 0) / DAY;
      const dated = facts.filter(f => f.days !== null);
      const current = dated.filter(f => f.days <= elapsed).slice(-2);
      const next = dated.filter(f => f.days > elapsed).slice(0, 3);
      return screen(['🫀 Восстановление организма', 'Ориентиры из исследований',
        current.length ? 'Что может меняться сейчас\n' + current.map(f => f.text).join('\n') : '',
        next.length ? 'Что впереди\n' + next.map(f => f.text).join('\n') : '',
        !current.length ? facts[0].text : ''].filter(Boolean).join('\n\n'),
      [nav('Все этапы', 'stages'), nav('Научные источники', 'sources.recovery')], [nav('Как считаем', 'method.recovery')], back());
    }
    case 'stages': {
      const chunk = paginate(facts, arg, 'stages', 3);
      return screen(chunk.rows.map(f => f.category + '\n' + f.text).join('\n\n'), chunk.buttons, back('recovery'));
    }
    case 'method': return screen('ℹ️ Как считаем\nДни серии считаются по времени с последнего употребления. Деньги оцениваются по прежней привычке, этанол — по объёму и крепости. Калории — только энергия этанола. Карточки здоровья содержат общие ориентиры.',
      [nav('Подробнее о расчётах', 'formulas'), nav('Научные источники', 'sources.method')], back(['progress', 'settings', 'recovery'].includes(arg) ? arg : 'menu'));
    case 'formulas': return screen('Серия идёт по UTC, сутки — 24 часа. В истории считаются только целые местные даты без употребления. Если известно только число, отсчёт начинается со следующей полуночи.\n\nЭтанол за период = порции × мл × крепость / 100 × 0,789 г по каждой строке. Калории = граммы этанола × 7. Расходы = общий бюджет или сумма цен порций. При неполных сведениях результат может быть частичным.\n\nВ среднем режиме 1400 ₽ за неделю дают ≈ 200 ₽ за каждые 24 часа известного периода. В календарном режиме засчитываются только полные дни по заданному графику.\n\nИстория остаётся после эпизода, расходы эпизода из оценки не вычитаются. При смене привычки прошлые оценки рассчитываются по прежней версии. Фактические расходы и самочувствие могут отличаться. Рубежи в годах считаются по 365 суток.', back('method'));
    case 'sources': return screen('Научные источники\n\n' + [...Map.groupBy(Object.values(sources), row => row[0])].map(([section, rows]) =>
      section + '\n' + rows.map(([, text, url]) => text + '\n' + url).join('\n')).join('\n\n'), back(arg === 'recovery' ? 'recovery' : 'method'));
    default: return screen('Это меню устарело. Открой нужный раздел ещё раз.', back());
  }
}
