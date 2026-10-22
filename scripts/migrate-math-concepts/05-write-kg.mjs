// 단계 6. KG 기록 (approved.jsonl 의 승인 건만)
//   DRY_RUN=true (기본): KG 테이블이 있으면 실제와 같은 쓰기를 트랜잭션 안에서 해 보고 ROLLBACK, 없으면 계획만 만든다.
//   DRY_RUN=false      : 배치 100건 단위 트랜잭션으로 기록. 대상 테이블은 ddl/001-concept-tables.sql (승인 후 적용) 이 만든다.
//   --ids 12,345       특정 항목만 (검수 후 재실행)
// 출력: out/kg_write_plan.jsonl (항목별 처리 결과), out/edge_conflicts.csv (기존 primary 와 달라 교체 승인이 필요한 건)
import { cfg, out } from "./lib/config.mjs";
import { openPg } from "./lib/kg.mjs";
import { parseArgs, readJsonl, splitList, writeCsv, writeJsonl } from "./lib/util.mjs";

const args = parseArgs();
const reps = new Map(readJsonl(out("concepts_merged.jsonl")).map((c) => [String(c.id), c]));
let approved = readJsonl(out("approved.jsonl"));
if (!approved.length) throw new Error("out/approved.jsonl 이 없거나 비었습니다. 04-review.mjs 를 먼저 실행하세요.");
if (args.ids) {
  const ids = new Set(splitList(args.ids));
  approved = approved.filter((a) => ids.has(a.item_id));
}

const pgc = await openPg();
const { rows: tableRows } = await pgc.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema = 'kg'
   AND table_name IN ('math_concepts', 'concept_unit_edges', 'concept_achievements', 'concept_prerequisites')`
);
const tablesReady = tableRows.length === 4;
if (!tablesReady) {
  if (!cfg.dryRun) throw new Error("KG 대상 테이블이 없습니다. ddl/001-concept-tables.sql 을 검토·승인한 뒤 적용하세요.");
  writeJsonl(out("kg_write_plan.jsonl"), approved.map((a) => ({ ...a, action: "planned (KG 테이블 없음 — DDL 미적용)" })));
  console.log(`DRY_RUN: KG 테이블이 아직 없어 계획만 만들었습니다 (${approved.length}건) → ${out("kg_write_plan.jsonl")}`);
  await pgc.end();
  process.exit(0);
}

async function upsertConcept(c) {
  const { rows } = await pgc.query(
    `INSERT INTO kg.math_concepts (source_id, merged_source_ids, title, statement, html_title, html_statement, concept_type, math_field,
       curriculum_type, school_type, curriculum_year, difficulty_level, img_path, merge_notes, written_by, written_at, source_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (source_id) DO UPDATE SET
       merged_source_ids = EXCLUDED.merged_source_ids, title = EXCLUDED.title, statement = EXCLUDED.statement,
       html_title = EXCLUDED.html_title, html_statement = EXCLUDED.html_statement, concept_type = EXCLUDED.concept_type,
       math_field = EXCLUDED.math_field, curriculum_type = EXCLUDED.curriculum_type, school_type = EXCLUDED.school_type,
       curriculum_year = EXCLUDED.curriculum_year, difficulty_level = EXCLUDED.difficulty_level, img_path = EXCLUDED.img_path,
       merge_notes = EXCLUDED.merge_notes, written_by = EXCLUDED.written_by, written_at = EXCLUDED.written_at,
       source_updated_at = EXCLUDED.source_updated_at, updated_at = now()
     RETURNING id`,
    [c.id, c.merged_source_ids, c.raw_title, c.raw_statement, c.html_title, c.html_statement, c.concept_type, c.math_field,
     c.curriculum_type, c.school_type, c.curriculum_year, c.difficulty_level, c.img_path, JSON.stringify(c.merge_notes),
     c.written_by, c.written_at, c.updated_at]
  );
  return rows[0].id;
}

const insertEdge = async (conceptId, unitId, isPrimary, a) =>
  (await pgc.query(
    `INSERT INTO kg.concept_unit_edges (concept_id, unit_id, is_primary, confidence, judged_by, rationale)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [conceptId, unitId, isPrimary, a.confidence, a.judged_by, a.rationale]
  )).rows[0].id;

const touchEdge = (id, a) =>
  pgc.query(`UPDATE kg.concept_unit_edges SET confidence = $2, judged_by = $3, rationale = $4, updated_at = now() WHERE id = $1`,
    [id, a.confidence, a.judged_by, a.rationale]);

// 개념 1건: 노드 upsert + 단원 엣지(이력 보존 교체) + 성취기준. 반환: 처리 결과 기록
async function writeItem(a) {
  const c = reps.get(a.item_id);
  if (!c) return { item_id: a.item_id, action: "error", error: "concepts_merged.jsonl 에 없는 항목" };
  const conceptId = await upsertConcept(c);
  const log = { item_id: a.item_id, concept_id: conceptId, primary: a.primary_unit_id, actions: [] };

  if (a.primary_unit_id) {
    const { rows: active } = await pgc.query(`SELECT id, unit_id, is_primary FROM kg.concept_unit_edges WHERE concept_id = $1 AND is_active`, [conceptId]);
    const cur = active.find((e) => e.is_primary);
    if (cur?.unit_id === a.primary_unit_id) {
      await touchEdge(cur.id, a);
      log.actions.push("primary 갱신");
    } else if (cur && !a.replace_existing) {
      log.conflict = { existing_unit_id: cur.unit_id, new_unit_id: a.primary_unit_id };
      log.actions.push("primary 충돌 — 교체 승인 필요(replace_existing=Y), 단원 엣지 건너뜀");
      return log;
    } else {
      // 기존 primary, 그리고 새 primary 단원으로 걸려 있던 보조 엣지를 비활성화하고 새 primary 로 대체
      const retire = active.filter((e) => e === cur || (!e.is_primary && e.unit_id === a.primary_unit_id)).map((e) => e.id);
      if (retire.length) await pgc.query(`UPDATE kg.concept_unit_edges SET is_active = false, superseded_at = now(), updated_at = now() WHERE id = ANY($1)`, [retire]);
      const newId = await insertEdge(conceptId, a.primary_unit_id, true, a);
      if (retire.length) await pgc.query(`UPDATE kg.concept_unit_edges SET superseded_by = $2 WHERE id = ANY($1)`, [retire, newId]);
      log.actions.push(cur ? `primary 교체 (${cur.unit_id} → ${a.primary_unit_id})` : "primary 생성");
    }
    for (const unitId of a.secondary_unit_ids) {
      const { rows } = await pgc.query(`SELECT id, is_primary FROM kg.concept_unit_edges WHERE concept_id = $1 AND unit_id = $2 AND is_active`, [conceptId, unitId]);
      if (rows[0] && !rows[0].is_primary) await touchEdge(rows[0].id, a);
      else if (!rows[0]) await insertEdge(conceptId, unitId, false, a);
    }
    if (a.secondary_unit_ids.length) log.actions.push(`보조 단원 ${a.secondary_unit_ids.length}`);
  } else {
    log.actions.push("단원 없음(NONE) — 개념 노드만");
  }

  for (const code of a.achievement_codes) {
    await pgc.query(`INSERT INTO kg.concept_achievements (concept_id, achievement_code, judged_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [conceptId, code, a.judged_by]);
  }
  return log;
}

const logs = [];
try {
  const batches = [];
  for (let i = 0; i < approved.length; i += 100) batches.push(approved.slice(i, i + 100));
  // DRY_RUN 은 전체를 한 트랜잭션에서 해 보고 되돌린다
  if (cfg.dryRun) await pgc.query("BEGIN");
  for (const batch of batches) {
    if (!cfg.dryRun) await pgc.query("BEGIN");
    try {
      for (const a of batch) logs.push(await writeItem(a));
      if (!cfg.dryRun) await pgc.query("COMMIT");
    } catch (e) {
      await pgc.query("ROLLBACK");
      throw e;
    }
    console.log(`  ${logs.length}/${approved.length}`);
  }

  // 선수 개념: 양쪽 개념 노드가 모두 있어야 하므로 마지막에 한 번에
  if (!cfg.dryRun) await pgc.query("BEGIN");
  let prereqs = 0;
  for (const a of approved) {
    for (const src of a.prerequisite_ids) {
      const r = await pgc.query(
        `INSERT INTO kg.concept_prerequisites (src_concept_id, dst_concept_id, judged_by)
         SELECT s.id, d.id, $3 FROM kg.math_concepts s, kg.math_concepts d WHERE s.source_id = $1 AND d.source_id = $2
         ON CONFLICT DO NOTHING`,
        [Number(src), Number(a.item_id), a.judged_by]
      );
      prereqs += r.rowCount;
    }
  }
  console.log(`선수 개념 엣지 새로 ${prereqs}개 (선수 개념이 아직 KG 에 없으면 건너뜀)`);

  // 누락·중복 검사 (스펙 8장)
  const expected = new Map(); // 원본 is_on=1 id → 대표 id
  for (const c of reps.values()) for (const id of [c.id, ...c.merged_source_ids]) expected.set(id, c.id);
  const { rows: nodes } = await pgc.query(`SELECT source_id, merged_source_ids FROM kg.math_concepts`);
  const present = new Map();
  for (const n of nodes) for (const id of [n.source_id, ...n.merged_source_ids]) present.set(id, (present.get(id) ?? 0) + 1);
  const missing = [...expected.keys()].filter((id) => !present.has(id));
  const dup = [...present].filter(([, n]) => n > 1).map(([id]) => id);
  console.log(`검사: 원본 is_on=1 ${expected.size}개 중 KG 에 없는 id ${missing.length}개, 두 번 이상 나타나는 id ${dup.length}개`);
  if (dup.length) console.log(`  중복 id: ${dup.slice(0, 30).join(" ")}`);

  if (cfg.dryRun) await pgc.query("ROLLBACK");
  else await pgc.query("COMMIT");
} finally {
  await pgc.end();
}

writeJsonl(out("kg_write_plan.jsonl"), logs);
const conflicts = logs.filter((l) => l.conflict);
writeCsv(out("edge_conflicts.csv"), ["item_id", "existing_unit_id", "new_unit_id"], conflicts.map((l) => ({ item_id: l.item_id, ...l.conflict })));
console.log(
  `${cfg.dryRun ? "DRY_RUN (ROLLBACK, KG 변경 없음)" : "기록 완료"}: ${logs.length}건, primary 충돌 ${conflicts.length}건\n` +
    `→ ${out("kg_write_plan.jsonl")}, edge_conflicts.csv`
);
