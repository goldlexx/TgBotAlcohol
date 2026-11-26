import { cityZone, clockInput, dateInput, displayDay, localDay, midnight, observation, parseDate, popularZones, validClock, validWeekdays, today, DAY, zoneLabel, zoneOffset } from './time.js';
import { timeline } from './history.js';
import { saveTimeline, saveAwards, saveHabit, reschedule } from './storage.js';
import { achievements, MILESTONES } from './calculations.js';
import { drinkName, drinks, volume } from './habits.js';
import { habitDraft, habitPrompt, handleHabit } from './habit-dialog.js';
import { slotFor } from './schedule.js';
import { preview, symptoms, riskHistory, risk } from './safety.js';
import { back, helpButtons, metricOptions, nav, reportMetrics, screen, sections, view, welcome, reportPause, reportSaved } from './views.js';

export const keys = new Map(sections.flat().map(([text, route]) => [text, route]));
export const defaults = { goal: null, frequency: 'off', weekdays: [1], clock: '08:00', content: 'both', privatePush: false };
const weekdays = 'Пн Вт Ср Чт Пт Сб Вс'.split(' ');
const reportTimes = ['06:00', '07:00', '08:00', '09:00', '10:00', '12:00'];
const contents = [['Факт о здоровье', 'fact'], ['Идея для жизни', 'idea'], ['Оба', 'both'], ['Только статистика', 'numbers']];
const episodeModes = ['active', 'complete', 'correct', 'remove'];

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
  const cancel = f.step?.startsWith('report')
    ? b(f.flow === 'onboard' && f.step === 'reportTime' ? 'Не сейчас' : 'Отмена', 'cancel')
    : nav('Отмена', 'cancel.' + origin);
  const form = (text, ...rows) => screen(text + (correction ? '\n\n' + correction : ''), ...rows, [cancel]);
  const prev = [b('Назад', 'back')];
  switch (f.step) {
    case 'check': return form('🛡 **Перед началом**\n\n' + symptoms + '\n\nПодробнее о данных в /privacy.',
      [b('Есть симптомы', 'urgent')], [b('Симптомов сейчас нет', 'next')], [b('Не знаю', 'unsure')], [helpButtons[1]]);
    case 'background': return form('🛡 **Важный вопрос**\n\n' + riskHistory, [b('Да', 'risk'), b('Нет', 'next')], [b('Не знаю', 'unsure')], ...helpButtons.map(b => [b]));
    case 'paused': return form('⚕️ **Медицинская помощь**\n\n' + risk + (f.flow === 'new'
      ? '\n\nПосле обращения за профессиональной помощью можно записать дату уже происходящего воздержания.' : ''),
      [helpButtons[1]], [nav('Куда обратиться', 'care.help')],
      f.flow === 'new' ? [b('Записать дату', 'record')]
        : f.flow === 'complete' ? [b('Продолжить запись эпизода', 'record')] : [],
      [nav('Главное меню', 'menu')]);
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
      [b('Указать дату и время', 'minute')], [b('Помню только дату', 'day')],
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
    case 'reportFrequency': return form('📆 **Дни уведомлений**\n\nКак часто присылать отчёт?',
      [b('Каждый день', 'daily')], [b('В выбранные дни недели', 'selected')],
      [b('Только на рубежах', 'milestones')]);
    case 'reportDays': return form('📆 **Выбери дни недели**',
      weekdays.slice(0, 4).map((d, i) => b((f.weekdays.includes(i + 1) ? '✓ ' : '') + d, String(i + 1))),
      weekdays.slice(4).map((d, i) => b((f.weekdays.includes(i + 5) ? '✓ ' : '') + d, String(i + 5))), [b('Готово', 'next')], prev);
    case 'reportTime': {
      const connecting = state.profile.frequency === 'off' && f.frequency;
      const title = connecting && f.frequency === 'daily' ? 'Ежедневный отчёт' : 'Время отчёта';
      const intro = connecting ? 'Выбери время, чтобы подключить отчёт о своём прогрессе.' : 'Выбери удобное время.';
      const zone = '🌍 Часовой пояс: ' + zoneLabel(state.profile.zone, now);
      const pause = reportPause(state);
      return form('🔔 **' + title + '**\n\n' + intro + '\n\n' + zone + '\n\nВремя всегда можно изменить в настройках.' +
        (pause ? '\n\n' + pause : '') + (connecting ? '\n\n' + preview : ''),
      reportTimes.slice(0, 3).map(time => b(time, time)), reportTimes.slice(3).map(time => b(time, time)),
      [b('🕒 Указать своё время', 'custom')], f.returnStep ? prev : []);
    }
    case 'reportTimeText': return form('🕒 **Укажи время отчёта**\n\nВведи время по местному поясу, например 6:00 или 18:30.', prev);
    case 'content': return form('🔔 **Содержание отчёта**\n\nСтатистика есть в обычном отчёте. Выбери, что ещё добавить.',
      ...contents.map(([title, key]) => [b(title, key)]));
    case 'push': return form('🔐 **Формат превью**\n\nНейтральное сообщение содержит только фразу «Твой отчёт готов».',
      [b('Обычный отчёт', 'normal')], [b('Нейтральное сообщение', 'private')]);
    case 'episode': return form('☀️ **Твой путь продолжается**\n\nОдин эпизод употребления не перечёркивает предыдущие успехи. История, трезвые дни и ранее полученные достижения сохраняются.\n\nУпотребление уже завершилось или ещё продолжается?',
      [b('Употребление завершилось', 'complete')], [b('Эпизод продолжается', 'active')], ...helpButtons.map(b => [b]));
    case 'episodeConfirm': return form('📅 **Проверь запись**\n\nСохранить ' + (f.flow === 'correct' ? 'исправление истории' : 'эпизод употребления') + '?' +
      (f.start !== undefined ? '\nНачало · ' + observation({ ms: f.start, precision: 'instant' }, f.zone) : '') +
      (f.last ? '\nПоследнее употребление · ' + observation(f.last, f.zone) : '') +
      (f.base ? '\nНачальная дата · ' + observation(f.base, f.zone) : '') +
      (extendable(state, f.base) ? '\n\nМожно применить прежнюю привычку и к добавленным дням, если она действовала тогда.' : ''),
      [b('Подтвердить', 'save'), b('Изменить', 'back')],
      extendable(state, f.base) ? [b('Сохранить и применить привычку', 'extend')] : [], ...helpButtons.map(b => [b]));
    case 'episodeRemove': return form('🗑 **Удалить этот эпизод?**\n\nНачало · ' +
      observation({ ms: f.start, precision: 'instant' }, f.zone) + '\nОкончание · ' +
      (f.last ? observation(f.last, f.zone) : 'эпизод продолжается') +
      '\n\nСерии и достижения будут пересчитаны.', [b('Удалить эпизод', 'save')]);
    case 'nameDrink': return form('🥤 **Уточнить напиток**\n\n' + observation({ ms: f.effective, precision: 'instant' }, state.profile.historyZone) +
      ' · ' + volume(f.ml) + '\nИзменится только название выбранной записи.',
      ...Object.keys(drinks).map(key => [b(drinkName(key), key)]));
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
function extendable(state, base) {
  return base && base.ms < state.profile.base.ms && state.habits[0]?.effective === state.profile.base.ms;
}
function saveSettings(state, id, now) {
  finish(state);
  let slot = slotFor(state, now);
  while (slot !== null && state.reportedDays?.includes(today(slot, state.profile.zone))) {
    slot = slotFor(state, now, today(slot, state.profile.zone));
  }
  reschedule(state, id, slot);
}

function settingsSaved(state, id, now, route = 'settings') {
  saveSettings(state, id, now);
  return view(route, state, now, id);
}

function saveReportTime(state, id, now, clock) {
  const { frequency, weekdays } = state.fsm;
  const connecting = state.profile.frequency === 'off' && frequency;
  state.profile.clock = clock;
  if (frequency) state.profile.frequency = frequency;
  if (frequency === 'selected') state.profile.weekdays = weekdays;
  saveSettings(state, id, now);
  return reportSaved(state, now, connecting);
}

function finishDate(state, id, now, date) {
  const f = state.fsm;
  if (f.dateRole === 'base' && f.flow === 'new') {
    state.profile = { ...defaults, zone: f.zone, historyZone: f.zone, base: date,
      ...(state.neutral ? { medicalHold: true } : {}) };
    state.neutral = false; // The profile now carries the pre-registration hold.
    planTimeline(state, id, now, date, []);
    enter(state, 'reportTime', { flow: 'onboard', frequency: 'daily' });
    return { ...view('progress.new', state, now, id), keyboard: true,
      followup: prompt(state, now) };
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
  if (f.remove && !old) return view('history', state, now, id);
  const episode = f.remove || f.start === undefined ? null : {
    id: old?.id ?? f.newId, start: f.start, last: f.last?.ms ?? null, precision: f.last?.precision ?? null
  };
  const episodes = f.remove ? state.episodes.filter(e => e.id !== old.id)
    : episode ? [...state.episodes.filter(e => e.id !== episode.id), episode].sort((a, b) => a.start - b.start) : state.episodes;
  planTimeline(state, id, now, base, episodes);
  const previousStart = old ? old.last : state.profile.base.ms;
  const newStart = old ? episode?.last : f.base?.ms;
  if (previousStart !== null && Number.isFinite(newStart) && newStart > previousStart) {
    const cutoffs = MILESTONES.map(days => today(newStart + days * DAY, state.profile.zone));
    state.writes.push([`UPDATE delivery_receipts SET milestone=NULL WHERE user_id=? AND series=?
      AND local_day < CASE milestone ${MILESTONES.map(days => 'WHEN ' + days + ' THEN ?').join(' ')} END`,
    id, old?.id ?? 0, ...cutoffs]);
  }
  if (f.extend && extendable(state, base)) {
    const [habit, ...rest] = state.habits;
    state.writes.push(['DELETE FROM habit_versions WHERE user_id=? AND effective=?', id, habit.effective]);
    state.habits = [];
    saveHabit(state, id, habit, base.ms);
    state.habits.push(...rest);
  }
  state.profile.base = base;
  state.episodes = episodes;
  if (f.remove) state.writes.push(['DELETE FROM episodes WHERE user_id=? AND id=?', id, old.id]);
  else if (episode) {
    if (old) state.writes.push(['UPDATE episodes SET start=?,last=?,precision=? WHERE id=? AND user_id=?',
      episode.start, episode.last, episode.precision, episode.id, id]);
    else state.writes.push(['INSERT INTO episodes(id,user_id,start,last,precision) VALUES (?,?,?,?,?)',
      episode.id, id, episode.start, episode.last, episode.precision]);
  }
  saveSettings(state, id, now);
  return episode?.last === null
    ? screen('☀️ **Твой путь продолжается**\n\nСерия и обычные уведомления на паузе.',
      [nav('Употребление завершилось', 'episode.time')], ...helpButtons.map(b => [b]), back('progress'))
    : view('progress', state, now, id);
}

function flagMedicalRisk(state, id) {
  state.changed = true;
  if (state.profile) state.profile.medicalHold = true;
  else state.neutral = true;
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
  if (action === 'cancel' && f.step.startsWith('report')) {
    finish(state);
    return view(f.flow === 'onboard' ? 'progress' : 'notifications', state, now, id);
  }
  switch (f.step) {
    case 'check':
      if (action === 'urgent') { flagMedicalRisk(state, id); return go('paused'); }
      if (action === 'unsure') return go('paused');
      if (action === 'next') return go('background');
      break;
    case 'background':
      if (action === 'risk') { flagMedicalRisk(state, id); return go('paused'); }
      if (action === 'unsure') return go('paused');
      if (action === 'next') return f.flow === 'new' ? go('zone') : go('episodeConfirm');
      break;
    case 'paused':
      if (action === 'record' && f.flow === 'complete') return go('episodeConfirm');
      if ((action === 'record' || action === 'neutral') && f.flow === 'new' && !state.profile) return go('zone', { flow: 'new', fromMedical: true });
      break;
    case 'zone':
      if (action === 'other') return go('zoneText');
      if (action === 'back' && f.flow === 'new') return f.fromMedical ? go('paused') : go('background');
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
      if (action === 'back') return go(f.stepBeforeAmbiguous ?? 'dateTime');
      if (['1', '2'].includes(action)) return finishDate(state, id, now, parseDate(f.dateDay + ' ' + f.clockValue + ' ' + action, f.zone, now, 'minute'));
      break;
    case 'goal':
      if (['7', '30', '90', 'none'].includes(action)) {
        state.profile.goal = Number(action) || null;
        return settingsSaved(state, id, now);
      }
      break;
    case 'reportFrequency':
      if (['daily', 'selected', 'milestones'].includes(action)) {
        const selected = action === 'selected';
        return go(selected ? 'reportDays' : 'reportTime', {
          ...f, frequency: action, returnStep: selected ? 'reportDays' : 'reportFrequency'
        });
      }
      break;
    case 'reportDays':
      if (action === 'back') return go('reportFrequency');
      if (action === 'next' && f.weekdays.length) return go('reportTime');
      if (/^[1-7]$/.test(action)) {
        const day = Number(action);
        return go('reportDays', { ...f, weekdays: f.weekdays.includes(day) ? f.weekdays.filter(d => d !== day) : [...f.weekdays, day] });
      }
      break;
    case 'reportTime':
      if (action === 'back' && f.returnStep) return go(f.returnStep);
      if (action === 'custom') return go('reportTimeText');
      if (reportTimes.includes(action)) return saveReportTime(state, id, now, action);
      break;
    case 'reportTimeText':
      if (action === 'back') return go('reportTime');
      break;
    case 'content':
      if (contents.some(([, key]) => key === action)) {
        state.profile.content = action;
        return settingsSaved(state, id, now, 'notifications');
      }
      break;
    case 'push':
      if (['private', 'normal'].includes(action)) {
        state.profile.privatePush = action === 'private';
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
        return go(role === 'start' ? 'episodeStart' : 'date', {
          ...f, dateRole: role, ...(role === 'last' && (f.flow === 'correct' || !f.episodeId) ? { start: undefined, last: undefined } : {})
        });
      }
      if (action === 'save' || action === 'extend') return saveEpisode(state, id, now, { ...f, newId: updateId, extend: action === 'extend' });
      break;
    case 'episodeRemove':
      if (action === 'save') return saveEpisode(state, id, now, { ...f, remove: true });
      break;
    case 'nameDrink': {
      const row = state.habits.find(habit => habit.effective === f.effective)?.items.find(item => item.line === f.line);
      if (row && row.drink == null && Object.hasOwn(drinks, action)) {
        state.writes.push(['INSERT INTO habit_drinks VALUES (?,?,?,?)', id, f.effective, f.line, action]);
        row.drink = action;
        finish(state);
        return view('details', state, now, id);
      }
      break;
    }
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
  const readTime = (dateDay, clockValue) => {
    try { return finishDate(state, id, now, parseDate(dateDay + ' ' + clockValue, f.zone, now, 'minute')); }
    catch (error) {
      if (error.message !== 'ambiguous') throw error;
      return go('dateAmbiguous', { dateDay, clockValue, stepBeforeAmbiguous: f.step });
    }
  };
  switch (f.step) {
    case 'zone': case 'zoneText': return go('zoneConfirm', { candidate: cityZone(value) });
    case 'dateInput': {
      const normalized = dateInput(value);
      if (f.precision === 'day') return finishDate(state, id, now, parseDate(normalized, f.zone, now, 'day'));
      const [dateDay, ...clock] = normalized.split(' ');
      if (clock.length) return readTime(dateDay, clock.join(' '));
      parseDate(normalized, f.zone, now, 'day');
      return go('dateTime', { dateDay: normalized, viaInput: true });
    }
    case 'dateTime': {
      const clock = clockInput(value);
      if (!validClock(clock)) throw new Error('clock');
      return readTime(f.dateDay, clock);
    }
    case 'reportTimeText': {
      const clock = clockInput(value);
      if (!validClock(clock)) throw new Error('reportClock');
      return saveReportTime(state, id, now, clock);
    }
    default: return f.step ? prompt(state, now, 'Воспользуйся кнопками.') : view('menu', state, now, id);
  }
}

function routeTo(state, id, now, route) {
  const p = state.profile;
  const [page, arg, other] = route.split('.');
  if (state.fsm.step && !['help', 'physical', 'emergency', 'care'].includes(page)) finish(state);
  const start = (step, data) => {
    enter(state, step, data);
    return prompt(state, now);
  };
  switch (page) {
    case 'cancel': return ['habits', 'habitSettings'].includes(arg)
      ? routeTo(state, id, now, arg) : view(['history', 'settings'].includes(arg) ? arg : 'menu', state, now, id);
    case 'start':
      return p ? { ...screen('☀️ **Счастье без алкоголя**'), keyboard: true, followup: view('progress', state, now, id) } : welcome;
    case 'begin': return p ? view('progress', state, now, id) : start('check', { flow: 'new' });
    case 'metric': {
      if (!p || !Object.hasOwn(metricOptions, arg)) return view('metrics', state, now, id);
      const value = p.metrics?.[arg];
      p.metrics = { ...p.metrics, [arg]: reportMetrics.includes(arg)
        ? value === undefined ? true : value ? false : undefined
        : value === false };
      state.changed = true;
      return view('metrics', state, now, id);
    }
    case 'delete': return start('delete', { flow: 'edit' });
    case 'off':
      if (!p || arg !== state.user.generation) return view('privacy', state, now, id);
      p.frequency = 'off';
      return settingsSaved(state, id, now, 'notifications');
    case 'episode':
      if (!p) return welcome;
      return arg === 'time' || state.episodes.at(-1)?.last === null
        ? start('date', episodeInput(state, 'complete')) : start('episode', { flow: 'complete' });
    case 'remove': {
      const episode = p && state.episodes.find(row => String(row.id) === arg);
      return episode ? start('episodeRemove', { flow: 'remove', episodeId: episode.id, zone: p.historyZone,
        start: episode.start, last: episode.last === null ? null : { ms: episode.last, precision: episode.precision } })
        : view('history', state, now, id);
    }
    case 'name': {
      const item = p && state.habits.find(habit => String(habit.effective) === arg)?.items.find(row => String(row.line) === other);
      if (item && item.drink == null) return start('nameDrink', { effective: Number(arg), line: item.line, ml: item.ml });
      return view('drinkNames', state, now, id);
    }
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
      if (arg === 'notify') return start('reportFrequency', { weekdays: validWeekdays(p.weekdays) ? p.weekdays : [], flow: 'edit' });
      if (arg === 'clock') return start('reportTime', { flow: 'edit' });
      if (arg === 'subscribe') return p.frequency === 'off'
        ? start('reportTime', { flow: 'edit', frequency: 'daily' }) : view('notifications', state, now, id);
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
  if (callback && (!state.fsm.token || !callback.startsWith(state.fsm.token + ':'))) {
    return screen('Кнопка устарела. Открой нужный раздел снова.', back());
  }
  if (['notify', 'frequency', 'weekdays', 'clock', 'notifyConfirm'].includes(state.fsm.step)) {
    finish(state);
    return screen('Настройка устарела. Открой раздел уведомлений снова.', [nav('Уведомления', 'notifications')]);
  }
  const action = callback?.slice(state.fsm.token.length + 1);
  try {
    if (state.fsm.step?.startsWith('habit.')) {
      if (!state.profile) return welcome;
      if (state.fsm.step === 'habit.review' && state.fsm.correction !== undefined && action === 'back') {
        return routeTo(state, id, now, 'habits');
      }
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
      reportClock: 'Укажи время от 00:00 до 23:59, например 6:00 или 18:30.',
      gap: 'При переводе часов такого местного времени не было. Укажи другое время.',
      future: 'Укажи дату и время, которые уже наступили, или выбери «Сейчас».',
      overlap: 'Даты пересекаются или идут в неверном порядке. Уточни их через «Изменить» или начни ввод заново.'
    };
    const fallback = stage === 'zoneText' || stage === 'zone' ? messages.zone : 'Проверь формат и попробуй ещё раз.';
    return prompt(state, now, messages[error.message] ?? fallback);
  }
}
