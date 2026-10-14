import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/infrastructure/db", { recursive: true });
await cp("src/infrastructure/db/schema.sql", "dist/infrastructure/db/schema.sql");
await cp("src/public", "dist/public", { recursive: true });
