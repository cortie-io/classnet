import assert from "node:assert/strict";
import { after, test } from "node:test";
import http from "node:http";
import { startTestDb } from "../../test/pgTestDb.js";
const active = await startTestDb();
const archive = await startTestDb({ setEnv: false });
process.env.ACTIVE_SERVICE_PERIOD = "2";
process.env.PHASE1_DATABASE_URL = archive.url;
const { pool, archivePool } = await import("../../infrastructure/db/pool.js");
const { createApp } = await import("../../app.js");
for (const [db, label] of [
	[active, "active"],
	[archive, "archive"],
] as const) {
	await db.db.exec(
		`INSERT INTO users(id,role,name,email,password_hash) VALUES(1,'admin','${label}','${label}@test','hash'),(2,'student','${label} student','s${label}@test','hash')`,
	);
}
await archive.db.exec(`CREATE TABLE phase_archive_snapshot(key text primary key,payload jsonb NOT NULL);
INSERT INTO phase_archive_snapshot VALUES('ranking','{"students":[{"id":2,"rank":7,"compositeScore":31.9}],"methodology":"frozen"}');`);
const server = createApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;
function call(path: string, method = "GET", user = 1) {
	return new Promise<{ status: number; data: any }>((resolve, reject) => {
		const req = http.request(
			`http://127.0.0.1:${port}${path}${path.includes("?") ? "&" : "?"}userId=${user}`,
			{ method, headers: { "x-internal-secret": "test-internal-secret" } },
			(res) => {
				let body = "";
				res.on("data", (x) => (body += x));
				res.on("end", () =>
					resolve({ status: res.statusCode!, data: JSON.parse(body) }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}
after(async () => {
	await new Promise<void>((r) => server.close(() => r()));
	await pool.end();
	await archivePool!.end();
	await active.stop();
	await archive.stop();
});

test("concurrent period reads stay independent; authentication uses active DB", async () => {
	const results = await Promise.all(
		Array.from({ length: 12 }, (_, i) =>
			call("/api/admin/users?period=" + ((i % 2) + 1)),
		),
	);
	for (let i = 0; i < results.length; i++) {
		assert.equal(results[i].status, 200);
		assert.equal(
			results[i].data.find((u: any) => u.id === 1).name,
			i % 2 === 0 ? "archive" : "active",
		);
	}
	assert.equal((await call("/api/admin/users?period=1", "GET", 2)).status, 403);
	assert.equal((await call("/api/admin/users?period=3")).status, 400);
});

test("archive rejects all mutations and returns frozen ranking without recalculation", async () => {
	for (const method of ["POST", "PATCH", "DELETE", "PUT"])
		assert.equal(
			(await call("/api/admin/users/2?period=1", method)).status,
			403,
		);
	assert.equal(
		(await call("/api/admin/analytics/ranking?period=1")).data.students[0].rank,
		7,
	);
	assert.equal(
		(await call("/api/admin/analytics/ranking?period=2")).data.students[0].rank,
		null,
	);
	assert.equal(
		(
			await archive.db.query<{ count: number }>(
				"SELECT count(*)::int AS count FROM users",
			)
		).rows[0].count,
		2,
	);
});

test("deleting a phase2 account leaves phase1 identity, history and saved ranking accessible", async () => {
	assert.equal(
		(await call("/api/admin/users/2?period=2", "DELETE")).status,
		200,
	);
	assert.equal(
		(await call("/api/admin/users?period=2")).data.some((u: any) => u.id === 2),
		false,
	);
	assert.equal(
		(await call("/api/admin/users?period=1")).data.find((u: any) => u.id === 2)
			.name,
		"archive student",
	);
	assert.equal(
		(await call("/api/admin/analytics/ranking?period=1")).data.students[0].rank,
		7,
	);
});

test("only admin can read phase1 chat messages; old chat IDs never resolve in phase2", async () => {
	for (const database of [active, archive])
		await database.db.exec(`CREATE TABLE "Chat"(id uuid PRIMARY KEY,title text,"userId" integer,"createdAt" timestamp);
    CREATE TABLE "Message_v2"(id uuid PRIMARY KEY,"chatId" uuid,role text,parts json,attachments json,"createdAt" timestamp);`);
	await archive.db.exec(`INSERT INTO "Chat" VALUES('00000000-0000-0000-0000-000000000001','Original student conversation',2,'2026-01-01');
    INSERT INTO "Message_v2" SELECT md5(n::text)::uuid,'00000000-0000-0000-0000-000000000001','user','[{"type":"text","text":"original question"}]','[]','2026-01-01' FROM generate_series(1,55) n;`);
	assert.equal((await call("/api/admin/users/2/chats?period=1")).data.total, 1);
	assert.equal((await call("/api/admin/users/2/chats?period=2")).data.total, 0);
	const path = "/api/admin/chats/00000000-0000-0000-0000-000000000001/messages";
	assert.equal((await call(path + "?period=2")).status, 404);
	const first = await call(path + "?period=1&limit=50");
	const last = await call(path + "?period=1&limit=50&offset=50");
	assert.equal(first.data.items.length + last.data.items.length, 55);
	assert.equal(
		new Set([...first.data.items, ...last.data.items].map((m) => m.id)).size,
		55,
	);
	assert.equal((await call(path + "?period=1", "GET", 2)).status, 401);
});

test("frozen phase1 student detail works without phase2-only schema columns", async () => {
	await archive.db.exec(
		"ALTER TABLE exam_answers DROP COLUMN revealed_at; ALTER TABLE users DROP COLUMN auth_version; ALTER TABLE users DROP COLUMN class_code;",
	);
	const detail = await call("/api/admin/users/2?period=1");
	assert.equal(detail.status, 200);
	assert.equal(detail.data.user.name, "archive student");
	assert.equal(detail.data.user.class_code, null);
});
