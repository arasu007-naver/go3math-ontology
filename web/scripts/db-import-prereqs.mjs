// 선수 관계(PREREQUISITE_OF)를 kg 에 넣는다 (level-spec.md). 데이터: {"edges": [{"src", "dst"}]} — src 가 dst 의 선수.
// 이미 있는 간선은 그대로 두고 없는 것만 더한다. 지우지는 않는다. 순환·단계 규칙은 DB 트리거가 검사하고, 하나라도 어긋나면 전체를 되돌린다.
// 사용: node scripts/db-import-prereqs.mjs db/level-prereq.json   (npm run db:import-prereq)
import fs from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) throw new Error("데이터 파일 경로가 필요합니다 (예: db/level-prereq.json)");
const { edges } = JSON.parse(fs.readFileSync(file, "utf8"));

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query("BEGIN");
  let added = 0;
  for (const e of edges) {
    const r = await client.query(`INSERT INTO kg.edges (src, dst, type) VALUES ($1, $2, 'PREREQUISITE_OF') ON CONFLICT DO NOTHING`, [e.src, e.dst]);
    added += r.rowCount;
  }
  await client.query("COMMIT");
  console.log(`${file}: 선수 관계 ${edges.length}개 중 ${added}개를 새로 넣었습니다.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
