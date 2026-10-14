-- 네트워크관리사 2급 AI 튜터 — 핵심 스키마
-- 152개 개념노드에 해당하는 단위: concept_nodes (온톨로지 노드 = RAG 청크 단위)
-- 표 데이터(cable_spec, port_table, raid_level 등): lookup_tables (reg 조회형 소스)

CREATE TABLE IF NOT EXISTS concept_nodes (
  id            SERIAL PRIMARY KEY,
  subject       TEXT NOT NULL,
  category      TEXT NOT NULL,
  topic         TEXT NOT NULL,
  tag_path      TEXT NOT NULL,
  section_no    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL,
  body_text     TEXT NOT NULL,
  order_index   INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_concept_nodes_tag_path ON concept_nodes(tag_path);
CREATE INDEX IF NOT EXISTS idx_concept_nodes_subject ON concept_nodes(subject);
CREATE INDEX IF NOT EXISTS idx_concept_nodes_category ON concept_nodes(subject, category);

CREATE TABLE IF NOT EXISTS lookup_tables (
  id          SERIAL PRIMARY KEY,
  node_id     INT REFERENCES concept_nodes(id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  row_order   INT NOT NULL,
  row_data    JSONB NOT NULL,
  -- JSONB는 키 순서를 보존하지 않는다(원문 표의 첫 컬럼이 뭐였는지 여기서 유실됨) — 원래 마크다운
  -- 표 헤더 순서를 별도로 남겨야 "이 표의 식별 컬럼이 뭔지" 같은 걸 안전하게 알 수 있다.
  col_order   JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lookup_tables_name ON lookup_tables(table_name);
CREATE INDEX IF NOT EXISTS idx_lookup_tables_row_data ON lookup_tables USING GIN (row_data);

CREATE TABLE IF NOT EXISTS node_embeddings (
  node_id     INT PRIMARY KEY REFERENCES concept_nodes(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  embedding   JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 사용자 / 인증 ----------
-- 회원가입 없음: 관리자가 계정을 생성(단건 또는 CSV 일괄)하고, 학생은 학교 이메일+비밀번호로만 로그인한다.
CREATE TABLE IF NOT EXISTS users (
  id                        SERIAL PRIMARY KEY,
  role                      TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin','student')),
  student_id                TEXT UNIQUE,
  name                      TEXT NOT NULL,
  birthdate                 DATE,
  email                     TEXT NOT NULL UNIQUE,
  password_hash             TEXT NOT NULL,
  level                     TEXT NOT NULL DEFAULT 'intermediate' CHECK (level IN ('beginner','intermediate','advanced')),
  openai_api_key_encrypted  TEXT,
  created_by                INT REFERENCES users(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id                    SERIAL PRIMARY KEY,
  user_id               INT REFERENCES users(id) ON DELETE SET NULL,
  session_id            TEXT,
  question              TEXT NOT NULL,
  intent                TEXT NOT NULL,
  retrieved_node_ids     INT[] DEFAULT '{}',
  rule_engine_trace      JSONB,
  llm_raw_answer         TEXT,
  verification_status    TEXT NOT NULL,
  verification_detail    JSONB,
  final_answer           TEXT NOT NULL,
  confidence              NUMERIC,
  reviewed                BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 학생이 "이 답변 이상해요" 버튼으로 직접 신고한 것과, 자동 검증에서 걸린 것을 구분하기 위한 플래그.
  student_reported          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_audit_log_status ON audit_log(verification_status);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS answer_cache (
  cache_key       TEXT PRIMARY KEY,
  question        TEXT NOT NULL,
  intent          TEXT NOT NULL,
  final_answer    TEXT NOT NULL,
  source_node_ids INT[] DEFAULT '{}',
  confidence      NUMERIC,
  hit_count       INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_hit_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 이미 배포된 스키마에 새 컬럼을 안전하게 추가(재실행 가능한 마이그레이션)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

-- ---------- 문제은행 / 시험 엔진 ----------
-- source는 데이터 출처에 대해 정직하기 위한 필드다: 지금은 전부 'ai_generated'(교재 근거 + 규칙엔진
-- 재검증 + 교사 승인을 거친)만 채워진다. 나중에 정당한 방법(구매/허락/직접 입력)으로 실제 기출을
-- 확보하면 'past_exam'으로 채워 같은 테이블·같은 엔진을 그대로 쓸 수 있게 설계했다.
CREATE TABLE IF NOT EXISTS exam_questions (
  id                    SERIAL PRIMARY KEY,
  source                TEXT NOT NULL DEFAULT 'ai_generated' CHECK (source IN ('ai_generated','admin_authored','past_exam')),
  source_detail         JSONB,
  subject               TEXT NOT NULL,
  concept_node_id       INT REFERENCES concept_nodes(id),
  stem                  TEXT NOT NULL,
  -- multiple_choice만 choices/correct_index를 쓴다. short_answer는 accepted_answers로 자동채점,
  -- subjective/essay는 정답이 하나로 정해지지 않아 model_answer(모범답안, 참고용)만 두고 교사가 직접 채점한다.
  question_type         TEXT NOT NULL DEFAULT 'multiple_choice' CHECK (question_type IN ('multiple_choice','short_answer','subjective','essay')),
  choices               JSONB,
  correct_index         INT,
  accepted_answers      JSONB,
  model_answer          TEXT,
  max_score             NUMERIC NOT NULL DEFAULT 1,
  explanation           TEXT,
  difficulty            TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  status                TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review','approved','rejected')),
  verification_detail   JSONB,
  created_by            INT REFERENCES users(id),
  reviewed_by           INT REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  stem_image_url        TEXT,
  -- past_exam로 적재된 직후에는 explanation에 정답만 담겨 있다("[회차 기출] 정답: X") — 백그라운드
  -- 배치(enrichPastExamExplanations.ts)가 근거를 갖춘 해설로 순차 교체하며 이 값을 true로 바꾼다.
  explanation_enriched  BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_subject ON exam_questions(subject);
CREATE INDEX IF NOT EXISTS idx_exam_questions_status ON exam_questions(status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_concept ON exam_questions(concept_node_id);

-- 모의고사(mock, 매 응시마다 자동 구성) / 관리자 출제 시험(admin_timed, 고정된 문항+시간) / 개인 맞춤
-- 연습 세트(practice_custom) 모두 이 테이블 하나로 표현한다.
CREATE TABLE IF NOT EXISTS exam_sets (
  id                     SERIAL PRIMARY KEY,
  kind                   TEXT NOT NULL CHECK (kind IN ('mock','admin_timed','practice_custom','past_exam_round')),
  title                  TEXT NOT NULL,
  created_by             INT REFERENCES users(id),
  duration_minutes       INT,
  question_ids           INT[] NOT NULL DEFAULT '{}',
  subject_distribution   JSONB,
  scheduled_start        TIMESTAMPTZ,
  scheduled_end          TIMESTAMPTZ,
  is_published           BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_sets_kind ON exam_sets(kind);

-- 응시 1회 = 1 row. question_ids/choice_order는 이 응시자에게 배정된(섞인) 순서를 그대로 스냅샷
-- 떠서 저장한다 — 부정행위 방지(문항·보기 순서를 학생마다 다르게)와 재현성(나중에 "그때 그 시험"을
-- 그대로 다시 볼 수 있음)을 동시에 만족시키기 위해서다.
CREATE TABLE IF NOT EXISTS exam_attempts (
  id                  SERIAL PRIMARY KEY,
  exam_set_id         INT REFERENCES exam_sets(id),
  user_id             INT NOT NULL REFERENCES users(id),
  question_ids        INT[] NOT NULL,
  choice_order        JSONB,
  time_limit_minutes  INT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at        TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','auto_submitted','invalidated')),
  score               NUMERIC,
  flagged_for_review  BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_user ON exam_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_set ON exam_attempts(exam_set_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_status ON exam_attempts(status);

CREATE TABLE IF NOT EXISTS exam_answers (
  id              SERIAL PRIMARY KEY,
  attempt_id      INT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id     INT NOT NULL REFERENCES exam_questions(id),
  selected_index  INT,
  answer_text     TEXT,
  is_correct      BOOLEAN,
  -- multiple_choice/short_answer는 제출 즉시 자동 채점되어 score가 바로 찬다. subjective/essay는
  -- score가 채점 전까지 NULL로 남아있고, 교사가 검수 큐(admin/exam/grading)에서 직접 채점한다.
  score           NUMERIC,
  graded_by       INT REFERENCES users(id),
  graded_at       TIMESTAMPTZ,
  grader_feedback TEXT,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_answers_attempt ON exam_answers(attempt_id);

-- 완전한 부정행위 방지는 불가능하다(웹캠 감독 등은 별도 소프트웨어 영역) — 여기서는 브라우저에서
-- 관찰 가능한 이상 신호를 전부 기록해 교사가 사후 검토할 수 있게 하는 수준으로 설계했다.
CREATE TABLE IF NOT EXISTS exam_proctor_events (
  id           SERIAL PRIMARY KEY,
  attempt_id   INT NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_proctor_events_attempt ON exam_proctor_events(attempt_id);

ALTER TABLE lookup_tables ADD COLUMN IF NOT EXISTS col_order JSONB;

-- ---------- 학습 편의 기능 ----------
CREATE TABLE IF NOT EXISTS bookmarks (
  id               SERIAL PRIMARY KEY,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  concept_node_id  INT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, concept_node_id)
);

-- 전역 설정용 단순 key-value 테이블. 지금은 시험일 카운트다운(key='exam_date') 하나만 쓴다.
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- "나의 학습 리포트" 맨 아래에 붙는 AI 종합 분석 글 — 매번 새로 생성하면 페이지를 열 때마다 LLM 호출이
-- 걸려 느리므로 캐시해두고, 학생이 "다시 생성"을 누르거나 일정 시간이 지나야 갱신한다.
CREATE TABLE IF NOT EXISTS student_report_analysis (
  user_id       INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 사후테스트는 classnet 밖(오프라인/다른 플랫폼)에서 치러지는 경우가 있어, 관리자가 점수를 직접
-- 입력할 수 있어야 한다. 지정 시험으로 사이트에서 직접 치른 기록이 있으면 그 점수를 자동으로 쓰고,
-- 없으면 이 값을 대신 쓴다(ranking/analytics 쿼리에서 COALESCE로 처리).
ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_post_test_score NUMERIC;

-- 학과(예: 소프트웨어융합과) — 명단에 포함되어 함께 관리되는 참고 정보.
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;

-- 사전테스트도 사후테스트와 동일하게 관리자가 직접 입력하는 방식으로 바꿨다(요청 반영, 2026-08-19).
-- 지정 시험으로 사이트에서 직접 치른 기록이 있으면 그 점수를 자동으로 쓰고, 없으면 이 값을 대신
-- 쓴다(ranking/analytics 쿼리에서 COALESCE로 처리) — manual_post_test_score와 동일한 패턴.
ALTER TABLE users ADD COLUMN IF NOT EXISTS manual_pre_test_score NUMERIC;

-- 바로 정오답을 보여주는 연습에서 "정답 확인"으로 정답을 공개한 시각. 공개한 문항은 답을 바꿀 수 없고,
-- 진행 중인 응시의 답은 공개된 것만 오답노트에 나온다(examService.submitAnswer, studentReport.getWrongAnswers).
ALTER TABLE exam_answers ADD COLUMN IF NOT EXISTS revealed_at TIMESTAMPTZ;

-- ===== 2026-10-14 서비스 복구: 검색 임베딩을 모델별로 저장 =====
-- node_embeddings는 노드당 벡터 1개(PK node_id)라 임베딩 모델을 바꾸려면 기존 벡터를 덮어써야 했고,
-- 그 경로(ingest)는 concept_nodes를 TRUNCATE ... CASCADE해서 문제은행·학생 답안까지 지울 수 있었다.
-- 여기에는 (node_id, model)마다 벡터를 따로 둔다 — model은 llm/embedding.ts의 activeEmbeddingModelId()
-- (예: openai:text-embedding-3-small:1536). 채우는 것은 `npm run embed:nodes`이고 concept_nodes는 읽기만
-- 한다. 기존 node_embeddings의 bge-m3 벡터는 그대로 둔다(corpus.ts가 재임베딩 전까지 함께 읽는다).
CREATE TABLE IF NOT EXISTS concept_embeddings (
  node_id     INT NOT NULL REFERENCES concept_nodes(id) ON DELETE CASCADE,
  model       TEXT NOT NULL,
  dims        INT NOT NULL,
  embedding   JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (node_id, model)
);
-- ===== 끝: 검색 임베딩을 모델별로 저장 =====

-- Shared admission counters and password-reset invalidation for browser JWTs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS request_limits (
  key TEXT PRIMARY KEY,
  bucket BIGINT NOT NULL,
  count INT NOT NULL CHECK (count > 0)
);

-- Phase2 only: class defines grade; unassigned historical identities remain NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS class_code TEXT
  CHECK (class_code IN ('1-A','1-B','1-C','2','3','4'));
CREATE INDEX IF NOT EXISTS idx_users_class_code ON users(class_code) WHERE role='student';

-- One-way phase2 beta -> official transition. Never applied to the phase1 archive.
CREATE TABLE IF NOT EXISTS service_launch (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  stage TEXT NOT NULL CHECK (stage IN ('beta','starting','official')),
  request_id UUID,
  requested_by INT,
  requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  backup_file TEXT,
  last_error TEXT
);
INSERT INTO service_launch(id,stage) VALUES(1,'beta') ON CONFLICT(id) DO NOTHING;

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

-- ===== 2026-10-14 기출문제 과목 값 바로잡기 =====
-- 기출 시험지 1~10번(내용은 TCP/IP)에 '1과목_네트워크_일반', 11~27번(내용은 네트워크 일반)에 '2과목_TCP_IP'가 붙어 있었다.
-- 적재할 때 시험지의 문항 위치를 시행처 과목 순서(네트워크일반·TCP/IP·NOS·운용기기)로 옮긴 탓이다 — '1과목_네트워크_일반' 기출의
-- 약 73%가 IP·TCP·UDP·서브넷·DNS 주제였고, 변조·다중화·CRC·HDLC는 '2과목_TCP_IP' 쪽에 있었다.
-- 기출(source='past_exam')만 두 값을 맞바꾼다. AI가 만든 문제와 개념 노드는 처음부터 내용대로 붙어 있어 건드리지 않는다.
-- 맞바꾸기는 두 번 하면 되돌아가므로 data_fixes에 한 번 한 것을 기록한다.
CREATE TABLE IF NOT EXISTS data_fixes (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM data_fixes WHERE name = '2026-10-14-past-exam-subject-swap') THEN
    UPDATE exam_questions
       SET subject = CASE subject WHEN '1과목_네트워크_일반' THEN '2과목_TCP_IP' ELSE '1과목_네트워크_일반' END
     WHERE source = 'past_exam' AND subject IN ('1과목_네트워크_일반', '2과목_TCP_IP');
    INSERT INTO data_fixes (name) VALUES ('2026-10-14-past-exam-subject-swap');
  END IF;
END $$;
-- ===== 끝: 기출문제 과목 값 바로잡기 =====
