# network-tutor-web — 네트워크관리사 2급 AI 튜터 (학생용 채팅 UI)

[vercel/chatbot](https://github.com/vercel/chatbot)(Next.js AI 챗봇 템플릿)을 프런트엔드로 채택해
[network-tutor-server](../network-tutor-server)(핵심 파이프라인 Express 백엔드) 위에 얹은 학생용
채팅 인터페이스입니다. `classnet.chat`에 배포되어 있습니다(관리자 콘솔은 별도로
`admin.classnet.chat`에서 network-tutor-server가 직접 서빙).

## 이 템플릿에서 실제로 바꾼 것

- **인증**: 템플릿 자체 User 테이블/게스트 로그인을 전부 제거하고, network-tutor-server의 실제
  `users` 테이블(정수 id, scrypt 해시)을 NextAuth Credentials 프로바이더가 직접 조회하도록 변경.
  회원가입 페이지·게스트 자동로그인 라우트는 삭제했다(`app/(auth)/register`,
  `app/(auth)/api/auth/guest`). `proxy.ts`가 미로그인 사용자를 무조건 `/login`으로 보낸다.
- **모델 계층**: Vercel AI Gateway 기반 다중 모델 카탈로그(`lib/ai/models.ts`)를 걷어내고, 실제 선택지
  두 개(`network-tutor-gemma`, `network-tutor-openai`)만 남겼다. `lib/ai/network-tutor-model.ts`가
  AI SDK의 `LanguageModel` 인터페이스를 흉내내는 어댑터로, 실제로는 아무 모델도 실행하지 않고
  **network-tutor-server의 `/api/ask`를 서버 간 호출로 그대로 위임**한다 — 규칙엔진·하이브리드
  RAG·자기검증은 전부 그쪽에서 이미 처리된 결과를 스트림 프로토콜로 감싸 돌려줄 뿐이다.
- **서버 간 인증**: 두 Node 프로세스가 각자 다른 인증 체계(NextAuth JWT vs 자체 세션 쿠키)를 쓰므로,
  `x-internal-secret` 헤더(env `INTERNAL_API_SECRET`, 두 백엔드만 공유하는 값) + 명시적 `userId`로
  서버 간 신뢰 호출을 한다. 브라우저에는 이 헤더가 절대 노출되지 않는다.
- **첨부파일**: Vercel Blob 대신 base64 data URI로 응답하도록 업로드 라우트를 바꿨다(별도 오브젝트
  스토리지 불필요, 이미지 질문은 곧바로 백엔드의 Ollama vision 경로로 전달됨).
- **제거한 Vercel 전용 기능**: BotID(봇 탐지), AI Gateway 헬스체크, Redis 기반 IP 레이트리밋(코드는
  남아있지만 REDIS_URL 없으면 자동 no-op), LLM 기반 채팅 제목 생성(단순 텍스트 truncate로 대체 —
  이미 여러 단계인 답변 파이프라인 위에 호출을 하나 더 얹지 않기 위함).
- 아티팩트/문서 생성 도구(createDocument 등)는 UI·DB 스키마는 남아있지만 채팅 라우트에 연결하지
  않았다(네트워크 자격증 튜터에 불필요한 기능). 필요해지면 `app/(chat)/api/chat/route.ts`에 다시
  `tools`로 연결하면 된다.

## 실행

```bash
pnpm install
pnpm run build   # 마이그레이션(같은 network_tutor DB의 Chat/Message 등 테이블) + next build
pnpm run start   # 또는 pnpm dev
```

`.env.local` 필수 값: `AUTH_SECRET`, `POSTGRES_URL`(network-tutor-server와 동일 DB),
`BACKEND_API_URL`(기본 http://127.0.0.1:3300), `INTERNAL_API_SECRET`(백엔드 `.env`와 반드시 동일).

## 배포 상태

systemd 서비스 `network-tutor-web`(포트 3400)로 상시 구동, nginx가 `classnet.chat`을 여기로
라우팅한다. `network-tutor-server`는 계속 3300에서 API + `admin.classnet.chat` 정적 콘솔을 서빙한다.
