-- Global ingest lock.
--
-- setlist.fm allows 2 requests/second, and the client spaces requests in process. But
-- serverless instances do not share memory, so two simultaneous first-lookups would each
-- believe they were within the limit.
--
-- A Postgres advisory lock is the textbook answer and does not work here: advisory locks
-- are session-scoped and neon-http is stateless HTTP, so no session survives between
-- statements.
--
-- Instead, this partial unique index lets the database hold at most one ingest_runs row
-- in the 'running' state at a time. A second concurrent claim fails on insert rather than
-- racing through a check-then-insert window, and lib/ingest/run.ts turns that failure
-- into a RUN_IN_PROGRESS error. Serialising runs globally is what makes the in-process
-- request spacing meaningful.
--
-- lib/ingest/run.ts clears rows left 'running' by a crashed invocation before claiming,
-- so a dead run cannot wedge the lock permanently.

CREATE UNIQUE INDEX ingest_runs_single_running_idx
  ON ingest_runs ((status))
  WHERE status = 'running';
