// 사전 조사 (스펙 3장 1~3). 읽기만 한다. 결과: out/survey_report.md, out/image_only_concepts.csv
// 4번(중복 탐지)은 01-merge.mjs --detect-only 로 따로 본다.
// 사용: node --env-file=.env 00-survey.mjs
import { cfg, out } from "./lib/config.mjs";
import { openMaria, loadConcepts, columnsOf, sibling, isImageOnly } from "./lib/source.mjs";
import { openPg, loadUnits } from "./lib/kg.mjs";
import { writeCsv, writeText, gradeLabel } from "./lib/util.mjs";

const md = [];
const table = (head, rows) => {
  md.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`);
  for (const r of rows) md.push(`| ${r.map((v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
  md.push("");
};
const countBy = (xs, f) => [...xs.reduce((m, x) => m.set(f(x) ?? "(없음)", (m.get(f(x) ?? "(없음)") ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]);

md.push(`# 사전 조사 보고서`, ``, `생성: ${new Date().toISOString()} · 원본 테이블: \`${cfg.conceptTable}\``, ``);

// ---------- 1. 원본 ----------
const m = await openMaria();
try {
  const concepts = await loadConcepts(m);
  const on = concepts.filter((c) => c.is_on);
  md.push(`## 1. 원본 집계`, ``);
  table(["항목", "값"], [
    ["전체 행", concepts.length],
    ["is_on=1 (이식 대상)", on.length],
    ["is_on=0 (제외)", concepts.length - on.length],
    ["기존 단원 힌트가 있는 개념(is_on=1)", on.filter((c) => c.chapters.length).length],
    ["학년·분야 신뢰 불가(school_type 없음 → 필터 미사용)", on.filter((c) => !c.meta_reliable).length],
    ["제목·본문에 HTML 태그 포함", on.filter((c) => c.title !== c.raw_title.trim() || c.statement !== c.raw_statement.trim()).length],
  ]);
  for (const [label, f] of [
    ["curriculum_year", (c) => c.curriculum_year],
    ["school_type", (c) => c.school_type],
    ["curriculum_type", (c) => c.curriculum_type],
    ["math_field", (c) => c.math_field],
    ["concept_type", (c) => c.concept_type],
  ]) {
    md.push(`### ${label} 분포 (is_on=1)`, ``);
    table([label, "개수"], countBy(on, f));
  }

  md.push(`### math_concepts 컬럼`, ``);
  const cols = await columnsOf(m, cfg.conceptTable.split(".").pop());
  table(["컬럼", "타입"], cols.map((c) => [c.name, c.type]));
  if (!cols.some((c) => c.name === "chapter_id")) {
    md.push(`> 스펙의 \`chapter_id\` 컬럼이 없습니다. 기존 단원 힌트는 \`math_concept_chapters\`(N:M)에서 읽습니다.`, ``);
  }

  md.push(`### math_chapters 구조`, ``);
  table(["컬럼", "타입"], (await columnsOf(m, "math_chapters")).map((c) => [c.name, c.type]));
  const [chapterDist] = await m.query(
    `SELECT curriculum_type, curriculum_grade, COUNT(*) AS n, SUM(is_on = 1) AS n_on FROM ${sibling("math_chapters")}
     GROUP BY curriculum_type, curriculum_grade ORDER BY curriculum_type, curriculum_grade`
  );
  table(["curriculum_type", "curriculum_grade", "단원 수", "is_on=1"], chapterDist.map((r) => [r.curriculum_type, r.curriculum_grade, r.n, r.n_on]));
  const [chapterSample] = await m.query(`SELECT id, subject_id, curriculum_type, curriculum_grade, chapter_title FROM ${sibling("math_chapters")} ORDER BY id LIMIT 15`);
  md.push(`표본 15개:`, ``);
  table(["id", "subject_id", "curriculum_type", "grade", "chapter_title"], chapterSample.map((r) => Object.values(r)));

  // ---------- 3. 수식 표기 ----------
  const has = (re) => on.filter((c) => re.test(c.raw_statement) || re.test(c.raw_title)).length;
  md.push(`## 3. 수식 표기 (is_on=1, raw_title·raw_statement)`, ``);
  table(["표기", "개수"], [
    ["백틱(`) AsciiMath 포함", has(/`[^`]+`/)],
    ["$ LaTeX 포함", has(/\$[^$]+\$/)],
    ["둘 다 포함", on.filter((c) => /`[^`]+`/.test(c.raw_statement) && /\$[^$]+\$/.test(c.raw_statement)).length],
  ]);
  const mixed = on.filter((c) => /\$[^$]+\$/.test(c.raw_statement)).slice(0, 5);
  if (mixed.length) {
    md.push(`$ 표기 표본:`, ``);
    table(["id", "raw_title", "raw_statement(앞 150자)"], mixed.map((c) => [c.id, c.raw_title, c.raw_statement.slice(0, 150)]));
  }
  md.push(`프롬프트에는 원문 그대로 넣습니다(변환하지 않음).`, ``);

  const imageOnly = on.filter(isImageOnly);
  md.push(`### 본문 없이 이미지만 있는 개념: ${imageOnly.length}개 → \`image_only_concepts.csv\` (OCR 범위 외, 제목만으로 판정)`, ``);
  writeCsv(out("image_only_concepts.csv"), ["id", "raw_title", "img_path", "curriculum_type"], imageOnly);
  const empty = on.filter((c) => !c.statement && !c.img_path);
  md.push(`### 본문·이미지 모두 없는 개념: ${empty.length}개`, ``);
} finally {
  await m.end();
}

// ---------- 2. KG ----------
const pgc = await openPg();
try {
  await pgc.query("BEGIN READ ONLY");
  md.push(`## 2. KG 스키마 (kg.nodes / kg.edges)`, ``);
  const { rows: nodeDist } = await pgc.query(
    `SELECT type, props->>'level' AS level, props->>'category' AS category, COUNT(*)::int AS n FROM kg.nodes
     WHERE type = 'level' GROUP BY 1, 2, 3 ORDER BY 2, 3`
  );
  table(["type", "level", "category", "개수"], nodeDist.map((r) => Object.values(r)));
  const units = await loadUnits(pgc);
  md.push(`매핑 후보 단원(수학 쪽 대단원·소단원): **${units.length}개**`, ``);
  table(["학년", "단원 수"], countBy(units, (u) => gradeLabel(u.grade)));
  table(["영역", "단원 수"], countBy(units, (u) => u.area_names.join("·") || "(없음)"));
  md.push(`표본:`, ``);
  table(["unit_id", "category", "path", "학년"], units.slice(0, 20).map((u) => [u.id, u.category, u.path, gradeLabel(u.grade)]));

  const withAch = units.filter((u) => u.achievements.length).length;
  const { rows: propKeys } = await pgc.query(
    `SELECT k, COUNT(*)::int AS n FROM kg.nodes, jsonb_object_keys(props) k WHERE type = 'level' GROUP BY k ORDER BY n DESC`
  );
  md.push(`### 성취기준`, ``, `성취기준을 가진 단원: ${withAch}/${units.length}`, ``);
  table(["level 노드 props 키", "개수"], propKeys.map((r) => [r.k, r.n]));

  const { rows: tables } = await pgc.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'kg' ORDER BY 1`
  );
  md.push(`### kg 스키마 테이블`, ``, tables.map((t) => `\`${t.table_name}\``).join(", "), ``);
  const { rows: ext } = await pgc.query(`SELECT extname FROM pg_extension ORDER BY 1`);
  md.push(`확장: ${ext.map((e) => e.extname).join(", ")} (pgvector 없으면 임베딩은 파일 캐시 사용)`, ``);
} finally {
  await pgc.query("ROLLBACK").catch(() => {});
  await pgc.end();
}

writeText(out("survey_report.md"), md.join("\n"));
console.log(`사전 조사 보고서: ${out("survey_report.md")}`);
