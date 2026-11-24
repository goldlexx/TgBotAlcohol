CREATE TABLE habit_drinks (
  user_id INTEGER NOT NULL,
  effective INTEGER NOT NULL,
  line INTEGER NOT NULL,
  drink TEXT NOT NULL,
  PRIMARY KEY(user_id,effective,line),
  FOREIGN KEY(user_id,effective,line) REFERENCES habit_items(user_id,effective,line) ON DELETE CASCADE
);
