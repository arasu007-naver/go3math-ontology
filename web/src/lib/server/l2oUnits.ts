import { cosine } from "@/lib/l2o/dedupe";
import { pickCandidates, type Candidate, type Unit } from "@/lib/l2o/units";
import { embedTexts } from "./embedding";
import { pool } from "./l2oPool";

// KG 2022 단원 (level 노드): 중학교 대단원 L3-MID-* + 고등 과목별 대단원 L4-H*. STUDY·TOC 는 제외.
let unitsCache: Promise<Unit[]> | null = null;
let vecCache: Promise<Map<string, number[]>> | null = null;

async function loadUnits(): Promise<Unit[]> {
  const r = await pool.query(
    `SELECT n.id, n.props->>'name' AS name, n.props->>'grade' AS grade,
            p.props->>'name' AS parent_name,
            COALESCE(array_agg(a.dst ORDER BY a.dst) FILTER (WHERE a.dst IS NOT NULL), '{}') AS areas,
            COALESCE(string_agg(an.props->>'name', '·' ORDER BY a.dst), '') AS area_names
       FROM kg.nodes n
       LEFT JOIN kg.edges pe ON pe.dst = n.id AND pe.type = 'HAS_CHILD'
       LEFT JOIN kg.nodes p ON p.id = pe.src
       LEFT JOIN kg.edges a ON a.src = n.id AND a.type = 'BELONGS_TO_AREA'
       LEFT JOIN kg.nodes an ON an.id = a.dst
      WHERE n.type = 'level' AND n.props->>'category' = '대단원' AND (n.id LIKE 'L3-MID%' OR n.id LIKE 'L4-H%')
      GROUP BY n.id, n.props, p.props
      ORDER BY n.id`
  );
  return r.rows.map((x) => {
    const high = String(x.id).startsWith("L4-H");
    return {
      unitId: x.id,
      path: high ? `고등 > ${x.parent_name} > ${x.name}` : `중${x.grade ?? "?"} > ${x.area_names || "기타"} > ${x.name}`,
      school: high ? "HIGHSCHOOL" : "MIDDLESCHOOL",
      areas: x.areas,
    };
  });
}

const retryable = <T,>(load: () => Promise<T>, reset: () => void) =>
  load().catch((e) => {
    reset();
    throw e;
  });

export function listUnits(): Promise<Unit[]> {
  unitsCache ??= retryable(loadUnits, () => (unitsCache = null));
  return unitsCache;
}

// unitId → 경로 (화면 표시용)
export async function unitPaths(): Promise<Map<string, string>> {
  return new Map((await listUnits()).map((u) => [u.unitId, u.path]));
}

function unitVectors(): Promise<Map<string, number[]>> {
  vecCache ??= retryable(async () => {
    const units = await listUnits();
    const vectors = await embedTexts(units.map((u) => u.path));
    return new Map(units.map((u, i) => [u.unitId, vectors[i]]));
  }, () => (vecCache = null));
  return vecCache;
}

// 5.2 getCandidateUnits: 세 선택기가 같은 후보 목록을 받는다
export async function getCandidateUnits(concept: {
  title: string;
  statement: string;
  schoolType: string | null;
  mathField: string | null;
}): Promise<{ candidates: Candidate[]; fallback: boolean }> {
  const [all, vec] = await Promise.all([listUnits(), unitVectors()]);
  const [cv] = await embedTexts([`${concept.title}\n${concept.statement}`]);
  return pickCandidates(concept, all, (id) => cosine(cv, vec.get(id)!));
}
