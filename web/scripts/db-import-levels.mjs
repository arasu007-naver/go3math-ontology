// 중등 대단원·고등 과목과 그 대단원을 kg 에 넣는다 (level-spec.md).
//   units    (중등 대단원, L3 category 대단원): area 의 PREREQUISITE(L2) 아래 HAS_CHILD, area 로 BELONGS_TO_AREA
//   subjects (고등 과목,  L3 category 과목):   areas 의 PREREQUISITE(L2) 아래 HAS_CHILD(여러 개), areas 로 BELONGS_TO_AREA
//     subjects[].units (고등 대단원, L4 category 대단원): 과목 아래 HAS_CHILD, area 로 BELONGS_TO_AREA
// 여러 번 실행해도 안전하다: 파일에 있는 노드는 내용을 갱신하고, 그 노드의 상위·영역 간선은 파일대로 다시 만든다.
// 한 트랜잭션이라 DB 트리거(상위 노드 규칙)가 커밋 때 전체를 검사한다.
// 사용: node scripts/db-import-levels.mjs db/level-middle.json   (npm run db:import-middle / db:import-high)
import fs from "node:fs";
import pg from "pg";

const PRE = { "L1-NUM": "L2-NUM-PRE", "L1-EXPR": "L2-EXPR-PRE", "L1-EQ": "L2-EQ-PRE", "L1-FUNC": "L2-FUNC-PRE", "L1-PROB": "L2-PROB-PRE", "L1-GEO": "L2-GEO-PRE" };
const file = process.argv[2];
if (!file) throw new Error("데이터 파일 경로가 필요합니다 (예: db/level-middle.json)");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const area = (a, what) => {
  if (!PRE[a]) throw new Error(`알 수 없는 영역 ${a} (${what})`);
  return a;
};

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

  // 중등 대단원
  for (const u of data.units ?? []) {
    if (![1, 2, 3].includes(u.grade)) throw new Error(`grade(학년 1~3)가 필요합니다 (${u.name})`);
    const a = area(u.area, u.name);
    await upsert(u.id, { level: 3, name: u.name, order: u.order, category: "대단원", grade: u.grade });
    await resetUp(u.id);
    await edge(PRE[a], u.id, "HAS_CHILD");
    await edge(u.id, a, "BELONGS_TO_AREA");
  }

  // 고등 과목과 그 대단원
  let units = 0;
  for (const s of data.subjects ?? []) {
    const subUnits = s.units ?? [];
    const areas = [...new Set(s.areas ?? subUnits.map((u) => u.area))].map((a) => area(a, s.name));
    if (!areas.length) throw new Error(`영역이 없습니다 (${s.name})`);
    if (s.school !== "high") throw new Error(`과목은 고등(school=high)만 넣습니다 (${s.name})`);
    if (!Number.isInteger(s.educationalStep)) throw new Error(`educationalStep(교육과정 연도)이 필요합니다 (${s.name})`);
    if (!Number.isInteger(s.revisedCurriculum)) throw new Error(`revisedCurriculum(개정 교육 과정)이 필요합니다 (${s.name})`);

    await upsert(s.id, {
      level: 3, name: s.name, order: s.order, category: "과목", school: s.school, curriculum: s.curriculum, educationalStep: s.educationalStep,
      revisedCurriculum: s.revisedCurriculum,
    });
    await resetUp(s.id);
    for (const a of areas) {
      await edge(PRE[a], s.id, "HAS_CHILD");
      await edge(s.id, a, "BELONGS_TO_AREA");
    }
    for (const u of subUnits) {
      await upsert(u.id, { level: 4, name: u.name, order: u.order, category: "대단원" });
      await resetUp(u.id);
      await edge(s.id, u.id, "HAS_CHILD");
      await edge(u.id, area(u.area, u.name), "BELONGS_TO_AREA");
      units++;
    }
  }
  await client.query("COMMIT");
  console.log(`${file}: 중등 대단원 ${data.units?.length ?? 0}개, 고등 과목 ${data.subjects?.length ?? 0}개, 고등 대단원 ${units}개를 반영했습니다.`);
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("실패:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
