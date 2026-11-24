CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  generation TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  delivery_epoch INTEGER NOT NULL DEFAULT 0,
  fsm TEXT NOT NULL DEFAULT '{}',
  profile TEXT,
  neutral INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE habit_versions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('average','calendar')),
  period INTEGER NOT NULL CHECK(period IN (7,28)),
  currency TEXT NOT NULL,
  budget INTEGER,
  PRIMARY KEY(user_id,effective)
);
CREATE TABLE habit_items (
  user_id INTEGER NOT NULL,
  effective INTEGER NOT NULL,
  line INTEGER NOT NULL,
  weekday INTEGER CHECK(weekday BETWEEN 1 AND 7),
  portions REAL NOT NULL,
  ml REAL,
  abv REAL,
  price INTEGER,
  PRIMARY KEY(user_id,effective,line),
  FOREIGN KEY(user_id,effective) REFERENCES habit_versions(user_id,effective) ON DELETE CASCADE
);
CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start INTEGER NOT NULL,
  last INTEGER,
  precision TEXT CHECK(precision IN ('minute','instant','day'))
);
CREATE INDEX episodes_user ON episodes(user_id,start);
CREATE TABLE abstinence_intervals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start INTEGER NOT NULL,
  end INTEGER,
  precision TEXT NOT NULL,
  PRIMARY KEY(user_id,start)
);
CREATE TABLE achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  days INTEGER NOT NULL,
  PRIMARY KEY(user_id,days)
);
CREATE TABLE delivery_jobs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next_due_at INTEGER NOT NULL,
  slot INTEGER NOT NULL
);
CREATE INDEX due_jobs ON delivery_jobs(next_due_at,user_id);
CREATE TABLE delivery_receipts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_day TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  series INTEGER,
  milestone INTEGER,
  PRIMARY KEY(user_id,local_day)
);
CREATE INDEX receipt_milestones ON delivery_receipts(user_id,series,milestone);
CREATE TABLE update_dedup (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  update_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,update_id)
);
CREATE INDEX dedup_age ON update_dedup(created_at);
CREATE TABLE deletion_markers (
  subject TEXT PRIMARY KEY,
  update_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX deletion_age ON deletion_markers(expires_at);
CREATE TABLE transaction_guard (ok INTEGER NOT NULL CHECK(ok=1));
