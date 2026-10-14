-- ===== 2026-10-14 공식 모의시험 =====
-- 관리자가 문항·응시 기간·제한 시간을 정해 전체 학생이 정해진 기간에 치르는 시험(exam/officialExam.ts).
-- 다른 시험(연습·모의고사·지정 시험)과 아예 따로 관리한다: 점수·정답·해설은 관리자가 공개하기 전까지 학생에게
-- 보이지 않고, 학습 순위·학습 리포트·오답노트·개인화 어디에도 반영하지 않는다.
ALTER TABLE exam_sets DROP CONSTRAINT IF EXISTS exam_sets_kind_check;
ALTER TABLE exam_sets ADD CONSTRAINT exam_sets_kind_check
  CHECK (kind IN ('mock','admin_timed','practice_custom','past_exam_round','official'));
ALTER TABLE exam_sets ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE exam_sets ADD COLUMN IF NOT EXISTS results_released BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_sets ADD COLUMN IF NOT EXISTS rank_released BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE exam_sets ADD COLUMN IF NOT EXISTS results_released_at TIMESTAMPTZ;
-- 이 횟수만큼 부정행위 의심 행동(화면 이탈·전체화면 해제 등)이 쌓이면 서버가 그 자리에서 자동 제출한다.
ALTER TABLE exam_sets ADD COLUMN IF NOT EXISTS max_violations INT NOT NULL DEFAULT 3;

ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;
-- 응시마다 서버가 정한 마감 시각(시작 + 제한시간과 응시 기간 끝 중 이른 쪽). 비어 있으면 예전처럼
-- started_at + time_limit_minutes로 계산한다.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ;
-- 공식 모의시험: 응시를 시작한 브라우저에만 준 토큰의 SHA-256 — 다른 기기·탭에서는 이어 풀 수 없다.
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS device_token_hash TEXT;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS start_ip TEXT;
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS start_user_agent TEXT;

-- 공식 모의시험은 학생당 한 번(관리자가 무효 처리한 응시는 제외) — 시작 요청이 동시에 두 번 와도 하나만 생긴다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_attempts_official_once
  ON exam_attempts(exam_set_id, user_id) WHERE is_official AND status <> 'invalidated';
CREATE INDEX IF NOT EXISTS idx_exam_attempts_official_active
  ON exam_attempts(user_id) WHERE is_official AND status = 'in_progress';

-- 공식 모의시험 전용으로 관리자가 직접 낸 문제 — 문제은행(연습·검색·모의고사·채팅 추천)에는 절대 나오지 않는다.
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_status_check;
ALTER TABLE exam_questions ADD CONSTRAINT exam_questions_status_check
  CHECK (status IN ('pending_review','approved','rejected','exam_only'));
-- ===== 끝: 공식 모의시험 =====

-- ===== 2026-10-14 지정 시험 1회 응시 강제 =====
-- 예전엔 "이전 응시가 있나 확인 → 없으면 새로 만들기"를 따로 해서, 시작 요청을 동시에 두 번 보내면 응시가
-- 두 개 생겼다(하나를 제출해 정답을 보고 다른 하나를 만점으로 내는 부정행위가 가능했다 — 보안 감사).
-- 새 응시부터는 one_shot으로 표시하고 DB가 학생당 하나만 허용한다(기존 응시는 건드리지 않는다).
ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS one_shot BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_attempts_one_shot
  ON exam_attempts(exam_set_id, user_id) WHERE one_shot AND status <> 'invalidated';
-- ===== 끝: 지정 시험 1회 응시 강제 =====

-- ===== 2026-10-14 처음부터 배우기(학습 경로) =====
-- 단원 목록과 순서는 웹(lib/textbook/curriculum.ts)이 정한다. 서버는 학생별로 어느 단원을 읽고 끝냈는지만 기록한다.
-- 단원 확인 문제는 일반 연습 응시(practice_custom)로 만들어 리포트·오답노트에 그대로 잡히게 하고, 여기엔 그 응시 번호만 둔다.
CREATE TABLE IF NOT EXISTS learn_progress (
  user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_slug     TEXT NOT NULL CHECK (lesson_slug ~ '^[a-z0-9-]{1,60}$'),
  first_read_at   TIMESTAMPTZ,
  last_read_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  quiz_attempt_id INT REFERENCES exam_attempts(id) ON DELETE SET NULL,
  quiz_correct    INT,
  quiz_total      INT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_slug)
);
CREATE INDEX IF NOT EXISTS idx_learn_progress_recent ON learn_progress (user_id, updated_at DESC);
-- ===== 끝: 처음부터 배우기 =====
