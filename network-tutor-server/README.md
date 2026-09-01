# 네트워크관리사 2급 AI 튜터 — 서버

`ref/` 문서(기획서, 기능명세 v2, 정규화 참조데이터)를 기반으로 구현한 백엔드 + 학생용/관리자용 웹앱입니다.
규칙엔진(reg) + 하이브리드 RAG(BM25+bge-m3 임베딩+RRF) + 온톨로지 확장 + LLM 생성(Ollama/OpenAI) +
자기검증 + 감사로그 + 캐싱에, 학교 실사용 파일럿에 필요한 인증·관리자·개인화 계층을 더했습니다.

## 실행

```bash
npm install
npm run migrate     # Postgres에 스키마 생성 (DB: network_tutor)
npm run ingest       # ref/정규화_참조데이터_final.md 파싱 → concept_nodes/lookup_tables + bge-m3 임베딩
npx tsx src/db/seedAdmin.ts   # 최초 관리자 계정 생성 (ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME 환경변수로 지정 가능)
npm run dev          # http://localhost:3300 (watch 모드) — 또는 npm start
```

- 학생용: `http://localhost:3300/` — 로그인 필수, 회원가입 없음(관리자가 계정 발급)
- 관리자용: `http://localhost:3300/admin/` — 같은 로그인 API를 쓰되 role이 admin인 계정만 통과

`.env`는 최초 실행 시 `ENCRYPTION_KEY`(OpenAI 키 암호화용), `SESSION_SECRET`을 자동 생성해 기록합니다.
운영 배포 시 `COOKIE_SECURE=true`(HTTPS 전제), `COOKIE_DOMAIN=.classnet.chat`(서브도메인 간 세션 공유가
필요할 때만) 등을 설정하세요. 기본값(도메인 미지정)은 학생/관리자 세션이 서로 다른 서브도메인에서 자동으로
분리되는 더 안전한 설정입니다.

## 배포 상태 (classnet.chat)

이 서버(3.38.232.17)에 실제로 배포되어 있습니다.

- `network-tutor.service` systemd 서비스로 상시 구동(부팅 시 자동 시작, 크래시 시 자동 재시작).
  `sudo systemctl status|restart|stop network-tutor` / `journalctl -u network-tutor -f`로 관리.
- nginx가 두 도메인을 같은 백엔드(127.0.0.1:3300)로 라우팅: `classnet.chat`은 그대로, `admin.classnet.chat`은
  `/api/*`만 그대로 두고 나머지는 백엔드의 `/admin/` 정적 콘솔로 매핑
  (`/etc/nginx/sites-available/classnet.chat.conf`, `admin.classnet.chat.conf`).
- **남은 작업(사용자 쪽)**: 아래 DNS 레코드를 만들어야 실제로 접속됩니다.

  | 호스트 | 타입 | 값 |
  |---|---|---|
  | `classnet.chat` | A | `3.38.232.17` |
  | `www.classnet.chat` | A | `3.38.232.17` |
  | `admin.classnet.chat` | A | `3.38.232.17` |

  DNS가 전파된 뒤 아래 명령으로 Let's Encrypt HTTPS를 붙일 수 있습니다(신호를 주시면 대신 실행해 드립니다):
  ```bash
  sudo certbot --nginx -d classnet.chat -d www.classnet.chat
  sudo certbot --nginx -d admin.classnet.chat
  ```

## 인증 · 계정 관리

- 회원가입 없음. 관리자가 `/admin/`에서 계정을 만들거나 CSV로 일괄 등록해야만 로그인 가능.
- 로그인은 학교 이메일 + 비밀번호(httpOnly 세션 쿠키, scrypt 해시).
- 관리자 계정 생성 시 학번·이름·생년월일·이메일·비밀번호 입력. CSV 일괄 등록도 동일 필드
  (`학번,이름,생년월일,메일,비밀번호` 헤더, 영문 컬럼명도 지원).
- 관리자 콘솔에서 전체 학생의 질문·답변 기록, 과목별 질문 분포, 검증 상태를 확인하고 비밀번호를 초기화할 수 있음.
- "성적"에 해당하는 정식 채점 데이터는 없음(기출문제 DB 자체가 없어 진짜 시험 채점 기능은 미구현) — 대신
  질문 수·검증 통과율·과목별 질문 분포로 학습 활동을 보여줌. 실제 채점형 기능(오답노트, 모의고사)을 원하면
  comcbt 기출문제 파이프라인(아래 "구현하지 않은 것" 참고)이 먼저 필요.

## 개인화 · AI 정책

- 학생이 `내 설정`에서 학습 수준(입문/중급/고급)을 선택하면 이후 모든 답변의 설명 난이도가 그에 맞춰짐.
- **연구용이 아닌 실서비스 정책**: RAG 컨텍스트에만 근거하도록 강제하지 않음. 교재에 없는 내용은 AI의
  배경지식으로 답하되 `[교재 범위 외 - AI 배경지식]`로 라벨링. 자기검증은 "컨텍스트 포함 여부"가 아니라
  "명백한 사실 오류가 있는가"를 기준으로 하며, 검증에 우려가 있어도 답변 자체는 항상 즉시 제공하고
  교사 검수 큐에만 남긴다(회피·응답 지연보다 교사 사후 확인이 낫다는 판단).
- 사진으로 질문 가능(`imageBase64`, gemma4-e4b vision 지원 확인됨). 문제 지문+보기를 직접 입력해
  해설을 요청하는 전용 폼(`/api/problem/explain`)도 있음.
- 기본 AI는 학교 자체 호스팅 Ollama(gemma4-e4b, Tailscale 사설망). 학생이 `내 설정`에서 본인 OpenAI
  API 키를 등록하면 해당 질문은 ChatGPT(gpt-4o-mini)로 처리됨(키는 AES-256-GCM으로 암호화 저장, 임베딩/검색은
  항상 bge-m3·Ollama로 고정 — 벡터 차원이 달라 프로바이더를 섞을 수 없음).

## 파이프라인 동작

1. **의도 라우팅**: 정규식 기반으로 계산형(서브넷/진법변환/IP클래스/채널용량)을 우선 감지 → 규칙엔진 직행.
2. **조회형**: 하이브리드 검색 상위 노드들 중 질문의 "구별력 있는 토큰"(포트 번호, CAT6 같은 숫자·코드,
   순수 영문 약어는 여러 표에 두루 나와 오탐 위험이 커 제외)이 표의 특정 행에만 걸리면 그 행 데이터만
   근거로 LLM이 문장으로 포장. 검증 실패 시 표 데이터를 그대로 노출.
3. **설명형**: BM25(2-gram 토크나이저) + bge-m3 코사인 유사도를 RRF로 융합, 온톨로지 1-hop(형제 노드) 확장,
   계층적 컨텍스트 조립 후 생성. 컨텍스트가 없어도 회피하지 않고 배경지식으로 답변(위 "AI 정책" 참고).
4. **자기검증**: 계산형/조회형은 산출값·매칭 행과의 수치 대조. 설명형은 LLM 팩트체커 호출(도메인 사실
   오류만 판정, 실패 시 어휘 중첩 휴리스틱 폴백). 계산/조회는 검증 실패 시 규칙엔진·표 데이터를 직접 노출해
   틀린 문장이 나가는 일 자체를 차단.
5. **감사로그**: 모든 요청을 `audit_log`에 사용자·질문·의도·검색근거·검증결과·최종답변과 함께 기록.
   관리자 콘솔에서 상태별 필터링, 학생별 조회, 검수 완료 처리 가능.
6. **캐싱**: 검증을 통과한 답변만 `answer_cache`에 저장(질문+학습수준 조합 키). 이미지 첨부 질문은 캐시 제외.

## API

인증(로그인 필요, `requireAuth`) / 관리자 전용(`requireAdmin`)으로 구분됩니다.

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`
- `PATCH /api/me/profile {level}`, `PUT/DELETE /api/me/openai-key`
- `POST /api/ask {question, imageBase64?, useOwnKey?}` — 전체 파이프라인 진입점
- `POST /api/problem/explain {stem, choices?, extraQuestion?, imageBase64?}` — 문제 입력 해설 요청
- `POST /api/calc/subnet|ip-class|base-convert|channel-capacity` — 규칙엔진 직접 호출(계산 과정 포함)
- `GET /api/ontology/tree`, `GET /api/ontology/node/:id`
- `GET /api/lookup/tables`, `GET /api/lookup/tables/:tableName`
- **관리자**: `POST /api/admin/users`, `POST /api/admin/users/bulk-csv`, `GET /api/admin/users`,
  `GET /api/admin/users/:id`, `GET /api/admin/users/:id/history`, `POST /api/admin/users/:id/reset-password`,
  `DELETE /api/admin/users/:id`, `GET /api/audit`, `GET /api/audit/:id`, `POST /api/audit/:id/review`,
  `GET /api/audit-summary/stats`

## 문제은행 · 시험 엔진 (2번째 확장)

- `src/exam/`: 문제 생성 3종(규칙엔진 결정론적 계산형 `generateCalcQuestions`, 정규화 표 결정론적 조회형
  `generateLookupQuestions`, LLM+자기검증 개념형 `generateConceptQuestions`) + 시험 로직(`examService.ts`).
  전부 `source='ai_generated'`, `status='pending_review'`로 시작하며 관리자 승인 전에는 학생에게 노출되지
  않습니다(기획서 5절의 "템플릿 제한·재검증·승인 워크플로" 안전장치를 실제 코드로 구현).
- `npx tsx src/exam/runGeneration.ts` — 배치 생성 실행(계산형 30 + 조회형 표당 최대 2 + 개념형 노드당 1).
- 학생: 연습(`/api/exam/practice/*`, 즉시 채점), 모의고사(`/api/exam/mock/*`, 실제 과목별 배분 10/17/18/5,
  총 50문항·60분), 관리자 지정 시험(`/api/exam/timed/:id/*`, 응시 중엔 정답 비공개, 제출 후 해설).
- 관리자: `/api/admin/exam/questions/*`(검수 큐 승인/반려/직접출제), `/api/admin/exam/sets/*`(시험
  생성·공개), `/api/admin/exam/attempts`(응시 현황, `flagged=true`로 부정행위 의심 응시만 필터).
- 부정행위 방지(`exam_proctor_events`): 화면 이탈·전체화면 해제·복사/붙여넣기 감지 + 문항·보기 순서
  학생별 셔플 + 서버 기준 제한시간(클라이언트 시계 조작 무관) + 3회 반복 시 자동 `flagged_for_review`.
  **완벽한 부정행위 방지는 아닙니다** — 웹캠 감독처럼 별도 소프트웨어가 필요한 영역은 다루지 않고,
  "관찰 가능한 이상 신호를 기록해 교사가 사후 판단"하는 수준으로 설계했습니다.
- 관리자 콘솔은 `network-tutor-web`(Next.js) 쪽 `/admin/*`로 이전했습니다 — 학생 페이지와 동일한
  사이드바/테마를 씁니다. 이 저장소(Express)의 `/admin/*` 정적 페이지는 더 이상 서빙되지 않고
  `/api/admin/*`, `/api/audit*` API만 내부 신뢰 호출(x-internal-secret)로 계속 사용됩니다.

## 이번 세션에서 구현하지 않은 것 (별도 인프라/자격증명 필요)

- Discord/Chat SDK 봇 어댑터 — 봇 토큰 필요
- **comcbt.com 실제 기출문제** — robots.txt는 크롤링을 허용하지만 사이트에 명시적 저작권 표시가 있고,
  자동화 요청을 TLS 핸드셰이크 단계에서 차단하는 정황이 확인돼 크롤링 파이프라인을 만들지 않았습니다.
  대신 교재 근거 AI 생성 문제(위 "문제은행" 참고)로 문제은행을 채웠습니다. 실제 기출을 합법적으로
  (구매/허락/직접 입력) 확보하면 `exam_questions.source='past_exam'`으로 같은 스키마·엔진을 그대로
  씁니다 — `source_detail`에 회차 정보를 넣으면 "회차별 풀이" 필터링도 바로 됩니다.
- pgvector — 노드 49개 규모에서는 애플리케이션 레벨 코사인 유사도가 더 단순하고 충분해 그대로 채택

## 알려진 한계

- `정규화_참조데이터_final.md`(45개 표, 49개 절)만 인제스트했습니다. 기획서가 언급한 전체 `final.md`
  152개 개념노드 원문은 `ref/`에 없어 포함하지 못했습니다 — 있다면 `src/ingest/parseDoc.ts`를 확장해
  동일 파이프라인으로 흡수할 수 있습니다.
- OpenAI 프로바이더 경로는 실제 키로 호출 테스트를 하지 못했습니다(테스트용 키가 없음) — 코드 경로와
  요청 포맷은 OpenAI 문서 기준으로 구현했으나, 실제 계정으로 최초 1회 확인을 권장합니다.
- AI 생성 문제 143개가 `pending_review` 상태로 대기 중입니다 — `admin.classnet.chat/admin/questions`에서
  실제로 검수·승인해야 학생 연습/시험에 노출됩니다(의도적 설계: 아무도 검수 안 하면 아무것도 안 나감).
