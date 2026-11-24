export class TelegramError extends Error {
  constructor(code, retry = 0) {
    super('Telegram request failed');
    this.code = code;
    this.retry = retry;
  }
}

export async function telegram(env, method, body) {
  if (!env.TELEGRAM_TOKEN) throw new TelegramError(0);
  try {
    const response = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_TOKEN + '/' + method, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(8_000)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new TelegramError(result.error_code ?? response.status, result.parameters?.retry_after);
    return result.result;
  } catch (error) {
    if (error instanceof TelegramError) throw error;
    throw new TelegramError(0);
  }
}

export function message(chat, screen) {
  const rows = screen.buttons.filter(row => row.length);
  return {
    chat_id: chat, text: screen.text, link_preview_options: { is_disabled: true },
    ...(screen.removeKeyboard ? { reply_markup: { remove_keyboard: true } }
      : rows.length ? { reply_markup: { inline_keyboard: rows } } : {})
  };
}

export const allowed = (env, id) => typeof env.ALLOWED_CHAT_IDS === 'string' &&
  (env.CLOSED_TEST === '1' ? env.ALLOWED_CHAT_IDS.trim() === String(id)
    : env.ALLOWED_CHAT_IDS.split(',').some(value => value.trim() === String(id)));
