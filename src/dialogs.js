import { cityZone, dateInput, displayDay, localDay, midnight, observation, parseDate, popularZones, today, validClock, zoneLabel, zoneOffset } from './time.js';
import { timeline } from './history.js';
import { saveTimeline, saveAwards, saveHabit, reschedule } from './storage.js';
import { achievements } from './calculations.js';
import { habitDraft, habitPrompt, handleHabit } from './habit-dialog.js';
import { slotFor } from './schedule.js';
import { preview, symptoms, riskHistory, risk } from './safety.js';
import { back, helpButtons, nav, screen, sections, view, welcome } from './views.js';

export const keys = new Map(sections.flat().map(([text, route]) => [text, route]));
export const defaults = { goal: null, frequency: 'off', weekdays: [1], clock: '08:00', content: 'both', privatePush: false };
const weekdays = 'Пн Вт Ср Чт Пт Сб Вс'.split(' ');
const contents = [['Факт о здоровье', 'fact'], ['Идея для жизни', 'idea'], ['Оба', 'both'], ['Только статистика', 'numbers']];
const episodeModes = ['active', 'complete', 'correct'];

function enter(state, step, data = {}) {
  state.changed = true;
  state.fsm = { ...data, step, token: crypto.randomUUID().slice(0, 12) };
}
function finish(state) {
  state.changed = true;
  state.fsm = {};
}

function prompt(state, now, correction = '') {
  const f = state.fsm;
  if (f.step?.startsWith('habit.')) return habitPrompt(f, correction);
  const b = (text, action) => ({ text, callback_data: f.token + ':' + action });
  const origin = f.flow === 'new' ? 'menu' : episodeModes.includes(f.flow) ? 'history' : 'settings';
  const form = (text, ...rows) => screen(text + (correction ? '\n\n' + correction : ''), ...rows, [nav('Отмена', 'cancel.' + origin)]);
  const prev = [b('Назад', 'back')];
  switch (f.step) {
    case 'check': return form('🛡 **Перед началом**\n\n' + symptoms + '\n\nПодробнее о данных в /privacy.',
      [b('Есть симптомы', 'urgent'), b('Симптомов сейчас нет', 'next')], [b('Не знаю', 'urgent')], [helpButtons[1]]);
    case 'background': return form('🛡 **Важный вопрос**\n\n' + riskHistory, [b('Да / Не знаю', 'risk'), b('Нет', 'next')], helpButtons);
    case 'paused': return form('⚕️ **Медицинская помощь**\n\n' + risk + '\n\nПосле обращения за профессиональной помощью можешь выбрать нейтральное отслеживание уже происходящего воздержания.',
      [helpButtons[1]], [b('Есть профессиональная помощь · нейтральный режим', 'neutral')]);
    case 'zone': {
      const cities = popularZones.map(([name, zone]) => b(name + ' (' + zoneOffset(zone, now) + ')', zone));
      return form('🌍 **Твой часовой пояс**\n\nВыбери город или часовой пояс, чтобы даты и уведомления отображались правильно.',
        cities.slice(0, 2), cities.slice(2, 4), [cities[4], b('Другой город', 'other')], f.flow === 'new' ? prev : []);
    }
    case 'zoneText': return form('🌍 **Другой город**\n\nНапиши город, например Алматы, Тбилиси или Берлин.\nДля всемирного времени можно ввести UTC.', prev);
    case 'zoneConfirm': return form('🌍 **Подтверди часовой пояс**\n\n' + zoneLabel(f.candidate, now) + ' (' + zoneOffset(f.candidate, now) + ').',
      [b('Подтвердить', 'save'), ...prev]);
    case 'date': case 'episodeStart': return form((f.step === 'episodeStart' ? '📅 **Начало эпизода**\n\nКогда началось употребление?'
      : '📅 **Начало новой жизни**\n\nКогда был последний эпизод употребления алкоголя?') +
      '\n\n' + zoneLabel(f.zone, now) + ' (' + zoneOffset(f.zone, now) + ').',
      [b('Сейчас', 'now'), b('Сегодня', 'today'), b('Вчера', 'yesterday')],
      [b('Указать дату и время', 'minute'), b('Помню только дату', 'day')],
      f.step === 'episodeStart' && f.last ? [b('Одиночный эпизод', 'single')] : [],
      f.flow === 'new' ? prev : []);
    case 'dateInput': return form('📅 **Укажи дату**\n\nНапример: 14.11.2026.' +
      (f.precision === 'day' && f.dateRole !== 'start' ? '\nОтсчёт начнётся со следующего местного дня.' : ''), prev);
    case 'dateTime': return form('🕒 **Укажи время**\n\n' + displayDay(f.dateDay) + '\nНапример: 19:00.',
      [b('Не помню точное время', 'day')], prev);
    case 'dateAmbiguous': return form('🕒 **Уточни время**\n\nПри переводе часов ' + f.clockValue + ' в этот день наступало дважды. Какое время ты имеешь в виду?',
      [b('Первое', '1'), b('Второе', '2')], [b('Не помню точное время', 'day')], prev);
    case 'goal': return form('🎯 **Моя цель**\n\nПосле достижения цели счётчик продолжит работать.',
      [b('7 дней', '7'), b('30 дней', '30'), b('90 дней', '90')], [b('Без конечной цели', 'none')]);
    case 'notify': return form('🔔 **Утренний отчёт**\n\nВыбери удобную частоту и время.',
      [b('Каждый день в 08:00', 'daily8'), b('Другая частота или время', 'custom')], [b('Выключить', 'off')]);
    case 'frequency': return form('📆 **Дни уведомлений**\n\nКак часто присылать отчёт?',
      [b('Каждый день', 'daily'), b('В выбранные дни недели', 'selected')],
      !state.neutral ? [b('Только на рубежах', 'milestones')] : [], prev);
    case 'weekdays': return form('📆 **Выбери дни недели**',
      weekdays.slice(0, 4).map((d, i) => b((f.weekdays.includes(i + 1) ? '✓ ' : '') + d, String(i + 1))),
      weekdays.slice(4).map((d, i) => b((f.weekdays.includes(i + 5) ? '✓ ' : '') + d, String(i + 5))), [b('Готово', 'next')], prev);
    case 'clock': return form('🕒 **Время отчёта**\n\nВведи местное время, например 08:00.', [b('08:00', 'default')], prev);
    case 'content': return form('🔔 **Содержание отчёта**\n\nСтатистика есть в обычном отчёте. Выбери, что ещё добавить.',
      ...contents.map(([title, key]) => [b(title, key)]));
    case 'push': return form('🔐 **Формат превью**\n\nНейтральное сообщение содержит только фразу «Твой отчёт готов».',
      [b('Обычный отчёт', 'normal'), b('Нейтральное сообщение', 'private')]);
    case 'notifyConfirm': return form('🔔 **Подтверди расписание**\n\nОтчёт запланирован на ' + f.clock + ' по местному времени.' +
      (state.profile.frequency === 'off' ? '\n\n' + preview : ''),
      [b(state.profile.frequency === 'off' ? 'Включить отчёты' : 'Сохранить', 'save')], prev);
    case 'episode': return form('☀️ **Твой путь продолжается**\n\nОдин эпизод употребления не перечёркивает предыдущие успехи. История, трезвые дни и ранее полученные достижения сохраняются.',
      [b('Употребление завершилось', 'complete'), b('Эпизод продолжается', 'active')],
      [b('Указать другое время', 'complete')], helpButtons);
    case 'episodeConfirm': return form('📅 **Проверь запись**\n\nСохранить ' + (f.flow === 'correct' ? 'исправление истории' : 'эпизод употребления') + '?' +
      (f.start !== undefined ? '\nНачало · ' + observation({ ms: f.start, precision: 'instant' }, f.zone) : '') +
      (f.last ? '\nПоследнее употребление · ' + observation(f.last, f.zone) : '') +
      (f.base ? '\nНачальная дата · ' + observation(f.base, f.zone) : ''),
      [b('Подтвердить', 'save'), b('Изменить', 'back')], helpButtons);
    case 'delete': return form('🔐 **Удалить данные?**\n\nСтатистика и настройки будут удалены из базы бота. История переписки останется до удаления в Telegram.',
      [b('Удалить данные', 'save')]);
    default: return screen('Открой нужный раздел, чтобы продолжить.', back());
  }
}

function planTimeline(state, id, now, base, episodes) {
  const intervals = timeline(base, episodes);
  saveTimeline(state, id, intervals);
  saveAwards(state, id, achievements(intervals, now), true);
}
function settingsSaved(state, id, now, route = 'settings') {
  finish(state);
  reschedule(state, id, slotFor(state, now));
  return view(route, state, now, id);
}

function finishDate(state, id, now, date) {
  const f = state.fsm;
  if (f.dateRole === 'base' && f.flow === 'new') {
    state.profile = { ...defaults, zone: f.zone, historyZone: f.zone, base: date };
    planTimeline(state, id, now, date, []);
    finish(state);
    return { ...view('progress.new', state, now, id), keyboard: true,
      followup: state.neutral ? null : screen('Хочешь дополнить свой прогресс расчётом экономии или включить отчёты?',
        [nav('💰 Настроить статистику', 'edit.habit')], [nav('🔔 Настроить утренние отчёты', 'edit.notify')],
        [nav('📊 Мой прогресс', 'progress')]) };
  }
  if (f.dateRole === 'base') enter(state, 'episodeConfirm', { ...f, base: date });
  if (f.dateRole === 'start') {
    const start = date.precision === 'day' ? midnight(localDay(date.ms - 1, f.zone), f.zone) : date.ms;
    if (state.profile.base.ms > start || (f.last && start > f.last.ms)) throw new Error('overlap');
    enter(state, f.flow === 'complete' ? 'check' : 'episodeConfirm', { ...f, start });
  }
  if (f.dateRole === 'last') {
    if (state.profile.base.ms > date.ms || (f.start !== undefined && date.ms < f.start)) throw new Error('overlap');
    const data = { ...f, last: date };
    enter(state, f.start === undefined ? 'episodeStart' : f.flow === 'complete' ? 'check' : 'episodeConfirm',
      f.start === undefined ? { ...data, dateRole: 'start' } : data);
  }
  return prompt(state, now);
}

function chooseZone(state, id, now, zone) {
  const f = state.fsm;
  if (f.flow === 'new') {
    enter(state, 'date', { ...f, zone, dateRole: 'base' });
    return prompt(state, now);
  }
  state.profile.zone = zone;
  return settingsSaved(state, id, now);
}

function saveEpisode(state, id, now, f) {
  const old = state.episodes.find(e => e.id === f.episodeId);
  const base = f.base ?? state.profile.base;
  const episode = f.start === undefined ? null : {
    id: old?.id ?? f.newId, start: f.start, last: f.last?.ms ?? null, precision: f.last?.precision ?? null
  };
  const episodes = episode ? [...state.episodes.filter(e => e.id !== episode.id), episode].sort((a, b) => a.start - b.start) : state.episodes;
  planTimeline(state, id, now, base, episodes);
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
    ? screen('☀️ **Твой путь продолжается**\n\nСерия и обычные уведомления на паузе.',
      [nav('Употребление завершилось', 'episode.time'), nav('Помощь сейчас', 'help')], helpButtons, back('progress'))
    : view('progress', state, now, id);
}

function flagNeutral(state, id) {
  state.changed = true;
  state.neutral = true;
  if (state.profile) Object.assign(state.profile, { trackingPaused: true, frequency: 'off', goal: null });
  reschedule(state, id, null);
}
function episodeInput(state, action) {
  const open = state.episodes.at(-1);
  return {
    flow: action, dateRole: action === 'active' ? 'start' : 'last', zone: state.profile.historyZone,
    ...(open?.last === null ? { episodeId: open.id, start: open.start } : {})
  };
}

function formAction(state, id, now, action, updateId) {
  const f = state.fsm;
  const go = (step, data = f) => {
    enter(state, step, data);
    return prompt(state, now);
  };
  const finishKnownDay = () => finishDate(state, id, now, parseDate(f.dateDay, f.zone, now, 'day'));
  switch (f.step) {
    case 'check':
      if (action === 'urgent') { flagNeutral(state, id); return go('paused'); }
      if (action === 'next') return go('background');
      break;
    case 'background':
      if (action === 'risk') { flagNeutral(state, id); return go('paused'); }
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
        return go('zone', { flow: 'new' });
      }
      break;
    case 'zone':
      if (action === 'other') return go('zoneText');
      if (action === 'back' && f.flow === 'new') return state.neutral ? go('paused') : go('background');
      if (popularZones.some(([, z]) => action === z)) return chooseZone(state, id, now, cityZone(action));
      break;
    case 'zoneText': if (action === 'back') return go('zone'); break;
    case 'zoneConfirm':
      if (action === 'back') return go('zoneText');
      if (action === 'save') return chooseZone(state, id, now, f.candidate);
      break;
    case 'date': case 'episodeStart':
      if (action === 'back' && f.flow === 'new') return go('zone');
      if (action === 'now') return finishDate(state, id, now, { ms: now, precision: 'instant' });
      if (action === 'single' && f.last) {
        const start = f.last.precision === 'day' ? midnight(localDay(f.last.ms - 1, f.zone), f.zone) : f.last.ms;
        return go(f.flow === 'complete' ? 'check' : 'episodeConfirm', { ...f, start });
      }
      if (['today', 'yesterday'].includes(action)) return go('dateTime', { ...f, previous: f.step,
        dateDay: localDay(now, f.zone).subtract({ days: action === 'today' ? 0 : 1 }).toString() });
      if (['day', 'minute'].includes(action)) return go('dateInput', { ...f, precision: action, previous: f.step });
      break;
    case 'dateInput': if (action === 'back') return go(f.previous); break;
    case 'dateTime':
      if (action === 'day') return finishKnownDay();
      if (action === 'back') return go(f.viaInput ? 'dateInput' : f.previous);
      break;
    case 'dateAmbiguous':
      if (action === 'day') return finishKnownDay();
      if (action === 'back') return go('dateTime');
      if (['1', '2'].includes(action)) return finishDate(state, id, now, parseDate(f.dateDay + ' ' + f.clockValue + ' ' + action, f.zone, now, 'minute'));
      break;
    case 'goal':
      if (!state.neutral && ['7', '30', '90', 'none'].includes(action)) {
        state.profile.goal = Number(action) || null;
        return settingsSaved(state, id, now);
      }
      break;
    case 'notify':
      if (action === 'daily8') return go('notifyConfirm', { ...f, frequency: 'daily', clock: '08:00', quick: true });
      if (action === 'custom') return go('frequency', { ...f, quick: false });
      if (action === 'off') { state.profile.frequency = 'off'; return settingsSaved(state, id, now, 'notifications'); }
      break;
    case 'frequency':
      if (action === 'back') return go('notify');
      if (['daily', 'selected', 'milestones'].includes(action) && !(state.neutral && action === 'milestones')) {
        return go(action === 'selected' ? 'weekdays' : 'clock', { ...f, frequency: action });
      }
      break;
    case 'weekdays':
      if (action === 'back') return go('frequency');
      if (action === 'next' && f.weekdays.length) return go('clock');
      if (/^[1-7]$/.test(action)) {
        const day = Number(action);
        return go('weekdays', { ...f, weekdays: f.weekdays.includes(day) ? f.weekdays.filter(d => d !== day) : [...f.weekdays, day] });
      }
      break;
    case 'clock':
      if (action === 'back') return go(f.frequency === 'selected' ? 'weekdays' : 'frequency');
      if (action === 'default') return go('notifyConfirm', { ...f, clock: '08:00' });
      break;
    case 'content':
      if (!state.neutral && contents.some(([, key]) => key === action)) {
        state.profile.content = action;
        return settingsSaved(state, id, now, 'notifications');
      }
      break;
    case 'push':
      if (!state.neutral && ['private', 'normal'].includes(action)) {
        state.profile.privatePush = action === 'private';
        return settingsSaved(state, id, now, 'notifications');
      }
      break;
    case 'notifyConfirm':
      if (action === 'back') return go(f.quick ? 'notify' : 'clock');
      if (action === 'save' && !state.profile.trackingPaused) {
        for (const key of ['frequency', 'weekdays', 'clock']) state.profile[key] = f[key];
        return settingsSaved(state, id, now, 'notifications');
      }
      break;
    case 'episode':
      if (['active', 'complete'].includes(action)) {
        if (action === 'active' && state.episodes.at(-1)?.last === null) return view('progress', state, now, id);
        return go(action === 'active' ? 'episodeStart' : 'date', episodeInput(state, action));
      }
      break;
    case 'episodeConfirm':
      if (action === 'back') {
        const role = f.base ? 'base' : f.last ? 'last' : 'start';
        return go(role === 'start' ? 'episodeStart' : 'date', { ...f, dateRole: role });
      }
      if (action === 'save') return saveEpisode(state, id, now, { ...f, newId: updateId });
      break;
    case 'delete':
      if (action === 'save') {
        state.deleted = true;
        return { ...screen('🔐 **Данные бота удалены**\n\nИсторию переписки можно удалить в Telegram. Для нового начала используй /start.'), removeKeyboard: true };
      }
      break;
  }
  return prompt(state, now, 'Выбери доступный вариант.');
}

function formText(state, id, now, value) {
  const f = state.fsm;
  const go = (step, data) => {
    enter(state, step, { ...f, ...data });
    return prompt(state, now);
  };
  switch (f.step) {
    case 'zone': case 'zoneText': return go('zoneConfirm', { candidate: cityZone(value) });
    case 'dateInput': {
      const normalized = dateInput(value);
      if (f.precision === 'day') return finishDate(state, id, now, parseDate(normalized, f.zone, now, 'day'));
      if (normalized.includes(' ')) return finishDate(state, id, now, parseDate(normalized, f.zone, now, 'minute'));
      parseDate(normalized, f.zone, now, 'day');
      return go('dateTime', { dateDay: normalized, viaInput: true });
    }
    case 'dateTime': {
      if (!validClock(value)) throw new Error('clock');
      try { return finishDate(state, id, now, parseDate(f.dateDay + ' ' + value, f.zone, now, 'minute')); }
      catch (error) {
        if (error.message !== 'ambiguous') throw error;
        return go('dateAmbiguous', { clockValue: value });
      }
    }
    case 'clock':
      if (!validClock(value)) throw new Error('clock');
      return go('notifyConfirm', { clock: value });
    default: return f.step ? prompt(state, now, 'Воспользуйся кнопками.') : view('menu', state, now, id);
  }
}

function routeTo(state, id, now, route) {
  const p = state.profile;
  const [page, arg] = route.split('.');
  const start = (step, data) => {
    enter(state, step, data);
    return prompt(state, now);
  };
  switch (page) {
    case 'cancel': finish(state); return view(['history', 'settings'].includes(arg) ? arg : 'menu', state, now, id);
    case 'start':
      finish(state);
      return p ? { ...view('progress', state, now, id), keyboard: true } : welcome;
    case 'begin': return p ? view('progress', state, now, id) : start('check', { flow: 'new' });
    case 'physical':
      flagNeutral(state, id);
      return start('paused', { flow: 'medical' });
    case 'delete': return start('delete', { flow: 'edit' });
    case 'off':
      if (!p || arg !== state.user.generation) return view('privacy', state, now, id);
      p.frequency = 'off';
      return settingsSaved(state, id, now, 'notifications');
    case 'episode':
      if (!p) return welcome;
      return arg === 'time' ? start('date', episodeInput(state, 'complete')) : start('episode', { flow: 'complete' });
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
      return screen('💰 **История прежних привычек**\n\nВыбери период для исправления.',
        ...versions.slice(pageNumber * 5, pageNumber * 5 + 5).map(h => [nav(observation({ ms: h.effective, precision: 'instant' }, p.historyZone), 'habitfix.' + h.effective)]),
        [pageNumber > 0 && nav('←', 'habits.' + (pageNumber - 1)), (pageNumber + 1) * 5 < versions.length && nav('→', 'habits.' + (pageNumber + 1))].filter(Boolean), back('settings'));
    }
    case 'habitfix': {
      if (!p) return welcome;
      const h = state.habits.find(h => String(h.effective) === arg);
      return h ? start('habit.review', habitDraft(h, h.mode, h.effective)) : view('settings', state, now, id);
    }
    case 'edit':
      if (!p) return welcome;
      if (arg === 'notify' && p.trackingPaused) return start('paused', { flow: 'medical' });
      if (['goal', 'content', 'push'].includes(arg) && state.neutral) return view('settings', state, now, id);
      if (arg === 'notify') return start('notify', { ...defaults, ...p, flow: 'edit' });
      if (['goal', 'zone', 'content', 'push'].includes(arg)) return start(arg, { flow: 'edit' });
      if (['habit', 'budget', 'mode'].includes(arg)) return start(arg === 'mode' ? 'habit.mode' : 'habit.home', habitDraft(state.habits.at(-1)));
      break;
  }
  return view(route, state, now, id);
}

export function dialog(state, { id, text, callback, updateId }, now) {
  const command = text?.match(/^\/(start|help|privacy|delete|morning)(?:@[A-Za-z0-9_]+)?(?:\s|$)/)?.[1];
  if (command || keys.has(text)) return routeTo(state, id, now, command ?? keys.get(text));
  if (callback?.startsWith('n:')) return routeTo(state, id, now, callback.slice(2));
  if (callback && (!state.fsm.token || !callback.startsWith(state.fsm.token + ':'))) return screen('Кнопка устарела. Открой нужный раздел снова.', back());
  const action = callback?.slice(state.fsm.token.length + 1);
  try {
    if (state.fsm.step?.startsWith('habit.')) {
      if (!state.profile) return welcome;
      const result = handleHabit(state.fsm, (step, data) => enter(state, step, data), action, text, (habit, correction) => {
        const last = state.habits.at(-1);
        const effective = correction ?? (last ? Math.max(now, last.effective + 1) : state.profile.base.ms);
        if (correction !== undefined) state.writes.push(['DELETE FROM habit_versions WHERE user_id=? AND effective=?', id, effective]);
        state.habits = state.habits.filter(row => row.effective !== effective);
        saveHabit(state, id, habit, effective);
        state.habits.sort((a, b) => a.effective - b.effective);
        return settingsSaved(state, id, now);
      });
      return result ?? prompt(state, now);
    }
    return callback ? formAction(state, id, now, action, updateId) : formText(state, id, now, text ?? '');
  } catch (error) {
    const stage = state.fsm.step;
    const messages = {
      zone: 'Часовой пояс не найден. Выбери город из списка или попробуй другое название.',
      gap: 'При переводе часов такого местного времени не было. Укажи другое время.',
      future: 'Укажи дату и время, которые уже наступили, или выбери «Сейчас».',
      overlap: 'Даты пересекаются или идут в неверном порядке. Уточни их через «Изменить» или начни ввод заново.'
    };
    const fallback = stage === 'zoneText' || stage === 'zone' ? messages.zone : 'Проверь формат и попробуй ещё раз.';
    return prompt(state, now, messages[error.message] ?? fallback);
  }
}
