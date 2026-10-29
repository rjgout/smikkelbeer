CREATE TABLE menu_sync_jobs (
 id TEXT PRIMARY KEY,
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','interrupted')),
 phase TEXT NOT NULL DEFAULT 'queued',
 actor TEXT NOT NULL,
 purpose TEXT NOT NULL CHECK(purpose IN ('menu','round.create','round.validate')),
 payload TEXT,
 test INTEGER NOT NULL CHECK(test IN (0,1)),
 delay_ms INTEGER NOT NULL CHECK(delay_ms>=1000),
 processed INTEGER NOT NULL DEFAULT 0,
 total INTEGER NOT NULL DEFAULT 0,
 current_product_id TEXT,
 created INTEGER NOT NULL,
 started INTEGER,
 updated INTEGER NOT NULL,
 finished INTEGER,
 lease_owner TEXT,
 lease_until INTEGER,
 error_code TEXT,
 error_message TEXT,
 sync_id TEXT REFERENCES syncs(id) ON DELETE SET NULL,
 result_round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
 CHECK(processed>=0 AND processed<=total)
);
CREATE UNIQUE INDEX one_active_menu_sync ON menu_sync_jobs((1)) WHERE status IN ('queued','running');
CREATE INDEX menu_sync_job_history ON menu_sync_jobs(created DESC);
