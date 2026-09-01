import { readFileSync } from "node:fs";
import { pool } from "./pool.js";

async function main() {
  const sql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
  console.log("migration applied");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
