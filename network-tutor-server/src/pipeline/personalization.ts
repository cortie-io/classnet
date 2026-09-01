import { pool } from "../db/pool.js";

export interface WeakArea {
  subject: string;
  wrongCount: number;
  totalCount: number;
  accuracy: number;
}

export interface WeakTopic {
  subject: string;
  topic: string;
  wrongCount: number;
  totalCount: number;
  accuracy: number;
}

export interface RecentTopic {
  subject: string;
  topic: string;
  count: number;
}

// 표본이 너무 적으면(1~2문제) 우연히 틀린 것뿐일 수 있어 성향으로 취급하지 않는다.
const MIN_SAMPLE = 3;
// 세부 주제(topic) 단위는 과목 단위보다 표본이 자연히 적게 모이므로 기준을 살짝 낮춘다.
const MIN_SAMPLE_TOPIC = 2;
// 정답률이 이 값 미만인 과목/주제만 "취약 영역"으로 본다.
const WEAK_ACCURACY_THRESHOLD = 0.6;

/** 학생이 지금까지 응시(연습/모의고사/기출회차 등 전부 포함)에서 실제로 답한 문제들을 과목별로 집계해
 * 취약 과목을 찾는다. 자기소개 설문이 아니라 실제 채점 결과 기반이라는 점에서 static level과 다르다. */
export async function getWeakAreas(userId: number): Promise<WeakArea[]> {
  const { rows } = await pool.query<{ subject: string; wrong_count: string; total_count: string }>(
    `SELECT q.subject,
            count(*) FILTER (WHERE a.is_correct = false) AS wrong_count,
            count(*) AS total_count
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     JOIN exam_attempts att ON att.id = a.attempt_id
     WHERE att.user_id = $1 AND a.is_correct IS NOT NULL
     GROUP BY q.subject`,
    [userId],
  );
  return rows
    .map((r) => {
      const total = Number(r.total_count);
      const wrong = Number(r.wrong_count);
      return { subject: r.subject, wrongCount: wrong, totalCount: total, accuracy: total > 0 ? 1 - wrong / total : 1 };
    })
    .filter((w) => w.totalCount >= MIN_SAMPLE && w.accuracy < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy);
}

/** 과목보다 더 구체적인 "세부 주제(개념 노드)" 단위 취약점. "2과목_TCP_IP에서 약하다"보다
 * "라우팅 프로토콜에서 약하다"가 학생에게 훨씬 실질적으로 도움이 된다. concept_node_id가 붙은
 * (문제은행에 정식 태깅된) 문제만 집계 대상이다. */
export async function getWeakTopics(userId: number): Promise<WeakTopic[]> {
  const { rows } = await pool.query<{ subject: string; topic: string; wrong_count: string; total_count: string }>(
    `SELECT n.subject, n.topic,
            count(*) FILTER (WHERE a.is_correct = false) AS wrong_count,
            count(*) AS total_count
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     JOIN exam_attempts att ON att.id = a.attempt_id
     JOIN concept_nodes n ON n.id = q.concept_node_id
     WHERE att.user_id = $1 AND a.is_correct IS NOT NULL
     GROUP BY n.subject, n.topic`,
    [userId],
  );
  return rows
    .map((r) => {
      const total = Number(r.total_count);
      const wrong = Number(r.wrong_count);
      return {
        subject: r.subject,
        topic: r.topic,
        wrongCount: wrong,
        totalCount: total,
        accuracy: total > 0 ? 1 - wrong / total : 1,
      };
    })
    .filter((w) => w.totalCount >= MIN_SAMPLE_TOPIC && w.accuracy < WEAK_ACCURACY_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy);
}

/** 채팅은 매번 새 대화로 시작되기 쉬워서(오답노트/문제은행에서 "새 채팅으로 이어가기"를 쓰는 것도 한
 * 이유), 지금 이 대화창의 히스토리만으로는 "이 학생이 요즘 뭘 공부하고 있는지"를 알 수 없다. 반면
 * audit_log는 어느 채팅에서 물었든 상관없이 이 학생이 실제로 물어본 모든 질문을 이미 기록하고 있으므로,
 * 거기서 최근 자주 검색된 개념 노드를 뽑아 "최근 관심사"로 삼는다 — 채팅방을 넘나드는 연속성을 이
 * 방식으로 준다. */
export async function getRecentTopics(userId: number, days = 30, limit = 3): Promise<RecentTopic[]> {
  const { rows } = await pool.query<{ subject: string; topic: string; cnt: string }>(
    `SELECT n.subject, n.topic, count(*) AS cnt
     FROM audit_log a
     CROSS JOIN LATERAL unnest(a.retrieved_node_ids) AS node_id
     JOIN concept_nodes n ON n.id = node_id
     WHERE a.user_id = $1 AND a.created_at > now() - ($2 * interval '1 day')
     GROUP BY n.subject, n.topic
     ORDER BY cnt DESC
     LIMIT $3`,
    [userId, days, limit],
  );
  return rows.map((r) => ({ subject: r.subject, topic: r.topic, count: Number(r.cnt) }));
}

/** 프롬프트에 실제로 붙일 지시문. 정답률·횟수 등 자주 바뀌는 숫자는 넣지 않는다 — 이 문자열이
 * 캐시 태그로도 쓰이는데, 문제를 더 풀 때마다 숫자가 바뀌면 같은 질문이라도 캐시가 거의 매번 깨진다. */
export function weakAreaInstruction(weakAreas: WeakArea[], weakTopics: WeakTopic[] = []): string {
  if (weakAreas.length === 0 && weakTopics.length === 0) return "";
  const parts: string[] = [];
  if (weakAreas.length > 0) {
    parts.push(`과목별로는 ${weakAreas.slice(0, 2).map((w) => w.subject).join(", ")}`);
  }
  if (weakTopics.length > 0) {
    parts.push(`세부 주제로는 ${weakTopics.slice(0, 3).map((w) => w.topic).join(", ")}`);
  }
  return ` 이 학생은 지금까지 풀었던 문제 채점 결과 기준으로 ${parts.join(", ")}에서 특히 자주 틀렸습니다. ` +
    "이번 질문이 그 영역과 관련 있다면 취약한 부분을 더 짚어 꼼꼼히 설명하고, 관련 없는 질문이면 이 사실을 언급하지 마세요.";
}

/** 최근 관심 주제 지시문. weakAreaInstruction과 마찬가지로 학생이 관련 없는 질문을 할 때 억지로
 * 끼워 맞추지 않도록 명시적으로 조건을 건다. */
export function recentTopicsInstruction(recentTopics: RecentTopic[]): string {
  if (recentTopics.length === 0) return "";
  const names = recentTopics.map((t) => t.topic).join(", ");
  return ` 이 학생은 최근(최대 30일 이내) ${names} 관련 질문을 자주 했습니다. ` +
    "지금 질문이 그 흐름과 자연스럽게 이어진다면(예: 같은 주제의 후속 질문) 그 맥락을 참고해서 답하고, 관련 없는 질문이면 이 사실을 언급하지 마세요.";
}

/** 캐시 키에 섞을 성향 태그. 실제 숫자가 아니라 과목/주제 이름만 써서, 학생이 문제를 더 풀거나 질문을
 * 더 해도 이 태그 자체가 바뀌지 않는 한(즉 취약점/관심사 "종류"가 바뀌지 않는 한) 캐시가 재사용된다. */
export function weakAreaCacheTag(
  weakAreas: WeakArea[],
  weakTopics: WeakTopic[] = [],
  recentTopics: RecentTopic[] = [],
): string {
  const subj = weakAreas.length === 0 ? "none" : weakAreas.slice(0, 2).map((w) => w.subject).join("+");
  const topic = weakTopics.length === 0 ? "none" : weakTopics.slice(0, 3).map((w) => w.topic).join("+");
  const recent = recentTopics.length === 0 ? "none" : recentTopics.map((t) => t.topic).join("+");
  return `${subj}::${topic}::${recent}`;
}
