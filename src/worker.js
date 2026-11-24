import { dialog } from './dialogs.js';
import { sections } from './views.js';
import { load, save, saveAwards } from './storage.js';
import { achievements } from './calculations.js';
import { allowed, message, telegram } from './telegram.js';
import { tick } from './scheduler.js';

const encoder = new TextEncoder();
const empty = () => new Response(null, { status: 204 });
const windows = new Map();

export async function authenticated(request, secret) {
  if (!secret) return false;
  const supplied = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const [a, b] = await Promise.all([supplied, secret].map(async s => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s)))));
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function subjectFor(id, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(String(id))));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function parseUpdate(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32_768) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  try { return JSON.parse(body + decoder.decode()); } catch { return null; }
}

function extract(update) {
  const cb = update?.callback_query;
  const msg = cb?.message ?? update?.message;
  const id = msg?.chat?.id;
  const from = cb?.from ?? msg?.from;
  const updateId = update?.update_id;
  if (msg?.chat?.type !== 'private' || !Number.isSafeInteger(id) || id <= 0 || id !== from?.id ||
      !Number.isSafeInteger(updateId) || updateId < 0 || from.is_bot) return null;
  const text = !cb && typeof msg.text === 'string' && msg.text.length <= 4096 ? msg.text.trim() : undefined;
  const callback = cb && typeof cb.data === 'string' && encoder.encode(cb.data).length <= 64 ? cb.data : undefined;
  if (!text && !callback) return null;
  return { id, updateId, text, callback, callbackId: cb?.id };
}

function limited(id, now) {
  const slot = Math.floor(now / 10_000), old = windows.get(id);
  if (windows.size >= 2048) windows.clear();
  const count = old?.slot === slot ? old.count + 1 : 1;
  windows.set(id, { slot, count });
  return count > 24;
}

export async function webhook(request, env, now = Date.now(), api = telegram) {
  if (!await authenticated(request, env.WEBHOOK_SECRET)) return new Response(null, { status: 403 });
  const input = extract(await parseUpdate(request));
  if (!input || !allowed(env, input.id) || !env.TELEGRAM_TOKEN) return empty();
  if (!['n:physical', 'n:emergency', 'n:help'].includes(input.callback) && input.text !== '/help' && limited(input.id, now)) return empty();
  const subject = await subjectFor(input.id, env.WEBHOOK_SECRET);
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await load(env.DB, input.id, input.updateId, subject);
    if (state.duplicate) return empty();
    response = dialog(state, input, now);
    if (!state.deleted && state.profile && !state.writes.some(([sql]) => sql.startsWith('DELETE FROM achievements'))) {
      saveAwards(state, input.id, achievements(state.intervals, now));
    }
    try {
      await save(env.DB, input.id, state, input.updateId, subject, now);
      break;
    } catch (error) {
      if (attempt === 4 || !/constraint failed/i.test(String(error))) return new Response(null, { status: 503 });
      response = null;
    }
  }
  if (response) {
    const ack = input.callbackId ? api(env, 'answerCallbackQuery', { callback_query_id: input.callbackId }).catch(() => {}) : null;
    try {
      if (response.keyboard) await api(env, 'sendMessage', {
        chat_id: input.id, text: 'Выбери раздел в меню.',
        reply_markup: { keyboard: sections.map(row => row.map(([text]) => ({ text }))), resize_keyboard: true, is_persistent: true }
      });
      await api(env, 'sendMessage', message(input.id, response));
    } catch {
      // The update is committed. Replaying it could duplicate a message whose delivery is unknown.
    }
    await ack;
  }
  return empty();
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health' && request.method === 'GET') {
      if (env.CLOSED_TEST === '1' && !await authenticated(request, env.WEBHOOK_SECRET)) {
        return new Response(null, { status: 404 });
      }
      return Response.json({ ok: true });
    }
    if (pathname === '/telegram/webhook' && request.method === 'POST') {
      try { return await webhook(request, env); } catch { return new Response(null, { status: 503 }); }
    }
    return new Response(null, { status: 404 });
  },
  async scheduled(event, env) {
    await tick(env, Date.now());
  }
};
