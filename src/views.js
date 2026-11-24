import { facts, sources, healthRotation, recoveryMilestones } from '../content/facts.js';
import { ideas, cravings, lifeLabels } from '../content/ideas.js';
import { awardCatalog } from '../content/achievements.js';
import { calculate, MILESTONES } from './calculations.js';
import { drinkName, formatMoney, volume } from './habits.js';
import { DAY, displayTime, observation, today, zoneLabel } from './time.js';
import { emergency, risk, privacy } from './safety.js';

export const sections = [
  [['📊 Мой прогресс', 'progress'], ['🆘 Хочу выпить', 'craving']],
  [['🫀 Восстановление', 'recovery'], ['☀️ Жизнь без алкоголя', 'life']],
  [['🏆 Достижения', 'awards'], ['⚙️ Настройки', 'settings']]
];

export const nav = (text, data) => ({ text, callback_data: 'n:' + data });
export const back = (where = 'menu') => [nav('Назад', where)];
export const helpButtons = [nav('⚕️ Мне физически плохо', 'physical'), nav('🚑 Экстренная помощь', 'emergency')];
export const reportButtons = [[nav('🫀 Здоровье', 'recovery'), nav('📊 Мой прогресс', 'progress')]];
export const screen = (text, ...buttons) => ({ text, buttons });
export const welcome = screen('☀️ **Счастье без алкоголя**\n\nВ жизни без алкоголя можно открыть для себя что-то новое.\n\nСледи за прогрессом, замечай положительные изменения и находи новые способы радоваться жизни.\n\nБесплатно. Без рекламы. Без осуждения.',
  [nav('☀️ Начать', 'begin'), nav('🆘 Помощь сейчас', 'help')], [nav('🔐 О моих данных', 'privacy')], helpButtons);
export const help = screen('🆘 **Помощь сейчас**\n\nЕсли физически плохо или нужна срочная помощь, выбери подходящий маршрут.',
  helpButtons, [nav('Хочу выпить', 'craving'), nav('🔐 О моих данных', 'privacy')], back());
export const emergencyView = screen('🚑 **Экстренная помощь**\n\n' + emergency, back('help'));
export const riskView = screen('⚕️ **Медицинская помощь**\n\n' + risk, [helpButtons[1]], back('help'));
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
  return calculate(state.intervals, state.habits, state.profile.historyZone, now);
}
const openEpisode = state => state.episodes.at(-1)?.last === null;
export const reportPaused = state => state.profile?.trackingPaused || openEpisode(state);
const series = stats => '**' + duration(stats.current) + ' без алкоголя**';
const partial = value => value ? ' (частично)' : '';
const moneyLines = stats => [...stats.money].map(([currency, amount]) =>
  '💰 Сэкономлено: **≈' + formatMoney(amount, currency, true) + '**' + partial(stats.partialCurrencies.has(currency)));
const awardLine = (d, locked = false) => (locked ? '🔒' : awardCatalog[d][0]) + ' ' + label(d) + ' — ' + awardCatalog[d][1];
const nextText = stats => 'До рубежа — **' + duration(stats.next * DAY - stats.current, true) + '**';

function progressText(state, stats, isReport = false) {
  if (state.profile.trackingPaused) return 'Отслеживание на паузе. Сейчас доступна медицинская помощь.';
  const paused = openEpisode(state);
  const lines = [paused ? '**Серия на паузе**' : series(stats)];
  if (!state.neutral && !paused) {
    if (stats.next) lines.push('🎯 Следующий рубеж — ' + label(stats.next) + '\n\n' + bar(stats.percent) + '\n' + nextText(stats));
    const goal = state.profile.goal;
    if (goal && !isReport) lines.push(stats.current >= goal * DAY ? '🎯 Личная цель достигнута'
      : '🎯 Личная цель — ' + label(goal) + ' · осталось ' + duration(goal * DAY - stats.current, true));
  }
  if (state.episodes.length) lines.push('📅 Полных трезвых дней за всю историю: **' + stats.days + '**');
  const metrics = moneyLines(stats);
  if (stats.grams !== null) metrics.push('⚖️ Не употреблено чистого спирта: **≈' +
    number.format(stats.grams.toNumber()) + ' г**' + partial(stats.partialGrams));
  if (stats.calories !== undefined) metrics.push('🔥 Не получено калорий из этанола: **≈' +
    number.format(stats.calories.toNumber()) + ' ккал**' + partial(stats.partialGrams));
  if (metrics.length) lines.push(metrics.join('\n'));
  if (!isReport && !state.neutral) {
    lines.push('🏆 **Твои достижения**\n\n' + (stats.awards.length ? stats.awards.slice(-3).map(d => awardLine(d)).join('\n') : 'Первая награда — за сутки без алкоголя.') +
      (stats.next && !paused ? '\n\n🔒 Следующая награда — ' + awardCatalog[stats.next][1] : ''));
  }
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
  if (reportPaused(state)) return screen('☀️ **Утренний отчёт на паузе**\n\nПосмотри историю или открой медицинскую помощь.', [nav('📅 История', 'history')], helpButtons);
  if (state.profile.privatePush || state.neutral) return screen('Твой отчёт готов', [nav('Открыть статистику', 'progress')]);
  const stats = statsFor(state, now);
  const p = state.profile;
  const greeting = afterEpisode ? '☀️ **Твой путь продолжается**' : milestone
    ? '🏆 **' + awardCatalog[milestone][2] + '**\n\nСегодня новый рубеж.' : '☀️ **Доброе утро!**';
  const lines = [greeting, progressText(state, stats, true)];
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
const noteEpisode = nav('📝 Отметить употребление', 'episode');
const progressButtons = [nav('📅 История прогресса', 'history'), noteEpisode];
const contentNames = { both: 'статистика, факт и идея', fact: 'статистика и факт', idea: 'статистика и идея', numbers: 'только статистика' };
const recoveryEmoji = { Сон: '😴', Давление: '❤️', Печень: '🫀', Память: '🧠', Внимание: '🧠', Вес: '⚖️', 'Обмен веществ': '🌿', Энергия: '☀️' };

function cravingStats(state, now) {
  if (!state.profile || reportPaused(state)) return '';
  const stats = statsFor(state, now);
  return [series(stats), ...moneyLines(stats), '🏆 Наград получено: **' + stats.awards.length + '**'].join('\n');
}

export function view(route, state, now, id) {
  const [page, arg, other] = route.split('.');
  const p = state.profile;
  const stats = ['progress', 'awards', 'recovery'].includes(page) && p ? statsFor(state, now) : null;
  const day = today(now, p?.zone ?? 'UTC');
  switch (page) {
    case 'menu': return p ? screen('☀️ **Счастье без алкоголя**', ...sections.map(row => row.map(([text, target]) => nav(text, target))), helpButtons) : welcome;
    case 'help': return help;
    case 'emergency': return emergencyView;
    case 'privacy': return screen('🔐 **Мои данные**\n\n' + privacy, [p && offButton(state), nav('Удалить данные', 'delete')].filter(Boolean), back('settings'));
    case 'morning': return { ...report(state, now, id, null, day), readOnly: true };
    case 'progress': {
      if (!p) return screen('☀️ **Мой прогресс**\n\nНачни отслеживание, чтобы видеть свой прогресс.', [nav('☀️ Начать', 'begin')], helpButtons);
      const setup = arg !== 'new' && !state.neutral && !reportPaused(state) && (!stats.money.size || stats.grams === null);
      return screen((arg === 'new' ? '☀️ **Твой путь начался!**' : '☀️ **Мой прогресс**') + '\n\n' + progressText(state, stats) +
        (setup ? '\n\nХочешь дополнить прогресс расчётом экономии и статистикой?' : ''),
      progressButtons, [nav('ℹ️ Как считаем', 'method.progress')],
      setup ? [nav('💰 Настроить статистику', 'edit.habit')] : [],
      arg === 'new' && !state.neutral ? [nav('🔔 Настроить утренние отчёты', 'edit.notify')] : [],
      reportPaused(state) ? helpButtons : []);
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
      [nav('ℹ️ Как считаем', 'method.settings'), nav('🔐 Мои данные', 'privacy')],
      [noteEpisode], [nav('🆘 Медицинская помощь', 'help')], helpButtons, back());
    }
    case 'notifications':
      if (!p) return welcome;
      return screen('🔔 **Уведомления**\n\nУтренний отчёт: ' + freq[p.frequency] + (p.frequency === 'off' ? '' : ' в ' + p.clock) +
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
      if (p && !state.neutral && !reportPaused(state) && nextAward) {
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
      [nav('✅ Отпустило', 'relief'), noteEpisode], helpButtons, back());
    case 'crave': {
      if (state.neutral || openEpisode(state)) return riskView;
      if (!Object.hasOwn(cravings, arg)) return view('craving', state, now, id);
      const list = cravings[arg], offset = offsetFor(other, list.length);
      return screen('**' + causeTitle[arg] + '**\n\n**Попробуй сейчас**\n\n' + pick(list, day, id, offset) +
        '\n\nЕсли физически плохо, выбери медицинскую помощь.' +
        (p && !reportPaused(state) ? '\n\n☀️ ' + series(statsFor(state, now)) : ''),
      [nav('✅ Отпустило', 'relief'), nav('💡 Другой совет', 'crave.' + arg + '.' + ((offset + 1) % list.length))],
      [noteEpisode], helpButtons, back('craving'));
    }
    case 'relief': return state.neutral || openEpisode(state) ? riskView : screen('Ещё одна волна позади. Продолжай в своём темпе. ☀️', back('craving'));
    case 'recovery': {
      const elapsed = (stats?.current ?? 0) / DAY;
      const current = recoveryMilestones.filter(f => f.days <= elapsed).slice(-2);
      const next = recoveryMilestones.filter(f => f.days > elapsed).slice(0, 3);
      const lines = entries => entries.map(f => (recoveryEmoji[f.category] ?? '🌿') + ' **' + f.category + '** — ' + f.text).join('\n');
      return screen(['🫀 **Восстановление организма**', stats && !reportPaused(state) ? series(stats) : '',
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
    case 'method': return screen('ℹ️ **Как считаем**\n\nВсе показатели опираются на твою прежнюю привычку и время без алкоголя.\n\n💰 Экономия — по прежним расходам.\n⚖️ Чистый спирт — по объёму и крепости напитков.\n🔥 Калории — по энергетической ценности этанола.\n📅 Трезвые дни — по указанной истории употребления.\n\nЭкономия, этанол и калории оцениваются приблизительно.',
      [nav('📖 Методика расчётов', 'formulas'), nav('🔬 Научные источники', 'sources.method')], back(['progress', 'settings', 'recovery'].includes(arg) ? arg : 'menu'));
    case 'formulas': return screen('📖 **Методика расчётов**\n\nСутки серии — 24 часа. В истории считаются целые местные даты без употребления. Если известно только число, отсчёт начинается со следующей полуночи.\n\n**Чистый спирт** = порции × мл × крепость / 100 × 0,789 г по каждому напитку. Энергия этанола = граммы × 7. В эту цифру входит только этанол.\n\n**Пример**\n1 400 ₽ за неделю дают ≈200 ₽ за каждые 24 часа. Так работает среднесуточная оценка. В календарном расчёте засчитывается полный день по указанному графику.\n\nПри смене привычки прежние оценки сохраняются по её прошлой версии. Расходы самого эпизода не вычитаются. При неполных сведениях оценка может быть частичной. Рубежи в годах считаются по 365 суток.',
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
