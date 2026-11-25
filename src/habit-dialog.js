import Decimal from 'decimal.js';
import { currencyCode, decimal, drinkName, drinks, formatMoney, hasCalendarBudget, minor, volume } from './habits.js';
import { back, nav, screen } from './views.js';

const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pairs = rows => rows.filter((_, i) => i % 2 === 0).map((_, i) => rows.slice(i * 2, i * 2 + 2));
const money = (value, currency) => {
  const suffix = /(?:[₽$€£]|[A-Za-z]{3}|руб(?:\.|лей)?)$/iu.exec(value)?.[0];
  const aliases = { '$': 'USD', '€': 'EUR', '£': 'GBP' };
  if (suffix && currencyCode(/^руб/i.test(suffix) ? 'RUB' : aliases[suffix] ?? suffix) !== currency) throw new Error('currency');
  return minor(suffix ? value.slice(0, -suffix.length) : value, currency);
};
const decimalText = value => String(value).replace('.', ',');
const weekText = list => [...list].sort((a, b) => a - b).map(d => days[d - 1]).join(', ');

function entriesOf(habit) {
  if (!habit) return [];
  const { items, period } = habit;
  if (habit.mode === 'average') return items.map(row => ({ ...row, period }));
  const calendarBudget = hasCalendarBudget(habit);
  const entries = calendarBudget ? items.map(row => row.drink === 'budget' ? row : { ...row, price: null }) : items;
  return [...Map.groupBy(entries, row => JSON.stringify([row.drink, row.portions, row.ml, row.abv, row.price])).values()]
    .map(rows => ({ ...rows[0], days: rows.map(row => row.weekday), period }));
}

export function habitDraft(habit, mode = habit?.mode ?? 'average', correction) {
  const saved = habit?.mode === mode ? habit : null;
  return { flow: correction === undefined ? 'edit' : 'habitfix', mode, currency: habit?.currency ?? 'RUB', entries: entriesOf(saved), budget: saved?.budget ?? null,
    budgetPeriod: saved?.period ?? 7, ...(correction === undefined ? {} : { correction }) };
}

function frequency(entry) {
  const count = entry.portions;
  const unit = Number.isInteger(count) && count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? ' раза' : ' раз';
  return entry.days ? weekText(entry.days) : decimalText(count) + unit + ' за ' + (entry.period === 7 ? 'неделю' : '28 дней');
}

function build(f) {
  const period = f.mode === 'calendar' ? 7 : Math.max(f.budget === null ? 7 : f.budgetPeriod, ...f.entries.map(row => row.period));
  const items = f.entries.flatMap(({ days: list, period: rowPeriod, ...row }) => f.mode === 'calendar'
    ? list.map(weekday => ({ ...row, weekday }))
    : [{ ...row, weekday: null, portions: new Decimal(row.portions).times(period).div(rowPeriod).toNumber() }]);
  const budget = f.budget === null ? null : new Decimal(f.budget).times(period).div(f.budgetPeriod).toNumber();
  return { mode: f.mode, period, currency: f.currency, budget, items };
}

const fields = ['drink', 'freq', 'vol', 'abv', 'cost'];

export function habitPrompt(f, error = '') {
  const b = (text, action) => ({ text, callback_data: f.token + ':' + action });
  const form = (text, ...rows) => screen(text.replace(/^[^\n]+/, heading => '**' + heading + '**') +
    (error ? '\n\n' + error : ''), ...rows,
    f.step === 'habit.home' || f.step === 'habit.mode' || (f.step === 'habit.review' && f.correction !== undefined)
      ? back(f.correction === undefined ? 'settings' : 'habits') : [b('Назад', 'back')]);
  const d = f.draft;
  switch (f.step.slice(6)) {
    case 'home': return form('💰 Твоя экономия\n\nСравни расходы и количество алкоголя с прежней привычкой.',
      [b('📊 Настроить полную статистику', 'full')], [b('💰 Считать только деньги', 'money')],
      f.entries.length || f.budget !== null ? [b('✏️ Изменить сохранённое', 'review')] : [],
      f.entries.length || f.budget !== null ? [b('Отключить оценку', 'clear')] : [],
      [nav('Настроить позже', 'progress'), nav('Исправить прошлую версию', 'habits')]);
    case 'mode': return form('💰 Расчёт экономии\n\nСредний расчёт прибавляет оценку постепенно. В календарном расчёте учитываются полные трезвые дни по прежнему графику.' +
      '\n\nДля новой модели укажи график и выбери источник расходов: общий бюджет или цены напитков. История сохранится.',
      [b('Среднесуточный', 'average'), b('Календарный', 'calendar')]);
    case 'drink': return form('🍽 Какой напиток был привычным?',
      ...pairs(Object.entries(drinks).map(([key, row]) => b(row[0], key))));
    case 'freq': return form('📆 Как часто в среднем?\n\n«По выходным» означает два раза за неделю для усреднённого расчёта.',
      [b('Каждый день', 'daily'), b('Несколько раз в неделю', 'weekly')],
      [b('По выходным', 'weekend'), b('Несколько раз в месяц', 'monthly')], [b('Указать самостоятельно', 'manual')]);
    case 'freqPeriod': return form('📆 За какой период удобнее вспомнить частоту?',
      [b('За неделю', '7'), b('За 28 дней', '28')]);
    case 'count': return form('📆 Сколько раз обычно за ' + (d.period === 7 ? 'неделю' : '28 дней') + '?',
      [1, 2, 3, 4].map(n => b(String(n), String(n))), [b('Другое количество', 'manual')]);
    case 'countInput': return form('📆 Введи число, например 3.');
    case 'days': return form('📆 Отметь обычные дни употребления.',
      ...pairs(days.map((name, i) => b((d.days.includes(i + 1) ? '✓ ' : '') + name, String(i + 1)))), [b('Готово', 'done')]);
    case 'vol': return form('💧 Сколько обычно за один раз?\n\nОбъёмы ниже можно изменить.',
      ...pairs(drinks[d.drink ?? 'other'][1].map(ml => b(volume(ml), String(ml)))), [b('Другой объём', 'manual'), b('Не помню', 'unknown')]);
    case 'volInput': return form('💧 Введи объём в миллилитрах или литрах, например 750 мл или 1,5 л.');
    case 'abv': return form('🧾 Какая крепость была указана?\n\nЭто примеры. Выбери подходящее значение.',
      ...pairs(drinks[d.drink ?? 'other'][2].map(abv => b(decimalText(abv) + '%', String(abv)))), [b('Другая', 'manual'), b('Не помню', 'unknown')]);
    case 'abvInput': return form('🧾 Введи крепость в процентах, например 5,5%.');
    case 'cost': return form('💰 Сколько обычно стоил указанный объём?\n\nНапример, 500 в выбранной валюте.' +
      (f.budget === null && !f.entries.some(row => row.drink === 'budget') ? '' : ' Цена за напиток заменит общий бюджет в этой версии.'),
      [b('Пропустить', 'skip'), b('Другая валюта', 'currency')]);
    case 'currency': return form('💱 Выбери валюту. При смене валюты укажи расходы заново.\n\nМожно ввести код другой валюты.',
      [b('₽ Рубли', 'RUB'), b('€ Евро', 'EUR')], [b('$ Доллары США', 'USD'), b('£ Фунты', 'GBP')]);
    case 'budgetType': return form('💰 За какой период проще назвать расходы?\n\nОбщий бюджет заменит отдельные цены в этой версии.',
      ...(f.mode === 'calendar' ? [] : [[b('За неделю', '7'), b('За месяц (28 дней)', '28')]]),
      [b('За привычный день', 'once'), b('Другая валюта', 'currency')]);
    case 'budgetInput': return form('💰 Введи примерную сумму, например 1 200,50.',
      [b('Другая валюта', 'currency')]);
    case 'fields': return form('✏️ Что изменить?',
      ...pairs(['Напиток', 'Частоту', 'Объём', 'Крепость', 'Стоимость'].map((name, i) => b(name, fields[i]))),
      [b('Удалить эту запись', 'remove')]);
    case 'review': {
      const lines = f.entries.map((row, i) => {
        if (row.drink === 'budget') return (i + 1) + '. Расходы · ' + frequency(row) + ' · ' + formatMoney(row.price, f.currency);
        return (i + 1) + '. ' + drinkName(row.drink) + ' · ' + volume(row.ml) + ' · ' + frequency(row) +
          (row.abv === null ? ' · крепость неизвестна' : ' · ' + decimalText(row.abv) + '%') +
          (row.price === null ? '' : ' · ' + formatMoney(row.price, f.currency) + ' за раз');
      });
      if (f.budget !== null) lines.push('Общий бюджет · ' + formatMoney(f.budget, f.currency) + (f.budgetPeriod === 7 ? ' за неделю' : ' за 28 дней'));
      const editable = f.entries.map((row, i) => b('✏️ ' + (i + 1) + '. ' + drinkName(row.drink), 'edit' + i));
      return form('✅ Твоя прежняя привычка\n\n' + (lines.join('\n') || 'Оценки по прежней привычке выключены.') +
        '\n\n' + (f.correction === undefined ? 'Новые настройки будут действовать с момента сохранения.' : 'Сохранение пересчитает выбранный период истории.'),
        ...pairs(editable), f.budget === null ? [] : [b('✏️ Изменить бюджет', 'money')],
        f.entries.length < 16 ? [b('➕ Добавить другой напиток', 'add')] : [],
        f.budget === null ? [b('Указать общий бюджет', 'money')] : [],
        [b('✅ Сохранить', 'save')]);
    }
  }
  return form('💰 Открой настройку статистики заново.');
}

export function handleHabit(f, enter, action, input, commit) {
  const step = f.step.slice(6);
  const go = (target, patch = {}) => {
    const next = { ...f, ...patch, step: 'habit.' + target };
    enter(next.step, next);
  };
  const applied = (target, patch) => go(target, { draft: { ...f.draft, ...patch } });
  const error = text => habitPrompt(f, text);
  const draft = () => ({ drink: null, ml: null, abv: null, price: null, portions: 1, period: 7, days: f.mode === 'calendar' ? [] : null });
  const reviewEntry = (row, replaceBudget = false) => {
    const entries = [...f.entries];
    if (f.index === null) entries.push(row);
    else entries[f.index] = row;
    if (row.drink === 'budget' && f.mode === 'average') {
      const budget = new Decimal(row.price).times(row.portions).toDecimalPlaces(0).toNumber();
      go('review', { budget, budgetPeriod: row.period, entries: entries.filter(e => e.drink !== 'budget').map(e => ({ ...e, price: null })) });
    } else if (row.drink === 'budget') {
      go('review', { entries: entries.filter((e, i) => e.drink !== 'budget' || i === (f.index ?? entries.length - 1))
        .map(e => e.drink === 'budget' ? e : { ...e, price: null }), draft: null });
    } else if (replaceBudget) {
      go('review', { entries: entries.filter(e => e.drink !== 'budget'), budget: null, draft: null });
    } else go('review', { entries, draft: null });
  };
  const saveField = (patch, target) => {
    const row = { ...f.draft, ...patch };
    if (f.single || target === 'review') reviewEntry(row, patch.price != null);
    else go(target, { draft: row, ...(target === 'vol' ? { volumeBack: step === 'countInput' ? 'count' : step } : {}) });
  };
  const frequencyTarget = () => f.draft.drink === 'budget' ? 'review' : 'vol';
  const setCurrency = v => {
    const currency = currencyCode(v);
    const different = currency !== f.currency;
    go(f.currencyFrom, different ? { currency, budget: null, entries: f.entries.filter(row => row.drink !== 'budget').map(row => ({ ...row, price: null })),
      draft: f.draft ? { ...f.draft, price: null } : null,
      index: f.index == null || f.draft?.drink === 'budget' ? null
        : f.entries.slice(0, f.index).filter(row => row.drink !== 'budget').length } : {});
  };
  if (action === 'back') {
    const previous = { drink: f.drinkBack ?? 'review', freq: f.draft?.drink === 'budget' ? 'budgetInput' : 'drink',
      freqPeriod: 'freq', count: f.countBack ?? 'freq', countInput: 'count',
      days: f.draft?.drink === 'budget' ? 'budgetInput' : 'drink',
      vol: f.volumeBack ?? (f.mode === 'calendar' ? 'days' : 'freq'), volInput: 'vol', abv: 'vol', abvInput: 'abv', cost: 'abv',
      currency: f.currencyFrom, budgetType: f.budgetBack ?? 'review', budgetInput: 'budgetType', fields: 'review', review: 'home' };
    let target = previous[step] ?? 'home';
    if (step !== 'fields' && f.single && fields.includes(step)) target = 'fields';
    go(target);
    return;
  }
  switch (step) {
    case 'home':
      if (action === 'full') {
        if (f.entries.some(row => row.drink !== 'budget')) go('review');
        else go('drink', { draft: draft(), index: null, single: false, drinkBack: 'home' });
      } else if (action === 'money') go('budgetType', { draft: { ...draft(), drink: 'budget' }, index: null, single: false, budgetBack: 'home' });
      else if (action === 'review') go('review');
      else if (action === 'clear') go('review', { entries: [], budget: null });
      else return error('Выбери вариант кнопкой.');
      return;
    case 'mode':
      if (['average', 'calendar'].includes(action)) {
        if (action === f.mode) go('home');
        else go('home', { ...habitDraft({ currency: f.currency }, action), correction: f.correction });
        return;
      }
      break;
    case 'drink':
      if (Object.hasOwn(drinks, action)) {
        saveField({ drink: action }, f.mode === 'calendar' ? 'days' : 'freq');
        return;
      }
      break;
    case 'freq':
      if (action === 'daily') saveField({ portions: 7, period: 7 }, frequencyTarget());
      else if (action === 'weekend') saveField({ portions: 2, period: 7 }, frequencyTarget());
      else if (['weekly', 'monthly'].includes(action)) go('count', { countBack: 'freq', draft: { ...f.draft, period: action === 'weekly' ? 7 : 28 } });
      else if (action === 'manual') go('freqPeriod');
      else break;
      return;
    case 'freqPeriod':
      if (['7', '28'].includes(action)) { go('count', { countBack: 'freqPeriod', draft: { ...f.draft, period: Number(action) } }); return; }
      break;
    case 'count':
    case 'countInput':
      if (action === 'manual') { go('countInput'); return; }
      if (input || /^[1-4]$/.test(action)) {
        const count = decimal(input ?? action, 1, 10_000);
        if (!count.isInteger()) return error('Введи целое число раз за выбранный период.');
        saveField({ portions: count.toNumber() }, frequencyTarget());
        return;
      }
      break;
    case 'days':
      if (action === 'done' && f.draft.days.length) { saveField({ portions: 1, period: 7 }, frequencyTarget()); return; }
      if (/^[1-7]$/.test(action)) {
        const day = Number(action), { days: chosen } = f.draft;
        applied('days', { days: chosen.includes(day) ? chosen.filter(d => d !== day) : [...chosen, day] });
        return;
      }
      return error('Выбери хотя бы один день.');
    case 'vol':
    case 'volInput':
      if (action === 'manual') { go('volInput'); return; }
      if (action === 'unknown') { saveField({ ml: null }, 'abv'); return; }
      if (input || drinks[f.draft.drink ?? 'other'][1].includes(Number(action))) {
        const value = input ?? action;
        const liters = /(?:^|\s|\d)л$/i.test(value) && !/мл$/i.test(value);
        const ml = decimal(value.replace(/\s*(?:мл|л)$/i, ''), 0.0001, liters ? 100 : 100_000).times(liters ? 1000 : 1);
        if (ml.lt(0.01)) throw new Error('volume');
        saveField({ ml: ml.toNumber() }, 'abv');
        return;
      }
      break;
    case 'abv':
    case 'abvInput':
      if (action === 'manual') { go('abvInput'); return; }
      if (action === 'unknown') { saveField({ abv: null }, 'cost'); return; }
      if (input || drinks[f.draft.drink ?? 'other'][2].includes(Number(action))) {
        saveField({ abv: decimal((input ?? action).replace(/%$/, ''), 0, 100).toNumber() }, 'cost');
        return;
      }
      break;
    case 'cost':
      if (action === 'currency') { go('currency', { currencyFrom: 'cost' }); return; }
      if (action === 'skip' || input) {
        const price = action === 'skip' ? null : money(input, f.currency);
        saveField({ price }, 'review');
        return;
      }
      break;
    case 'currency':
      if (input || ['RUB', 'EUR', 'USD', 'GBP'].includes(action)) { setCurrency(input ?? action); return; }
      break;
    case 'budgetType':
      if (action === 'currency') { go('currency', { currencyFrom: 'budgetType' }); return; }
      if (action === 'once' || (f.mode !== 'calendar' && ['7', '28'].includes(action))) {
        go('budgetInput', { budgetType: action }); return;
      }
      break;
    case 'budgetInput':
      if (action === 'currency') { go('currency', { currencyFrom: 'budgetInput' }); return; }
      if (input) {
        const amount = money(input, f.currency);
        if (f.budgetType === 'once') {
          go(f.mode === 'calendar' ? 'days' : 'freq', { draft: { ...draft(), drink: 'budget', price: amount }, single: false });
        } else {
          go('review', { budget: amount, budgetPeriod: Number(f.budgetType),
            entries: f.entries.filter(row => row.drink !== 'budget').map(row => ({ ...row, price: null })) });
        }
        return;
      }
      break;
    case 'review':
      if (action === 'save') {
        if (f.correction !== undefined && f.flow !== 'habitfix') return error('Открой нужную версию истории заново.');
        return commit(build(f), f.correction);
      }
      if (action === 'add' && f.entries.length < 16) { go('drink', { draft: draft(), index: null, single: false, drinkBack: 'review' }); return; }
      if (action === 'money') { go('budgetType', { draft: { ...draft(), drink: 'budget' }, index: null, single: false, budgetBack: 'review' }); return; }
      if (/^edit\d+$/.test(action)) {
        const index = Number(action.slice(4)), row = f.entries[index];
        if (row) {
          if (row.drink === 'budget') go('budgetType', { draft: { ...row }, index, single: false, budgetBack: 'review' });
          else go('fields', { draft: { ...row }, index, single: true });
          return;
        }
      }
      break;
    case 'fields':
      if (action === 'remove') { go('review', { entries: f.entries.filter((_, i) => i !== f.index) }); return; }
      if (fields.includes(action)) { go(action === 'freq' && f.mode === 'calendar' ? 'days' : action); return; }
      break;
  }
  return error('Выбери вариант кнопкой или проверь введённое значение.');
}
