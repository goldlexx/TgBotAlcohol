import { DAY, localDay, midnight, observation, parseDate, validClock, zoneName } from './time.js';
import { timeline } from './history.js';
import { saveTimeline, saveAwards, saveHabit, reschedule } from './storage.js';
import { achievements } from './calculations.js';
import { parseHabit, presets } from './habits.js';
import { slotFor } from './schedule.js';
import { preview, symptoms, riskHistory, risk } from './safety.js';
import { back, helpButtons, nav, screen, sections, view, welcome } from './views.js';

export const keys = new Map(sections.flat().map(([text, route]) => [text, route]));
export const defaults = { goal: null, frequency: 'off', weekdays: [1], clock: '08:00', content: 'both', privatePush: false };
const zones = [['Москва', 'Europe/Moscow'], ['Калининград', 'Europe/Kaliningrad'], ['Екатеринбург', 'Asia/Yekaterinburg'], ['Новосибирск', 'Asia/Novosibirsk'], ['Владивосток', 'Asia/Vladivostok'], ['UTC', 'UTC']];
const weekdays = 'Пн Вт Ср Чт Пт Сб Вс'.split(' ');
const contents = [['Факт о здоровье', 'fact'], ['Идея для жизни', 'idea'], ['Оба', 'both'], ['Только цифры', 'numbers']];
const episodeModes = ['active', 'complete', 'correct'];
const currentHabit = state => state.habits.at(-1);

function enter(state, step, data = {}) {
  state.changed = true;
  state.fsm = { ...data, step, token: crypto.randomUUID().slice(0, 12) };
}
function finish(state) {
  state.changed = true;
  state.fsm = {};
}

function prompt(state, correction = '') {
  const f = state.fsm;
  const button = (text, action) => ({ text, callback_data: f.token + ':' + action });
  const origin = f.flow === 'new' ? 'menu' : episodeModes.includes(f.flow) ? 'history' : 'settings';
  const cancel = [nav('Отмена', 'cancel.' + origin)];
  const form = (text, ...rows) => screen(correction ? correction + '\n\n' + text : text, ...rows, cancel);
  const presetRows = names => names.map(([text, action]) => [button(text, action)]);
  const zone = f.zone ?? state.profile?.historyZone;
  switch (f.step) {
    case 'check': return form('Для статистики бот хранит введённые данные. ' + preview + ' Подробнее в /privacy.\n\n' + symptoms,
      [button('Есть симптомы', 'urgent'), button('Симптомов сейчас нет', 'next')],
      [button('Не уверен(а)', 'urgent'), nav('Экстренная помощь', 'emergency')]);
    case 'background': return form(riskHistory, [button('Да / Не уверен(а)', 'risk'), button('Нет', 'next')], helpButtons);
    case 'paused': return form(risk + '\n\nПосле обращения за профессиональной помощью можешь выбрать нейтральное отслеживание уже происходящего воздержания.',
      [nav('Экстренная помощь', 'emergency')], [button('Есть профессиональная помощь · нейтральный режим', 'neutral')]);
    case 'zone': return form('Выбери город или введи часовой пояс IANA, например Europe/Moscow.', ...presetRows(zones));
    case 'date': case 'episodeStart': return form((f.step === 'episodeStart' ? 'Когда началось употребление?' : 'Когда был последний алкоголь?') + ' Часовой пояс ' + zone + '.',
      [button('Сейчас', 'now'), button('Указать дату и время', 'minute')],
      [button('Помню только дату', 'day'), ...(f.step === 'episodeStart' && f.last ? [button('Одиночный эпизод', 'single')] : [])]);
    case 'dateInput': return form(f.precision === 'day'
      ? 'Введи дату в формате ГГГГ-ММ-ДД. Для последнего употребления отсчёт начнётся со следующего местного дня.'
      : 'Введи ГГГГ-ММ-ДД ЧЧ:ММ. Если в этот день часы переводились назад и время повторилось, добавь 1 для первого или 2 для второго вхождения.',
      [button('Назад', 'back')]);
    case 'habitChoice': return form('Хочешь считать расходы и количество алкоголя по прежней привычке?',
      [button('Быстрая настройка', 'average'), button('Только расходы', 'budget')],
      f.flow === 'new' ? [button('Пропустить', 'skip'), button('Назад', 'back')] : [button('Календарный режим', 'calendar'), button('Отключить оценку', 'skip')],
      f.flow === 'new' || !currentHabit(state) ? [] : [nav('Исправить прошлую версию', 'habits')]);
    case 'budget': return form('Введи период, валюту и бюджет за период. Например: 7 RUB 1400. Можно выбрать 7 или 28 дней и указать код валюты, например EUR.' +
      (f.keepDrinks ? ' Сохраним строки напитков. Для прежних порций используй период ' + currentHabit(state).period + ' дней.' : ''), [button('Назад', 'back')]);
    case 'habit': return form(f.mode === 'calendar'
      ? 'Если прежние дни недели известны, в первой строке введи «7 RUB», а ниже — день недели (1 — понедельник), порции, мл, крепость %, цена порции. Пример строки: 6 1 200 40 240. Для одного только бюджета на день: 6 1 - - 240.'
      : 'В первой строке укажи период (7 или 28) и валюту, например «7 RUB». Общий бюджет можно указать третьим числом. Ниже — по строке на напиток: порции за период, мл, крепость %, цена порции. Неизвестные поля обозначь «-». При общем бюджете пропусти цены.',
      f.mode === 'average' ? [button('Пресеты объёма и крепости', 'presets')] : [], [button('Назад', 'back')]);
    case 'presets': return form('Пресеты для заполнения строки. Замени объём и крепость своими значениями.', ...presetRows(presets), [button('Назад', 'back')]);
    case 'habitConfirm': return form(f.correction !== undefined
      ? 'Пересчитать прошлые оценки по выбранной версии привычки? Это изменит затронутую историю.'
      : 'Сохранить привычку с текущего момента? Прежние оценки останутся.',
      [button('Подтвердить', 'save'), button('Назад', 'back')]);
    case 'goal': return form('Выбрать цель? После неё счётчик продолжит работать.', [button('7 дней', '7'), button('30 дней', '30'), button('90 дней', '90')],
      [button('Без конечной цели', 'none'), ...(f.flow === 'new' ? [button('Назад', 'back')] : [])]);
    case 'notify': return form('Присылать отчёт по утрам? ' + preview,
      [button('Каждый день в 08:00', 'daily8'), button('Другая частота/время', 'custom')],
      [button('Нет', 'off'), ...(f.flow === 'new' && !state.neutral ? [button('Назад', 'back')] : [])]);
    case 'frequency': return form('Как часто присылать отчёт?',
      [button('Ежедневно', 'daily'), button('Выбранные дни', 'selected')],
      [button('Еженедельно', 'weekly'), ...(!state.neutral ? [button('Только рубежи', 'milestones')] : [])],
      [button('Назад', 'back')]);
    case 'weekdays': return form('Выбери ' + (f.frequency === 'weekly' ? 'один день.' : 'дни недели.'),
      weekdays.slice(0, 4).map((d, i) => button((f.weekdays.includes(i + 1) ? '✓ ' : '') + d, String(i + 1))),
      weekdays.slice(4).map((d, i) => button((f.weekdays.includes(i + 5) ? '✓ ' : '') + d, String(i + 5))),
      [button('Готово', 'next'), button('Назад', 'back')]);
    case 'clock': return form('Введи местное время в формате ЧЧ:ММ.', [button('08:00', 'default'), button('Назад', 'back')]);
    case 'content': return form('Что добавить к цифрам?', ...presetRows(contents), [button('Назад', 'back')]);
    case 'push': return form(preview + ' Какой вид сообщения выбрать?',
      [button('Обычный отчёт', 'normal'), button('Нейтральный текст', 'private')], [button('Назад', 'back')]);
    case 'notifyConfirm': return form('Включить рассылку в ' + f.clock + '? ' + preview, [button('Подтверждаю', 'save'), button('Назад', 'back')]);
    case 'review': return form('Начать отслеживание?\nЧасовой пояс · ' + f.zone + '\nПоследнее употребление · ' + observation(f.base, f.zone) +
      '\nПрежняя привычка · ' + (f.habit ? f.habit.currency + ' · период ' + f.habit.period + ' дней' : 'пропущена') +
      '\nЦель · ' + (f.goal ? f.goal + ' дней' : 'без конечной цели') +
      '\nУведомления · ' + (f.frequency === 'off' ? 'выключены' : f.clock),
      [button('Начать', 'save'), button('Изменить', 'back')]);
    case 'episode': return form('Один эпизод не стирает предыдущий путь. Сохраним историю.',
      [button('Эпизод завершён', 'complete'), button('Употребление продолжается', 'active')], helpButtons);
    case 'episodeConfirm': return form('Сохранить ' + (f.flow === 'correct' ? 'исправление истории' : 'эпизод употребления') + '?' +
      (f.start !== undefined ? '\nНачало · ' + observation({ ms: f.start, precision: 'instant' }, zone) : '') +
      (f.last ? '\nПоследнее употребление · ' + observation(f.last, zone) : '') +
      (f.base ? '\nНачальная дата · ' + observation(f.base, zone) : ''),
      [button('Подтвердить', 'save'), button('Изменить', 'back')], helpButtons);
    case 'delete': return form('Удалить данные из базы бота? Статистика и настройки будут удалены. История Telegram останется до удаления в Telegram.',
      [button('Удалить данные', 'save')]);
    default: return view('menu', state, Date.now(), 0);
  }
}

function planTimeline(state, id, now, base, episodes, reset) {
  const intervals = timeline(base, episodes);
  saveTimeline(state, id, intervals);
  saveAwards(state, id, achievements(intervals, now), reset);
}
function settingsSaved(state, id, now) {
  finish(state);
  reschedule(state, id, slotFor(state, now));
  return view('settings', state, now, id);
}
function notificationNext(state, f, step) {
  enter(state, step, f);
  return prompt(state);
}

function finishDate(state, id, now, date) {
  const f = state.fsm;
  if (f.dateRole === 'base') {
    enter(state, f.flow === 'new' ? 'habitChoice' : 'episodeConfirm', { ...f, base: date });
  } else if (f.dateRole === 'start') {
    const start = date.precision === 'day' ? midnight(localDay(date.ms - 1, f.zone), f.zone) : date.ms;
    if (state.profile.base.ms > start || (f.last && start > f.last.ms)) throw new Error('overlap');
    const data = { ...f, start };
    enter(state, f.flow === 'complete' ? 'check' : 'episodeConfirm', data);
  } else {
    if (state.profile.base.ms > date.ms) throw new Error('overlap');
    const data = { ...f, last: date };
    if (f.start !== undefined && date.ms < f.start) throw new Error('overlap');
    enter(state, f.start === undefined ? 'episodeStart' : f.flow === 'complete' ? 'check' : 'episodeConfirm',
      f.start === undefined ? { ...data, dateRole: 'start' } : data);
  }
  return prompt(state);
}

function chooseZone(state, id, now, value) {
  const f = state.fsm;
  const zone = zoneName(value);
  if (f.flow === 'new') {
    enter(state, 'date', { ...f, zone, dateRole: 'base' });
    return prompt(state);
  }
  state.profile.zone = zone;
  return settingsSaved(state, id, now);
}

function saveEpisode(state, id, now, f) {
  const old = state.episodes.find(e => e.id === f.episodeId);
  const base = f.base ?? state.profile.base;
  const episode = f.start === undefined ? null : {
    id: old?.id ?? f.newId,
    start: f.start, last: f.last?.ms ?? null, precision: f.last?.precision ?? null
  };
  const episodes = episode ? [...state.episodes.filter(e => e.id !== episode.id), episode].sort((a, b) => a.start - b.start) : state.episodes;
  planTimeline(state, id, now, base, episodes, true);
  state.profile.base = base;
  if (f.resumeTracking) state.profile.trackingPaused = false;
  state.episodes = episodes;
  if (episode) {
    if (old) state.writes.push(['UPDATE episodes SET start=?,last=?,precision=? WHERE id=? AND user_id=?',
      episode.start, episode.last, episode.precision, episode.id, id]);
    else state.writes.push(['INSERT INTO episodes(id,user_id,start,last,precision) VALUES (?,?,?,?,?)',
      episode.id, id, episode.start, episode.last, episode.precision]);
  }
  finish(state);
  reschedule(state, id, slotFor(state, now));
  return episode?.last === null
    ? screen('Серия и обычные уведомления на паузе.', [nav('Эпизод завершён', 'episode'), nav('Помощь сейчас', 'help')], helpButtons, back('progress'))
    : view('progress', state, now, id);
}

function flagNeutral(state, id) {
  state.changed = true;
  state.neutral = true;
  if (state.profile) Object.assign(state.profile, { trackingPaused: true, frequency: 'off', goal: null });
  reschedule(state, id, null);
}

function formAction(state, id, now, action, updateId) {
  const f = state.fsm;
  const go = (step, data = f) => notificationNext(state, data, step);
  switch (f.step) {
    case 'check':
      if (action === 'urgent') {
        flagNeutral(state, id);
        return go('paused');
      }
      if (action === 'next') return go('background');
      break;
    case 'background':
      if (action === 'risk') {
        flagNeutral(state, id);
        return go('paused');
      }
      if (action === 'next') return state.neutral && state.profile?.trackingPaused ? go('paused')
        : f.flow === 'new' ? go('zone') : go('episodeConfirm');
      break;
    case 'paused':
      if (action === 'neutral') {
        if (state.profile) {
          if (f.flow === 'complete') return go('episodeConfirm', { ...f, resumeTracking: true });
          state.profile.trackingPaused = false;
          return settingsSaved(state, id, now);
        }
        return go('zone', { flow: 'new', ...defaults });
      }
      break;
    case 'zone': if (zones.some(([, z]) => action === z)) return chooseZone(state, id, now, action); break;
    case 'date': case 'episodeStart':
      if (action === 'now') return finishDate(state, id, now, { ms: now, precision: 'instant' });
      if (action === 'single' && f.last) {
        const start = f.last.precision === 'day' ? midnight(localDay(f.last.ms - 1, f.zone), f.zone) : f.last.ms;
        return go(f.flow === 'complete' ? 'check' : 'episodeConfirm', { ...f, start });
      }
      if (['day', 'minute'].includes(action)) return go('dateInput', { ...f, precision: action, previous: f.step });
      break;
    case 'dateInput': if (action === 'back') return go(f.previous); break;
    case 'habitChoice':
      if (action === 'skip') return f.flow === 'new' ? go(state.neutral ? 'notify' : 'goal', { ...f, habit: null })
        : go('habitConfirm', { ...f, habit: { mode: 'average', period: 7, currency: 'RUB', budget: null, items: [] } });
      if (action === 'back' && f.flow === 'new') return go('date', { ...f, dateRole: 'base' });
      if (action === 'budget') return go('budget', { ...f, mode: 'average' });
      if (['average', 'calendar'].includes(action)) return go('habit', { ...f, mode: action });
      break;
    case 'budget': case 'habit':
      if (action === 'back') return go('habitChoice');
      if (action === 'presets' && f.step === 'habit') return go('presets');
      break;
    case 'presets':
      if (action === 'back' || presets.some(([, value]) => value === action)) {
        enter(state, 'habit', f);
        return prompt(state, action === 'back' ? '' : 'Пример объёма и крепости для строки: ' + action);
      }
      break;
    case 'habitConfirm':
      if (action === 'back') return go(f.inputStep ?? 'habitChoice');
      if (action === 'save') {
        const h = f.habit;
        const effective = f.correction ?? Math.max(now, (currentHabit(state)?.effective ?? 0) + 1);
        if (f.correction !== undefined) state.writes.push(['DELETE FROM habit_versions WHERE user_id=? AND effective=?', id, effective]);
        state.habits = state.habits.filter(row => row.effective !== effective);
        saveHabit(state, id, h, effective);
        state.habits.sort((a, b) => a.effective - b.effective);
        return settingsSaved(state, id, now);
      }
      break;
    case 'goal':
      if (action === 'back' && f.flow === 'new') return go('habitChoice');
      if (!state.neutral && ['7', '30', '90', 'none'].includes(action)) {
        const goal = Number(action) || null;
        if (f.flow === 'new') return go('notify', { ...f, goal });
        state.profile.goal = goal;
        return settingsSaved(state, id, now);
      }
      break;
    case 'notify':
      if (action === 'back' && f.flow === 'new' && !state.neutral) return go('goal');
      if (action === 'off') {
        if (f.flow === 'new') return go('review', { ...f, frequency: 'off' });
        state.profile.frequency = 'off';
        return settingsSaved(state, id, now);
      }
      if (action === 'daily8') return go(state.neutral ? 'notifyConfirm' : 'content', { ...f, frequency: 'daily', clock: '08:00', quick: true });
      if (action === 'custom') return go('frequency', { ...f, quick: false });
      break;
    case 'frequency':
      if (action === 'back') return go('notify');
      if (['daily', 'selected', 'weekly', 'milestones'].includes(action) && !(state.neutral && action === 'milestones')) {
        return go(['weekly', 'selected'].includes(action) ? 'weekdays' : 'clock', { ...f, frequency: action, weekdays: action === 'selected' ? [] : [1] });
      }
      break;
    case 'weekdays': {
      if (action === 'back') return go('frequency');
      if (action === 'next' && f.weekdays.length) return go('clock');
      if (!/^[1-7]$/.test(action)) break;
      const day = Number(action);
      return go('weekdays', { ...f, weekdays: f.frequency === 'weekly' ? [day] : f.weekdays.includes(day) ? f.weekdays.filter(d => d !== day) : [...f.weekdays, day] });
    }
    case 'clock':
      if (action === 'back') return go(['weekly', 'selected'].includes(f.frequency) ? 'weekdays' : 'frequency');
      if (action === 'default') return go(state.neutral ? 'notifyConfirm' : 'content', { ...f, clock: '08:00' });
      break;
    case 'content':
      if (action === 'back') return go(f.quick ? 'notify' : 'clock');
      if (contents.some(([, key]) => key === action)) return go('push', { ...f, content: action });
      break;
    case 'push':
      if (action === 'back') return go('content');
      if (['private', 'normal'].includes(action)) return go('notifyConfirm', { ...f, privatePush: action === 'private' });
      break;
    case 'notifyConfirm':
      if (action === 'back') return go(state.neutral ? (f.quick ? 'notify' : 'clock') : 'push');
      if (action === 'save') {
        if (f.flow === 'new') return go('review');
        for (const key of ['frequency', 'weekdays', 'clock', 'content', 'privatePush']) state.profile[key] = f[key];
        return settingsSaved(state, id, now);
      }
      break;
    case 'review':
      if (action === 'back') return go('zone');
      if (action === 'save' && !state.profile) {
        const { zone, base, goal, frequency, weekdays, clock, content, privatePush } = f;
        state.profile = { zone, historyZone: zone, base, goal, frequency, weekdays, clock, content, privatePush };
        planTimeline(state, id, now, base, [], true);
        if (f.habit) saveHabit(state, id, f.habit, base.ms);
        finish(state);
        reschedule(state, id, slotFor(state, now));
        return { ...view('progress', state, now, id), keyboard: true };
      }
      break;
    case 'episode':
      if (['active', 'complete'].includes(action)) {
        const open = state.episodes.at(-1);
        if (action === 'active' && open?.last === null) return view('progress', state, now, id);
        return go(action === 'active' ? 'episodeStart' : 'date', { flow: action, dateRole: action === 'active' ? 'start' : 'last',
          zone: state.profile.historyZone, ...(open?.last === null ? { episodeId: open.id, start: open.start } : {}) });
      }
      break;
    case 'episodeConfirm':
      if (action === 'back') return go(f.flow === 'active' || (f.flow === 'correct' && f.start !== undefined && !f.last)
        ? 'episodeStart' : 'date', { ...f, dateRole: f.base ? 'base' : f.last ? 'last' : 'start' });
      if (action === 'save') return saveEpisode(state, id, now, { ...f, newId: updateId });
      break;
    case 'delete':
      if (action === 'save') {
        state.deleted = true;
        return { ...screen('Данные бота удалены. Историю переписки можно удалить в Telegram. Для нового начала используй /start.'), removeKeyboard: true };
      }
      break;
  }
  return prompt(state, 'Выбери доступный вариант.');
}

function formText(state, id, now, value) {
  const f = state.fsm;
  switch (f.step) {
    case 'zone': return chooseZone(state, id, now, value);
    case 'dateInput': return finishDate(state, id, now, parseDate(value, f.zone, now, f.precision));
    case 'budget': case 'habit': {
      const habit = parseHabit(value, f.mode);
      if (f.step === 'budget' && habit.items.length) throw new Error('budget');
      if (f.keepDrinks && f.step === 'budget') {
        const current = currentHabit(state);
        if (current.period !== habit.period) return prompt(state, 'Укажи тот же период, что в строках напитков.');
        habit.items = current.items.map(row => ({ ...row, price: null }));
      }
      enter(state, f.flow === 'new' ? (state.neutral ? 'notify' : 'goal') : 'habitConfirm', { ...f, habit, inputStep: f.step });
      return prompt(state);
    }
    case 'clock':
      if (!validClock(value)) throw new Error('clock');
      enter(state, state.neutral ? 'notifyConfirm' : 'content', { ...f, clock: value });
      return prompt(state);
    default: return f.step ? prompt(state, 'Воспользуйся кнопками.') : view('menu', state, now, id);
  }
}

function routeTo(state, id, now, route) {
  const p = state.profile;
  const [page, arg] = route.split('.');
  const start = (step, data) => {
    enter(state, step, data);
    return prompt(state);
  };
  switch (page) {
    case 'cancel': finish(state); return view(['history', 'settings'].includes(arg) ? arg : 'menu', state, now, id);
    case 'start':
      finish(state);
      return p ? { ...view('menu', state, now, id), keyboard: true } : welcome;
    case 'begin':
      return p ? view('progress', state, now, id) : start('check', { flow: 'new', ...defaults });
    case 'physical':
      flagNeutral(state, id);
      return start('paused', { flow: 'medical' });
    case 'delete': return start('delete', { flow: 'edit' });
    case 'off':
      if (!p || arg !== state.user.generation) return view('privacy', state, now, id);
      p.frequency = 'off';
      return settingsSaved(state, id, now);
    case 'episode': return p ? start('episode', { flow: 'complete' }) : welcome;
    case 'correct': {
      if (!p) return welcome;
      if (arg === 'base') return start('date', { flow: 'correct', zone: p.historyZone, dateRole: 'base' });
      const e = state.episodes.find(e => String(e.id) === arg);
      if (!e) return view('history', state, now, id);
      return start(e.last === null ? 'episodeStart' : 'date', { flow: 'correct', zone: p.historyZone,
        episodeId: e.id, dateRole: e.last === null ? 'start' : 'last' });
    }
    case 'habits': {
      if (!p) return welcome;
      const versions = [...state.habits].reverse();
      const pageNumber = Math.max(0, Math.min(Math.ceil(versions.length / 5) - 1, Number(arg) || 0));
      return screen('Выбери версию для исправления.',
        ...versions.slice(pageNumber * 5, pageNumber * 5 + 5).map(h => [nav(observation({ ms: h.effective, precision: 'instant' }, p.historyZone) + ' · ' + h.currency, 'habitfix.' + h.effective)]),
        [pageNumber > 0 && nav('←', 'habits.' + (pageNumber - 1)), (pageNumber + 1) * 5 < versions.length && nav('→', 'habits.' + (pageNumber + 1))].filter(Boolean), back('settings'));
    }
    case 'habitfix': {
      if (!p) return welcome;
      const h = state.habits.find(h => String(h.effective) === arg);
      return h ? start('habit', { flow: 'edit', mode: h.mode, correction: h.effective }) : view('settings', state, now, id);
    }
    case 'edit':
      if (!p) return welcome;
      if (arg === 'notify' && p.trackingPaused) return start('paused', { flow: 'medical' });
      if (arg === 'goal' && state.neutral) return view('settings', state, now, id);
      if (arg === 'notify') return start('notify', { ...defaults, ...p, flow: 'edit' });
      if (arg === 'mode') return start('habitChoice', { flow: 'edit' });
      if (arg === 'budget' && currentHabit(state)?.mode === 'calendar') return start('habit', { flow: 'edit', mode: 'calendar' });
      if (['habit', 'budget', 'goal', 'zone'].includes(arg)) return start(arg === 'habit' ? 'habitChoice' : arg, {
        flow: 'edit', mode: 'average', keepDrinks: arg === 'budget' && Boolean(currentHabit(state)?.items.length)
      });
      break;
  }
  return view(route, state, now, id);
}

export function dialog(state, { id, text, callback, updateId }, now) {
  const command = text?.match(/^\/(start|help|privacy|delete)(?:\s|$)/)?.[1];
  if (command || keys.has(text)) return routeTo(state, id, now, command ?? keys.get(text));
  if (callback?.startsWith('n:')) return routeTo(state, id, now, callback.slice(2));
  if (callback && !callback.startsWith(state.fsm.token + ':')) return screen('Кнопка устарела. Открой нужный раздел снова.', back());
  try {
    return callback ? formAction(state, id, now, callback.slice(state.fsm.token.length + 1), updateId)
      : formText(state, id, now, text ?? '');
  } catch (error) {
    const messages = {
      ambiguous: 'Это местное время повторилось. Добавь 1 или 2 после времени.',
      gap: 'Такого местного времени в этот день не было. Укажи другое время.',
      future: 'Укажи дату и время в прошлом или выбери «Сейчас».',
      overlap: 'Даты пересекаются или идут в неверном порядке. Уточни их через «Изменить» или начни ввод заново.'
    };
    return prompt(state, messages[error.message] ?? 'Проверь формат и попробуй ещё раз.');
  }
}
