import { createApp } from "./app.js";
import { config } from "./config.js";
import { activePool, archivePool } from "./infrastructure/db/pool.js";
import { loadCorpus, getCorpus } from "./infrastructure/search/corpus.js";
import { bm25Index } from "./infrastructure/search/textIndex.js";

async function main() {
	await loadCorpus();
	bm25Index.build(getCorpus());
	const server = createApp().listen(config.port, () => {
		console.log(
			`network-tutor-server listening on http://localhost:${config.port}`,
		);
	});
	const stop = () => {
		const timeout = setTimeout(() => process.exit(1), 10_000);
		timeout.unref();
		server.close(async () => {
			await Promise.all([activePool.end(), archivePool?.end()]);
			clearTimeout(timeout);
			process.exit(0);
		});
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
process.on("unhandledRejection", (err) =>
	console.error("[unhandledRejection]", err),
);
