// Knowledge Graph DB (PostgreSQL, 스키마 kg — web/db/schema.sql).
// 22개정 단원 = level 노드 중 category 대단원·소단원 + 수학 학습 쪽 고정 대단원 L3-STUDY-* (그 아래·교재 TOC 노드는 제외).
//   중등: L2-*-PRE > L3 대단원(grade 1~3) > L4 소단원
//   고등: L2-*-PRE > L3 과목 > L4 대단원 > L5 소단원
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { cfg, requireEnv, ROOT } from "./config.mjs";
import { readJson } from "./util.mjs";

// KG_PG_DSN 이 없으면 pg 가 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD 를 읽는다 (web/.env.local 과 같은 방식)
export async function openPg() {
  if (!process.env.KG_PG_DSN) requireEnv("PGHOST", "PGDATABASE", "PGUSER");
  const c = new pg.Client({ connectionString: process.env.KG_PG_DSN || undefined, connectionTimeoutMillis: 15000 });
  await c.connect();
  return c;
}

const subjectGrades = readJson(path.join(ROOT, "subject-grades.json"));
const subjectGrade = (name) => subjectGrades[String(name).replace(/\s/g, "")] ?? null;

// 단원별 성취기준. KG 노드 props.achievementStandards([{code, text}]) 를 먼저 쓰고,
// 없으면 ACHIEVEMENT_FILE ({ "<unit_id>": [{code, text}] }) 에서 읽는다.
function achievementsFor(id, props, fileMap) {
  return props.achievementStandards ?? fileMap[id] ?? [];
}

export async function loadUnits(pgc) {
  const { rows: nodes } = await pgc.query(
    `SELECT id, props, kg.level_study_subject(id) AS study FROM kg.nodes
     WHERE type = 'level' AND (props->>'level' = '1' OR props->>'category' IN ('과목', '대단원', '소단원'))`
  );
  const { rows: edges } = await pgc.query(
    `SELECT src, dst, type FROM kg.edges WHERE type IN ('HAS_CHILD', 'BELONGS_TO_AREA') AND src ~ '^L[1-9]-'`
  );
  const fileMap = cfg.achievementFile ? JSON.parse(fs.readFileSync(cfg.achievementFile, "utf8")) : {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map();
  const area = new Map();
  for (const e of edges) {
    if (e.type === "HAS_CHILD" && byId.has(e.dst) && byId.has(e.src) && !parent.has(e.dst)) parent.set(e.dst, e.src);
    if (e.type === "BELONGS_TO_AREA") (area.get(e.src) ?? area.set(e.src, []).get(e.src)).push(e.dst);
  }

  const units = [];
  for (const n of nodes) {
    const cat = n.props.category;
    // 수학 학습 쪽은 고정 대단원 L3-STUDY-* 넷만 후보로 쓴다(수학 외 항목용). 그 아래 교재 TOC 는 제외
    if ((n.study && !n.id.startsWith("L3-STUDY-")) || !(cat === "대단원" || cat === "소단원")) continue;
    const chain = []; // 자신 → 과목/중등 대단원
    for (let id = n.id; id && byId.get(id)?.props.category; id = parent.get(id)) chain.push(byId.get(id));
    const names = chain.map((x) => x.props.name).reverse();
    let grade = null;
    for (const x of chain) {
      if (x.props.grade != null) grade = 6 + Number(x.props.grade);
      else if (x.props.category === "과목") grade = subjectGrade(x.props.name);
      if (grade != null) break;
    }
    // 수학 학습 대단원은 영역 간선이 없어 L1-STUDY 로 표시한다
    const areas = chain.map((x) => area.get(x.id)).find((a) => a?.length) ?? (n.study ? ["L1-STUDY"] : []);
    units.push({
      id: n.id,
      name: n.props.name,
      category: cat,
      kind: n.props.kind ?? null,
      path: names.join(" > "),
      grade,
      areas,
      area_names: areas.map((a) => byId.get(a)?.props.name).filter(Boolean),
      achievements: achievementsFor(n.id, n.props, fileMap),
    });
  }
  return units.sort((a, b) => a.id.localeCompare(b.id));
}

export const unitText = (u) =>
  [`${u.area_names.join("·")} | ${u.path}`, ...u.achievements.map((a) => `[${a.code}] ${a.text}`)].join("\n");
