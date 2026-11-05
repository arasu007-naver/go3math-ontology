import type { PoolClient } from "pg";
import { getRawConceptsByIds } from "./legacyDb";
import { pool } from "./l2oPool";

// 그룹 1개 → KG 기록 (specs/math_concepts2ontology.md 4.6·5.5). 한 트랜잭션에서:
// 1) kg.math_concepts: source_id = 대표 legacy id, merged_source_ids = 나머지 멤버. 이미 기록된 그룹이면 같은 노드를 갱신.
// 2) kg.concept_unit_edges: 같은 단원이 이미 활성이면 그대로, 단원이 바뀌면 옛 엣지를 비활성화(삭제하지 않음)하고 새 주 엣지 추가.
// 3) l2o.migration_result: migrated + kg_concept_id 연결.
// 원본 MariaDB 는 읽기만 한다.

export type KgWrite = { groupId: number; unitId: string; judgedBy: string; confidence: number | null; rationale: string; jobId: string | null };
export type KgWriteResult = { conceptId: number; created: boolean; edge: "kept" | "added" | "replaced"; retiredEdges: number };

export async function writeGroupToKg(w: KgWrite): Promise<KgWriteResult> {
  const g = await pool.query(
    `SELECT g.representative_legacy_id AS rep, r.kg_concept_id,
            ARRAY(SELECT m.legacy_concept_id FROM l2o.dedupe_member m WHERE m.group_id = g.id ORDER BY m.legacy_concept_id) AS members
       FROM l2o.dedupe_group g LEFT JOIN l2o.migration_result r ON r.group_id = g.id WHERE g.id = $1`,
    [w.groupId]
  );
  if (!g.rows[0]) throw new Error(`없는 그룹입니다: ${w.groupId}`);
  const rep = Number(g.rows[0].rep);
  const members: number[] = g.rows[0].members.map(Number);
  const others = members.filter((id) => id !== rep);
  const raws = await getRawConceptsByIds(members); // 트랜잭션 밖에서 원본을 읽어 둔다
  const c = raws.find((r) => r.id === rep);
  if (!c) throw new Error(`원본 개념 #${rep} 를 찾을 수 없습니다.`);
  const notes = raws.filter((r) => r.id !== rep).map((r) => ({ source_id: r.id, title: r.rawTitle, merged_by: "legacy2ontology", group_id: w.groupId }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // 노드 찾기: 이 그룹이 전에 쓴 노드 → 멤버 중 하나가 source_id 인 노드(대표 우선)
    // → 예전에 흡수된(source_id 음수) 노드: 묶었다가 다시 분리한 경우 그 노드를 되살린다
    let conceptId: number | null = g.rows[0].kg_concept_id == null ? null : Number(g.rows[0].kg_concept_id);
    if (conceptId != null) {
      const ok = await client.query(`SELECT 1 FROM kg.math_concepts WHERE id = $1`, [conceptId]);
      if (!ok.rows[0]) conceptId = null;
    }
    if (conceptId == null) {
      const f = await client.query(
        `SELECT id FROM kg.math_concepts WHERE source_id = ANY($1::int[]) OR -source_id = ANY($1::int[])
          ORDER BY (abs(source_id) = $2) DESC, (source_id > 0) DESC, id LIMIT 1`,
        [members, rep]
      );
      conceptId = f.rows[0] ? Number(f.rows[0].id) : null;
    }
    // 대표가 바뀌어 다른 노드가 이 대표를 source_id 로 쓰고 있으면, 그 노드를 흡수(엣지 비활성 + 메모) 후 source_id 를 비운다
    const absorbed = await absorbOthers(client, conceptId, members, w.jobId);

    const values = [
      rep, others, c.rawTitle, c.rawStatement, c.htmlTitle, c.htmlStatement, c.conceptType, c.mathField, c.curriculumType,
      c.schoolType, c.curriculumYear, c.difficultyLevel, c.imgPath, JSON.stringify(notes), c.writtenBy, c.writtenAt, c.updatedAt,
    ];
    let created = false;
    if (conceptId == null) {
      const ins = await client.query(
        `INSERT INTO kg.math_concepts (source_id, merged_source_ids, title, statement, html_title, html_statement, concept_type, math_field,
           curriculum_type, school_type, curriculum_year, difficulty_level, img_path, merge_notes, written_by, written_at, source_updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
        values
      );
      conceptId = Number(ins.rows[0].id);
      created = true;
    } else {
      await client.query(
        `UPDATE kg.math_concepts SET source_id = $1, merged_source_ids = $2, title = $3, statement = $4, html_title = $5, html_statement = $6,
           concept_type = $7, math_field = $8, curriculum_type = $9, school_type = $10, curriculum_year = $11, difficulty_level = $12,
           img_path = $13, merge_notes = $14, written_by = $15, written_at = $16, source_updated_at = $17, updated_at = now()
         WHERE id = $18`,
        [...values, conceptId]
      );
    }
    // 이 그룹 멤버를 다른 노드의 merged_source_ids 에서 뺀다(분리·재묶음 후 한 개념은 한 노드에만)
    await client.query(
      `UPDATE kg.math_concepts SET merged_source_ids = ARRAY(SELECT x FROM unnest(merged_source_ids) x WHERE NOT (x = ANY($1::int[]))), updated_at = now()
        WHERE id <> $2 AND merged_source_ids && $1::int[]`,
      [members, conceptId]
    );

    const edge = await setPrimaryUnit(client, conceptId, w);
    await client.query(
      `INSERT INTO l2o.migration_result (group_id, status, final_unit_id, kg_concept_id, dry_run_only, last_job_run_id, updated_at)
       VALUES ($1, 'migrated', $2, $3, false, $4, now())
       ON CONFLICT (group_id) DO UPDATE SET status = 'migrated', final_unit_id = EXCLUDED.final_unit_id, kg_concept_id = EXCLUDED.kg_concept_id,
         dry_run_only = false, last_job_run_id = EXCLUDED.last_job_run_id, updated_at = now()`,
      [w.groupId, w.unitId, conceptId, w.jobId]
    );
    await client.query("COMMIT");
    return { conceptId, created, edge: edge.kind, retiredEdges: edge.retired + absorbed };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// 멤버를 source_id 로 가진 다른 노드(묶기 전에 따로 이전된 개념): 활성 엣지를 비활성화하고 merge_notes 에 흡수 기록.
// source_id 는 UNIQUE 라 그대로 두면 이 그룹 노드가 그 id 를 쓸 수 없으므로, 흡수된 노드는 음수 source_id 로 비켜 둔다.
async function absorbOthers(client: PoolClient, conceptId: number | null, members: number[], jobId: string | null): Promise<number> {
  const o = await client.query(`SELECT id, source_id FROM kg.math_concepts WHERE source_id = ANY($1::int[]) AND id <> COALESCE($2, -1)`, [
    members,
    conceptId,
  ]);
  let retired = 0;
  for (const row of o.rows) {
    const r = await client.query(
      `UPDATE kg.concept_unit_edges SET is_active = false, superseded_at = now(), deactivated_by_job = $2, updated_at = now()
        WHERE concept_id = $1 AND is_active`,
      [row.id, jobId]
    );
    retired += r.rowCount ?? 0;
    await client.query(
      `UPDATE kg.math_concepts SET source_id = -source_id,
              merge_notes = merge_notes || jsonb_build_array(jsonb_build_object('absorbed_into_group_of', $2::int, 'at', now(), 'by', 'legacy2ontology')),
              updated_at = now()
        WHERE id = $1`,
      [row.id, Number(row.source_id)]
    );
  }
  return retired;
}

async function setPrimaryUnit(client: PoolClient, conceptId: number, w: KgWrite): Promise<{ kind: KgWriteResult["edge"]; retired: number }> {
  const active = await client.query(`SELECT id, unit_id, is_primary FROM kg.concept_unit_edges WHERE concept_id = $1 AND is_active`, [conceptId]);
  const same = active.rows.find((r) => r.unit_id === w.unitId);
  const retire = active.rows.filter((r) => r.unit_id !== w.unitId && r.is_primary).map((r) => Number(r.id));
  if (retire.length)
    await client.query(
      `UPDATE kg.concept_unit_edges SET is_active = false, superseded_at = now(), deactivated_by_job = $2, updated_at = now() WHERE id = ANY($1::bigint[])`,
      [retire, w.jobId]
    );
  if (same) {
    // 같은 단원 엣지가 이미 활성: 근거만 갱신(중복 엣지 없음)
    await client.query(
      `UPDATE kg.concept_unit_edges SET is_primary = true, confidence = $2, judged_by = $3, rationale = $4, source = 'legacy2ontology', updated_at = now()
        WHERE id = $1`,
      [same.id, w.confidence, w.judgedBy, w.rationale]
    );
    if (retire.length) await client.query(`UPDATE kg.concept_unit_edges SET superseded_by = $2 WHERE id = ANY($1::bigint[])`, [retire, same.id]);
    return { kind: same.is_primary && !retire.length ? "kept" : "replaced", retired: retire.length };
  }
  const ins = await client.query(
    `INSERT INTO kg.concept_unit_edges (concept_id, unit_id, is_primary, confidence, judged_by, rationale, source)
     VALUES ($1, $2, true, $3, $4, $5, 'legacy2ontology') RETURNING id`,
    [conceptId, w.unitId, w.confidence, w.judgedBy, w.rationale]
  );
  if (retire.length) await client.query(`UPDATE kg.concept_unit_edges SET superseded_by = $2 WHERE id = ANY($1::bigint[])`, [retire, ins.rows[0].id]);
  return { kind: retire.length ? "replaced" : "added", retired: retire.length };
}
