# 배포 메모 — 학습 흐름 개선 (2026-10-23)

브랜치 `classnet-improve-20261023` (alpha 작업 폴더 `~/projects/classnet-next`).
이미지 태그 `learning-flow-20261023` (server·web 둘 다).

## 무엇이 나가나

이 브랜치는 지금 운영본이 아니라 그 뒤의 codex 작업(`584d28f`)을 바탕으로 한다. 운영본과의 차이는 두 묶음이다.

**1. 바탕(584d28f)에만 있던, 아직 배포 안 된 변경** — 10-20 "정규 시작 정책"과 같은 내용이라 함께 나가도 된다.
- 채팅 공유(링크 공개) 버튼 숨김 — `SHOW_CHAT_SHARING = false`, 이미 공개로 바꾼 대화도 본인만 보임
- 정식 전환 안내 문구: "학습 기록은 유지됩니다"(예전 "초기화됩니다")
- `scripts/operations/launch/reset.sql`: 기록을 지우지 않는 정식 전환(beta의 `/var/lib/classnet-launch/reset.sql`은 10-20에 이미 이렇게 바뀜)
- 교재 안내 문구("교재" → "단계별 학습하기"), 연습문제 요청 해석의 불용어 몇 개

**2. 이번 개선(1dd1092 + 이어진 커밋)** — 학생 화면
- 오늘의 복습(간격 반복), 홈 "오늘의 학습", 풀이 이어 하기(/exam/[id]), 기출 회차 이어 풀기·내 기록
- 오답노트(문제당 한 줄·복습 상태·해설 펼치기·정답 가리기·관련 단원·자주 틀리는 단원)
- 연습 "안 푼 문제 먼저"·30문제, 결과 "틀린 문제만"·관련 단원, 응시 기록·리포트 정리, 키보드 단축키
- 리포트 AI 분석 자동 갱신, 활동 날짜 한국 시간, 과목 이름 표시, PC 사이드바 기본 펼침

## DB

**스키마 변경 없음** — `schema.sql`을 건드리지 않았다. 복습 일정·이어 풀기·단원 연결은 모두 기존 테이블(풀이 기록)에서 계산한다.
마이그레이션을 돌릴 필요 없다.

## 배포 (DEPLOYMENT.md 방식 — `cortie deploy classnet-tutor`는 쓰지 않는다)

beta의 `~/projects/classnet-tutor/docker-compose.yml`(root, 600)은 운영 환경 값을 직접 담고 있다. **이미지 태그 두 줄만** 바꾼다.

```bash
# alpha — 이미지 빌드(이미 빌드해 두었으면 생략)
cd ~/projects/classnet-next
sudo docker build -t cortie/network-tutor-server:learning-flow-20261023 network-tutor-server
sudo docker build -t cortie/network-tutor-web:learning-flow-20261023 network-tutor-web

# alpha → beta 전송
sudo docker save cortie/network-tutor-server:learning-flow-20261023 cortie/network-tutor-web:learning-flow-20261023 \
  | ssh beta 'sudo docker load'

# beta — 태그 교체 후 다시 띄움(환경 값은 그대로)
ssh beta 'cd ~/projects/classnet-tutor \
  && sudo cp docker-compose.yml docker-compose.yml.before-learning-flow \
  && sudo sed -i "s#network-tutor-server:csv-email-20261016#network-tutor-server:learning-flow-20261023#; s#network-tutor-web:study-label-20261019#network-tutor-web:learning-flow-20261023#" docker-compose.yml \
  && sudo docker compose up -d && sudo docker compose ps'
```

확인: https://classnet.chat 로그인 → 홈의 "오늘의 학습" 줄, 사이드바 "오늘의 복습", 오답노트, 기출문제 회차 목록.

## 되돌리기

```bash
ssh beta 'cd ~/projects/classnet-tutor && sudo cp docker-compose.yml.before-learning-flow docker-compose.yml && sudo docker compose up -d'
```
DB를 바꾸지 않았으므로 이미지만 되돌리면 끝난다.

## 확인한 것

- 서버 테스트 154개 통과(새로 `reviewSchedule.test.ts`, `attemptResume.test.ts`)
- 웹 타입 검사 통과
- alpha에서 운영 문제은행(콘텐츠만 복사, 학생 데이터 없음)으로 띄워 PC·휴대폰 크기로 학생 흐름을 실제로 돌려 봄:
  연습 시작 → 새로고침 후 이어 풀기 → 제출 → 결과(틀린 문제만) → 오답노트(해설·정답 가리기) → 오늘의 복습 → 기출 이어 풀기
- 확인 못 한 것: 리포트 AI 분석 자동 갱신(로컬에 OpenAI 키가 없어 생성 단계는 못 돌림), 휴대폰 홈에서 가끔 나는
  React 하이드레이션 경고(#418, 이번 변경 전부터 있었고 화면에는 영향 없음)
