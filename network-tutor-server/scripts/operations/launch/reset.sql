-- Data-preserving official launch (policy changed 2026-10-20).
-- Both application writers are stopped and a verified backup exists.
-- Historical filename retained for the host worker; no learning or account reset is allowed.
BEGIN;
SELECT id FROM service_launch WHERE id=1 FOR UPDATE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM service_launch WHERE id=1 AND stage='starting' AND request_id=current_setting('classnet.launch_request')::uuid) THEN
  RAISE EXCEPTION 'Stale or duplicate official launch request';
 END IF;
END $$;
UPDATE service_launch SET stage='official',started_at=now(),backup_file=current_setting('classnet.launch_backup'),last_error=NULL WHERE id=1;
COMMIT;
