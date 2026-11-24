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
import { report } from '../src/views.js';
import { today } from '../src/time.js';

const now = Date.parse('2026-03-10T08:00Z');
const secret = 'local-synthetic-only';
const idRange = Array.from({ length: 200 }, (_, i) => 800_000 + i);
const chats = [...Array.from({ length: 30 }, (_, i) => 100 + i), ...idRange];
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

async function onboard(s, { notifications = false, habit = false } = {}) {
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('Другой город');
  await s.receive('UTC');
  await s.press('Подтвердить');
  await s.press('Указать дату и время');
  await s.receive('01.03.2026');
  const progress = await s.receive('07:00');
  if (habit) {
    await s.press('💰 Настроить статистику');
    await s.press('💰 Считать только деньги');
    await s.press('За неделю');
    await s.receive('1 400,00 ₽');
    await s.press('✅ Сохранить');
  }
  await s.nav('edit.goal');
  await s.press('7 дней');
  if (notifications) {
    await s.nav('edit.notify');
    await s.press('Каждый день в 08:00');
    await s.press('Включить отчёты');
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
    assert.match(await s.nav('craving'), /Резкое прекращение/);
    assert.match(await s.nav('crave.stress'), /медицинской оценкой/);
    const row = await get('SELECT profile,neutral,fsm FROM users WHERE id=?', id);
    assert.equal(row.profile, null);
    assert.equal(row.neutral, 1);
    assert.ok(!/urgent|symptom|initial|reason/.test(row.fsm));
  }
  const s = session(103);
  await s.receive('/start');
  await s.press('☀️ Начать');
  await s.press('Симптомов сейчас нет');
  assert.match(await s.press('Да / Не знаю'), /врачом заранее/);
  await s.press('Есть профессиональная помощь · нейтральный режим');
  await s.press(/^Москва /);
  assert.doesNotMatch(await s.press('Сейчас'), /Цель|█/);
  assert.equal(s.messages().length, 1);
});

test('Регистрация, /start без сброса, контент, цель, часовой пояс и выключение уведомлений', async () => {
  const s = session(104);
  assert.match(await onboard(s, { notifications: true, habit: true }), /9 дней 1 час/);
  assert.match(await s.receive('/start'), /Мой прогресс/);
  assert.match(await s.nav('progress'), /1[\s\u00a0]808/);
  assert.match(await s.nav('life'), /Жизнь без алкоголя/);
  assert.match(await s.press('🔄 Другая идея'), /Жизнь без алкоголя/);
  assert.match(await s.nav('recovery'), /ориентиры/);
  await s.press('ℹ️ Методика и источники');
  assert.match(await s.press('🔬 Научные источники'), /NIAAA/);
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
  await s.press('Употребление завершилось');
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
  assert.match(await s.receive('01.03.2026'), /Твой путь начался/);
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
  await s.press('📊 Настроить полную статистику');
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
  assert.match(await s.nav('progress'), /частично/);
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
  await s.press('💰 Считать только деньги');
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
  const expected = message(112, report(progress, now, 112, null, today(now, 'UTC')));
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
  assert.equal(await s.receive('/morning'), 'Твой отчёт готов');
  await s.nav('notifications');
  await s.press('Отключить уведомления');
});

async function seed(ids, options = {}) {
  const base = { ms: now - 9 * DAY, precision: 'minute' };
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
  const plan = await statement('EXPLAIN QUERY PLAN SELECT * FROM delivery_jobs WHERE next_due_at<=? ORDER BY next_due_at,user_id LIMIT 8', now).all();
  assert.match(plan.results.map(row => row.detail).join(' '), /due_jobs/);
  t.diagnostic('200/200 уникальных локальных отправок, 20 параллельных обновлений, ' + Math.round(performance.now() - start) + ' мс');
});
