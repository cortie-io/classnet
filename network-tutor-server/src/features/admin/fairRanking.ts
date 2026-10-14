import { pool } from "../../infrastructure/db/pool.js";

export const rankingMethodology =
	"문항마다 최초 완료한 유효 응시의 획득점수 ÷ 배점을 합산합니다(문항당 최대 1점). 반복 풀이, 진행 중·무효 응시, 대화 횟수, 접속 일수, 수동 입력 점수는 순위 점수에 반영하지 않습니다. 채점 전 문항은 대기하며 동점은 공동 순위, 평가 기록이 없으면 미산정입니다.";

export function assignFairRanks<
	T extends { id: number; compositeScore: number; questionsGraded: number },
>(students: T[]) {
	let lastScore: number | undefined;
	let rank = 0;
	return [...students]
		.sort(
			(a, b) =>
				Number(b.questionsGraded > 0) - Number(a.questionsGraded > 0) ||
				b.compositeScore - a.compositeScore ||
				a.id - b.id,
		)
		.map((student, index) => {
			if (!student.questionsGraded) return { ...student, rank: null };
			if (lastScore !== student.compositeScore) rank = index + 1;
			lastScore = student.compositeScore;
			return { ...student, rank };
		});
}

export async function getFairRanking() {
	const { rows } = await pool.query(`
    WITH first_answers AS (
      SELECT DISTINCT ON (att.user_id, a.question_id)
        att.user_id, a.question_id, a.is_correct, a.score, q.max_score
      FROM exam_attempts att
      JOIN exam_answers a ON a.attempt_id=att.id
      JOIN exam_questions q ON q.id=a.question_id
      WHERE att.status IN ('submitted','auto_submitted')
      ORDER BY att.user_id,a.question_id,att.started_at,att.id
    ), assessment AS (
      SELECT user_id, count(*)::int AS attempted,
        count(*) FILTER (WHERE score IS NOT NULL AND max_score>0)::int AS graded,
        count(*) FILTER (WHERE is_correct=true AND score IS NOT NULL AND max_score>0)::int AS correct,
        round(sum(CASE WHEN score IS NOT NULL AND max_score>0 THEN greatest(0,least(1,score/max_score)) ELSE 0 END),4) AS earned
      FROM first_answers GROUP BY user_id
    ), chats AS (SELECT user_id,count(*)::int AS count FROM audit_log GROUP BY user_id),
    days AS (
      SELECT user_id,count(DISTINCT day)::int AS count FROM (
        SELECT user_id,(created_at AT TIME ZONE 'Asia/Seoul')::date AS day FROM audit_log
        UNION SELECT user_id,(started_at AT TIME ZONE 'Asia/Seoul')::date FROM exam_attempts
        WHERE status IN ('submitted','auto_submitted')
      ) activity GROUP BY user_id
    )
    SELECT u.id,u.student_id,u.name,u.email,u.manual_pre_test_score,u.manual_post_test_score,coalesce(a.attempted,0) AS attempted,
      coalesce(a.graded,0) AS graded,coalesce(a.correct,0) AS correct,coalesce(a.earned,0) AS earned,
      coalesce(c.count,0) AS chat_count,coalesce(d.count,0) AS active_days
    FROM users u LEFT JOIN assessment a ON a.user_id=u.id
    LEFT JOIN chats c ON c.user_id=u.id LEFT JOIN days d ON d.user_id=u.id
    WHERE u.role='student'`);
	const students = assignFairRanks(
		rows.map((r) => ({
			id: r.id,
			studentId: r.student_id,
			name: r.name,
			email: r.email,
			questionsAttempted: Number(r.attempted),
			questionsGraded: Number(r.graded),
			questionsCorrect: Number(r.correct),
			compositeScore: Number(r.earned),
			chatCount: Number(r.chat_count),
			activeDays: Number(r.active_days),
			accuracyPct: r.graded
				? Math.round((r.correct / r.graded) * 1000) / 10
				: 0,
			preTestScore:
				r.manual_pre_test_score === null
					? null
					: Number(r.manual_pre_test_score),
			postTestScore:
				r.manual_post_test_score === null
					? null
					: Number(r.manual_post_test_score),
			improvement:
				r.manual_pre_test_score !== null && r.manual_post_test_score !== null
					? Number(r.manual_post_test_score) - Number(r.manual_pre_test_score)
					: null,
		})),
	);
	const mean = (key: "preTestScore" | "postTestScore" | "improvement") => {
		const values = students
			.map((s) => s[key])
			.filter((v): v is number => v !== null);
		return {
			count: values.length,
			average: values.length
				? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) /
					10
				: null,
		};
	};
	const pre = mean("preTestScore"),
		post = mean("postTestScore"),
		improvement = mean("improvement");
	return {
		methodology: rankingMethodology,
		noUsageYet: students.every((s) => !s.questionsGraded),
		prePostNote:
			"사전·사후 점수는 별도 참고 정보이며 순위 점수에는 반영하지 않습니다.",
		prePostSummary:
			pre.count || post.count
				? {
						preParticipantCount: pre.count,
						avgPreTestScore: pre.average,
						postParticipantCount: post.count,
						avgPostTestScore: post.average,
						improvementParticipantCount: improvement.count,
						avgImprovement: improvement.average,
					}
				: null,
		students,
	};
}
