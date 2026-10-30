-- Rebuild without the original one-round-per-day constraint. The migrator
-- disables foreign keys outside the transaction and verifies them before commit.
CREATE TABLE rounds_new (id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, day TEXT NOT NULL, opens INTEGER NOT NULL, closes INTEGER NOT NULL, sends INTEGER NOT NULL, arrives INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'planned', snapshot TEXT NOT NULL, digest TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, payment_mode TEXT NOT NULL, payment_link TEXT NOT NULL DEFAULT '', test INTEGER NOT NULL, invited INTEGER, reminded INTEGER, reminded2 INTEGER, alerted INTEGER, sent INTEGER, message_id TEXT, issue TEXT, automatic INTEGER NOT NULL DEFAULT 0);
INSERT INTO rounds_new SELECT id,number,day,opens,closes,sends,arrives,status,snapshot,digest,revision,payment_mode,payment_link,test,invited,reminded,reminded2,alerted,sent,message_id,issue,0 FROM rounds;
DROP TABLE rounds;
ALTER TABLE rounds_new RENAME TO rounds;
CREATE UNIQUE INDEX automatic_round_day ON rounds(day) WHERE automatic=1;
CREATE INDEX round_schedule ON rounds(status,opens,sends);
CREATE TRIGGER frozen_round_snapshot BEFORE UPDATE OF snapshot,digest ON rounds BEGIN SELECT RAISE(ABORT,'Round snapshots are immutable; cancel and recreate'); END;
