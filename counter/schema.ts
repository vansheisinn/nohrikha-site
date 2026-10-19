/** Idempotent initial schema; applied once per Worker instance. No resets. */
export const schema = `-- Aggregates only: one row per Moscow date, numeric counts, no visitor records.
CREATE TABLE IF NOT EXISTS totals (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0)
);
-- statement-break
INSERT OR IGNORE INTO totals (id, views) VALUES (1, 0);
-- statement-break
CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY NOT NULL,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  browsers INTEGER NOT NULL DEFAULT 0 CHECK (browsers >= 0 AND browsers <= views),
  direct INTEGER NOT NULL DEFAULT 0 CHECK (direct >= 0),
  google INTEGER NOT NULL DEFAULT 0 CHECK (google >= 0),
  yandex INTEGER NOT NULL DEFAULT 0 CHECK (yandex >= 0),
  bing INTEGER NOT NULL DEFAULT 0 CHECK (bing >= 0),
  telegram INTEGER NOT NULL DEFAULT 0 CHECK (telegram >= 0),
  whatsapp INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp >= 0),
  social INTEGER NOT NULL DEFAULT 0 CHECK (social >= 0),
  other INTEGER NOT NULL DEFAULT 0 CHECK (other >= 0),
  CHECK (browsers = direct + google + yandex + bing + telegram + whatsapp + social + other)
);
-- statement-break
CREATE TRIGGER IF NOT EXISTS daily_insert AFTER INSERT ON daily
BEGIN
  UPDATE totals SET views = views + NEW.views WHERE id = 1;
END;
-- statement-break
CREATE TRIGGER IF NOT EXISTS daily_update AFTER UPDATE OF views ON daily
BEGIN
  UPDATE totals SET views = views + NEW.views - OLD.views WHERE id = 1;
END;
`;
