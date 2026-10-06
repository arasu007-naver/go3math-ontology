// Level 3 과목(과 선택적으로 Level 4 대단원)을 kg 에 넣는다 (level-spec.md).
//   중등(school=middle): 과목 → 영역들의 PREREQUISITE(L2) 아래 HAS_CHILD
//   고등(school=high):   과목 → 영역들의 Level 1 바로 아래 HAS_CHILD (PREREQUISITE 없음)
//   과목·대단원 → 영역 L1 BELONGS_TO_AREA, 과목 → 대단원 HAS_CHILD
//   과목의 영역 = subject.areas, 없으면 대단원 area 들
// 여러 번 실행해도 안전하다: 파일에 있는 노드는 내용을 갱신하고, 그 노드의 상위·영역 간선은 파일대로 다시 만든다.
// 한 트랜잭션이라 DB 트리거(상위 노드 규칙)가 커밋 때 전체를 검사한다.
// 사용: node scripts/db-import-levels.mjs db/level-middle.json   (npm run db:import-middle / db:import-high)
import fs from "node:fs";
import pg from "pg";

const PRE = { "L1-NUM": "L2-NUM-PRE", "L1-EXPR": "L2-EXPR-PRE", "L1-EQ": "L2-EQ-PRE", "L1-FUNC": "L2-FUNC-PRE", "L1-PROB": "L2-PROB-PRE", "L1-GEO": "L2-GEO-PRE" };
const file = process.argv[2];
if (!file) throw new Error("데이터 파일 경로가 필요합니다 (예: db/level-middle.json)");
const data = JSON.parse(fs.readFileSync(file, "utf8"));

const client = new pg.Client(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
await client.connect();
try {
  await client.query("BEGIN");
  const upsert = (id, props) =>
    client.query(
      `INSERT INTO kg.nodes (id, type, book, props) VALUES ($1, 'level', 'level', $2)
       ON CONFLICT (id) DO UPDATE SET props = EXCLUDED.props, updated_at = now()`,
      [id, JSON.stringify(props)]
    );
  const edge = (src, dst, type) => client.query(`INSERT INTO kg.edges (src, dst, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [src, dst, type]);
  // 파일이 정하는 간선만 지우고 다시 만든다 (PREREQUISITE_OF 등 다른 간선은 그대로)
  const resetUp = (id) => client.query(`DELETE FROM kg.edges WHERE (dst = $1 AND type = 'HAS_CHILD') OR (src = $1 AND type = 'BELONGS_TO_AREA')`, [id]);

  let units = 0;
  for (const s of data.subjects) {
    const subUnits = s.units ?? [];
    const areas = [...new Set(s.areas ?? subUnits.map((u) => u.area))];
    if (!areas.length) throw new Error(`영역이 없습니다 (${s.name})`);
    for (const a of [...areas, ...subUnits.map((u) => u.area)]) if (!PRE[a]) throw new Error(`알 수 없는 영역 ${a} (${s.name})`);
    if (!["middle", "high"].includes(s.school)) throw new Error(`school 은 middle/high 입니다 (${s.name})`);
    if (!Number.isInteger(s.educationalStep)) throw new Error(`educationalStep(교육과정 연도)이 필요합니다 (${s.name})`);

    await upsert(s.id, { level: 3, name: s.name, order: s.order, school: s.school, curriculum: s.curriculum, educationalStep: s.educationalStep });
    await resetUp(s.id);
    for (const a of areas) {
      await edge(s.school === "middle" ? PRE[a] : a, s.id, "HAS_CHILD");
      await edge(s.id, a, "BELONGS_TO_AREA");
    }
    for (const u of subUnits) {
      await upsert(u.id, { level: 4, name: u.name, order: u.order });
      await resetUp(u.id);
      await edge(s.id, u.id, "HAS_CHILD");
      await edge(u.id, u.area, "BELONGS_TO_AREA");
      units++;
    }
  }
  await client.query("COMMIT");
  console.log(`${file}: 과목 ${data.subjects.length}개, 대단원 ${units}개를 반영했습니다.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
