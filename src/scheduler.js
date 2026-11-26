import { first, guard, load, saveAwards, stmt } from './storage.js';
import { achievements, reached } from './calculations.js';
import { FRESH, slotFor } from './schedule.js';
import { report } from './views.js';
import { DAY, today, hasReportDays } from './time.js';
import { hasMedicalRisk } from './safety.js';
import { allowed, message, telegram, TelegramError } from './telegram.js';

export const BATCH = 8;

async function deliver(env, job, now, api) {
  const db = env.DB, id = job.user_id;
  if (!allowed(env, id)) {
    await stmt(db, 'DELETE FROM delivery_jobs WHERE user_id=? AND next_due_at=? AND slot=?', id, job.next_due_at, job.slot).run();
    return;
  }
  const state = await load(db, id);
  const p = state.profile;
  const series = state.intervals.at(-1);
  const matchesUser = 'EXISTS(SELECT 1 FROM users WHERE id=? AND delivery_epoch=? AND generation=?)';
  if (!state.user) return; // Jobs have an ON DELETE CASCADE foreign key.
  const { delivery_epoch: epoch, generation } = state.user;
  if (!p || hasMedicalRisk(state) || p.frequency === 'off' || !hasReportDays(p) || series?.end !== null) {
    await stmt(db, 'DELETE FROM delivery_jobs WHERE user_id=? AND next_due_at=? AND slot=? AND ' + matchesUser,
      id, job.next_due_at, job.slot, id, epoch, generation).run();
    return;
  }
  const seriesId = state.episodes.at(-1)?.id ?? 0;
  const localDate = today(job.slot, p.zone);
  const period = today(now, p.zone);
  const next = slotFor(state, p.frequency === 'milestones' ? Math.max(now, job.slot) : now, period);
  const previous = await first(db, `SELECT *, (SELECT max(milestone) FROM delivery_receipts
    WHERE user_id=? AND series=? AND status IN ('sent','reserved','unknown')) AS highest,
    EXISTS(SELECT 1 FROM delivery_receipts WHERE user_id=? AND series=? AND status IN ('sent','reserved','unknown')) AS previous_report
    FROM (SELECT 1) LEFT JOIN delivery_receipts ON user_id=? AND local_day=?`, id, seriesId, id, seriesId, id, localDate);
  const fresh = now - job.slot <= FRESH && localDate === period;
  const available = !previous.status || previous.status === 'retry';
  const latest = reached(now - series.start).at(-1);
  const since = p.frequency === 'milestones' ? 8 * DAY : (p.frequency === 'daily' ? 2 : 8) * DAY;
  const milestone = latest > (previous.highest ?? 0) && now - (series.start + latest * DAY) < since ? latest : null;
  const ready = fresh && available && (p.frequency !== 'milestones' || milestone !== null);
  const attempts = (previous.attempts ?? 0) + 1;
  const batch = [
    guard(db, matchesUser, id, epoch, generation),
    guard(db, 'EXISTS(SELECT 1 FROM delivery_jobs WHERE user_id=? AND next_due_at=? AND slot=?)', id, job.next_due_at, job.slot),
    stmt(db, 'DELETE FROM delivery_jobs WHERE user_id=?', id)
  ];
  if (next !== null) batch.push(stmt(db, 'INSERT INTO delivery_jobs VALUES (?,?,?)', id, next, next));
  if (ready) batch.push(stmt(db, `INSERT INTO delivery_receipts VALUES (?,?, 'reserved', ?,?,?)
    ON CONFLICT(user_id,local_day) DO UPDATE SET status='reserved',attempts=excluded.attempts,
    series=excluded.series,milestone=excluded.milestone`, id, localDate, attempts, seriesId, milestone));
  saveAwards(state, id, achievements(state.intervals, now));
  for (const [sql, ...args] of state.writes) batch.push(stmt(db, sql, ...args));
  try {
    await db.batch(batch);
  } catch (error) {
    if (String(error).includes('CHECK constraint failed')) return;
    throw error;
  }
  if (!ready) return;
  const outgoing = message(id, report(state, now, id, localDate, {
    automatic: true, milestone, afterEpisode: seriesId !== 0 && !previous.previous_report
  }));
  if (!await first(db, 'SELECT 1 FROM users WHERE id=? AND delivery_epoch=? AND generation=?', id, epoch, generation)) return;
  let status = 'sent', retry = null;
  try {
    await api(env, 'sendMessage', outgoing);
  } catch (error) {
    const code = error instanceof TelegramError ? error.code : 0;
    const retryAt = now + Math.max(60_000, (Number(error?.retry) || 0) * 1000);
    if (code === 429 && attempts < 4 && retryAt <= job.slot + FRESH && today(retryAt, p.zone) === period) {
      status = 'retry';
      retry = retryAt;
    } else if (code === 403) status = 'blocked';
    else status = code > 0 && code < 500 ? 'rejected' : 'unknown';
  }
  const finish = [stmt(db, `UPDATE delivery_receipts SET status=? WHERE user_id=? AND local_day=? AND attempts=? AND
    EXISTS(SELECT 1 FROM users WHERE id=? AND generation=?)`, status, id, localDate, attempts, id, generation)];
  if (retry !== null) finish.push(stmt(db, `INSERT INTO delivery_jobs SELECT ?,?,? WHERE ${matchesUser}
    ON CONFLICT(user_id) DO UPDATE SET next_due_at=excluded.next_due_at,slot=excluded.slot`,
  id, retry, job.slot, id, epoch, generation));
  if (status === 'blocked') {
    finish.push(stmt(db, 'DELETE FROM delivery_jobs WHERE user_id=? AND ' + matchesUser, id, id, epoch, generation));
    finish.push(stmt(db, "UPDATE users SET rev=rev+1,delivery_epoch=delivery_epoch+1,profile=json_set(profile,'$.frequency','off') WHERE id=? AND delivery_epoch=? AND generation=?", id, epoch, generation));
  }
  await db.batch(finish);
}

export async function tick(env, now = Date.now(), api = telegram) {
  if (!env.TELEGRAM_TOKEN || !env.ALLOWED_CHAT_IDS) return;
  const db = env.DB;
  const due = await stmt(db, 'SELECT * FROM delivery_jobs WHERE next_due_at<=? ORDER BY next_due_at,user_id LIMIT ?', now, BATCH).all();
  const outcomes = await Promise.allSettled(due.results.map(job => deliver(env, job, now, api)));
  if (Math.floor(now / 60_000) % 60 === 0) await db.batch([
    stmt(db, 'DELETE FROM update_dedup WHERE rowid IN (SELECT rowid FROM update_dedup WHERE created_at<? ORDER BY created_at LIMIT 1000)', now - 7 * DAY),
    stmt(db, 'DELETE FROM deletion_markers WHERE subject IN (SELECT subject FROM deletion_markers WHERE expires_at<=? ORDER BY expires_at LIMIT 200)', now)
  ]);
  if (outcomes.some(result => result.status === 'rejected')) throw new Error('Scheduled delivery failed');
}
