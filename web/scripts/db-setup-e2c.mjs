// e2c 스키마 DDL(db/e2c-schema.sql) 적용. 여러 번 실행해도 안전.
// 사용: npm run db:e2c   (.env.local 의 DATABASE_URL 또는 PG* 사용)
import fs from "node:fs";
import pg from "pg";

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(fs.readFileSync("db/e2c-schema.sql", "utf8"));
  await client.query("COMMIT");
  console.log("e2c 스키마 적용 완료.");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
