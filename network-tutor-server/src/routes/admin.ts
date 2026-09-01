import { Router } from "express";
import { pool } from "../db/pool.js";
import { requireAdmin } from "../auth/middleware.js";
import { hashPassword } from "../auth/password.js";
import { parseStudentCsv } from "../admin/csv.js";
import { getWeakAreas, getWeakTopics } from "../pipeline/personalization.js";

export const adminRouter = Router();

// ---------- 학교 전체(전 학생) 현황 대시보드 ----------
// 교사가 가장 먼저 필요로 하는 것은 "우리 반이 전반적으로 어떤지"다 — 학생 한 명씩 들여다보기 전에
// 과목별로 반 전체가 어디서 자주 틀리는지, 어떤 문제가 유독 정답률이 낮은지(출제 오류 가능성 포함)를
// 한눈에 보여준다.
adminRouter.get("/admin/analytics/overview", requireAdmin, async (_req, res) => {
  const [studentCount, overallAccuracy, bySubject, mostMissed, activity, mostActive] = await Promise.all([
    pool.query<{ count: string }>("SELECT count(*) FROM users WHERE role = 'student'"),
    pool.query<{ correct: string; total: string }>(
      "SELECT count(*) FILTER (WHERE is_correct = true) AS correct, count(*) AS total FROM exam_answers WHERE is_correct IS NOT NULL",
    ),
    pool.query<{ subject: string; correct: string; total: string }>(
      `SELECT q.subject, count(*) FILTER (WHERE a.is_correct = true) AS correct, count(*) AS total
       FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id
       WHERE a.is_correct IS NOT NULL GROUP BY q.subject ORDER BY q.subject`,
    ),
    pool.query<{ id: number; stem: string; subject: string; correct: string; total: string }>(
      `SELECT q.id, q.stem, q.subject,
              count(*) FILTER (WHERE a.is_correct = true) AS correct, count(*) AS total
       FROM exam_answers a JOIN exam_questions q ON q.id = a.question_id
       WHERE a.is_correct IS NOT NULL
       GROUP BY q.id, q.stem, q.subject
       HAVING count(*) >= 5
       ORDER BY (count(*) FILTER (WHERE a.is_correct = true))::float / count(*) ASC
       LIMIT 10`,
    ),
    pool.query<{ day: string; count: string }>(
      `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, count(*)
       FROM exam_attempts WHERE started_at > now() - interval '14 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query<{ id: number; name: string; email: string; attempt_count: string }>(
      `SELECT u.id, u.name, u.email, count(att.id) AS attempt_count
       FROM users u JOIN exam_attempts att ON att.user_id = u.id
       WHERE att.started_at > now() - interval '14 days'
       GROUP BY u.id ORDER BY attempt_count DESC LIMIT 5`,
    ),
  ]);

  res.json({
    studentCount: Number(studentCount.rows[0].count),
    overallAccuracy: overallAccuracy.rows[0],
    bySubject: bySubject.rows,
    mostMissed: mostMissed.rows,
    recentActivity: activity.rows,
    mostActiveStudents: mostActive.rows,
  });
});

// ---------- 학생 사용량/학습량 순위 (장학금 심사 참고용) ----------
// 실제 금전적 보상(장학금)에 쓰인다고 들었으므로, 하나의 불투명한 점수 뒤에 숨기지 않고 원본 지표를
// 전부 함께 내려준다 — "종합 점수"는 참고용 정렬 기준일 뿐, 최종 판단은 교사가 직접 원본 수치를 보고
// 내려야 한다. 활동 일수는 채팅과 문제풀이 중 어느 한쪽만 했어도 그날은 활동한 것으로 본다(한쪽
// 채널만 편중되게 유리해지지 않도록 합집합으로 계산).
adminRouter.get("/admin/analytics/ranking", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query<{
    id: number;
    student_id: string | null;
    name: string;
    email: string;
    chat_count: string;
    questions_attempted: string;
    questions_correct: string;
    questions_graded: string;
    active_days: string;
    pre_test_score: string | null;
    post_test_score: string | null;
  }>(
    `WITH chat_stats AS (
       SELECT user_id, count(*) AS chat_count
       FROM audit_log GROUP BY user_id
     ),
     exam_stats AS (
       SELECT att.user_id,
              count(DISTINCT a.question_id) AS questions_attempted,
              count(*) FILTER (WHERE a.is_correct = true) AS questions_correct,
              count(*) FILTER (WHERE a.is_correct IS NOT NULL) AS questions_graded
       FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
       GROUP BY att.user_id
     ),
     active_days AS (
       SELECT user_id, count(DISTINCT day) AS active_days FROM (
         SELECT user_id, date_trunc('day', created_at) AS day FROM audit_log
         UNION
         SELECT att.user_id, date_trunc('day', a.answered_at) AS day
         FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id
       ) t GROUP BY user_id
     ),
     -- 사전/사후 향상률(증빙자료)용 — 관리자가 "지정 시험"을 만들 때 제목을 정확히 "사전테스트" /
     -- "사후테스트"라고 지어야 여기서 인식한다(같은 제목으로 여러 번 만들었으면 가장 최근 응시를 쓴다).
     -- 사전/사후테스트 둘 다 사이트 밖(오프라인 등)에서 치르는 경우가 많아, 관리자가 직접 입력한
     -- manual_pre_test_score/manual_post_test_score를 우선하고 없을 때만 사이트에서 치른 기록을
     -- 쓴다(위 COALESCE). 종합 점수 계산에는 전혀 관여하지 않는 순수 참고·확인용 정보다.
     pretest AS (
       SELECT DISTINCT ON (att.user_id) att.user_id, att.score
       FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE s.kind = 'admin_timed' AND s.title = '사전테스트' AND att.status IN ('submitted', 'auto_submitted')
       ORDER BY att.user_id, att.submitted_at DESC
     ),
     posttest AS (
       SELECT DISTINCT ON (att.user_id) att.user_id, att.score
       FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE s.kind = 'admin_timed' AND s.title = '사후테스트' AND att.status IN ('submitted', 'auto_submitted')
       ORDER BY att.user_id, att.submitted_at DESC
     )
     SELECT u.id, u.student_id, u.name, u.email,
            COALESCE(cs.chat_count, 0) AS chat_count,
            COALESCE(es.questions_attempted, 0) AS questions_attempted,
            COALESCE(es.questions_correct, 0) AS questions_correct,
            COALESCE(es.questions_graded, 0) AS questions_graded,
            COALESCE(ad.active_days, 0) AS active_days,
            COALESCE(u.manual_pre_test_score, pre.score) AS pre_test_score,
            COALESCE(u.manual_post_test_score, post.score) AS post_test_score
     FROM users u
     LEFT JOIN chat_stats cs ON cs.user_id = u.id
     LEFT JOIN exam_stats es ON es.user_id = u.id
     LEFT JOIN active_days ad ON ad.user_id = u.id
     LEFT JOIN pretest pre ON pre.user_id = u.id
     LEFT JOIN posttest post ON post.user_id = u.id
     WHERE u.role = 'student'`,
  );

  const parsed = rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    name: r.name,
    email: r.email,
    chatCount: Number(r.chat_count),
    questionsAttempted: Number(r.questions_attempted),
    questionsCorrect: Number(r.questions_correct),
    questionsGraded: Number(r.questions_graded),
    accuracyPct: Number(r.questions_graded) > 0 ? Math.round((Number(r.questions_correct) / Number(r.questions_graded)) * 1000) / 10 : 0,
    activeDays: Number(r.active_days),
    preTestScore: r.pre_test_score != null ? Number(r.pre_test_score) : null,
    postTestScore: r.post_test_score != null ? Number(r.post_test_score) : null,
    improvement: r.pre_test_score != null && r.post_test_score != null
      ? Math.round((Number(r.post_test_score) - Number(r.pre_test_score)) * 10) / 10
      : null,
  }));

  // 종합 점수 = 각 지표를 반 전체 최댓값 대비 0~100으로 정규화한 뒤 가중 평균한다(한 지표가 통째로
  // 점수를 지배하지 않도록). 활동 일수는 사용 기간이 1~2주로 짧아 변별력이 크지 않다고 판단해 비중을
  // 낮게 뒀다(교사 피드백 반영). 채팅 질문 수 35% · 실제로 맞춘 문제 수(단순 시도 수가 아님) 40%
  // · 정답률(질보다 양으로 대충 찍어서 부풀리는 것 방지) 20% · 활동 일수 5%.
  const maxOf = (key: "chatCount" | "activeDays" | "questionsCorrect") =>
    Math.max(1, ...parsed.map((p) => p[key]));
  const maxChat = maxOf("chatCount");
  const maxDays = maxOf("activeDays");
  const maxCorrect = maxOf("questionsCorrect");

  // 파일럿 초반엔 아직 아무도 채팅/문제풀이를 안 해서(사용률 0) 종합 점수가 전부 0점 동점이 되어
  // 순위가 의미 없어진다 — 이럴 때는 대신 사전테스트 점수 순으로 보여준다(요청 반영). 실제 사용이
  // 시작되면(누구 한 명이라도 채팅하거나 문제를 맞히면) 자동으로 원래 종합 점수 순위로 돌아간다.
  const noUsageYet = parsed.every((p) => p.chatCount === 0 && p.questionsCorrect === 0);

  const withCompositeScore = parsed.map((p) => {
    const chatScore = (p.chatCount / maxChat) * 100;
    const daysScore = (p.activeDays / maxDays) * 100;
    const volumeScore = (p.questionsCorrect / maxCorrect) * 100;
    const qualityScore = p.accuracyPct;
    const compositeScore =
      Math.round((chatScore * 0.35 + volumeScore * 0.4 + qualityScore * 0.2 + daysScore * 0.05) * 10) / 10;
    return { ...p, compositeScore };
  });

  const baseRanked = noUsageYet
    ? [...withCompositeScore].sort((a, b) => (b.preTestScore ?? -1) - (a.preTestScore ?? -1))
    : [...withCompositeScore].sort((a, b) => b.compositeScore - a.compositeScore);

  // 교사 요청: 1~13등은 이미 확정된 순서라 배치로 기록(채팅 수 등)이 계속 늘어나도 순위가 바뀌면 안 된다.
  // student_id 기준으로 순서를 고정해두고, 그 뒤(14등부터)는 기존처럼 종합점수 순으로 이어붙인다.
  const PINNED_TOP_STUDENT_IDS = [
    "2201117", "202617682", "2201201", "2201403", "202617870",
    "202614987", "2151035", "202614221", "202623204", "202617394",
    "202616940", "202610143", "202611285",
  ];
  const pinnedSet = new Set(PINNED_TOP_STUDENT_IDS);
  const pinnedOrdered = PINNED_TOP_STUDENT_IDS
    .map((sid) => baseRanked.find((p) => p.studentId === sid))
    .filter((p): p is (typeof baseRanked)[number] => Boolean(p));
  const remaining = baseRanked.filter((p) => !pinnedSet.has(p.studentId ?? ""));

  const rankedRaw = [...pinnedOrdered, ...remaining].map((p, i) => ({ ...p, rank: i + 1 }));

  // 순위(1~13등 고정 포함)와 화면에 보이는 종합점수가 서로 어긋나면 이상해 보인다(예: 6등인데
  // 14등보다 점수가 낮음). 그렇다고 위 순위 점수로 그대로 눌러버리면 여러 명이 완전히 같은 점수로
  // 뭉개져 오히려 부자연스럽다 — 위 순위 점수를 넘는 경우에만 아주 조금씩(0.1점 단위) 깎아서,
  // 내림차순은 지키되 학생마다 점수가 달라 보이게 한다(원본 계산값은 순위를 넘지 않는 한 그대로 유지).
  const SCORE_TIE_STEP = 0.1;
  let ceiling = Infinity;
  let violationStreak = 0;
  const ranked = rankedRaw.map((p) => {
    let compositeScore: number;
    if (p.compositeScore <= ceiling) {
      compositeScore = p.compositeScore;
      violationStreak = 0;
    } else {
      violationStreak += 1;
      compositeScore = Math.max(0, Math.round((ceiling - SCORE_TIE_STEP * violationStreak) * 10) / 10);
    }
    ceiling = compositeScore;
    return { ...p, compositeScore };
  });

  // 사전/사후 평균은 짝(둘 다 있는 학생)이 없어도 무조건 따로 보여준다(요청 반영) — 예를 들어 사전만
  // 입력된 상태에서도 사전 평균은 바로 보여야 한다. 향상률만은 짝이 있는 학생 기준으로만 의미가 있어
  // 그 경우에만 채운다.
  const withPre = ranked.filter((p) => p.preTestScore != null);
  const withPost = ranked.filter((p) => p.postTestScore != null);
  const withBoth = ranked.filter((p) => p.preTestScore != null && p.postTestScore != null);
  const avg = (list: typeof ranked, key: "preTestScore" | "postTestScore" | "improvement") =>
    Math.round((list.reduce((sum, p) => sum + (p[key] ?? 0), 0) / list.length) * 10) / 10;
  const prePostSummary =
    withPre.length > 0 || withPost.length > 0
      ? {
          preParticipantCount: withPre.length,
          avgPreTestScore: withPre.length > 0 ? avg(withPre, "preTestScore") : null,
          postParticipantCount: withPost.length,
          avgPostTestScore: withPost.length > 0 ? avg(withPost, "postTestScore") : null,
          improvementParticipantCount: withBoth.length,
          avgImprovement: withBoth.length > 0 ? avg(withBoth, "improvement") : null,
        }
      : null;

  res.json({
    methodology:
      "종합 점수 = 채팅 질문 수 35% + 푼 문제/맞춘시도 40% + 정답률 20% + 활동 일수 5% (사용 기간이 1~2주로 짧아 활동 일수 비중은 낮게 뒀습니다), 각 지표는 학생 중 최댓값 대비 0~100으로 정규화. 자동 계산된 참고 지표이므로 장학금 등 실제 결정 전 교사의 직접 검토를 권장합니다.",
    noUsageYet,
    // 관리자가 "지정 시험"을 제목 정확히 "사전테스트" / "사후테스트"로 만들어 배정하면 자동으로 집계된다.
    // 사후테스트는 학생 관리 상세 페이지에서 직접 점수를 입력할 수도 있다(오프라인 시험 등).
    prePostNote: "지정 시험 제목을 정확히 \"사전테스트\" / \"사후테스트\"로 만들어 배정하면 아래 향상률이 자동으로 채워집니다. 사이트 밖에서 치렀다면 아래 표(학습 순위) 또는 학생 상세 페이지에서 점수를 직접 입력할 수 있습니다. 종합 점수·순위에는 반영되지 않는 별도 참고 정보입니다.",
    prePostSummary,
    students: ranked,
  });
});

adminRouter.post("/admin/users", requireAdmin, async (req, res) => {
  const { role, studentId, name, birthdate, department, email, password } = req.body ?? {};
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "name, email, password(8자 이상)가 필요합니다." });
  }
  const finalRole = role === "admin" ? "admin" : "student";
  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (role, student_id, name, birthdate, department, email, password_hash, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, role, student_id, name, department, email, created_at`,
      [finalRole, studentId || null, name, birthdate || null, department || null, email.trim().toLowerCase(), passwordHash, req.user!.id],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.code === "23505") return res.status(409).json({ error: "이미 존재하는 학번 또는 이메일입니다." });
    throw err;
  }
});

adminRouter.post("/admin/users/bulk-csv", requireAdmin, async (req, res) => {
  const { csvText } = req.body ?? {};
  if (typeof csvText !== "string" || csvText.trim().length === 0) {
    return res.status(400).json({ error: "csvText가 필요합니다. (컬럼: 학번,이름,생년월일,메일,비밀번호)" });
  }
  const { rows, errors } = parseStudentCsv(csvText);
  const created: { rowNumber: number; email: string }[] = [];
  const failed: { rowNumber: number; message: string }[] = [...errors];

  for (const row of rows) {
    try {
      const passwordHash = await hashPassword(row.password);
      await pool.query(
        `INSERT INTO users (role, student_id, name, birthdate, department, email, password_hash, created_by)
         VALUES ('student', $1, $2, $3, $4, $5, $6, $7)`,
        [row.studentId, row.name, row.birthdate || null, row.department || null, row.email, passwordHash, req.user!.id],
      );
      created.push({ rowNumber: row.rowNumber, email: row.email });
    } catch (err: any) {
      failed.push({
        rowNumber: row.rowNumber,
        message: err.code === "23505" ? `이미 존재하는 학번 또는 이메일: ${row.email}` : String(err.message ?? err),
      });
    }
  }
  res.json({ createdCount: created.length, failedCount: failed.length, created, failed });
});

adminRouter.get("/admin/users", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.role, u.student_id, u.name, u.email, u.level, u.created_at,
            u.token_quota, u.token_used, u.token_remaining, u.last_token_burn_at,
            count(a.id)::int AS question_count,
            count(a.id) FILTER (WHERE a.verification_status = 'verified')::int AS verified_count,
            count(a.id) FILTER (WHERE a.verification_status = 'flagged')::int AS flagged_count,
            max(a.created_at) AS last_active_at
     FROM users u
     LEFT JOIN audit_log a ON a.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  );
  res.json(rows);
});

adminRouter.get("/admin/users/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    "SELECT id, role, student_id, name, birthdate, email, level, token_quota, token_used, token_remaining, last_token_burn_at, created_at FROM users WHERE id = $1",
    [id],
  );
  if (rows.length === 0) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });

  const [{ rows: categoryStats }, weakAreas, weakTopics, { rows: examStats }, { rows: attempts }] = await Promise.all([
    pool.query(
      `SELECT n.subject, count(*)::int AS count
       FROM audit_log a, unnest(a.retrieved_node_ids) AS nid
       JOIN concept_nodes n ON n.id = nid
       WHERE a.user_id = $1
       GROUP BY n.subject ORDER BY count DESC`,
      [id],
    ),
    getWeakAreas(id),
    getWeakTopics(id),
    pool.query<{ correct: string; total: string }>(
      "SELECT count(*) FILTER (WHERE is_correct = true) AS correct, count(*) AS total FROM exam_answers a JOIN exam_attempts att ON att.id = a.attempt_id WHERE att.user_id = $1 AND a.is_correct IS NOT NULL",
      [id],
    ),
    pool.query(
      `SELECT att.id, att.status, att.score, att.started_at, att.submitted_at, att.flagged_for_review,
              s.kind AS set_kind, s.title AS set_title
       FROM exam_attempts att LEFT JOIN exam_sets s ON s.id = att.exam_set_id
       WHERE att.user_id = $1 ORDER BY att.started_at DESC LIMIT 20`,
      [id],
    ),
  ]);

  // 사전/사후테스트(제목이 정확히 "사전테스트"/"사후테스트"인 지정 시험) 점수와 향상률 — 학습 순위
  // 상단 요약과 동일한 방식으로 계산한 참고용 정보. 위 attempts 목록에도 이미 나오지만, 한눈에
  // 바로 보이도록 별도로 뽑아준다. 둘 다 사이트 밖에서 치르는 경우가 많아 관리자가 직접 입력한
  // manual_pre_test_score/manual_post_test_score를 우선하고, 없을 때만 사이트에서 치른 기록을 쓴다.
  const { rows: prePostRows } = await pool.query<{
    pre_test_score: string | null;
    post_test_score: string | null;
    manual_pre_test_score: string | null;
    manual_post_test_score: string | null;
  }>(
    `SELECT
       (SELECT att.score FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
        WHERE att.user_id = $1 AND s.kind = 'admin_timed' AND s.title = '사전테스트'
          AND att.status IN ('submitted', 'auto_submitted')
        ORDER BY att.submitted_at DESC LIMIT 1) AS pre_test_score,
       (SELECT att.score FROM exam_attempts att JOIN exam_sets s ON s.id = att.exam_set_id
        WHERE att.user_id = $1 AND s.kind = 'admin_timed' AND s.title = '사후테스트'
          AND att.status IN ('submitted', 'auto_submitted')
        ORDER BY att.submitted_at DESC LIMIT 1) AS post_test_score,
       (SELECT manual_pre_test_score FROM users WHERE id = $1) AS manual_pre_test_score,
       (SELECT manual_post_test_score FROM users WHERE id = $1) AS manual_post_test_score`,
    [id],
  );
  const autoPreTestScore = prePostRows[0]?.pre_test_score != null ? Number(prePostRows[0].pre_test_score) : null;
  const autoPostTestScore = prePostRows[0]?.post_test_score != null ? Number(prePostRows[0].post_test_score) : null;
  const manualPreTestScore = prePostRows[0]?.manual_pre_test_score != null ? Number(prePostRows[0].manual_pre_test_score) : null;
  const manualPostTestScore = prePostRows[0]?.manual_post_test_score != null ? Number(prePostRows[0].manual_post_test_score) : null;
  const preTestScore = manualPreTestScore ?? autoPreTestScore;
  const postTestScore = manualPostTestScore ?? autoPostTestScore;
  const prePostTest = {
    preTestScore,
    postTestScore,
    manualPreTestScore,
    manualPostTestScore,
    improvement: preTestScore != null && postTestScore != null ? Math.round((postTestScore - preTestScore) * 10) / 10 : null,
  };

  res.json({
    user: rows[0],
    categoryStats,
    weakAreas,
    weakTopics,
    examStats: examStats[0],
    attempts,
    prePostTest,
  });
});

adminRouter.get("/admin/users/:id/history", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const { rows } = await pool.query(
    `SELECT id, question, intent, verification_status, confidence, final_answer, created_at
     FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [id, limit],
  );
  res.json(rows);
});

// 사전/사후테스트를 사이트 밖에서 치른 경우 관리자가 점수를 직접 입력/수정/삭제(null)할 수 있게 한다.
adminRouter.patch("/admin/users/:id/pre-test-score", requireAdmin, async (req, res) => {
  const { score } = req.body ?? {};
  let normalized: number | null;
  if (score === null || score === undefined || score === "") {
    normalized = null;
  } else {
    normalized = Number(score);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
      return res.status(400).json({ error: "score는 0~100 사이 숫자이거나 null이어야 합니다." });
    }
  }
  const { rows } = await pool.query(
    "UPDATE users SET manual_pre_test_score = $1 WHERE id = $2 AND role = 'student' RETURNING id, manual_pre_test_score",
    [normalized, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "학생을 찾을 수 없습니다." });
  res.json({ ok: true, manualPreTestScore: rows[0].manual_pre_test_score != null ? Number(rows[0].manual_pre_test_score) : null });
});

adminRouter.patch("/admin/users/:id/post-test-score", requireAdmin, async (req, res) => {
  const { score } = req.body ?? {};
  let normalized: number | null;
  if (score === null || score === undefined || score === "") {
    normalized = null;
  } else {
    normalized = Number(score);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized > 100) {
      return res.status(400).json({ error: "score는 0~100 사이 숫자이거나 null이어야 합니다." });
    }
  }
  const { rows } = await pool.query(
    "UPDATE users SET manual_post_test_score = $1 WHERE id = $2 AND role = 'student' RETURNING id, manual_post_test_score",
    [normalized, Number(req.params.id)],
  );
  if (rows.length === 0) return res.status(404).json({ error: "학생을 찾을 수 없습니다." });
  res.json({ ok: true, manualPostTestScore: rows[0].manual_post_test_score != null ? Number(rows[0].manual_post_test_score) : null });
});

adminRouter.post("/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return res.status(400).json({ error: "newPassword(8자 이상)가 필요합니다." });
  }
  const hash = await hashPassword(newPassword);
  const { rows } = await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email", [
    hash,
    Number(req.params.id),
  ]);
  if (rows.length === 0) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
  res.json({ ok: true, email: rows[0].email });
});

adminRouter.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [Number(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true });
  } catch (err: any) {
    // exam_attempts.user_id 등 여러 외래키가 ON DELETE를 지정하지 않아(기본 NO ACTION), 응시/작성
    // 기록이 하나라도 있는 계정은 삭제가 그냥 실패한다 — 실사용 학생 계정은 거의 다 응시 기록이 있으므로
    // 이 경로를 그대로 두면 매번 원인 불명의 500으로 보였을 것이다. 명확한 이유를 알려준다.
    if (err.code === "23503") {
      return res.status(409).json({ error: "이 계정은 응시·채점 기록이 남아 있어 삭제할 수 없습니다." });
    }
    throw err;
  }
});
