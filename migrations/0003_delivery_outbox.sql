CREATE TABLE delivery_outbox (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  update_id INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  due_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, update_id, sequence)
);
CREATE INDEX outbox_due ON delivery_outbox(due_at, id) WHERE status IN ('ready', 'retry', 'sending');
