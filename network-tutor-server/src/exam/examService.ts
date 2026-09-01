import { randomInt } from "node:crypto";
import { pool } from "../db/pool.js";

export type QuestionType = "multiple_choice" | "short_answer" | "subjective" | "essay";

export interface ApprovedQuestion {
  id: number;
  subject: string;
  stem: string;
  questionType: QuestionType;
  choices: string[] | null;
  correctIndex: number | null;
  acceptedAnswers: string[] | null;
  modelAnswer: string | null;
  maxScore: number;
  explanation: string;
  stemImageUrl: string | null;
}

function normalizeShortAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function matchesAcceptedAnswer(submitted: string, accepted: string[]): boolean {
  const norm = normalizeShortAnswer(submitted);
  return accepted.some((a) => normalizeShortAnswer(a) === norm);
}

function shuffleIndices(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** 관리자 승인을 통과한(status='approved') 문제만 학생에게 노출한다 — "AI생성·검수대기" 문제는 절대 시험/연습에 나가지 않는다. */
async function fetchApprovedQuestions(ids: number[]): Promise<Map<number, ApprovedQuestion>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{
    id: number;
    subject: string;
    stem: string;
    question_type: QuestionType;
    choices: string[] | null;
    correct_index: number | null;
    accepted_answers: string[] | null;
    model_answer: string | null;
    max_score: string;
    explanation: string;
    stem_image_url: string | null;
  }>(
    `SELECT id, subject, stem, question_type, choices, correct_index, accepted_answers, model_answer, max_score, explanation, stem_image_url
     FROM exam_questions WHERE id = ANY($1::int[]) AND status = 'approved'`,
    [ids],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        subject: r.subject,
        stem: r.stem,
        questionType: r.question_type,
        choices: r.choices,
        correctIndex: r.correct_index,
        acceptedAnswers: r.accepted_answers,
        modelAnswer: r.model_answer,
        maxScore: Number(r.max_score),
        explanation: r.explanation,
        stemImageUrl: r.stem_image_url,
      },
    ]),
  );
}

/** 학급/과목별로 승인된 문제 중 무작위 count개 id를 뽑는다. */
async function drawRandomApprovedIds(subject: string | null, count: number, excludeIds: number[] = []): Promise<number[]> {
  const params: unknown[] = [];
  let where = "status = 'approved'";
  if (subject) {
    params.push(subject);
    where += ` AND subject = $${params.length}`;
  }
  if (excludeIds.length > 0) {
    params.push(excludeIds);
    where += ` AND NOT (id = ANY($${params.length}::int[]))`;
  }
  params.push(count);
  const { rows } = await pool.query<{ id: number }>(
    `SELECT id FROM exam_questions WHERE ${where} ORDER BY random() LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => r.id);
}

// 실제 네트워크관리사 2급 필기 과목별 출제 비중(1과목10/2과목17/3과목18/4과목5, 총 50문항).
// 5과목(정보보호개론)은 교재에는 있지만 이 공식 배분표에는 없어 모의고사 자동 구성 대상에서는
// 제외하고(과목 자체가 없는데 억지로 채우면 실제 시험 구조와 달라짐), 개별 연습에서는 계속 노출한다.
export const MOCK_EXAM_SUBJECT_DISTRIBUTION: Record<string, number> = {
  "1과목_네트워크_일반": 10,
  "2과목_TCP_IP": 17,
  "3과목_NOS": 18,
  "4과목_네트워크_운용기기": 5,
};
export const MOCK_EXAM_DURATION_MINUTES = 60;

export interface AttemptQuestionView {
  questionId: number;
  stem: string;
  questionType: QuestionType;
  choices: string[]; // 이미 셔플된 순서 (객관식 외에는 빈 배열)
  maxScore: number;
  stemImageUrl: string | null;
}

function buildChoiceOrder(question: ApprovedQuestion): { order: number[]; view: string[] } {
  if (question.questionType !== "multiple_choice" || !question.choices) return { order: [], view: [] };
  const order = shuffleIndices(question.choices.length);
  const view = order.map((origIdx) => question.choices![origIdx]);
  return { order, view };
}

export async function createAttempt(params: {
  userId: number;
  kind: "practice_custom" | "mock" | "admin_timed" | "past_exam_round";
  subject?: string | null;
  count?: number;
  examSetId?: number; // admin_timed일 때 이미 만들어진 세트를 지정
  title?: string;
  roundLabel?: string; // past_exam_round일 때 "연도-월-일" 형식으로 회차 지정
  questionIds?: number[]; // practice_custom일 때 무작위 대신 특정 문제로 고정하고 싶으면(예: 채팅에서 뽑아준 문제)
}): Promise<{ attemptId: number; questions: AttemptQuestionView[]; timeLimitMinutes: number | null }> {
  let questionIds: number[];
  let timeLimitMinutes: number | null = null;
  let examSetId: number | null = null;
  // 회차별 풀이는 원본 그대로의 1~50번 순서를 유지한다(실제 인쇄된 기출문제를 그대로 따라 풀 수 있도록) —
  // 다른 종류는 전부 부정행위 방지를 위해 문항 순서까지 학생마다 섞는다.
  const preserveOrder = params.kind === "past_exam_round";

  if (params.kind === "past_exam_round") {
    if (!params.roundLabel) throw new Error("past_exam_round 응시에는 roundLabel이 필요합니다.");
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM exam_questions
       WHERE status = 'approved' AND source = 'past_exam' AND source_detail->>'roundLabel' = $1
       ORDER BY (source_detail->>'qnum')::int`,
      [params.roundLabel],
    );
    if (rows.length === 0) throw new Error("해당 회차의 문제를 찾을 수 없습니다.");
    questionIds = rows.map((r) => r.id);
    timeLimitMinutes = null;
    const setRes = await pool.query<{ id: number }>(
      `INSERT INTO exam_sets (kind, title, created_by, question_ids, is_published)
       VALUES ('past_exam_round', $1, $2, $3, true) RETURNING id`,
      [`기출문제 ${params.roundLabel} 회차`, params.userId, questionIds],
    );
    examSetId = setRes.rows[0].id;
  } else if (params.kind === "admin_timed") {
    if (!params.examSetId) throw new Error("admin_timed 응시에는 examSetId가 필요합니다.");
    const { rows } = await pool.query<{
      question_ids: number[];
      duration_minutes: number | null;
      is_published: boolean;
      scheduled_start: Date | null;
      scheduled_end: Date | null;
    }>(
      "SELECT question_ids, duration_minutes, is_published, scheduled_start, scheduled_end FROM exam_sets WHERE id = $1 AND kind = 'admin_timed'",
      [params.examSetId],
    );
    if (rows.length === 0) throw new Error("존재하지 않는 시험입니다.");
    if (!rows[0].is_published) throw new Error("아직 공개되지 않은 시험입니다.");
    const now = new Date();
    if (rows[0].scheduled_start && now < rows[0].scheduled_start) {
      throw new Error(`아직 응시 시작 전입니다. 응시 가능 시작: ${rows[0].scheduled_start.toLocaleString("ko-KR")}`);
    }
    if (rows[0].scheduled_end && now > rows[0].scheduled_end) {
      throw new Error(`응시 가능 기간이 종료되었습니다. 응시 마감: ${rows[0].scheduled_end.toLocaleString("ko-KR")}`);
    }
    questionIds = rows[0].question_ids;
    timeLimitMinutes = rows[0].duration_minutes;
    examSetId = params.examSetId;
  } else if (params.kind === "mock") {
    const picks: number[] = [];
    for (const [subject, count] of Object.entries(MOCK_EXAM_SUBJECT_DISTRIBUTION)) {
      const ids = await drawRandomApprovedIds(subject, count, picks);
      picks.push(...ids);
    }
    questionIds = picks;
    timeLimitMinutes = MOCK_EXAM_DURATION_MINUTES;
    const setRes = await pool.query<{ id: number }>(
      `INSERT INTO exam_sets (kind, title, created_by, duration_minutes, question_ids, subject_distribution, is_published)
       VALUES ('mock', '모의고사', $1, $2, $3, $4, true) RETURNING id`,
      [params.userId, timeLimitMinutes, questionIds, JSON.stringify(MOCK_EXAM_SUBJECT_DISTRIBUTION)],
    );
    examSetId = setRes.rows[0].id;
  } else {
    if (params.questionIds && params.questionIds.length > 0) {
      questionIds = params.questionIds;
    } else {
      const count = params.count ?? 10;
      questionIds = await drawRandomApprovedIds(params.subject ?? null, count);
    }
    const setRes = await pool.query<{ id: number }>(
      `INSERT INTO exam_sets (kind, title, created_by, question_ids, is_published)
       VALUES ('practice_custom', $1, $2, $3, true) RETURNING id`,
      [params.title ?? `연습 문제${params.subject ? ` (${params.subject})` : ""}`, params.userId, questionIds],
    );
    examSetId = setRes.rows[0].id;
  }

  if (questionIds.length === 0) throw new Error("조건에 맞는 승인된 문제가 없습니다.");

  const approvedMap = await fetchApprovedQuestions(questionIds);
  const orderedIds = questionIds.filter((id) => approvedMap.has(id));
  // 문항 순서 자체도 학생마다 섞는다(부정행위 방지: 옆 사람과 화면이 달라짐) — 다만 회차별 풀이는
  // preserveOrder로 원본 1~50번 순서를 그대로 유지한다.
  const shuffledOrder = preserveOrder ? orderedIds : shuffleIndices(orderedIds.length).map((i) => orderedIds[i]);

  const choiceOrderMap: Record<number, number[]> = {};
  const views: AttemptQuestionView[] = shuffledOrder.map((qid) => {
    const q = approvedMap.get(qid)!;
    const { order, view } = buildChoiceOrder(q);
    choiceOrderMap[qid] = order;
    return { questionId: qid, stem: q.stem, questionType: q.questionType, choices: view, maxScore: q.maxScore, stemImageUrl: q.stemImageUrl };
  });

  const attemptRes = await pool.query<{ id: number }>(
    `INSERT INTO exam_attempts (exam_set_id, user_id, question_ids, choice_order, time_limit_minutes)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [examSetId, params.userId, shuffledOrder, JSON.stringify(choiceOrderMap), timeLimitMinutes],
  );

  return { attemptId: attemptRes.rows[0].id, questions: views, timeLimitMinutes };
}

interface AttemptRow {
  id: number;
  exam_set_id: number | null;
  user_id: number;
  question_ids: number[];
  choice_order: Record<string, number[]>;
  time_limit_minutes: number | null;
  started_at: Date;
  submitted_at: Date | null;
  status: string;
  score: number | null;
  flagged_for_review: boolean;
}

export async function getAttempt(attemptId: number): Promise<AttemptRow | null> {
  const { rows } = await pool.query<AttemptRow>("SELECT * FROM exam_attempts WHERE id = $1", [attemptId]);
  return rows[0] ?? null;
}

async function getExamSetKind(examSetId: number | null): Promise<string | null> {
  if (!examSetId) return null;
  const { rows } = await pool.query<{ kind: string }>("SELECT kind FROM exam_sets WHERE id = $1", [examSetId]);
  return rows[0]?.kind ?? null;
}

function isTimeExpired(attempt: AttemptRow): boolean {
  if (!attempt.time_limit_minutes) return false;
  const deadline = new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60_000;
  return Date.now() > deadline;
}

export interface AnswerResult {
  recorded: true;
  isCorrect?: boolean;
  correctIndex?: number; // 셔플된 화면 기준 인덱스 (객관식만)
  explanation?: string;
  gradingPending?: boolean; // 주관식/서술형: 교사 채점 전까지 true
  instantFeedback: boolean;
}

/** selectedDisplayIndex(객관식, 셔플된 화면 기준 인덱스)/answerText(단답식·주관식·서술형) 중 문제 유형에 맞는 것만 채운다. */
export async function submitAnswer(params: {
  attemptId: number;
  userId: number;
  questionId: number;
  selectedDisplayIndex?: number;
  answerText?: string;
}): Promise<AnswerResult> {
  const attempt = await getAttempt(params.attemptId);
  if (!attempt || attempt.user_id !== params.userId) throw new Error("응시 기록을 찾을 수 없습니다.");
  if (attempt.status !== "in_progress") throw new Error("이미 종료된 응시입니다.");
  if (isTimeExpired(attempt)) {
    await pool.query("UPDATE exam_attempts SET status = 'auto_submitted', submitted_at = now() WHERE id = $1", [params.attemptId]);
    throw new Error("제한 시간이 종료되어 자동 제출되었습니다.");
  }
  if (!attempt.question_ids.includes(params.questionId)) throw new Error("이 응시에 포함되지 않은 문제입니다.");

  const { rows } = await pool.query<{
    question_type: QuestionType;
    correct_index: number | null;
    accepted_answers: string[] | null;
    max_score: string;
    explanation: string;
  }>(
    "SELECT question_type, correct_index, accepted_answers, max_score, explanation FROM exam_questions WHERE id = $1",
    [params.questionId],
  );
  if (rows.length === 0) throw new Error("문제를 찾을 수 없습니다.");
  const q = rows[0];
  const maxScore = Number(q.max_score);
  const kind = await getExamSetKind(attempt.exam_set_id);
  const instantFeedback = kind === "practice_custom" || kind === "past_exam_round";

  if (q.question_type === "multiple_choice") {
    if (typeof params.selectedDisplayIndex !== "number") throw new Error("selectedDisplayIndex가 필요합니다.");
    const order = attempt.choice_order[String(params.questionId)];
    const originalIndex = order ? order[params.selectedDisplayIndex] : params.selectedDisplayIndex;
    const isCorrect = q.correct_index === originalIndex;
    const score = isCorrect ? maxScore : 0;

    await pool.query(
      `INSERT INTO exam_answers (attempt_id, question_id, selected_index, is_correct, score, graded_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         selected_index = EXCLUDED.selected_index, is_correct = EXCLUDED.is_correct, score = EXCLUDED.score, answered_at = now(), graded_at = now()`,
      [params.attemptId, params.questionId, originalIndex, isCorrect, score],
    );

    if (!instantFeedback) return { recorded: true, instantFeedback };
    // 화면(셔플) 기준 정답 인덱스로 되돌려서 알려준다(클라이언트는 원본 인덱스를 모름).
    const displayCorrectIndex = order ? order.indexOf(q.correct_index!) : q.correct_index!;
    return { recorded: true, instantFeedback, isCorrect, correctIndex: displayCorrectIndex, explanation: q.explanation };
  }

  const answerText = (params.answerText ?? "").trim();
  if (!answerText) throw new Error("answerText가 필요합니다.");

  if (q.question_type === "short_answer") {
    const isCorrect = matchesAcceptedAnswer(answerText, q.accepted_answers ?? []);
    const score = isCorrect ? maxScore : 0;
    await pool.query(
      `INSERT INTO exam_answers (attempt_id, question_id, answer_text, is_correct, score, graded_at)
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET
         answer_text = EXCLUDED.answer_text, is_correct = EXCLUDED.is_correct, score = EXCLUDED.score, answered_at = now(), graded_at = now()`,
      [params.attemptId, params.questionId, answerText, isCorrect, score],
    );
    if (!instantFeedback) return { recorded: true, instantFeedback };
    return { recorded: true, instantFeedback, isCorrect, explanation: q.explanation };
  }

  // subjective/essay: 정답이 하나로 정해지지 않아 자동채점하지 않는다 — 교사가 나중에 직접 채점한다.
  await pool.query(
    `INSERT INTO exam_answers (attempt_id, question_id, answer_text, is_correct, score)
     VALUES ($1,$2,$3,NULL,NULL)
     ON CONFLICT (attempt_id, question_id) DO UPDATE SET
       answer_text = EXCLUDED.answer_text, is_correct = NULL, score = NULL, graded_by = NULL, graded_at = NULL, grader_feedback = NULL, answered_at = now()`,
    [params.attemptId, params.questionId, answerText],
  );
  return { recorded: true, instantFeedback: false, gradingPending: true };
}

export interface AttemptResultItem {
  questionId: number;
  subject: string;
  stem: string;
  questionType: QuestionType;
  choices: string[]; // 화면 기준, 객관식만
  selectedIndex: number | null; // 화면 기준, 객관식만
  correctIndex: number | null; // 화면 기준, 객관식만
  answerText: string | null; // 단답식/주관식/서술형
  isCorrect: boolean | null;
  score: number | null; // 채점 전(주관식/서술형)이면 null
  maxScore: number;
  graderFeedback: string | null;
  explanation: string;
  stemImageUrl: string | null;
}

async function buildResultItems(
  attempt: AttemptRow,
): Promise<{ score: number; total: number; correctCount: number; gradingPending: boolean; items: AttemptResultItem[] }> {
  const { rows: questions } = await pool.query<{
    id: number;
    subject: string;
    stem: string;
    question_type: QuestionType;
    choices: string[] | null;
    correct_index: number | null;
    max_score: string;
    explanation: string;
    stem_image_url: string | null;
  }>(
    "SELECT id, subject, stem, question_type, choices, correct_index, max_score, explanation, stem_image_url FROM exam_questions WHERE id = ANY($1::int[])",
    [attempt.question_ids],
  );
  const qMap = new Map(questions.map((q) => [q.id, q]));

  const { rows: answers } = await pool.query<{
    question_id: number;
    selected_index: number | null;
    answer_text: string | null;
    is_correct: boolean | null;
    score: string | null;
    grader_feedback: string | null;
  }>(
    "SELECT question_id, selected_index, answer_text, is_correct, score, grader_feedback FROM exam_answers WHERE attempt_id = $1",
    [attempt.id],
  );
  const aMap = new Map(answers.map((a) => [a.question_id, a]));

  let correctCount = 0;
  let scoreSum = 0;
  let maxScoreSum = 0;
  let gradingPending = false;
  const items: AttemptResultItem[] = attempt.question_ids.map((qid) => {
    const q = qMap.get(qid)!;
    const maxScore = Number(q.max_score);
    const order = attempt.choice_order[String(qid)] ?? (q.choices ? q.choices.map((_, i) => i) : []);
    const a = aMap.get(qid);
    if (a?.is_correct) correctCount++;
    const itemScore = a?.score != null ? Number(a.score) : null;
    maxScoreSum += maxScore;
    if (itemScore != null) scoreSum += itemScore;
    if ((q.question_type === "subjective" || q.question_type === "essay") && a && itemScore == null) {
      gradingPending = true;
    }
    return {
      questionId: qid,
      subject: q.subject,
      stem: q.stem,
      questionType: q.question_type,
      choices: q.choices ? order.map((origIdx) => q.choices![origIdx]) : [],
      selectedIndex: a?.selected_index != null ? order.indexOf(a.selected_index) : null,
      correctIndex: q.correct_index != null ? order.indexOf(q.correct_index) : null,
      answerText: a?.answer_text ?? null,
      isCorrect: a?.is_correct ?? null,
      score: itemScore,
      maxScore,
      graderFeedback: a?.grader_feedback ?? null,
      explanation: q.explanation,
      stemImageUrl: q.stem_image_url,
    };
  });

  const score = maxScoreSum > 0 ? Math.round((scoreSum / maxScoreSum) * 1000) / 10 : 0;
  return { score, total: attempt.question_ids.length, correctCount, gradingPending, items };
}

export async function submitAttempt(
  attemptId: number,
  userId: number,
): Promise<{ score: number; total: number; gradingPending: boolean; items: AttemptResultItem[] }> {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.user_id !== userId) throw new Error("응시 기록을 찾을 수 없습니다.");
  if (attempt.status !== "in_progress") throw new Error("이미 종료된 응시입니다.");

  const { score, total, gradingPending, items } = await buildResultItems(attempt);
  await pool.query(
    "UPDATE exam_attempts SET status = 'submitted', submitted_at = now(), score = $1 WHERE id = $2",
    [score, attemptId],
  );

  return { score, total, gradingPending, items };
}

/** 이미 제출된 응시의 결과(문제별 정답·해설 포함)를 상태 변경 없이 다시 조회한다 — "내가 푼 문제 해설 보기". */
export async function getAttemptResults(
  attemptId: number,
  userId: number,
): Promise<{ status: string; score: number | null; total: number; gradingPending: boolean; items: AttemptResultItem[] } | null> {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.user_id !== userId) return null;
  if (attempt.status === "in_progress") {
    return { status: attempt.status, score: null, total: attempt.question_ids.length, gradingPending: false, items: [] };
  }
  const { total, gradingPending, items } = await buildResultItems(attempt);
  return { status: attempt.status, score: attempt.score, total, gradingPending, items };
}

export interface PastExamRound {
  roundLabel: string;
  year: string;
  month: string;
  day: string;
  questionCount: number;
}

/** 실제 기출문제 회차 목록(최신순) — "회차별 풀이" 화면에서 고를 회차 목록으로 쓴다. */
export async function listPastExamRounds(): Promise<PastExamRound[]> {
  const { rows } = await pool.query<{ round_label: string; year: string; month: string; day: string; count: string }>(
    `SELECT source_detail->>'roundLabel' AS round_label,
            source_detail->>'year' AS year, source_detail->>'month' AS month, source_detail->>'day' AS day,
            count(*) AS count
     FROM exam_questions
     WHERE source = 'past_exam' AND status = 'approved'
     GROUP BY round_label, year, month, day
     ORDER BY year DESC, month DESC, day DESC`,
  );
  return rows.map((r) => ({ roundLabel: r.round_label, year: r.year, month: r.month, day: r.day, questionCount: Number(r.count) }));
}

export async function listMyAttempts(userId: number, limit = 50): Promise<
  { id: number; status: string; score: number | null; startedAt: Date; submittedAt: Date | null; setKind: string | null; setTitle: string | null }[]
> {
  // 끝까지 응시(제출 또는 시간초과 자동제출)한 것만 기록에 남긴다 — 중간에 그만둔 응시는 학생 화면에
  // 아예 안 보이는 게 맞다는 피드백이 있었다. (부정행위 검토용 관리자 화면은 별도 쿼리라 여기 영향 없음)
  const { rows } = await pool.query(
    `SELECT a.id, a.status, a.score, a.started_at, a.submitted_at, s.kind AS set_kind, s.title AS set_title
     FROM exam_attempts a LEFT JOIN exam_sets s ON s.id = a.exam_set_id
     WHERE a.user_id = $1 AND a.status IN ('submitted', 'auto_submitted')
     ORDER BY a.started_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    score: r.score !== null ? Number(r.score) : null,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    setKind: r.set_kind,
    setTitle: r.set_title,
  }));
}

// ---------- 부정행위 방지(관찰 가능한 이상 신호 기록) ----------
// 완벽한 감독은 불가능하다(웹캠 감독 등은 별도 소프트웨어 영역) — 여기서는 브라우저가 관찰할 수 있는
// 신호(탭 전환, 전체화면 이탈, 개발자도구, 복사/붙여넣기)를 전부 기록하고, 반복되면 자동으로
// flagged_for_review를 세워 교사가 사후에 판단하게 한다. "잡아낸다"가 아니라 "기록해서 검토 대상으로
// 남긴다"는 설계다.
const SUSPICIOUS_EVENT_TYPES = new Set([
  "blur",
  "fullscreen_exit",
  "devtools_open",
  "tab_switch",
  "copy",
  "paste",
  "right_click",
  "multiple_tabs",
]);
const FLAG_THRESHOLD = 3;
// 검토 대상 표시(FLAG_THRESHOLD)보다 훨씬 높은 문턱 — 여기까지 가면 "사후 검토"로는 부족하다고 보고
// 그 자리에서 바로 자동 제출한다. 오탐 한두 번으로 시험이 끝나버리는 걸 막기 위해 충분히 높게 잡는다.
const AUTO_SUBMIT_THRESHOLD = 8;

export async function logProctorEvent(
  attemptId: number,
  userId: number,
  eventType: string,
  detail: unknown,
): Promise<{ flagged: boolean; autoSubmit: boolean }> {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.user_id !== userId) throw new Error("응시 기록을 찾을 수 없습니다.");

  await pool.query("INSERT INTO exam_proctor_events (attempt_id, event_type, detail) VALUES ($1,$2,$3)", [
    attemptId,
    eventType,
    JSON.stringify(detail ?? {}),
  ]);

  if (!SUSPICIOUS_EVENT_TYPES.has(eventType)) return { flagged: attempt.flagged_for_review ?? false, autoSubmit: false };

  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*) FROM exam_proctor_events WHERE attempt_id = $1 AND event_type = ANY($2::text[])",
    [attemptId, [...SUSPICIOUS_EVENT_TYPES]],
  );
  const suspiciousCount = Number(rows[0].count);
  const flagged = suspiciousCount >= FLAG_THRESHOLD;
  if (flagged) {
    await pool.query("UPDATE exam_attempts SET flagged_for_review = true WHERE id = $1", [attemptId]);
  }
  return { flagged, autoSubmit: suspiciousCount >= AUTO_SUBMIT_THRESHOLD && attempt.status === "in_progress" };
}

/** 제한 시간이 지난 in_progress 응시를 자동 제출 처리한다 — GET으로 상태를 조회할 때마다 확인한다. */
export async function autoSubmitIfExpired(attemptId: number): Promise<void> {
  const attempt = await getAttempt(attemptId);
  if (!attempt || attempt.status !== "in_progress" || !isTimeExpired(attempt)) return;
  const { score } = await buildResultItems(attempt);
  await pool.query(
    "UPDATE exam_attempts SET status = 'auto_submitted', submitted_at = now(), score = $1 WHERE id = $2",
    [score, attemptId],
  );
}
