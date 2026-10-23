-- CSV 학생 등록: 메일을 입력하지 않은 계정은 NULL로 저장한다. 기존 값과 UNIQUE 제약은 유지한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
COMMIT;
