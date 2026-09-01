import { pool } from "../db/pool.js";
import { getWeakAreas, getWeakTopics, type WeakArea, type WeakTopic } from "../pipeline/personalization.js";
import { generateChat } from "../llm/provider.js";

export interface WrongAnswerItem {
  answerId: number;
  questionId: number;
  conceptNodeId: number | null;
  subject: string;
  stem: string;
  questionType: string;
  choices: string[] | null;
  correctIndex: number | null;
  selectedIndex: number | null;
  answerText: string | null;
  explanation: string;
  answeredAt: Date;
}

/** 학생이 지금까지(연습/모의고사/기출회차/관리자시험 전부 포함) 틀린 문제를 최신순으로 모은 오답노트. */
export async function getWrongAnswers(userId: number, limit = 100): Promise<WrongAnswerItem[]> {
  const { rows } = await pool.query(
    `SELECT a.id AS answer_id, a.question_id, a.selected_index, a.answer_text, a.answered_at,
            q.subject, q.stem, q.question_type, q.choices, q.correct_index, q.explanation, q.concept_node_id
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     JOIN exam_attempts att ON att.id = a.attempt_id
     WHERE att.user_id = $1 AND a.is_correct = false
     ORDER BY a.answered_at DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    answerId: r.answer_id,
    questionId: r.question_id,
    conceptNodeId: r.concept_node_id,
    subject: r.subject,
    stem: r.stem,
    questionType: r.question_type,
    choices: r.choices,
    correctIndex: r.correct_index,
    selectedIndex: r.selected_index,
    answerText: r.answer_text,
    explanation: r.explanation,
    answeredAt: r.answered_at,
  }));
}

export interface SubjectStat {
  subject: string;
  total: number;
  correct: number;
  accuracy: number;
}

export interface StudentReport {
  totalAnswered: number;
  totalCorrect: number;
  overallAccuracy: number;
  bySubject: SubjectStat[];
  weakTopics: WeakTopic[];
  activityByDay: { day: string; count: number }[];
  recentAttempts: { id: number; score: number | null; total: number; setKind: string | null; submittedAt: Date | null }[];
}

/** 약점 진단 리포트 + 개인 학습 프로필에 필요한 통계를 한 번에 모은다. */
export async function getStudentReport(userId: number): Promise<StudentReport> {
  const { rows: subjectRows } = await pool.query<{ subject: string; total: string; correct: string }>(
    `SELECT q.subject, count(*) AS total, count(*) FILTER (WHERE a.is_correct = true) AS correct
     FROM exam_answers a
     JOIN exam_questions q ON q.id = a.question_id
     JOIN exam_attempts att ON att.id = a.attempt_id
     WHERE att.user_id = $1 AND a.is_correct IS NOT NULL
     GROUP BY q.subject ORDER BY q.subject`,
    [userId],
  );
  const bySubject: SubjectStat[] = subjectRows.map((r) => {
    const total = Number(r.total);
    const correct = Number(r.correct);
    return { subject: r.subject, total, correct, accuracy: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0 };
  });
  const totalAnswered = bySubject.reduce((sum, s) => sum + s.total, 0);
  const totalCorrect = bySubject.reduce((sum, s) => sum + s.correct, 0);

  const weakTopics = await getWeakTopics(userId);

  const { rows: activityRows } = await pool.query<{ day: string; count: string }>(
    `SELECT to_char(date_trunc('day', answered_at), 'YYYY-MM-DD') AS day, count(*)
     FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
     WHERE att.user_id = $1 AND a.answered_at > now() - interval '14 days'
     GROUP BY 1 ORDER BY 1`,
    [userId],
  );

  const { rows: attemptRows } = await pool.query(
    `SELECT a.id, a.score, array_length(a.question_ids, 1) AS total, s.kind AS set_kind, a.submitted_at
     FROM exam_attempts a LEFT JOIN exam_sets s ON s.id = a.exam_set_id
     WHERE a.user_id = $1 AND a.status IN ('submitted','auto_submitted')
     ORDER BY a.submitted_at DESC LIMIT 10`,
    [userId],
  );

  return {
    totalAnswered,
    totalCorrect,
    overallAccuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 1000) / 10 : 0,
    bySubject,
    weakTopics,
    activityByDay: activityRows.map((r) => ({ day: r.day, count: Number(r.count) })),
    recentAttempts: attemptRows.map((r) => ({
      id: r.id,
      score: r.score !== null ? Number(r.score) : null,
      total: r.total ?? 0,
      setKind: r.set_kind,
      submittedAt: r.submitted_at,
    })),
  };
}

/** 리포트 하단에 붙는 AI 종합 분석 글. 매 요청마다 새로 생성하면 느리므로 캐시하고, force=true일 때만
 * (또는 캐시가 없을 때) 새로 생성한다. */
export async function getOrCreateReportAnalysis(userId: number, force = false): Promise<{ content: string; generatedAt: Date }> {
  if (!force) {
    const { rows } = await pool.query<{ content: string; generated_at: Date }>(
      "SELECT content, generated_at FROM student_report_analysis WHERE user_id = $1",
      [userId],
    );
    if (rows.length > 0) return { content: rows[0].content, generatedAt: rows[0].generated_at };
  }

  const [report, weakAreas] = await Promise.all([getStudentReport(userId), getWeakAreas(userId)]);
  const { content, ok } = await composeAnalysis(report, weakAreas);

  // AI 생성이 일시적으로 실패했을 때 그 실패 메시지를 그대로 캐시해버리면, 학생이 "다시 생성"을 직접
  // 누르기 전까지 계속 실패 메시지만 보게 된다(다음 GET은 항상 force=false로 캐시부터 보기 때문). 실패
  // 시에는 캐시를 건드리지 않고, 이전에 성공한 분석이 있으면 그걸 계속 보여주는 편이 낫다.
  if (!ok) {
    const { rows } = await pool.query<{ content: string; generated_at: Date }>(
      "SELECT content, generated_at FROM student_report_analysis WHERE user_id = $1",
      [userId],
    );
    if (rows.length > 0) return { content: rows[0].content, generatedAt: rows[0].generated_at };
    return { content, generatedAt: new Date() };
  }

  await pool.query(
    `INSERT INTO student_report_analysis (user_id, content, generated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET content = EXCLUDED.content, generated_at = now()`,
    [userId, content],
  );
  return { content, generatedAt: new Date() };
}

async function composeAnalysis(report: StudentReport, weakAreas: WeakArea[]): Promise<{ content: string; ok: boolean }> {
  if (report.totalAnswered === 0) {
    return {
      ok: true,
      content: "아직 채점된 문제가 없어서 분석할 데이터가 없어요. 문제 연습이나 모의고사를 몇 개 풀어보시면 그때부터 맞춤 분석을 보여드릴게요.",
    };
  }

  const subjectLines = report.bySubject
    .map((s) => `- ${s.subject.replace(/^\d과목_/, "")}: ${s.accuracy}% (${s.correct}/${s.total})`)
    .join("\n");
  const topicLines = report.weakTopics
    .slice(0, 5)
    .map((t) => `- ${t.topic}: ${Math.round(t.accuracy * 100)}% (${t.totalCount - t.wrongCount}/${t.totalCount})`)
    .join("\n");
  const activeDays = report.activityByDay.length;

  const prompt =
    `아래는 한 학생의 네트워크관리사 2급 시험 대비 학습 데이터야. 이 데이터를 바탕으로 학생에게 직접 말하듯 ` +
    `친근하면서도 구체적인 종합 학습 분석을 4~6문단으로 작성해줘. 잘하고 있는 점을 먼저 짚어주고, 약점 패턴을 ` +
    `과목/세부주제 단위로 명확히 짚고, 마지막엔 다음 1~2주 동안 무엇을 우선 공부하면 좋을지 구체적으로 제안해줘. ` +
    `데이터에 없는 수치는 절대 지어내지 마.\n\n` +
    `전체 정답률: ${report.overallAccuracy}% (${report.totalCorrect}/${report.totalAnswered}문제)\n\n` +
    `과목별 정답률:\n${subjectLines}\n\n` +
    (topicLines ? `세부 주제별 약점(정답률 낮은 순):\n${topicLines}\n\n` : "") +
    (weakAreas.length > 0 ? `가장 취약한 과목: ${weakAreas.map((w) => w.subject.replace(/^\d과목_/, "")).join(", ")}\n\n` : "") +
    `최근 14일 중 ${activeDays}일 학습 활동 있음.`;

  try {
    const gen = await generateChat(
      [
        {
          role: "system",
          content: "당신은 네트워크관리사 2급 필기시험 대비 AI 튜터입니다. 학생의 실제 채점 데이터를 바탕으로 정직하고 구체적인 학습 분석을 씁니다.",
        },
        { role: "user", content: prompt },
      ],
      { provider: "default" },
      { temperature: 0.4 },
    );
    return { ok: true, content: gen.text };
  } catch {
    return { ok: false, content: "지금 분석 글을 생성하는 데 실패했어요. 잠시 후 다시 시도해주세요." };
  }
}
