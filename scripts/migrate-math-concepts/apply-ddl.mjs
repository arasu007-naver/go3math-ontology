// ddl/001-concept-tables.sql 을 KG(PostgreSQL)에 적용한다. 한 트랜잭션이라 중간에 실패하면 아무것도 바뀌지 않는다.
// DDL 이 IF NOT EXISTS 라 여러 번 실행해도 안전하다.
// 사용: node --env-file-if-exists=.env apply-ddl.mjs [ddl 파일 경로]   (npm run ddl)
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/config.mjs";
import { openPg } from "./lib/kg.mjs";

const file = process.argv[2] ?? path.join(ROOT, "ddl", "001-concept-tables.sql");
const sql = fs.readFileSync(file, "utf8");

const pgc = await openPg();
try {
  await pgc.query("BEGIN");
  await pgc.query(sql);
  await pgc.query("COMMIT");
  const { rows } = await pgc.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'kg' AND table_name IN ('math_concepts', 'concept_unit_edges', 'concept_achievements', 'concept_prerequisites')
     ORDER BY 1`
  );
  console.log(`${path.basename(file)} 적용 완료. kg 테이블: ${rows.map((r) => r.table_name).join(", ")}`);
} catch (err) {
  await pgc.query("ROLLBACK").catch(() => {});
  console.error("실패 (ROLLBACK):", err.message);
  process.exitCode = 1;
} finally {
  await pgc.end();
}
