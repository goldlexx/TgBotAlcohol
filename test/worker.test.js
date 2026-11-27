import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { webhook } from '../src/worker.js';
import { tick } from '../src/scheduler.js';
import { TelegramError } from '../src/telegram.js';
import { DAY } from '../src/time.js';
import { defaults } from '../src/dialogs.js';
import { load } from '../src/storage.js';
import { message } from '../src/telegram.js';
import { report, statsFor } from '../src/views.js';
import { today } from '../src/time.js';

const now = Date.parse('2026-03-10T08:00Z');
const secret = 'local-synthetic-only';
const idRange = Array.from({ length: 200 }, (_, i) => 800_000 + i);
const chats = [...Array.from({ length: 81 }, (_, i) => 100 + i), ...idRange];
const fakeEnv = { WEBHOOK_SECRET: secret, TELEGRAM_TOKEN: 'local-stub', ALLOWED_CHAT_IDS: chats.join(',') };
let mf, db, seq = 1000;
const statement = (sql, ...args) => db.prepare(sql).bind(...args);
const get = (sql, ...args) => statement(sql, ...args).first();

before(async () => {
  mf = new Miniflare({ workers: [{ config: {
    name: 'test', compatibilityDate: '2026-11-23',
    manifest: { mainModule: 'main.js', modules: {
      'main.js': { type: 'esm', contents: 'export default {fetch(){return new Response()}}' }
    } },
    env: { DB: { type: 'd1', name: 'synthetic' } }
  } }] });
  db = await mf.getD1Database('DB');
  const schema = await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8');
  await db.batch(schema.split(';').map(s => s.trim()).filter(Boolean).map(s => statement(s)));
  await db.batch([
    statement("INSERT INTO users(id,generation,profile) VALUES(-1,'legacy-profile','{\"frequency\":\"weekly\"}')"),
    statement("INSERT INTO habit_versions VALUES(-1,1000,'average',7,'RUB',NULL)"),
    statement('INSERT INTO habit_items VALUES(-1,1000,0,NULL,3,500,5,12000)'),
    statement("INSERT INTO episodes VALUES(-1,-1,2000,3000,'minute')"),
    statement('INSERT INTO achievements VALUES(-1,1)')
  ]);
  const migration = await readFile(new URL('../migrations/0002_habit_drink.sql', import.meta.url), 'utf8');
  await db.batch([statement(migration)]);
});
after(async () => mf?.dispose());

function request(id, value, options = {}) {
  const { updateId = seq++, key = secret, type = 'private' } = options;
  const chat = { id, type }, from = { id };
  const update = typeof value === 'string' ? { message: { chat, from, text: value } }
    : { callback_query: { id: String(updateId), message: { chat }, from, data: value.callback } };
  return new Request('https://local/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': key },
    body: JSON.stringify({ update_id: updateId, ...update })
  });
}

const env = () => ({ ...fakeEnv, DB: db });
function session(id) {
  let last, messages, calls = 0;
  async function receive(value, options) {
    const out = [];
    const receivedAt = now + Math.floor(calls++ / 20) * 10_000;
    const answer = await webhook(request(id, value, options), env(), receivedAt, async (_, method, body) => {
      if (method === 'answerCallbackQuery') throw new TelegramError(400);
      out.push(body);
    });
    assert.equal(answer.status, 204);
    messages = out;
    last = out.at(-1);
    return out[0]?.text;
  }
  const nav = route => receive({ callback: 'n:' + route });
  const findButton = label => {
    const button = last?.reply_markup?.inline_keyboard?.flat().find(b => typeof label === 'string' ? b.text === label : label.test(b.text));
    assert.ok(button, label + ' absent from ' + last?.text);
    return button.callback_data;
  };
  const press = label => receive({ callback: findButton(label) });
  return { receive, nav, press, findButton, messages: () => messages };
}

async function register(s, zone = 'UTC') {
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Другой город');
  await s.receive(zone);
  await s.press('Подтвердить');
  await s.press('Указать дату и время');
  await s.receive('01.03.2026');
  return s.receive('07:00');
}

async function onboard(s, { notifications = false, habit = false } = {}) {
  const progress = await register(s);
  if (habit) {
    await s.nav('edit.habit');
    await s.press('💰 Только деньги');
    await s.press('За неделю');
    await s.receive('1 400,00 ₽');
    await s.press('✅ Сохранить');
  }
  await s.nav('edit.goal');
  await s.press('7 дней');
  if (notifications) {
    await s.nav('edit.subscribe');
    await s.press('08:00');
    await s.press('⚙️ К уведомлениям');
    await s.press('Формат превью');
    await s.press('Нейтральное сообщение');
  }
  return progress;
}

test('Worker health, secret, allowlist, private chat and stale callback', async () => {
  const res = await worker.fetch(new Request('https://local/health'), env());
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await webhook(request(100, '/start', { key: 'invalid' }), env(), now)).status, 403);
  assert.equal((await webhook(request(100, '/start', { type: 'group' }), env(), now)).status, 204);
  assert.equal((await webhook(request(999, '/start'), env(), now)).status, 204);
  assert.equal(await get('SELECT id FROM users WHERE id=100 OR id=999'), null);
  assert.match(await session(100).receive({ callback: 'old-token:save' }), /устарела/);
});

test('Закрытый Worker скрывает health и допускает ровно один тестовый чат', async () => {
  const hidden = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: '107' };
  const check = secret => worker.fetch(new Request('https://local/health', {
    headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }
  }), hidden);
  assert.equal((await check('invalid')).status, 404);
  assert.equal((await check(secret)).status, 200);
  const api = async () => {};
  assert.equal((await webhook(request(108, '/start'), hidden, now, api)).status, 204);
  assert.equal((await webhook(request(107, '/start'), { ...hidden, ALLOWED_CHAT_IDS: '107,108' }, now, api)).status, 204);
  assert.equal(await get('SELECT id FROM users WHERE id IN (107,108)'), null);
  await webhook(request(107, '/start'), hidden, now, api);
  assert.equal((await get('SELECT id FROM users WHERE id=107')).id, 107);
});

test('P0 помощь до регистрации, симптомы и сомнения, дальнейший нейтральный маршрут', async () => {
  for (const [id, label] of [[101, 'Есть симптомы'], [102, 'Не знаю']]) {
    const s = session(id);
    assert.match(await s.receive('/help'), /срочная помощь/);
    assert.match(await s.press('🚑 Экстренная помощь'), /112 или 103/);
    assert.match(await s.nav('emergency'), /трудно разбудить/);
    await s.receive('/start');
    await s.press('☀️ Начать');
    assert.match(await s.press(label), /медицинской оценкой сегодня/);
    const row = await get('SELECT profile,neutral,fsm FROM users WHERE id=?', id);
    assert.equal(row.profile, null);
    assert.equal(row.neutral, Number(label === 'Есть симптомы'));
    assert.ok(!/urgent|symptom|initial|reason|unsure/.test(row.fsm));
    if (row.neutral) {
      assert.match(await s.press('🚑 Экстренная помощь'), /Немедленно вызови скорую[\s\S]+112 или 103/);
      assert.match(await s.nav('craving'), /При симптомах отмены/);
      assert.match(await s.nav('crave.stress'), /Попробуй сейчас/);
    }
  }
  const s = session(103);
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  assert.match(await s.press('Да'), /врачом заранее/);
  await s.press('Записать дату');
  await s.press(/^Москва /);
  assert.match(await s.press('Сейчас'), /Следующий рубеж/);
  assert.equal(s.messages().length, 2);
  assert.match(s.messages()[1].text, /Ежедневный отчёт/);
  const registered = await load(db, 103);
  assert.equal(registered.neutral, false);
  assert.equal(registered.profile.medicalHold, true);
  assert.match(await s.press('06:00'), /Следующий отчёт/);
  assert.ok((await load(db, 103)).job);
  await statement("DELETE FROM delivery_jobs WHERE user_id=103").run();
});

test('Регистрация, /start без сброса, контент, цель, часовой пояс и выключение уведомлений', async () => {
  const s = session(104);
  assert.match(await onboard(s, { notifications: true, habit: true }), /9 дней 1 час/);
  await s.receive('/start');
  const [menu, progress] = s.messages();
  assert.equal(s.messages().length, 2);
  assert.equal(menu.reply_markup.keyboard.flat().length, 6);
  assert.deepEqual(menu.reply_markup.keyboard.map(row => row.length), [2, 1, 1, 2]);
  assert.equal(menu.reply_markup.inline_keyboard, undefined);
  assert.match(progress.text, /Мой прогресс/);
  assert.deepEqual(progress.reply_markup.inline_keyboard.flat().map(button => button.callback_data).sort(),
    ['n:details', 'n:episode', 'n:history', 'n:method.progress']);
  assert.match(await s.nav('progress'), /1[\s\u00a0]808/);
  assert.match(await s.nav('life'), /Жизнь без алкоголя/);
  assert.match(await s.press('🔄 Другая идея'), /Жизнь без алкоголя/);
  assert.match(await s.nav('recovery'), /Общие ориентиры/);
  assert.match(await s.press('📅 Все этапы восстановления'), /Этапы восстановления/);
  assert.match(await s.press('🫀 К восстановлению'), /Восстановление организма/);
  assert.match(await s.press('🔬 Подробнее и источники'), /Выбери тему/);
  assert.match(await s.press('Энергия'), /Кого изучали/);
  assert.ok(s.messages()[0].reply_markup.inline_keyboard.flat().some(button => button.url?.startsWith('https://')));
  assert.match(await s.press('Главное меню'), /Мой прогресс/);
  assert.match(await s.nav('awards'), /3 из 12/);
  await s.nav('edit.zone');
  await s.press(/^Москва /);
  const { profile } = await get('SELECT profile FROM users WHERE id=104');
  assert.equal(JSON.parse(profile).historyZone, 'UTC');
  const job = await get('SELECT * FROM delivery_jobs WHERE user_id=104');
  assert.ok(job.next_due_at > now);
  await s.nav('notifications');
  assert.match(await s.press('Отключить уведомления'), /выключен/);
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=104'), null);
});

test('Медицинские экраны сохраняют профиль и доставку, старый флаг меняет только содержание рассылки', async () => {
  const id = 113;
  await seed([id], { trackingPaused: true, goal: 14 });
  await statement('UPDATE users SET neutral=1,fsm=? WHERE id=?', '{"step":"habit.home","token":"legacy-fsm"}', id).run();
  const s = session(id);
  const before = await load(db, id);
  const job = await get('SELECT * FROM delivery_jobs WHERE user_id=?', id);
  for (let i = 0; i < 2; i++) {
    assert.match(await s.nav('physical'), /медицинской оценкой сегодня/);
    assert.match(await s.press('Куда обратиться'), /врачом-наркологом/);
    assert.match(await s.press('🚑 Экстренная помощь'), /112 или 103.*местному экстренному номеру/);
    assert.match(await s.press('Главное меню'), /Мой прогресс/);
  }
  await s.receive('/start');
  assert.match(s.messages()[1].text, /9 дней без алкоголя/);
  assert.match(await s.nav('progress'), /Достижения.*3 из 12/);
  assert.match(await s.press('📊 Подробная статистика'), /Самая длинная серия/);
  assert.match(await s.nav('history'), /Начало отслеживания/);
  assert.match(await s.nav('settings'), /Последнее употребление/);
  assert.match(await s.nav('awards'), /3 из 12/);
  assert.match(await s.nav('craving'), /Что сейчас происходит[\s\S]+При симптомах отмены/);
  const manual = await s.receive('/morning');
  assert.match(manual, /Следующий рубеж[\s\S]*Факт о здоровье[\s\S]*Идея дня/);
  assert.match(manual, /При симптомах отмены/);
  assert.doesNotMatch(manual, /Резкое прекращение/);
  const after = await load(db, id);
  assert.deepEqual(after.profile, before.profile);
  assert.deepEqual(after.intervals, before.intervals);
  assert.equal(after.neutral, true);
  assert.deepEqual(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), job);
  const sent = [];
  await tick({ ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) }, now, async (_, __, body) => sent.push(body.text));
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Твой отчёт/);
  assert.doesNotMatch(sent[0], /Факт о здоровье|Идея дня/);
  assert.ok(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id));
  const stored = JSON.parse((await get('SELECT profile FROM users WHERE id=?', id)).profile);
  assert.equal(stored.trackingPaused, undefined);
  assert.equal(stored.medicalHold, true);
  await s.nav('edit.push');
  await s.press('Обычный отчёт');
  assert.deepEqual(JSON.parse((await get('SELECT profile FROM users WHERE id=?', id)).profile), stored);
  await statement("DELETE FROM delivery_jobs WHERE user_id=? ", id).run();
});

test('Эпизод: пауза, повторная проверка безопасности, новая серия, коррекция и удаление', async () => {
  const s = session(105);
  await onboard(s, { habit: true });
  await s.nav('episode');
  await s.press('Эпизод продолжается');
  await s.press('Помню только дату');
  await s.receive('2026-03-08');
  const oldConfirm = s.findButton('Подтвердить');
  assert.match(await s.press('Подтвердить'), /на паузе/);
  assert.match(await s.receive({ callback: oldConfirm }), /устарела/);
  assert.equal((await get('SELECT count(*) AS n FROM episodes WHERE user_id=105')).n, 1);
  await s.nav('episode');
  await s.press('Указать дату и время');
  await s.receive('2026-03-09 07:00');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  assert.match(await s.press('Подтвердить'), /1 день 1 час без алкоголя/);
  const e = await get('SELECT id FROM episodes WHERE user_id=105');
  await s.nav('correct.' + e.id);
  await s.press('Указать дату и время');
  await s.receive('2026-03-09 07:00');
  await s.press('Помню только дату');
  await s.receive('2026-03-05');
  await s.press('Подтвердить');
  assert.deepEqual((await statement('SELECT days FROM achievements WHERE user_id=105 ORDER BY days').all()).results.map(x => x.days), [1, 3]);
  await s.receive('/delete');
  const oldDelete = s.findButton('Удалить данные');
  const deleteUpdate = seq++;
  assert.match(await s.receive({ callback: oldDelete }, { updateId: deleteUpdate }), /удалены/);
  await s.receive('/start');
  assert.equal(await s.receive({ callback: oldDelete }, { updateId: deleteUpdate }), undefined);
  assert.match(await s.receive({ callback: oldDelete }), /устарела/);
  for (const table of ['episodes', 'abstinence_intervals', 'achievements', 'habit_versions', 'habit_items', 'delivery_jobs', 'delivery_receipts']) {
    assert.equal((await get('SELECT count(*) AS n FROM ' + table + ' WHERE user_id=105')).n, 0);
  }
});

test('Конкурентный дубль webhook приводит к одному ответу', async () => {
  const updateId = seq++, sent = [];
  const api = async (_, method) => sent.push(method);
  await Promise.all(Array.from({ length: 8 }, () => webhook(request(106, '/start', { updateId }), env(), now, api)));
  assert.deepEqual(sent, ['sendMessage']);
});

test('Короткая регистрация: ошибка пояса и даты, приблизительная дата, уведомления выключены', async () => {
  const s = session(108);
  assert.match(await s.receive('/start'), /<b>Счастье без алкоголя<\/b>/);
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  assert.match(await s.press('Нет'), /Москва|часовой пояс/);
  await s.press('Другой город');
  assert.match(await s.receive('<unknown>'), /Часовой пояс не найден/);
  await s.receive('Москва');
  await s.press('Подтвердить');
  await s.press('Помню только дату');
  assert.match(await s.receive('31.02.2026'), /Проверь формат/);
  assert.match(await s.receive('14.11.2026'), /уже наступили/);
  assert.match(await s.receive('01.03.2026'), /Мой прогресс/);
  const output = s.messages();
  assert.equal(output.length, 2);
  assert.ok(output.every(body => body.parse_mode === 'HTML'));
  assert.equal(output[0].reply_markup.keyboard.flat().length, 6);
  assert.doesNotMatch(output.map(body => body.text).join(' '), /Выбери раздел в меню|Europe\/Moscow|\bRUB\b/);
  const { profile } = await get('SELECT profile FROM users WHERE id=108');
  const p = JSON.parse(profile);
  assert.equal(p.base.precision, 'day');
  assert.equal(p.base.ms, Date.parse('2026-03-01T21:00Z'));
  assert.equal(p.frequency, 'off');
  assert.equal(p.goal, null);
  assert.equal(await get('SELECT * FROM habit_versions WHERE user_id=108'), null);
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=108'), null);
});

test('Неоднозначные часы: уточнение появляется только при повторении выбранного времени', async () => {
  const s = session(109);
  await s.nav('begin');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Другой город');
  await s.receive('Нью-Йорк');
  await s.press('Подтвердить');
  await s.press('Указать дату и время');
  assert.doesNotMatch(await s.receive('02.11.2025'), /переводе часов/);
  assert.match(await s.receive('01:30'), /наступало дважды/);
  await s.press('Второе');
  const { profile } = await get('SELECT profile FROM users WHERE id=109');
  assert.equal(JSON.parse(profile).base.ms, Date.parse('2025-11-02T06:30Z'));
});

test('Пошаговая статистика: пресеты, ручной ввод, два напитка и отдельное изменение записи', async () => {
  const s = session(110);
  await onboard(s);
  await s.nav('edit.habit');
  await s.press('📊 Полная статистика');
  await s.press('Пиво');
  await s.press('Несколько раз в неделю');
  await s.press('3');
  await s.press('1 л');
  await s.press('5%');
  await s.receive('500 ₽');
  await s.press('➕ Добавить другой напиток');
  await s.press('Коньяк');
  await s.press('Несколько раз в месяц');
  await s.press('2');
  await s.press('Другой объём');
  await s.receive('0,15 л');
  await s.press('Не помню');
  assert.match(await s.receive('20 ₽'), /крепость неизвестна/);
  await s.press('✅ Сохранить');
  const first = await load(db, 110);
  assert.equal(first.habits[0].period, 28);
  assert.deepEqual(first.habits[0].items.map(row => [row.drink,row.portions,row.ml,row.abv,row.price]), [
    ['beer',12,1000,5,50000], ['brandy',2,150,null,2000]
  ]);
  const progress = await s.nav('progress');
  assert.match(progress, /л пива<\/b>/);
  assert.match(progress, /мл коньяка<\/b>/);
  assert.doesNotMatch(progress, /этанол|ккал|бутылок/);
  assert.match(await s.press('📊 Подробная статистика'), /Чистый спирт \(этанол\), оценка:.*частично/);
  await s.nav('edit.habit');
  await s.press('✏️ Изменить сохранённое');
  await s.press('✏️ 2. Коньяк');
  await s.press('Крепость');
  await s.press('40%');
  await s.press('✅ Сохранить');
  const second = await load(db, 110);
  assert.equal(second.habits.length, 2);
  assert.equal(second.habits[0].items[1].abv, null);
  assert.equal(second.habits[1].items[1].abv, 40);
  assert.deepEqual(second.habits[1].items[0].portions, 12);
});

test('Календарь, бюджет в другой валюте и прежние версии', async () => {
  const s = session(111);
  await onboard(s, { habit: true });
  await s.nav('edit.mode');
  await s.press('Календарный');
  await s.press('💰 Только деньги');
  await s.press('Другая валюта');
  await s.press('€ Евро');
  await s.press('За привычный день');
  await s.receive('18,50 €');
  await s.press('Сб');
  await s.press('Вс');
  await s.press('Готово');
  await s.press('✅ Сохранить');
  const state = await load(db, 111);
  const [average, calendar] = state.habits;
  assert.equal(average.budget, 140000);
  assert.equal(average.currency, 'RUB');
  assert.equal(calendar.mode, 'calendar');
  assert.equal(calendar.currency, 'EUR');
  assert.deepEqual(calendar.items.map(row => [row.weekday,row.price]), [[6,1850],[7,1850]]);
  assert.ok(calendar.effective > average.effective);
});

test('Миграция сохраняет старый профиль и записи, старый формат вставки совместим', async () => {
  const state = await load(db, -1);
  assert.equal(state.profile.frequency, 'weekly');
  assert.equal(state.episodes[0].last, 3000);
  assert.equal((await get('SELECT days FROM achievements WHERE user_id=-1')).days, 1);
  assert.equal(state.habits[0].items[0].price, 12000);
  assert.equal(state.habits[0].items[0].drink, null);
  await statement('INSERT INTO habit_items VALUES(-1,1000,1,NULL,2,100,12,15000)').run();
});

test('/morning использует общий генератор и не меняет расписание, подтверждения или награды', async () => {
  await seed([112], { content: 'both' });
  const s = session(112), before = await get('SELECT * FROM delivery_jobs WHERE user_id=112');
  const progress = await load(db, 112);
  const expected = message(112, report(progress, now, 112, today(now, 'UTC')));
  assert.equal(await s.receive('/morning'), expected.text);
  assert.equal(s.messages()[0].parse_mode, 'HTML');
  assert.deepEqual(await get('SELECT * FROM delivery_jobs WHERE user_id=112'), before);
  assert.equal(await get('SELECT * FROM delivery_receipts WHERE user_id=112'), null);
  assert.equal(await get('SELECT * FROM achievements WHERE user_id=112'), null);
  for (const [setting, hasFact, hasIdea] of [['Факт о здоровье',true,false], ['Идея для жизни',false,true], ['Только статистика',false,false], ['Оба',true,true]]) {
    await s.nav('edit.content');
    await s.press(setting);
    const text = await s.receive('/morning');
    assert.equal(text.includes('Факт о здоровье'), hasFact);
    assert.equal(text.includes('Идея дня'), hasIdea);
  }
  await s.nav('edit.push');
  await s.press('Нейтральное сообщение');
  assert.match(await s.receive('/morning'), /Следующий рубеж[\s\S]*Факт о здоровье[\s\S]*Идея дня/);
  assert.equal(await s.nav('morning.preview'), 'Твой отчёт готов');
  await s.nav('notifications');
  await s.press('Отключить уведомления');
});

test('Показатели сохраняются и применяются в прогрессе, деталях и /morning', async () => {
  const id = 114, s = session(id);
  await onboard(s, { habit: true });
  const profile = (await load(db, id)).profile;
  await statement("INSERT INTO habit_items VALUES (?,?,0,NULL,7,500,5,NULL)", id, profile.base.ms).run();
  await statement("INSERT INTO habit_drinks VALUES (?,?,0,'beer')", id, profile.base.ms).run();
  const progress = await s.nav('progress');
  assert.match(progress, /л пива<\/b>/);
  assert.match(progress, /Трезвых выходных.*1/);
  assert.match(progress, /Всего трезвых дней/);
  assert.doesNotMatch(progress, /этанол|ккал/);
  assert.match(await s.nav('details'), /Она не определяет дефицит калорий, снижение веса/);
  const morning = await s.receive('/morning');
  assert.doesNotMatch(morning, /этанол|ккал/);
  assert.match(morning, /Всего трезвых дней/);
  await s.nav('settings');
  await s.press('🎯 Цель и показатели');
  await s.press('📊 Показатели прогресса');
  await s.press('Экономия · вкл.');
  await s.press('Невыпитые напитки · вкл.');
  await s.press('Общие трезвые дни · вкл.');
  await s.press('Трезвые выходные · вкл.');
  await s.press('Чистый этанол · подробно');
  await s.press('Калории · подробно');
  assert.doesNotMatch(await s.nav('progress'), /Сэкономлено|Не выпито|Трезвых выходных|Всего трезвых дней|ккал|этанол/);
  assert.match(await s.receive('/morning'), /Энергия этанола, оценка/);
  await s.nav('metrics');
  await s.press('Калории · и в отчёте');
  assert.doesNotMatch(await s.nav('details'), /ккал/);
  assert.match(await s.receive('/morning'), /Чистый спирт \(этанол\), оценка/);
  assert.doesNotMatch(await s.receive('/morning'), /ккал/);
  assert.deepEqual((await load(db, id)).profile.base, profile.base);
});

test('Медицинские экраны сохраняют черновик, переход в раздел или команда его закрывают', async () => {
  const id = 115, s = session(id);
  await onboard(s);
  for (const destination of ['📊 Мой прогресс', '/morning', '/privacy', '/start']) {
    await s.nav('edit.habit');
    const old = s.findButton('📊 Полная статистика');
    const before = (await load(db, id)).fsm;
    await s.nav('emergency');
    assert.deepEqual((await load(db, id)).fsm, before);
    await s.receive(destination);
    assert.deepEqual((await load(db, id)).fsm, {});
    assert.match(await s.receive({ callback: old }), /устарела/);
  }
  await s.nav('edit.habit');
  const old = s.findButton('📊 Полная статистика');
  await s.receive('/delete');
  assert.equal((await load(db, id)).fsm.step, 'delete');
  assert.match(await s.receive({ callback: old }), /устарела/);
  await s.receive('⚙️ Настройки');
  assert.deepEqual((await load(db, id)).fsm, {});
  assert.equal((await load(db, id)).habits.length, 0);
});

test('Приватное превью обратимо и не снимает медицинское ограничение или выключенную подписку', async () => {
  const id = 116, s = session(id);
  await seed([id], { frequency: 'off', privatePush: true, medicalHold: true });
  const state = await load(db, id);
  const explicit = await s.receive('/morning');
  assert.match(explicit, /Следующий рубеж[\s\S]*Факт о здоровье[\s\S]*Идея дня/);
  assert.equal(await s.nav('morning.preview'), 'Твой отчёт готов');
  const push = report(state, now, id, today(now, 'UTC'), { automatic: true });
  assert.equal(push.text, 'Твой отчёт готов');
  await s.nav('edit.push');
  await s.press('Обычный отчёт');
  assert.match(await s.nav('morning.preview'), /Твой отчёт/);
  assert.match(await s.nav('craving'), /Что сейчас происходит[\s\S]+При симптомах отмены/);
  assert.deepEqual((await load(db, id)).profile, { ...state.profile, privatePush: false });
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), null);
  await s.nav('edit.push');
  await s.press('Нейтральное сообщение');
  assert.deepEqual((await load(db, id)).profile, state.profile);
  assert.equal(await s.nav('morning.preview'), 'Твой отчёт готов');
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), null);
});

test('Отмена ввода в мастере возвращает к привычке и не сохраняет черновик', async () => {
  const id = 155, s = session(id);
  await onboard(s);
  await s.nav('settings');
  await s.press('💰 Привычка и экономия');
  await s.press('Прежняя привычка');
  assert.match(await s.press('Назад'), /Привычка и экономия/);
  await s.press('Прежняя привычка');
  await s.press('💰 Только деньги');
  await s.press('За неделю');
  assert.match(await s.press('Отмена'), /Привычка и экономия/);
  assert.deepEqual((await load(db, id)).fsm, {});
  assert.equal(await get('SELECT 1 FROM habit_versions WHERE user_id=?', id), null);
  assert.match(await s.press('Назад'), /Настройки/);
  assert.match(await s.press('Главное меню'), /Мой прогресс/);
});

test('Старый профиль без медицинской паузы сохраняет расписание и чеки при повторной нормализации', async () => {
  const id = 136, s = session(id);
  await seed([id], { trackingPaused: false, privatePush: true });
  await statement("INSERT INTO delivery_receipts VALUES (?,'2026-03-09','sent',1,0,7)", id).run();
  const before = await load(db, id);
  const job = await get('SELECT * FROM delivery_jobs WHERE user_id=?', id);
  const receipt = await get('SELECT * FROM delivery_receipts WHERE user_id=?', id);
  assert.equal(await s.nav('morning.preview'), 'Твой отчёт готов');
  const oldProfile = JSON.parse((await get('SELECT profile FROM users WHERE id=?', id)).profile);
  assert.equal(oldProfile.trackingPaused, false);
  await s.nav('metric.money');
  await s.nav('metric.money');
  const after = await load(db, id);
  assert.deepEqual(after.profile, { ...before.profile, metrics: { money: true } });
  assert.equal(after.profile.medicalHold, false);
  assert.deepEqual(after.intervals, before.intervals);
  assert.deepEqual(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), job);
  assert.deepEqual(await get('SELECT * FROM delivery_receipts WHERE user_id=?', id), receipt);
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
});

test('Форматы даты, времени и суммы, возврат из бюджета и точная календарная экономия', async () => {
  const id = 117, s = session(id);
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press(/^Москва /);
  await s.press('Указать дату и время');
  assert.match(await s.receive('31.2.2026'), /Проверь формат/);
  assert.match(await s.receive('1.3.2026'), /01\.03\.2026/);
  assert.match(await s.receive('24:00'), /Проверь формат/);
  assert.match(await s.receive('7:00'), /Мой прогресс/);
  assert.equal((await load(db, id)).profile.base.ms, Date.parse('2026-03-01T04:00Z'));
  await s.nav('edit.habit');
  await s.press('💰 Только деньги');
  await s.press('За привычный день');
  await s.receive('1 400 рублей');
  assert.match(await s.press('Назад'), /Введи примерную сумму/);
  await s.nav('edit.mode');
  await s.press('Календарный');
  await s.press('💰 Только деньги');
  await s.press('За привычный день');
  assert.match(await s.receive('1000 EUR'), /Проверь формат/);
  await s.receive('1 000 руб.');
  await s.press('Сб');
  await s.press('Готово');
  await s.press('➕ Добавить другой напиток');
  await s.press('Пиво');
  await s.press('Сб');
  await s.press('Готово');
  await s.press('500 мл');
  assert.match(await s.press('5%'), /заменит общий бюджет/);
  await s.receive('500,50 руб');
  await s.press('✅ Сохранить');
  const state = await load(db, id);
  assert.deepEqual(state.habits[0].items.map(item => [item.drink, item.price]), [['beer', 50_050]]);
  assert.equal(statsFor(state, now).money.get('RUB').toNumber(), 50_050);
});

test('Отмена исторического исправления сохраняет версии и следующий ввод создаёт новую', async () => {
  const id = 118, s = session(id);
  await onboard(s, { habit: true });
  const budget = async amount => {
    await s.nav('edit.habit');
    await s.press('💰 Только деньги');
    await s.press('За неделю');
    await s.receive(amount);
    await s.press('✅ Сохранить');
  };
  await budget('1 750 ₽');
  const before = (await load(db, id)).habits;
  await s.nav('habitfix.' + before[0].effective);
  assert.match(await s.press('Назад'), /История прежних привычек/);
  assert.deepEqual((await load(db, id)).habits, before);
  await budget('2 100');
  const after = await load(db, id);
  assert.deepEqual(after.habits.slice(0, 2), before);
  const [first, second, third] = after.habits;
  assert.deepEqual([first.budget, second.budget, third.budget], [140_000, 175_000, 210_000]);
  assert.ok(first.effective < second.effective && second.effective < third.effective);
  const expected = (second.effective - first.effective) / DAY * 20_000 +
    (third.effective - second.effective) / DAY * 25_000 + 30_000;
  assert.ok(Math.abs(statsFor(after, third.effective + DAY).money.get('RUB').toNumber() - expected) < 0.000001);
});

test('Повторное исправление завершённого эпизода переносит обе даты раньше и пересчитывает награды', async () => {
  const id = 119, s = session(id);
  await onboard(s);
  await s.nav('episode');
  await s.press('Употребление завершилось');
  await s.press('Указать дату и время');
  await s.receive('9.3.2026 7:00');
  await s.press('Одиночный эпизод');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Подтвердить');
  const initial = await load(db, id);
  const [episode] = initial.episodes;
  assert.deepEqual(statsFor(initial, now).awards, [1, 3, 7]);
  await s.nav('correct.' + episode.id);
  await s.press('Указать дату и время');
  await s.receive('6.3.2026 20:00');
  await s.press('Одиночный эпизод');
  await s.press('Изменить');
  await s.press('Указать дату и время');
  await s.receive('4.3.2026 20:00');
  await s.press('Одиночный эпизод');
  await s.press('Подтвердить');
  const after = await load(db, id), ms = Date.parse('2026-03-04T20:00Z');
  assert.deepEqual(after.episodes, [{ ...episode, start: ms, last: ms }]);
  assert.equal(after.intervals[0].end, ms);
  assert.deepEqual((await statement('SELECT days FROM achievements WHERE user_id=? ORDER BY days', id).all()).results.map(row => row.days), [1, 3]);
});

async function seed(ids, options = {}) {
  const base = options.base ?? { ms: now - 9 * DAY, precision: 'minute' };
  const p = { ...defaults, zone: 'UTC', historyZone: 'UTC', frequency: 'daily', base, ...options };
  await db.batch(ids.flatMap(id => [
    statement('INSERT INTO users(id,generation,profile) VALUES (?,?,?)', id, 'fixture-' + id, JSON.stringify(p)),
    statement('INSERT INTO abstinence_intervals VALUES (?,?,NULL,?)', id, base.ms, base.precision),
    statement('INSERT INTO delivery_jobs VALUES (?,?,?)', id, now, now)
  ]));
}
test('Cron: 429 возобновляется, 403 отключает, 5xx/timeout не дублируются и вечерний отчёт пропускается', async () => {
  await seed([120, 121, 122, 123], { privatePush: true });
  const sent = [];
  const api = async (_, __, body) => {
    assert.equal(body.text, 'Твой отчёт готов');
    sent.push(body.chat_id);
    throw new TelegramError({ 120: 429, 121: 403, 122: 502, 123: 0 }[body.chat_id], 120);
  };
  await tick(env(), now, api);
  await tick(env(), now + 60_000, api);
  assert.equal(sent.length, 4);
  await tick(env(), now + 120_000, async (_, __, body) => sent.push(body.chat_id));
  assert.equal(sent.at(-1), 120);
  assert.equal(sent.length, 5);
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=121'), null);
  for (const [id, status] of [[120, 'sent'], [121, 'blocked'], [122, 'unknown'], [123, 'unknown']]) {
    assert.equal((await get('SELECT status FROM delivery_receipts WHERE user_id=?', id)).status, status);
  }
  await seed([124]);
  await tick(env(), now + 10 * 3_600_000, api);
  assert.equal(await get('SELECT status FROM delivery_receipts WHERE user_id=124'), null);
});

test('Выключение и удаление во время отправки не возрождают 429-задания', async () => {
  await seed([125, 126]);
  await tick(env(), now, async (_, __, body) => {
    const s = session(body.chat_id);
    if (body.chat_id === 125) {
      await s.nav('notifications');
      await s.press('Отключить уведомления');
    } else {
      await s.receive('/delete');
      await s.press('Удалить данные');
    }
    throw new TelegramError(429, 60);
  });
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id IN (125,126)'), null);
  assert.equal(await get('SELECT * FROM delivery_receipts WHERE user_id=126'), null);
});

test('Рубежи отправляются по одному, при паузе обычного отчёта нет', async () => {
  await seed([127, 128], { frequency: 'milestones' });
  await statement("UPDATE users SET profile=json_set(profile,'$.trackingPaused',true) WHERE id=128").run();
  await statement('INSERT INTO delivery_receipts VALUES (?,?,?,?,?,?)', 127, '2026-03-09', 'sent', 1, 0, 3).run();
  await statement('DELETE FROM delivery_jobs WHERE user_id=128').run();
  const messages = [];
  const api = async (_, __, body) => messages.push(body);
  await tick(env(), now, api);
  await tick(env(), now + 60_000, api);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /Целая неделя без алкоголя/);
  assert.equal((await get('SELECT slot FROM delivery_jobs WHERE user_id=127')).slot, now + 5 * DAY);
});

test('Ручное поздравление и первый рубеж после эпизода сохраняют точные чеки без дублей', async () => {
  const id = 130, episodeId = 5100;
  await seed([id], { frequency: 'milestones' });
  await db.batch([
    statement("UPDATE abstinence_intervals SET end=? WHERE user_id=?", now - 2 * DAY, id),
    statement("INSERT INTO abstinence_intervals VALUES (?,?,NULL,'minute')", id, now - DAY),
    statement("INSERT INTO episodes VALUES (?,?,?,?,'minute')", episodeId, id, now - 2 * DAY, now - DAY)
  ]);
  const s = session(id);
  const startJob = await get('SELECT * FROM delivery_jobs WHERE user_id=?', id);
  assert.match(await s.receive('/morning'), /Первые сутки позади[\s\S]*Факт о здоровье[\s\S]*Идея дня/);
  assert.deepEqual(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), startJob);
  assert.equal(await get('SELECT * FROM delivery_receipts WHERE user_id=?', id), null);
  const sent = [], api = async (_, __, body) => sent.push(body);
  const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) };
  await Promise.all([tick(closed, now, api), tick(closed, now, api)]);
  await tick(closed, now + 60_000, api);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Первые сутки позади/);
  assert.doesNotMatch(sent[0].text, /Твой путь продолжается/);
  assert.deepEqual((await statement('SELECT * FROM delivery_receipts WHERE user_id=?', id).all()).results, [
    { user_id: id, local_day: today(now, 'UTC'), status: 'sent', attempts: 1, series: episodeId, milestone: 1 }
  ]);
  assert.equal((await get('SELECT slot FROM delivery_jobs WHERE user_id=?', id)).slot, now + 2 * DAY);
});

test('Cron освобождает пачку от недействительных заданий и сохраняет будущие задания', async () => {
  await seed([131], { frequency: 'off' });
  await seed([132], { trackingPaused: true });
  await seed([133, 134, 135]);
  await db.batch([
    statement('UPDATE abstinence_intervals SET end=? WHERE user_id=133', now - DAY),
    statement('INSERT INTO episodes VALUES (?,?,?,NULL,NULL)', 5101, 133, now - DAY),
    statement('UPDATE users SET profile=NULL WHERE id=134'),
    statement('UPDATE delivery_jobs SET next_due_at=?,slot=? WHERE user_id=135', now + DAY, now + DAY)
  ]);
  const sent = [];
  await tick(env(), now, async (_, __, body) => sent.push(body.chat_id));
  assert.deepEqual(sent.filter(id => id >= 131 && id <= 135), [132]);
  const remaining = (await statement('SELECT user_id,slot FROM delivery_jobs WHERE user_id BETWEEN 131 AND 135').all()).results;
  assert.deepEqual(remaining, [{ user_id: 132, slot: now + DAY }, { user_id: 135, slot: now + DAY }]);
  assert.equal(await get('SELECT * FROM delivery_receipts WHERE user_id BETWEEN 131 AND 135 AND user_id<>132'), null);
  await statement('DELETE FROM delivery_jobs WHERE user_id=132').run();
});

test('Старое недельное расписание без дней приостановлено до выбора пользователя', async () => {
  const id = 140;
  await seed([id], { frequency: 'weekly', weekdays: undefined });
  const s = session(id);
  assert.match(await s.nav('notifications'), /Дни прежнего расписания неизвестны/);
  let sent = false;
  await tick({ ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) }, now, async () => { sent = true; });
  assert.equal(sent, false);
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id), null);
  assert.equal((await load(db, id)).profile.frequency, 'weekly');
  await s.nav('edit.notify');
  await s.press('В выбранные дни недели');
  await s.press('Пн');
  await s.press('Готово');
  await s.press('08:00');
  assert.deepEqual((await load(db, id)).profile.weekdays, [1]);
  assert.ok(await get('SELECT * FROM delivery_jobs WHERE user_id=?', id));
});

test('Медицинский выход и возврат из приватности учитывают регистрацию', async () => {
  const id = 141, s = session(id);
  await s.receive('/privacy');
  assert.match(await s.press('Назад'), /Счастье без алкоголя/);
  await s.nav('care');
  assert.match(await s.press('Главное меню'), /☀️ Начать|Счастье без алкоголя/);
  await onboard(s);
  const before = (await load(db, id)).profile;
  for (const route of ['help', 'care', 'physical', 'emergency']) {
    await s.nav(route);
    assert.match(await s.press('Главное меню'), /Мой прогресс/);
    assert.ok(!s.messages()[0].reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'n:emergency'));
  }
  assert.deepEqual((await load(db, id)).profile, before);
  await s.receive('/privacy');
  assert.match(await s.press('Назад'), /Настройки/);
});

test('Уточнение имени исторического напитка сохраняет строки, суммы и режим', async () => {
  const id = 142, s = session(id);
  await onboard(s);
  const base = (await load(db, id)).profile.base.ms;
  await db.batch([
    statement("INSERT INTO habit_versions VALUES(?,?,'calendar',7,'RUB',NULL)", id, base),
    statement('INSERT INTO habit_items VALUES(?,?,0,6,2,500,5,17000)', id, base),
    statement('INSERT INTO habit_items VALUES(?,?,1,6,1,150,12,24000)', id, base)
  ]);
  const original = await load(db, id);
  const values = statsFor(original, now);
  await s.nav('details');
  await s.press('Уточнить напиток');
  await s.press(/500 мл.*№1/);
  const old = s.findButton('Пиво');
  assert.match(await s.press('Пиво'), /1 л пива/);
  assert.match(await s.nav('progress'), /1 л пива/);
  assert.match(await s.receive('/morning'), /1 л пива/);
  assert.match(await s.receive({ callback: old }), /устарела/);
  const changed = await load(db, id), after = statsFor(changed, now);
  assert.deepEqual(changed.habits, [{ ...original.habits[0], items: [
    { ...original.habits[0].items[0], drink: 'beer' }, original.habits[0].items[1]
  ] }]);
  for (const key of ['money', 'grams', 'calories', 'days']) assert.deepEqual(after[key], values[key]);
});

test('Исправление завершения нового эпизода и ввод неоднозначного времени одной строкой', async () => {
  const s = session(143);
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Другой город');
  await s.receive('America/New_York');
  await s.press('Подтвердить');
  await s.press('Указать дату и время');
  assert.match(await s.receive('2025-11-02_01:30 2'), /Проверь формат/);
  assert.match(await s.receive('02.11.2025 01:30'), /наступало дважды/);
  await s.press('Второе');
  assert.equal((await load(db, 143)).profile.base.ms, Date.parse('2025-11-02T06:30Z'));
  await s.nav('episode');
  await s.press('Употребление завершилось');
  await s.press('Указать дату и время');
  await s.receive('09.03.2026 07:00');
  await s.press('Одиночный эпизод');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Изменить');
  await s.press('Указать дату и время');
  await s.receive('08.03.2026 07:00');
  await s.press('Одиночный эпизод');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Подтвердить');
  assert.equal((await load(db, 143)).episodes[0].last, Date.parse('2026-03-08T11:00Z'));
});

test('Базовая дата сдвигает только первую привычку по явному подтверждению', async () => {
  const id = 144, s = session(id);
  await onboard(s, { habit: true });
  await statement("INSERT INTO habit_versions VALUES(?,?,'average',7,'RUB',70000)", id, now - DAY).run();
  const before = await load(db, id);
  const setBase = async (date, confirmation) => {
    await s.nav('correct.base');
    await s.press('Указать дату и время');
    await s.receive(date);
    await s.press(confirmation);
  };
  await setBase('28.02.2026 07:00', 'Подтвердить');
  assert.deepEqual((await load(db, id)).habits, before.habits);
  await setBase('01.03.2026 07:00', 'Подтвердить');
  await setBase('28.02.2026 07:00', 'Сохранить и применить привычку');
  const changed = await load(db, id);
  assert.equal(changed.habits[0].effective, before.profile.base.ms - DAY);
  assert.deepEqual(changed.habits[1], before.habits[1]);
  assert.equal(statsFor(changed, now).money.get('RUB').minus(statsFor(before, now).money.get('RUB')).toNumber(), 20_000);
});

test('Коррекция серии и удаление меняют только выбранный эпизод и сохраняют чеки дня', async () => {
  const id = 145, s = session(id);
  await onboard(s);
  const base = (await load(db, id)).profile.base.ms;
  const start = now - 2 * DAY, last = now - DAY;
  await db.batch([
    statement("INSERT INTO episodes VALUES (701,?,?,?,'minute')", id, start - 3 * DAY, start - 2 * DAY),
    statement("INSERT INTO episodes VALUES (702,?,?,?,'minute')", id, start, last),
    statement("INSERT INTO delivery_receipts VALUES (?,'2026-03-07','sent',1,701,1)", id),
    statement("INSERT INTO delivery_receipts VALUES (?,'2026-03-09','sent',1,702,1)", id)
  ]);
  await s.nav('edit.subscribe');
  await s.press('08:00');
  const correct = async date => {
    await s.nav('correct.702');
    await s.press('Указать дату и время');
    await s.receive(date);
    await s.press('Одиночный эпизод');
    await s.press('Подтвердить');
  };
  await correct('10.03.2026 06:00');
  const oldReceipt = await get("SELECT * FROM delivery_receipts WHERE user_id=? AND local_day='2026-03-09'", id);
  assert.equal(oldReceipt.milestone, null);
  assert.equal(oldReceipt.status, 'sent');
  assert.equal((await get('SELECT milestone FROM delivery_receipts WHERE user_id=? AND series=701', id)).milestone, 1);
  const job = await get('SELECT * FROM delivery_jobs WHERE user_id=?', id);
  const sent = [];
  const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) };
  const api = async (_, __, body) => sent.push(body.text);
  // Isolate this due slot from subscriptions restored in preceding synthetic tests.
  await statement('DELETE FROM delivery_jobs WHERE user_id<>? AND next_due_at<=?', id, job.slot).run();
  await Promise.all([tick(closed, job.slot, api), tick(closed, job.slot, api)]);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Первые сутки позади/);
  await correct('09.03.2026 06:00');
  assert.deepEqual(await get("SELECT * FROM delivery_receipts WHERE user_id=? AND local_day='2026-03-09'", id), oldReceipt);
  await s.nav('remove.702');
  const stale = s.findButton('Удалить эпизод');
  assert.match(await session(149).receive({ callback: stale }), /устарела/);
  assert.equal((await load(db, id)).episodes.length, 2);
  await s.press('Отмена');
  assert.match(await s.receive({ callback: stale }), /устарела/);
  await s.nav('remove.702');
  await s.press('Удалить эпизод');
  const after = await load(db, id);
  assert.deepEqual(after.episodes.map(e => e.id), [701]);
  assert.equal(after.intervals[0].start, base);
  assert.equal(after.intervals.at(-1).start, start - 2 * DAY);
  assert.equal((await statement('SELECT count(*) AS n FROM delivery_receipts WHERE user_id=?', id).first()).n, 3);
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
});

test('Открытие контента тратит 10 SQL-операторов вместо 21, новые награды записываются один раз', async t => {
  const id = 146;
  await seed([id], { frequency: 'off' });
  const base = now - 1830 * DAY;
  await statement('UPDATE abstinence_intervals SET start=? WHERE user_id=?', base, id).run();
  let count = 0, awards = 0;
  const countedDb = { prepare: sql => {
    if (sql.startsWith('INSERT INTO achievements')) awards++;
    return db.prepare(sql);
  }, batch: batch => { count += batch.length; return db.batch(batch); } };
  const visit = route => webhook(request(id, { callback: 'n:' + route }), { ...env(), DB: countedDb }, now, async () => {});
  for (const route of ['life', 'life.evening.1', 'craving', 'recovery', 'settings', 'history', 'details']) {
    count = 0;
    assert.equal((await visit(route)).status, 204);
    assert.equal(count, 10);
    assert.equal(awards, 0);
  }
  await visit('progress');
  assert.equal(awards, 12);
  count = 0;
  await visit('awards');
  assert.equal(count, 10);
  assert.equal(awards, 12);
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
  t.diagnostic('21 → 10 SQL-операторов при просмотре контента, 12 → 0 повторных INSERT в достижения.');
});

test('/admin авторизует числовой ID и возвращает агрегаты без изменений данных', async () => {
  const id = 147, other = 148;
  await seed([id, other]);
  const before = await load(db, id), replies = [];
  const send = async (...args) => replies.push(args[2]);
  const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id), OWNER_IS_CLOSED_CHAT: '1' };
  await webhook(request(other, '/admin'), closed, now, send);
  await webhook(request(id, '/admin', { type: 'group' }), closed, now, send);
  await webhook(request(id, '/admin'), { ...env(), OWNER_CHAT_ID: '' }, now, send);
  assert.deepEqual(replies, []);
  await webhook(request(id, '/admin'), closed, now, send);
  assert.equal(replies.length, 1);
  assert.match(replies[0].text, /Могут получать автоматические отчёты: 1/);
  assert.match(replies[0].text, /Пользователей в базе: \d+\n✅ Завершили регистрацию: \d+\n🔔 Включили уведомления: \d+/);
  assert.doesNotMatch(replies[0].text, /fixture-|medicalHold|historyZone/);
  assert.deepEqual(await load(db, id), before);
  await statement('DELETE FROM delivery_jobs WHERE user_id IN (?,?)', id, other).run();
});

for (const [index, clock] of ['06:00', '07:00', '08:00', '09:00', '10:00', '12:00'].entries()) {
  test('Регистрация: пресет ' + clock + ' сразу сохраняет ежедневный отчёт в местном поясе', async () => {
    const id = 160 + index, s = session(id);
    await register(s, 'Москва');
    const [progress, offer] = s.messages();
    assert.match(progress.text, /Мой прогресс/);
    assert.match(offer.text, /Ежедневный отчёт[\s\S]*Москва/);
    assert.equal((await load(db, id)).profile.frequency, 'off');
    assert.equal(await get('SELECT 1 FROM delivery_jobs WHERE user_id=?', id), null);
    const day = clock > '11:00' ? '10' : '11';
    const expected = Date.parse('2026-03-' + day + 'T' + clock + '+03:00');
    const result = await s.press(clock);
    assert.match(result, /Ежедневный отчёт подключён/);
    assert.ok(result.includes('Следующий отчёт: ' + day + '.03.2026, ' + clock));
    const { profile, job, fsm } = await load(db, id);
    assert.equal(profile.frequency, 'daily');
    assert.equal(profile.clock, clock);
    assert.equal(profile.zone, 'Europe/Moscow');
    assert.deepEqual(job, { next_due_at: expected, slot: expected });
    assert.deepEqual(fsm, {});
  });
}

test('Регистрация: собственное время, понятная ошибка, возврат и сохранение без подтверждения', async () => {
  const id = 166, s = session(id);
  await register(s);
  const oldPreset = s.findButton('06:00');
  await s.press('🕒 Указать своё время');
  assert.match(await s.receive('24:00'), /от 00:00 до 23:59/);
  assert.equal((await load(db, id)).profile.frequency, 'off');
  s.findButton('Отмена');
  await s.press('Назад');
  const custom = s.findButton('🕒 Указать своё время');
  assert.match(await s.receive({ callback: oldPreset }), /Кнопка устарела/);
  await s.receive({ callback: custom });
  assert.match(await s.receive('6:00'), /Ежедневный отчёт подключён/);
  assert.equal((await load(db, id)).profile.clock, '06:00');
});

test('Регистрация: «Не сейчас» и отмена своего времени оставляют подписку выключенной', async () => {
  for (const [id, cancel] of [[167, false], [168, true]]) {
    const s = session(id);
    await register(s);
    const oldPreset = s.findButton('06:00');
    if (cancel) await s.press('🕒 Указать своё время');
    assert.match(await s.press(cancel ? 'Отмена' : 'Не сейчас'), /Мой прогресс/);
    assert.match(await s.receive({ callback: oldPreset }), /Кнопка устарела/);
    const { profile, fsm, job } = await load(db, id);
    assert.equal(profile.frequency, 'off');
    assert.equal(profile.clock, '08:00');
    assert.deepEqual(fsm, {});
    assert.equal(job, null);
    assert.match(await s.nav('settings'), /Подписка: выключена/);
    assert.match(await s.press('🔔 Уведомления'), /Подписка: выключена[\s\S]*Предпочтительное время/);
    const buttons = s.messages()[0].reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(b => b.text === 'Подключить ежедневные отчёты'));
    assert.ok(buttons.some(b => b.text === 'Изменить время'));
    assert.ok(buttons.some(b => b.text === 'Пример уведомления'));
    assert.ok(buttons.every(b => b.text !== 'Отключить уведомления'));
  }
});

for (const [id, frequency] of [[169, 'daily'], [170, 'weekly'], [171, 'off']]) {
  test('Настройки: изменение времени сохраняет частоту ' + frequency + ', дни и часовой пояс', async () => {
    const s = session(id);
    await seed([id], { frequency, weekdays: [4], zone: 'Europe/Moscow', privatePush: true });
    if (frequency === 'off') await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
    const before = await load(db, id);
    await s.nav('notifications');
    await s.press('Изменить время');
    await s.press('🕒 Указать своё время');
    const result = await s.receive('18:30');
    assert.match(result, /Время отчёта сохранено/);
    const after = await load(db, id);
    assert.deepEqual(after.profile, { ...before.profile, clock: '18:30' });
    if (frequency === 'off') {
      assert.equal(after.job, null);
      assert.match(result, /Подписка: выключена/);
      assert.doesNotMatch(result, /Следующий отчёт/);
    } else {
      assert.equal(after.job.slot, Date.parse('2026-03-' + (frequency === 'weekly' ? '12' : '10') + 'T15:30Z'));
      assert.match(result, /Следующий отчёт/);
    }
    assert.match(await s.press('⚙️ К уведомлениям'), /18:30 · Москва/);
    if (frequency === 'weekly') {
      await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
      assert.match(await s.nav('notifications'), /пока не запланирована/);
    }
  });
}

for (const [id, flag] of [[172, 'medicalHold'], [173, 'neutral'], [174, 'trackingPaused']]) {
  test('Медицинский флаг ' + flag + ': согласие создаёт задание', async () => {
    const s = session(id);
    await seed([id], { frequency: 'off', ...(flag === 'neutral' ? {} : { [flag]: true }) });
    await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
    if (flag === 'neutral') await statement('UPDATE users SET neutral=1 WHERE id=?', id).run();
    await s.nav('notifications');
    await s.press('Подключить ежедневные отчёты');
    const result = await s.press('06:00');
    assert.match(result, /Ежедневный отчёт подключён[\s\S]*Следующий отчёт/);
    await s.nav('edit.push');
    await s.press('Нейтральное сообщение');
    await s.receive('/start');
    const { profile, job, neutral } = await load(db, id);
    assert.equal(profile.clock, '06:00');
    assert.equal(profile.frequency, 'daily');
    assert.equal(profile.privatePush, true);
    assert.equal(neutral, flag === 'neutral');
    assert.equal(Boolean(profile.medicalHold), flag !== 'neutral');
    assert.equal(profile.trackingPaused, undefined);
    assert.ok(job);
    assert.match(await s.nav('notifications'), /Следующий отчёт/);
    assert.match(await s.nav('recovery'), /Текущий период[\s\S]+При симптомах отмены/);
    assert.match(await s.receive('/morning'), /Следующий рубеж[\s\S]*Идея дня[\s\S]*При симптомах отмены/);
    assert.match(await s.press('⚕️ Мне плохо'), /Немедленно вызови скорую/);
    assert.match(await s.press('Главное меню'), /Мой прогресс/);
    assert.deepEqual((await load(db, id)).profile, profile);
  });
}

test('Оба сохранённых флага: 23 дня 20 часов, полное восстановление и ручной отчёт без изменения данных', async () => {
  const id = 156, s = session(id);
  const base = { ms: now - 23 * DAY - 20 * 3_600_000, precision: 'minute' };
  await seed([id], { base, frequency: 'off', zone: 'Europe/Moscow', historyZone: 'Europe/Moscow', medicalHold: true });
  await db.batch([
    statement('UPDATE users SET neutral=1 WHERE id=?', id),
    statement('DELETE FROM delivery_jobs WHERE user_id=?', id),
    statement("INSERT INTO habit_versions VALUES (?,?,'average',7,'RUB',140000)", id, base.ms),
    statement('INSERT INTO habit_items VALUES (?,?,0,NULL,7,500,5,NULL)', id, base.ms),
    statement("INSERT INTO habit_drinks VALUES (?,?,0,'beer')", id, base.ms)
  ]);
  const before = await load(db, id);
  const recovery = await s.nav('recovery');
  assert.match(recovery, /23 дня 20 часов без алкоголя[\s\S]+Текущий период · Первые недели[\s\S]+Сон[\s\S]+Ближайший ориентир — 1 месяц[\s\S]+6 дней 4 часа/);
  assert.doesNotMatch(recovery, /▰|▱/);
  s.findButton('📅 Все этапы восстановления');
  s.findButton('🔬 Подробнее и источники');
  s.findButton('🚑 Экстренная помощь');
  const manual = await s.receive('/morning');
  assert.match(manual, /^☀️ <b>Доброе утро!<\/b>[\s\S]+23 дня 20 часов[\s\S]+61%[\s\S]+Сэкономлено[\s\S]+Не выпито[\s\S]+Факт о здоровье[\s\S]+Идея дня/);
  for (const text of [recovery, manual]) {
    assert.match(text, /При симптомах отмены/);
    assert.doesNotMatch(text, /Резкое прекращение|судорогах|112 или 103/);
  }
  await s.press('🚑 Экстренная помощь');
  assert.match(s.messages()[0].text, /Немедленно вызови скорую/);
  assert.match(await s.press('Главное меню'), /Мой прогресс/);
  assert.match(await s.nav('notifications'), /Подписка: выключена[\s\S]+Предпочтительное время/);
  assert.doesNotMatch(s.messages()[0].text, /Следующий отчёт:/);
  const after = await load(db, id);
  for (const key of ['profile', 'neutral', 'intervals', 'episodes', 'habits', 'job']) assert.deepEqual(after[key], before[key]);
});

test('Просмотр медицинской помощи без ответов о риске не устанавливает флаги и не меняет очередь', async () => {
  const id = 175, s = session(id);
  await seed([id]);
  const before = await load(db, id);
  await s.nav('physical');
  await s.press('Главное меню');
  await s.receive('/start');
  const { job, neutral, profile } = await load(db, id);
  assert.equal(neutral, false);
  assert.equal(profile.medicalHold, undefined);
  assert.deepEqual(job, before.job);
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
});

test('Старый черновик v2.3.1 и повторное нажатие не меняют расписание', async () => {
  const id = 176, s = session(id);
  await register(s);
  await statement('UPDATE users SET fsm=? WHERE id=?', '{"step":"notifyConfirm","token":"legacy","frequency":"daily","clock":"06:00"}', id).run();
  assert.match(await s.receive({ callback: 'legacy:save' }), /Настройка устарела/);
  assert.equal((await load(db, id)).profile.frequency, 'off');
  await s.nav('edit.subscribe');
  const button = { callback: s.findButton('09:00') };
  const replies = await Promise.all([s.receive(button), s.receive(button)]);
  assert.ok(replies.some(text => /Ежедневный отчёт подключён/.test(text)));
  assert.ok(replies.some(text => /Кнопка устарела/.test(text)));
  assert.equal((await load(db, id)).profile.clock, '09:00');
  assert.equal((await get('SELECT count(*) AS n FROM delivery_jobs WHERE user_id=?', id)).n, 1);
});

test('После доставки сегодня новое время сразу планируется на следующий день', async () => {
  const id = 177, s = session(id);
  await seed([id]);
  await statement("INSERT INTO delivery_receipts VALUES (?,'2026-03-10','sent',1,0,NULL)", id).run();
  await s.nav('notifications');
  await s.press('Изменить время');
  assert.match(await s.press('09:00'), /Следующий отчёт: 11\.03\.2026, 09:00/);
  assert.equal((await load(db, id)).job.slot, Date.parse('2026-03-11T09:00Z'));
  await tick(env(), Date.parse('2026-03-10T09:00Z'), async (_, method, body) => {
    assert.ok(method !== 'sendMessage' || body.chat_id !== id);
  });
  assert.equal((await get('SELECT count(*) AS n FROM delivery_receipts WHERE user_id=?', id)).n, 1);
});

test('/admin считает подписку на медицинской паузе отдельно от доступной доставки', async () => {
  const id = 178, s = session(id);
  await seed([id], { frequency: 'off', medicalHold: true });
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
  const counts = async () => {
    const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id), OWNER_IS_CLOSED_CHAT: '1' };
    let out;
    await webhook(request(id, '/admin'), closed, now, async (_, __, body) => { out = body.text; });
    return [...out.matchAll(/: (\d+)/g)].map(match => Number(match[1]));
  };
  const before = await counts();
  await s.nav('edit.subscribe');
  await s.press('06:00');
  const after = await counts();
  assert.deepEqual(after, [before[0], before[1], before[2] + 1, 1]);
  assert.ok(await get('SELECT 1 FROM delivery_jobs WHERE user_id=?', id));
});

test('При открытом эпизоде время сохраняется без обещания отправки', async () => {
  const id = 179, s = session(id);
  await seed([id]);
  await db.batch([
    statement('INSERT INTO episodes(id,user_id,start) VALUES(?,?,?)', id, id, now - DAY),
    statement('UPDATE abstinence_intervals SET end=? WHERE user_id=?', now - DAY, id),
    statement('DELETE FROM delivery_jobs WHERE user_id=?', id)
  ]);
  await s.nav('notifications');
  await s.press('Изменить время');
  const result = await s.press('06:00');
  assert.match(result, /Время отчёта сохранено[\s\S]*Пока открыт эпизод употребления/);
  assert.doesNotMatch(result, /Следующий отчёт/);
  const { profile, job } = await load(db, id);
  assert.equal(profile.clock, '06:00');
  assert.equal(profile.frequency, 'daily');
  assert.equal(job, null);
});

test('Навигация v2.4.1: отмена эпизода, устаревшие кнопки, повторные /start и /morning, Cron под паузой', async () => {
  const id = 158, s = session(id);
  await seed([id], { frequency: 'daily', clock: '08:00', medicalHold: true });
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
  const sent = [];
  await tick(env(), now, async (_, method, body) => { if (method === 'sendMessage') sent.push(body); });
  assert.equal(sent.length, 0);
  const before = await load(db, id);

  await s.nav('craving');
  await s.press('📝 Отметить эпизод');
  const staleBtn = s.findButton('Употребление завершилось');
  assert.match(s.messages()[0].text, /Употребление уже завершилось/);
  assert.match(await s.press('Отмена'), /История прогресса/);
  assert.equal((await load(db, id)).episodes.length, 0);

  await s.nav('physical');
  await s.press('Куда обратиться');
  assert.match(await s.press('Назад'), /Мне физически плохо/);
  await s.press('Главное меню');

  await s.receive('/start');
  assert.equal(s.messages().length, 2);
  assert.match(await s.receive('/morning'), /Доброе утро/);
  assert.match(await s.receive('/morning'), /Доброе утро/);
  assert.match(await s.receive({ callback: staleBtn }), /Кнопка устарела/);

  await s.nav('edit.clock');
  assert.match(await s.press('09:00'), /Время отчёта сохранено/);
  assert.match(await s.press('⚙️ К уведомлениям'), /09:00/);
  assert.match(await s.nav('stages.1'), /Страница 2 из 2/);
  assert.match(await s.press('📖 Полгода'), /Полгода и далее/);
  assert.match(await s.press('🔬 Память'), /Recovery of neuropsychological function/);
  assert.match(await s.press('Назад'), /Полгода и далее/);
  assert.match(await s.press('← К этапам'), /Страница 2 из 2/);

  const after = await load(db, id);
  assert.deepEqual(after.profile, { ...before.profile, clock: '09:00' });
  assert.ok(after.job);
  assert.equal(after.episodes.length, 0);
});

test('200 синтетических профилей, общий слот, конкурирующий Cron и параллельные обновления', async t => {
  await seed(idRange.slice(0, 100), { privatePush: true });
  await seed(idRange.slice(100));
  await db.batch(idRange.flatMap(id => [
    statement('INSERT INTO habit_versions VALUES (?,?,?,?,?,?)', id, now - 9 * DAY, 'average', 7, 'RUB', 140000),
    statement('INSERT INTO habit_items(user_id,effective,line,weekday,portions,ml,abv,price) VALUES (?,?,?,?,?,?,?,?)', id, now - 9 * DAY, 0, null, 2, 300, 12, null)
  ]));
  const sent = [];
  const api = async (_, method, body) => {
    if (method === 'sendMessage' && (body.text === 'Твой отчёт готов' || body.text.startsWith('☀️ <b>Доброе утро!'))) sent.push(body.chat_id);
  };
  const start = performance.now();
  // All 200 jobs share the same original slot. Move the clock by one minute per batch.
  await Promise.all([
    tick(env(), now, api), tick(env(), now, api),
    ...idRange.slice(0, 20).map(id => webhook(request(id, '📊 Мой прогресс'), env(), now, api))
  ]);
  for (let i = 1; i <= 25; i++) await tick(env(), now + i * 60_000, api);
  assert.equal(sent.length, idRange.length);
  assert.equal(new Set(sent).size, idRange.length);
  const adminOutput = [];
  await webhook(request(idRange[0], '/admin'), { ...env(), OWNER_CHAT_ID: String(idRange[0]) }, now + DAY,
    async (_, __, body) => adminOutput.push(body.text));
  assert.match(adminOutput[0], /Пора проверить пропускную способность рассылки/);
  const plan = await statement('EXPLAIN QUERY PLAN SELECT * FROM delivery_jobs WHERE next_due_at<=? ORDER BY next_due_at,user_id LIMIT 8', now).all();
  assert.match(plan.results.map(row => row.detail).join(' '), /due_jobs/);
  t.diagnostic('200/200 уникальных локальных отправок, 20 параллельных обновлений, ' + Math.round(performance.now() - start) + ' мс');
});

test('06:00 МСК: сохранённый риск не мешает Cron отправить статистику и записать квитанцию', async t => {
  const id = 157, s = session(id);
  await seed([id], { frequency: 'daily', zone: 'Europe/Moscow', historyZone: 'Europe/Moscow', medicalHold: true });
  await statement('UPDATE users SET neutral=1 WHERE id=?', id).run();
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
  await s.nav('notifications');
  await s.press('Изменить время');
  assert.match(await s.press('06:00'), /Следующий отчёт: 11\.03\.2026, 06:00/);
  const next = Date.parse('2026-03-11T03:00Z');
  assert.deepEqual((await load(db, id)).job, { next_due_at: next, slot: next });
  const sent = [];
  const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) };
  const log = t.mock.method(console, 'info', () => {});
  for (let i = 0; i < 4 && !sent.length; i++) await tick(closed, next, async (_, method, body) => {
    assert.equal(method, 'sendMessage');
    sent.push(body);
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, id);
  assert.match(sent[0].text, /Твой отчёт[\s\S]+Всего трезвых дней/);
  assert.doesNotMatch(sent[0].text, /Факт о здоровье|Идея дня|поздрав/i);
  assert.equal((await get('SELECT status FROM delivery_receipts WHERE user_id=? AND local_day=?', id, '2026-03-11')).status, 'sent');
  assert.equal((await load(db, id)).job.slot, next + DAY);
  await tick({ ...closed, TELEGRAM_TOKEN: '' }, next, async () => assert.fail('Unexpected send'));
  assert.deepEqual(JSON.parse(log.mock.calls.at(-1).arguments[0]), { event: 'delivery_skipped', reason: 'missing_configuration' });
});

test('Bootstrap восстанавливает 06:00 МСК без отправки задним числом и выдерживает параллельный Cron', async () => {
  const id = 159;
  await seed([id], { zone: 'Europe/Moscow', clock: '06:00', medicalHold: true });
  await db.batch([
    statement('DELETE FROM delivery_jobs WHERE user_id=?', id),
    statement("INSERT INTO delivery_receipts VALUES (?,'2026-03-10','sent',1,0,NULL)", id)
  ]);
  const before = (await load(db, id)).user;
  const start = Date.parse('2026-03-10T02:59Z');
  const next = Date.parse('2026-03-11T03:00Z');
  const closed = { ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id) };
  const sent = [];
  const api = async (_, __, body) => sent.push(body);
  await Promise.all([tick(closed, start, api), tick(closed, start, api)]);
  assert.deepEqual((await load(db, id)).job, { slot: next, next_due_at: next });
  await db.batch([
    statement('DELETE FROM delivery_jobs WHERE user_id=?', id),
    statement('DELETE FROM delivery_receipts WHERE user_id=?', id)
  ]);
  await tick(closed, Date.parse('2026-03-10T03:05Z'), api);
  assert.equal(sent.length, 0);
  assert.deepEqual((await load(db, id)).job, { slot: next, next_due_at: next });
  assert.deepEqual((await load(db, id)).user, before);
  await Promise.all([tick(closed, next, api), tick(closed, next, api)]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, id);
  assert.match(sent[0].text, /Твой отчёт/);
  assert.doesNotMatch(sent[0].text, /Факт о здоровье|Идея дня/);
  assert.equal((await load(db, id)).job.slot, next + DAY);
});

test('Bootstrap пропускает выключенную подписку, закрытую серию, чужой чат и неизвестные дни', async () => {
  await seed([150], { frequency: 'off' });
  await seed([151, 152, 153]);
  await seed([154], { frequency: 'weekly', weekdays: [] });
  await db.batch([
    statement('DELETE FROM delivery_jobs WHERE user_id BETWEEN 150 AND 154'),
    statement('UPDATE abstinence_intervals SET end=? WHERE user_id=151', now - DAY)
  ]);
  await tick({ ...env(), ALLOWED_CHAT_IDS: '150,151,153,154' }, now - 1, async () => assert.fail('Unexpected send'));
  assert.deepEqual((await statement('SELECT user_id FROM delivery_jobs WHERE user_id BETWEEN 150 AND 154').all()).results,
    [{ user_id: 153 }]);
  assert.equal((await load(db, 150)).profile.frequency, 'off');
});

test('Bootstrap не восстанавливает задание после смены подписки между чтением и записью', async () => {
  const id = 180;
  await seed([id]);
  await statement('DELETE FROM delivery_jobs WHERE user_id=?', id).run();
  const s = session(id);
  await s.nav('notifications');
  let changed = false;
  const wrappedDb = {
    prepare: db.prepare.bind(db),
    async batch(writes) {
      assert.equal(changed, false);
      changed = true;
      await s.press('Отключить уведомления');
      return db.batch(writes);
    }
  };
  await tick({ ...env(), CLOSED_TEST: '1', ALLOWED_CHAT_IDS: String(id), DB: wrappedDb }, now - 1,
    async () => assert.fail('Unexpected send'));
  assert.equal(changed, true);
  const state = await load(db, id);
  assert.equal(state.profile.frequency, 'off');
  assert.equal(state.job, null);
});
