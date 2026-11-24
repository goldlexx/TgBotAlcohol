import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { webhook } from '../src/worker.js';
import { tick } from '../src/scheduler.js';
import { TelegramError } from '../src/telegram.js';
import { DAY } from '../src/time.js';
import { defaults } from '../src/dialogs.js';

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
  let last, calls = 0;
  async function receive(value, options) {
    const out = [];
    const receivedAt = now + Math.floor(calls++ / 20) * 10_000;
    const answer = await webhook(request(id, value, options), env(), receivedAt, async (_, method, body) => {
      if (method === 'answerCallbackQuery') throw new TelegramError(400);
      out.push(body);
    });
    assert.equal(answer.status, 204);
    last = out.at(-1);
    return last?.text;
  }
  const nav = route => receive({ callback: 'n:' + route });
  const findButton = label => {
    const button = last?.reply_markup?.inline_keyboard?.flat().find(b => b.text === label);
    assert.ok(button, label + ' absent from ' + last?.text);
    return button.callback_data;
  };
  const press = label => receive({ callback: findButton(label) });
  return { receive, nav, press, findButton };
}

async function onboard(s, { notifications = false, habit = false } = {}) {
  await s.receive('/start');
  await s.press('Начать');
  await s.press('Симптомов сейчас нет');
  await s.press('Нет');
  await s.press('UTC');
  await s.press('Указать дату и время');
  await s.receive('2026-03-01 07:00');
  if (habit) {
    await s.press('Только расходы');
    await s.receive('7 RUB 1400');
  } else await s.press('Пропустить');
  await s.press('7 дней');
  if (notifications) {
    await s.press('Каждый день в 08:00');
    await s.press('Оба');
    await s.press('Нейтральный текст');
    await s.press('Подтверждаю');
  } else await s.press('Нет');
  return s.press('Начать');
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

test('P0 помощь до регистрации, симптомы и сомнения, дальнейший нейтральный маршрут', async () => {
  for (const [id, label] of [[101, 'Есть симптомы'], [102, 'Не уверен(а)']]) {
    const s = session(id);
    assert.match(await s.receive('/help'), /срочная помощь/);
    assert.match(await s.press('Экстренная помощь'), /112 или 103/);
    assert.match(await s.nav('emergency'), /трудно разбудить/);
    await s.receive('/start');
    await s.press('Начать');
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
  await s.press('Начать');
  await s.press('Симптомов сейчас нет');
  assert.match(await s.press('Да / Не уверен(а)'), /врачом заранее/);
  await s.press('Есть профессиональная помощь · нейтральный режим');
  await s.press('UTC');
  await s.press('Сейчас');
  assert.match(await s.press('Пропустить'), /Присылать отчёт/);
  await s.press('Нет');
  assert.doesNotMatch(await s.press('Начать'), /Цель|▓/);
});

test('Регистрация, /start без сброса, контент, цель, часовой пояс и выключение уведомлений', async () => {
  const s = session(104);
  assert.match(await onboard(s, { notifications: true, habit: true }), /9 дней 1 час/);
  assert.match(await s.receive('/start'), /Счастье без алкоголя/);
  assert.match(await s.nav('progress'), /1[\s\u00a0]808/);
  assert.match(await s.nav('life'), /Жизнь без алкоголя/);
  assert.match(await s.press('Другая идея'), /Жизнь без алкоголя/);
  assert.match(await s.nav('recovery'), /Ориентиры/);
  assert.match(await s.press('Научные источники'), /NIAAA/);
  assert.match(await s.nav('awards'), /3 из 12/);
  await s.nav('edit.zone');
  await s.press('Москва');
  const { profile } = await get('SELECT profile FROM users WHERE id=104');
  assert.equal(JSON.parse(profile).historyZone, 'UTC');
  const job = await get('SELECT * FROM delivery_jobs WHERE user_id=104');
  assert.ok(job.next_due_at > now);
  await s.nav('settings');
  assert.match(await s.press('Отключить уведомления'), /выключены/);
  assert.equal(await get('SELECT * FROM delivery_jobs WHERE user_id=104'), null);
});

test('Эпизод: пауза, повторная проверка безопасности, новая серия, коррекция и удаление', async () => {
  const s = session(105);
  await onboard(s, { habit: true });
  await s.nav('episode');
  await s.press('Употребление продолжается');
  await s.press('Помню только дату');
  await s.receive('2026-03-08');
  const oldConfirm = s.findButton('Подтвердить');
  assert.match(await s.press('Подтвердить'), /на паузе/);
  assert.match(await s.receive({ callback: oldConfirm }), /устарела/);
  assert.equal((await get('SELECT count(*) AS n FROM episodes WHERE user_id=105')).n, 1);
  await s.nav('episode');
  await s.press('Эпизод завершён');
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
      await s.nav('settings');
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
  assert.match(messages[0].text, /Новый рубеж · 7 дней/);
  assert.equal((await get('SELECT slot FROM delivery_jobs WHERE user_id=127')).slot, now + 5 * DAY);
});

test('200 синтетических профилей, общий слот, конкурирующий Cron и параллельные обновления', async t => {
  await seed(idRange.slice(0, 100), { privatePush: true });
  await seed(idRange.slice(100));
  await db.batch(idRange.flatMap(id => [
    statement('INSERT INTO habit_versions VALUES (?,?,?,?,?,?)', id, now - 9 * DAY, 'average', 7, 'RUB', 140000),
    statement('INSERT INTO habit_items VALUES (?,?,?,?,?,?,?,?)', id, now - 9 * DAY, 0, null, 2, 300, 12, null)
  ]));
  const sent = [];
  const api = async (_, method, body) => {
    if (method === 'sendMessage' && (body.text === 'Твой отчёт готов' || body.text.startsWith('☀️ Доброе утро!'))) sent.push(body.chat_id);
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
