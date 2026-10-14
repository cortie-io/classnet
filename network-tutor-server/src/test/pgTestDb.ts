import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// DB가 필요한 테스트용 임시 Postgres. 같은 프로세스 안에서 PGlite(WASM Postgres)를 메모리로 띄우고,
// pglite-socket으로 127.0.0.1의 임의 포트에 열어 앱 코드가 쓰는 그대로의 pg 드라이버(db/pool.ts)가
// 붙게 한다. 매 실행마다 빈 DB에 schema.sql을 적용하므로 테스트끼리, 그리고 실제 DB와 섞일 일이 없다.
//
// 반드시 db/pool.js를 import하는 모듈보다 먼저 불러야 한다 — pool은 import되는 순간 DATABASE_URL로
// 만들어진다. 그래서 테스트 파일은 이 함수를 top-level await로 부른 뒤 앱 모듈을 동적 import한다.
//   const testDb = await startTestDb();
//   const { answerQuestion } = await import("../features/tutor/pipeline/answerPipeline.js");

export interface TestDb {
	url: string;
	db: PGlite;
	/** 테스트 데이터만 지우고 스키마는 남긴다(파일 안의 테스트 사이 정리용). */
	reset(): Promise<void>;
	stop(): Promise<void>;
}

function refuseProductionUrl(url: string | undefined): void {
	if (url && url.includes("rds.amazonaws.com")) {
		throw new Error(
			"[pgTestDb] 운영 RDS 주소가 설정돼 있어 테스트 DB를 띄우지 않습니다.",
		);
	}
}

const schemaSql = () =>
	readFileSync(
		new URL("../infrastructure/db/schema.sql", import.meta.url),
		"utf8",
	);

export async function startTestDb(
	opts: { setEnv?: boolean } = {},
): Promise<TestDb> {
	refuseProductionUrl(process.env.DATABASE_URL);
	const db = await PGlite.create();
	await db.exec(schemaSql());

	// pg.Pool(max 20)이 동시에 여러 연결을 열 수 있게 연결 수 한도를 넉넉히 둔다. PGlite 자체는 한 번에
	// 쿼리 하나만 처리하고, 소켓 서버가 연결들 사이에서 순서를 정해 준다.
	const server = new PGLiteSocketServer({
		db,
		host: "127.0.0.1",
		port: 0,
		maxConnections: 32,
	});
	await server.start();
	const conn = server.getServerConn(); // "127.0.0.1:PORT"
	const url = `postgres://postgres@${conn}/postgres`;
	refuseProductionUrl(url);
	if (opts.setEnv !== false) process.env.DATABASE_URL = url;

	return {
		url,
		db,
		async reset() {
			const { rows } = await db.query<{ tablename: string }>(
				"SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
			);
			if (rows.length === 0) return;
			// 테스트용 메모리 DB 안에서만 도는 정리다(운영 DB에는 이 경로로 닿을 수 없다).
			await db.exec(
				`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
			);
		},
		async stop() {
			await server.stop();
			await db.close();
		},
	};
}
