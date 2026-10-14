import assert from "node:assert/strict";
import { test, after } from "node:test";
import { startTestDb } from "../../test/pgTestDb.js";
const db = await startTestDb();
const { pool } = await import("../../infrastructure/db/pool.js");
const { getFairRanking, assignFairRanks } = await import("./fairRanking.js");
after(async () => {
	await pool.end();
	await db.stop();
});

test("same score shares rank; no assessment stays unranked regardless of identity", () => {
	const rows = assignFairRanks([
		{ id: 9, compositeScore: 0, questionsGraded: 0 },
		{ id: 4, compositeScore: 1, questionsGraded: 1 },
		{ id: 2, compositeScore: 1, questionsGraded: 2 },
		{ id: 3, compositeScore: 0, questionsGraded: 1 },
	]);
	assert.deepEqual(
		rows.map((r) => [r.id, r.rank]),
		[
			[2, 1],
			[4, 1],
			[3, 3],
			[9, null],
		],
	);
});

test("phase2 rank excludes repeat farming, unfinished and invalidated answers, and chat volume", async () => {
	await pool.query(`INSERT INTO users(id,role,name,email,password_hash,student_id) VALUES
    (1,'student','first','one@test','hash','2201117'),(2,'student','second','two@test','hash','other');
    INSERT INTO exam_questions(id,source,subject,stem,correct_index,explanation,status,max_score) VALUES
    (1,'past_exam','IP','q',0,'e','approved',1),(2,'past_exam','IP','q2',0,'e','approved',4);
    INSERT INTO exam_attempts(id,user_id,question_ids,status,started_at) VALUES
    (1,1,ARRAY[1],'submitted','2026-01-01'),(2,1,ARRAY[1],'submitted','2026-01-02'),
    (3,2,ARRAY[1,2],'submitted','2026-01-01'),(4,1,ARRAY[2],'invalidated','2026-01-03'),
    (5,1,ARRAY[2],'in_progress','2026-01-04');
    INSERT INTO exam_answers(attempt_id,question_id,is_correct,score) VALUES
    (1,1,false,0),(2,1,true,1),(3,1,true,1),(3,2,false,2),(4,2,true,4),(5,2,true,4);
    INSERT INTO audit_log(user_id,question,intent,final_answer,verification_status)
    SELECT 1,'chat','retrieve','answer','verified' FROM generate_series(1,100);`);
	const ranking = await getFairRanking();
	assert.deepEqual(
		ranking.students.map((s) => [
			s.id,
			s.rank,
			s.compositeScore,
			s.questionsGraded,
		]),
		[
			[2, 1, 1.5, 2],
			[1, 2, 0, 1],
		],
	);
	assert.equal(ranking.students[1].chatCount, 100);
});
