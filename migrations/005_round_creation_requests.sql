-- Persistent idempotency for immediate and background round creation.
CREATE TABLE round_creation_requests (
  actor TEXT NOT NULL,
  id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created INTEGER NOT NULL,
  round_id TEXT REFERENCES rounds(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES menu_sync_jobs(id) ON DELETE SET NULL,
  PRIMARY KEY(actor,id)
);
CREATE INDEX round_creation_requests_created ON round_creation_requests(created);
