// kg 스키마 DDL(db/schema.sql) 적용 + 교육과정 초기값(db/curriculum-seed.json) 넣기. 여러 번 실행해도 안전(없는 것만 추가).
// 사용: npm run db:setup   (.env.local 의 DATABASE_URL 또는 PG* 사용)
import fs from "node:fs";
import pg from "pg";

const nfc = (s) => s.normalize("NFC");
const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(fs.readFileSync("db/schema.sql", "utf8"));
  const seed = JSON.parse(fs.readFileSync("db/curriculum-seed.json", "utf8"));
  const nodes = [
    ...seed.categories.map((name, i) => ({ id: `cat:${nfc(name)}`, type: "category", props: { name, order: i + 1 } })),
    ...seed.curriculum.map((c, i) => ({ id: `cur:${nfc(c.name)}`, type: "curriculum", props: { name: c.name, level: c.level, order: i + 1 } })),
  ];
  const edges = [
    ...seed.curriculum.flatMap((c) => c.categories.map((cat) => ({ src: `cat:${nfc(cat)}`, dst: `cur:${nfc(c.name)}`, type: "CATEGORY_HAS" }))),
    ...seed.prereqs.map(([a, b]) => ({ src: `cur:${nfc(a)}`, dst: `cur:${nfc(b)}`, type: "PREREQ_OF" })),
  ];
  const n = await client.query(
    `INSERT INTO kg.nodes (id, type, book, props)
     SELECT r.id, r.type, 'curriculum', r.props FROM jsonb_to_recordset($1::jsonb) AS r(id text, type text, props jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(nodes)]
  );
  const e = await client.query(
    `INSERT INTO kg.edges (src, dst, type)
     SELECT r.src, r.dst, r.type FROM jsonb_to_recordset($1::jsonb) AS r(src text, dst text, type text)
     ON CONFLICT DO NOTHING`,
    [JSON.stringify(edges)]
  );
  await client.query("COMMIT");
  console.log(`kg 스키마 적용 완료. 노드 ${n.rowCount}개, 간선 ${e.rowCount}개 추가.`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
