-- Called only after BOTH application containers have stopped and a validated full backup exists.
BEGIN;
SELECT id FROM service_launch WHERE id=1 FOR UPDATE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM service_launch WHERE id=1 AND stage='starting' AND request_id=current_setting('classnet.launch_request')::uuid) THEN
  RAISE EXCEPTION 'Stale or duplicate official launch request';
 END IF;
END $$;
DO $$ BEGIN IF to_regclass('public."exam_answers"') IS NOT NULL THEN DELETE FROM "exam_answers"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."exam_proctor_events"') IS NOT NULL THEN DELETE FROM "exam_proctor_events"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."exam_attempts"') IS NOT NULL THEN DELETE FROM "exam_attempts"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."student_report_analysis"') IS NOT NULL THEN DELETE FROM "student_report_analysis"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."bookmarks"') IS NOT NULL THEN DELETE FROM "bookmarks"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."audit_log"') IS NOT NULL THEN DELETE FROM "audit_log"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."answer_cache"') IS NOT NULL THEN DELETE FROM "answer_cache"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Vote_v2"') IS NOT NULL THEN DELETE FROM "Vote_v2"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Message_v2"') IS NOT NULL THEN DELETE FROM "Message_v2"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Stream"') IS NOT NULL THEN DELETE FROM "Stream"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Chat"') IS NOT NULL THEN DELETE FROM "Chat"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Suggestion"') IS NOT NULL THEN DELETE FROM "Suggestion"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."Document"') IS NOT NULL THEN DELETE FROM "Document"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."sessions"') IS NOT NULL THEN DELETE FROM "sessions"; END IF; END $$;
DO $$ BEGIN IF to_regclass('public."request_limits"') IS NOT NULL THEN DELETE FROM "request_limits"; END IF; END $$;
DELETE FROM exam_sets WHERE kind <> 'admin_timed';
UPDATE users SET auth_version=auth_version+1,
 level=CASE WHEN role='student' THEN 'beginner' ELSE level END,
 manual_pre_test_score=CASE WHEN role='student' THEN NULL ELSE manual_pre_test_score END,
 manual_post_test_score=CASE WHEN role='student' THEN NULL ELSE manual_post_test_score END;
UPDATE service_launch SET stage='official',started_at=now(),backup_file=current_setting('classnet.launch_backup'),last_error=NULL WHERE id=1;
COMMIT;
