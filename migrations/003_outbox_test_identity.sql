-- Keep test identity even when settings change while a message waits.
-- Historical messages without a round are conservatively treated as tests.
ALTER TABLE outbox ADD COLUMN test INTEGER NOT NULL DEFAULT 1 CHECK(test IN (0,1));
UPDATE outbox SET test=COALESCE((SELECT test FROM rounds WHERE rounds.id=outbox.round_id),1);
