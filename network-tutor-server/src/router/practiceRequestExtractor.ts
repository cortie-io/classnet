// "이거랑 비슷한 문제 줘", "RAID 관련 문제 뽑아줘", "연습 문제 하나 내줘" 같은 요청을 감지한다.
// 실제 문제은행(exam_questions)에서 검색해서 뽑아주기 위한 라우팅 신호일 뿐, 여기서 문제를 만들지는 않는다
// — AI가 그 자리에서 문제를 지어내면 정답이 검증되지 않은 채로 나가게 되어 이 프로젝트의 "틀린 정보 없음"
// 원칙과 정면으로 충돌한다.
// "문제 4개 뽑아줘"/"문제 10개만 풀어줄 수 있어?"처럼 "문제"와 동사 사이에 개수(숫자+개)가 끼어드는
// 흔한 어순을 원래 못 잡았다("하나"/"한 개"만 허용했었음) — 실사용 중 확인된 버그.
// "문제를 만들어줘"/"문제 출제해줘"류도 반드시 여기서 잡아야 한다 — 이 트리거에 안 걸리면 일반 설명
// (explain) 경로로 새서 LLM이 그 자리에서 문제를 지어내는데, 실사용 중 확인된 버그로 "OSPF는
// 벨먼-포드, RIP는 다익스트라"처럼 알고리즘이 서로 뒤바뀐 채로 지어낸 문제가 정답까지 달려 나간 적이
// 있다(실제로는 반대: OSPF=다익스트라, RIP=벨먼-포드) — 이 프로젝트가 절대 허용하면 안 되는 유형의
// 오류다. "만들어줘"를 이 트리거에 포함시켜 항상 문제은행에서 실제 문제를 찾아주는 안전한 경로로 보낸다.
const PRACTICE_TRIGGER_RE =
  /(비슷한|관련|관련된|연습|유사한)\s*문제|문제\s*(하나|한\s*개|\d+\s*개)?\s*(만|좀)?\s*(내|뽑아|줘|추천|풀어)|풀어\s*보고\s*싶어|문제\s*은행|문제\s*(를|을)?\s*(만들어|출제해|생성해)/;

// 학생이 실제 문제 지문(보기 포함)을 통째로 붙여넣고 "이 문제 풀어줘"라고 물으면, 트리거 단어("문제 풀어")만
// 보면 practice_request로 오인되지만 실제 의도는 "문제은행에서 비슷한 걸 찾아달라"가 아니라 "붙여넣은 이
// 문제를 설명해달라"다(실사용 평가에서 확인된 버그: 정답 설명 대신 무관한 문제 카드를 반환했었음). 보기
// 마커(①②③④)가 있거나 텍스트가 길면 실제 문제 지문이 붙어있다고 보고 일반 설명 경로로 넘긴다.
export const CHOICE_MARKER_RE = /[①②③④⑤⑥]/;
const PASTED_PROBLEM_LENGTH_THRESHOLD = 60;

export function isPracticeRequest(question: string): boolean {
  if (!PRACTICE_TRIGGER_RE.test(question)) return false;
  if (CHOICE_MARKER_RE.test(question) || question.length > PASTED_PROBLEM_LENGTH_THRESHOLD) return false;
  return true;
}

// 오답노트/시험결과 "전체 해설 생성"은 여러 개의 객관식 문제를 한 프롬프트에 이어 붙여서 보낸다. 문제마다
// 선택지가 "①"로 시작하므로, "①" 등장 횟수로 몇 개의 문제가 붙어있는지 셀 수 있다. calc/lookup처럼 질문
// 전체에서 규칙 기반으로 하나만 딱 집어 답하는 지름길들은, 이렇게 여러 문제가 붙어있을 때 그중 우연히
// 매칭되는 문제 하나만 붙잡고 나머지를 무시해버리는 사례가 실사용에서 확인됐다 — 그런 지름길은 여기서
// 걸러서 항상 일반 설명(RAG) 경로로 보내야 한다.
// "시험 결과 종합 분석"(exam/[id]/page.tsx의 composeAnalysisPrompt)처럼 "①" 마커는 없지만 문제 지문
// 여러 개+점수 통계가 통째로 박혀 들어오는 긴 합성 메시지도 같은 문제를 일으킨다(실사용 중 확인된 버그:
// "1/5 정답" 같은 통계 숫자를 calc/lookup 지름길이 우연히 집어서 요청 전체를 엉뚱한 한 줄 답으로
// 축소시킴). "①" 유무와 상관없이 이례적으로 긴 메시지는 항상 합성 메시지로 보고 지름길을 건너뛴다.
export const LONG_COMPOSITE_MESSAGE_THRESHOLD = 200;

export function isMultiQuestionPaste(question: string): boolean {
  const count = (question.match(/①/g) ?? []).length;
  return count >= 2 || question.length > LONG_COMPOSITE_MESSAGE_THRESHOLD;
}
