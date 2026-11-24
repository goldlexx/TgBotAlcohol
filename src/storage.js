export const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
export const first = (db, sql, ...args) => stmt(db, sql, ...args).first();

export async function load(db, id, updateId = -1, subject = '') {
  const rows = (await db.batch([
    stmt(db, 'SELECT * FROM users WHERE id=?', id),
    stmt(db, 'SELECT * FROM episodes WHERE user_id=? ORDER BY start,id', id),
    stmt(db, 'SELECT * FROM abstinence_intervals WHERE user_id=? ORDER BY start', id),
    stmt(db, 'SELECT * FROM habit_versions WHERE user_id=? ORDER BY effective', id),
    stmt(db, 'SELECT * FROM habit_items WHERE user_id=? ORDER BY effective,line', id),
    stmt(db, 'SELECT 1 FROM update_dedup WHERE user_id=? AND update_id=?', id, updateId),
    stmt(db, 'SELECT 1 FROM deletion_markers WHERE subject=? AND update_id>=?', subject, updateId)
  ])).map(row => row.results);
  const [user] = rows[0];
  const items = Map.groupBy(rows[4], row => row.effective);
  return {
    user, profile: user?.profile ? JSON.parse(user.profile) : null,
    fsm: user ? JSON.parse(user.fsm) : {}, neutral: Boolean(user?.neutral),
    episodes: rows[1], intervals: rows[2],
    habits: rows[3].map(row => ({ ...row, items: items.get(row.effective) ?? [] })),
    duplicate: rows[5].length > 0 || (updateId >= 0 && rows[6].length > 0),
    writes: []
  };
}

export function guard(db, condition, ...args) {
  return stmt(db, 'INSERT INTO transaction_guard(ok) SELECT 0 WHERE NOT (' + condition + ')', ...args);
}

export async function save(db, id, state, updateId, subject, now) {
  const old = state.user;
  const batch = [];
  const add = (sql, ...args) => batch.push(stmt(db, sql, ...args));
  if (old) batch.push(guard(db, 'EXISTS(SELECT 1 FROM users WHERE id=? AND generation=? AND rev=?)', id, old.generation, old.rev));
  else {
    batch.push(guard(db, 'NOT EXISTS(SELECT 1 FROM deletion_markers WHERE subject=? AND update_id>=?)', subject, updateId));
    add('INSERT INTO users(id,generation) VALUES (?,?)', id, crypto.randomUUID());
  }
  if (state.deleted) {
    add('INSERT INTO deletion_markers VALUES (?,?,?) ON CONFLICT(subject) DO UPDATE SET update_id=max(update_id,excluded.update_id),expires_at=excluded.expires_at', subject, updateId, now + 7 * 86_400_000);
    add('DELETE FROM users WHERE id=?', id);
  } else {
    add('INSERT INTO update_dedup VALUES (?,?,?)', id, updateId, now);
    if (state.changed) {
      add('UPDATE users SET rev=rev+1,fsm=?,profile=?,neutral=? WHERE id=?', JSON.stringify(state.fsm), state.profile && JSON.stringify(state.profile), Number(state.neutral), id);
    }
    for (const [sql, ...args] of state.writes) add(sql, ...args);
  }
  await db.batch(batch);
}

export function saveTimeline(state, id, intervals) {
  state.intervals = intervals;
  state.writes.push(['DELETE FROM abstinence_intervals WHERE user_id=?', id]);
  for (const period of intervals) {
    state.writes.push(['INSERT INTO abstinence_intervals VALUES (?,?,?,?)', id, period.start, period.end, period.precision]);
  }
}

export function saveAwards(state, id, awards, reset = false) {
  if (reset) state.writes.push(['DELETE FROM achievements WHERE user_id=?', id]);
  for (const days of awards) {
    state.writes.push(['INSERT INTO achievements(user_id,days) VALUES (?,?) ON CONFLICT DO NOTHING', id, days]);
  }
}

export function saveHabit(state, id, habit, effective) {
  state.writes.push(['INSERT INTO habit_versions VALUES (?,?,?,?,?,?)', id, effective, habit.mode, habit.period, habit.currency, habit.budget]);
  for (const [line, row] of habit.items.entries()) {
    state.writes.push(['INSERT INTO habit_items VALUES (?,?,?,?,?,?,?,?)', id, effective, line, row.weekday, row.portions, row.ml, row.abv, row.price]);
  }
  state.habits.push({ ...habit, effective });
}

export function reschedule(state, id, slot) {
  state.writes.push(['UPDATE users SET delivery_epoch=delivery_epoch+1 WHERE id=?', id]);
  state.writes.push(['DELETE FROM delivery_jobs WHERE user_id=?', id]);
  if (slot !== null) state.writes.push(['INSERT INTO delivery_jobs VALUES (?,?,?)', id, slot, slot]);
}
