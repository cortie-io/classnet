import assert from "node:assert/strict";
import { test, after } from "node:test";
import { readFileSync } from "node:fs";
import http from "node:http";
import { startTestDb } from "../../test/pgTestDb.js";
const db = await startTestDb();
const archive = await startTestDb({ setEnv: false });
process.env.ACTIVE_SERVICE_PERIOD = "2";
process.env.PHASE1_DATABASE_URL = archive.url;
const { createApp } = await import("../../app.js");
const { activePool, archivePool } = await import(
	"../../infrastructure/db/pool.js"
);
await db.db.exec(`INSERT INTO users(id,role,name,email,password_hash,student_id,class_code,level,manual_pre_test_score) VALUES(1,'admin','Teacher','a@test','adminhash',NULL,NULL,'advanced',NULL),(2,'student','Student','s@test','samehash','S001','1-B','advanced',30);
INSERT INTO audit_log(user_id,question,intent,verification_status,final_answer) VALUES(2,'Beta','explain','verified','Beta answer');
INSERT INTO exam_questions(id,subject,stem,status) VALUES(1,'network','Question','approved');
INSERT INTO exam_sets(id,kind,title,question_ids) VALUES(1,'admin_timed','Official exam','{1}'),(2,'mock','Beta mock','{1}');
INSERT INTO exam_attempts(user_id,exam_set_id,question_ids,score,status) VALUES(2,2,'{1}',1,'submitted');`);
await db.db.exec(
	`INSERT INTO learn_progress(user_id,lesson_slug,first_read_at,completed_at) VALUES(2,'beta-lesson',now(),now()); INSERT INTO exam_sets(id,kind,title,question_ids,results_released,rank_released) VALUES(3,'official','Prepared official exam','{1}',true,true);`,
);
await archive.db.exec(
	`INSERT INTO users(id,role,name,email,password_hash) VALUES(1,'admin','Archive teacher','archive@test','oldhash');INSERT INTO audit_log(question,intent,verification_status,final_answer) VALUES('Original phase1','explain','verified','Original answer');`,
);
const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
function call(path: string, method = "GET", user = 1, confirmation?: string) {
	return new Promise<{ status: number; data: any }>((resolve, reject) => {
		const req = http.request(
			`http://127.0.0.1:${(server.address() as any).port}${path}${path.includes("?") ? "&" : "?"}userId=${user}`,
			{
				method,
				headers: {
					"x-internal-secret": "test-internal-secret",
					"Content-Type": "application/json",
				},
			},
			(res) => {
				let text = "";
				res.on("data", (c) => (text += c));
				res.on("end", () =>
					resolve({ status: res.statusCode!, data: JSON.parse(text) }),
				);
			},
		);
		req.on("error", reject);
		req.end(
			method === "GET"
				? undefined
				: JSON.stringify({ confirmation, userId: user }),
		);
	});
}
after(async () => {
	await new Promise<void>((r) => server.close(() => r()));
	await activePool.end();
	await archivePool!.end();
	await db.stop();
	await archive.stop();
});
test("confirmed one-way official launch clears only beta learning and preserves archive/accounts/configuration", async () => {
	assert.equal((await call("/api/admin/service-launch")).data.stage, "beta");
	const endpoint = "/api/admin/service-launch/start";
	assert.equal((await call(endpoint, "POST", 2, "2차 정식 시작")).status, 403);
	assert.equal(
		(await call(endpoint + "?period=1", "POST", 1, "2차 정식 시작")).status,
		403,
	);
	assert.equal((await call(endpoint, "POST")).status, 400);
	const both = await Promise.all([
		call(endpoint, "POST", 1, "2차 정식 시작"),
		call(endpoint, "POST", 1, "2차 정식 시작"),
	]);
	assert.deepEqual(both.map((r) => r.status).sort(), [202, 409]);
	assert.equal(
		(await db.db.query<any>("SELECT count(*)::int AS n FROM audit_log")).rows[0]
			.n,
		1,
		"request alone never resets",
	);
	const {
		rows: [launch],
	} = await db.db.query<{ request_id: string }>(
		"SELECT request_id FROM service_launch",
	);
	await db.db.query<any>(
		"SELECT set_config('classnet.launch_request',$1,false)",
		[launch.request_id],
	);
	await db.db.query<any>(
		"SELECT set_config('classnet.launch_backup','verified-beta.dump',false)",
	);
	const reset = readFileSync(
		new URL("../../../scripts/operations/launch/reset.sql", import.meta.url),
		"utf8",
	);
	await db.db.exec(reset);
	assert.equal(
		(await call("/api/admin/service-launch")).data.stage,
		"official",
	);
	assert.equal((await call(endpoint, "POST", 1, "2차 정식 시작")).status, 409);
	for (const table of [
		"audit_log",
		"exam_attempts",
		"sessions",
		"learn_progress",
	])
		assert.equal(
			(await db.db.query<any>(`SELECT count(*)::int AS n FROM ${table}`))
				.rows[0].n,
			0,
		);
	const {
		rows: [s],
	} = await db.db.query<any>("SELECT * FROM users WHERE id=2");
	assert.equal(s.password_hash, "samehash");
	assert.equal(s.student_id, "S001");
	assert.equal(s.class_code, "1-B");
	assert.equal(s.name, "Student");
	assert.equal(s.level, "beginner");
	assert.equal(s.manual_pre_test_score, null);
	assert.equal(s.auth_version, 1);
	const official = (
		await db.db.query<any>(
			"SELECT results_released,rank_released FROM exam_sets WHERE id=3",
		)
	).rows[0];
	assert.equal(official.results_released, false);
	assert.equal(official.rank_released, false);
	assert.equal(
		(await db.db.query<any>("SELECT count(*)::int AS n FROM exam_questions"))
			.rows[0].n,
		1,
	);
	assert.deepEqual(
		(await db.db.query<any>("SELECT id FROM exam_sets ORDER BY id")).rows,
		[{ id: 1 }, { id: 3 }],
	);
	assert.equal(
		(await archive.db.query<any>("SELECT question FROM audit_log")).rows[0]
			.question,
		"Original phase1",
	);
	assert.equal(
		(await call("/api/admin/users?period=1")).data[0].name,
		"Archive teacher",
	);
	await db.db.exec(
		`INSERT INTO audit_log(question,intent,verification_status,final_answer) VALUES('Official','explain','verified','Answer')`,
	);
	await assert.rejects(db.db.exec(reset), /Stale or duplicate/);
	await db.db.exec("ROLLBACK");
	assert.equal(
		(await db.db.query<any>("SELECT question FROM audit_log")).rows[0].question,
		"Official",
	);
});
