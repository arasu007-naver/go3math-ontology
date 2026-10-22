// 원본 MariaDB (읽기 전용). SELECT 외의 문장은 쓰지 않고, 세션도 READ ONLY 로 연다.
import mysql from "mysql2/promise";
import { cfg, requireEnv } from "./config.mjs";
import { gradeOf, stripHtml } from "./util.mjs";

const [dbName, conceptTableName] = cfg.conceptTable.includes(".") ? cfg.conceptTable.split(".") : [null, cfg.conceptTable];
export const sibling = (name) => (dbName ? `${dbName}.${name}` : name); // math_chapters 등은 같은 DB

export async function openMaria() {
  requireEnv("MARIADB_DSN");
  const c = await mysql.createConnection({ uri: process.env.MARIADB_DSN, dateStrings: true, supportBigNumbers: true, connectTimeout: 15000 });
  await c.query("SET SESSION TRANSACTION READ ONLY");
  await c.query("START TRANSACTION READ ONLY");
  return c;
}

export async function columnsOf(m, table) {
  const [rows] = await m.query(
    `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = COALESCE(?, DATABASE()) AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [dbName, table]
  );
  return rows;
}

// BIT(1) 은 Buffer 로 온다
const flag = (v) => (Buffer.isBuffer(v) ? v[0] === 1 : Number(v) === 1);

// 원본 개념 전체 + 기존 단원 힌트. 스펙은 math_concepts.chapter_id 를 말하지만,
// api-v2 엔티티에는 그 컬럼이 없고 math_concept_chapters(N:M)로 연결되어 있어 둘 다 지원한다.
export async function loadConcepts(m) {
  const cols = (await columnsOf(m, conceptTableName)).map((c) => c.name);
  const [rows] = await m.query(`SELECT * FROM ${cfg.conceptTable} ORDER BY id`);

  const chapters = new Map(); // concept id → [{id, title, grade, curriculum_type}]
  const push = (cid, ch) => (chapters.get(cid) ?? chapters.set(cid, []).get(cid)).push(ch);
  const chapterSelect = `ch.id, ch.chapter_title AS title, ch.curriculum_grade AS grade, ch.curriculum_type`;
  // 실DB 는 chapter_id 컬럼이 있지만 전부 NULL 이고, 실제 연결은 math_concept_chapters 에 있다 → 둘 다 읽어 합친다
  if (cols.includes("chapter_id")) {
    const [chs] = await m.query(
      `SELECT c.id AS concept_id, ${chapterSelect} FROM ${cfg.conceptTable} c JOIN ${sibling("math_chapters")} ch ON ch.id = c.chapter_id`
    );
    for (const r of chs) push(r.concept_id, r);
  }
  if ((await columnsOf(m, "math_concept_chapters")).length) {
    const [chs] = await m.query(
      `SELECT cc.concept_id, ${chapterSelect} FROM ${sibling("math_concept_chapters")} cc
       JOIN ${sibling("math_chapters")} ch ON ch.id = cc.chapter_id ORDER BY cc.concept_id, cc.order_index`
    );
    for (const r of chs) if (!chapters.get(r.concept_id)?.some((ch) => ch.id === r.id)) push(r.concept_id, r);
  }

  return rows.map((r) => {
    // 실DB 의 일괄 등록 TERM 562개는 school_type 이 없고 curriculum_type·math_field 가 기본값(HIGHSCHOOL_3·ALGEBRA)이라
    // 학년·분야를 믿을 수 없다 → school_type 이 있는 행만 학년·분야를 후보 필터에 쓴다
    const metaReliable = !!r.school_type;
    return {
      id: Number(r.id),
      is_on: flag(r.is_on),
      meta_reliable: metaReliable,
      math_field: r.math_field ?? null,
      concept_type: r.concept_type ?? null,
      curriculum_type: r.curriculum_type ?? null,
      school_type: r.school_type ?? null,
      curriculum_year: r.curriculum_year == null ? null : String(r.curriculum_year),
      difficulty_level: r.difficulty_level ?? null,
      raw_title: r.raw_title ?? "",
      html_title: r.html_title ?? null,
      raw_statement: r.raw_statement ?? "",
      html_statement: r.html_statement ?? null,
      img_path: r.img_path ?? null,
      written_by: r.written_by ?? null,
      written_at: r.written_at ?? null,
      updated_at: r.updated_at ?? null,
      // 판정·임베딩·제목 비교용 텍스트 (HTML 태그만 걷어냄, 백틱 안 수식은 그대로). KG 에는 raw_* 원문을 기록한다
      title: stripHtml(r.raw_title),
      statement: stripHtml(r.raw_statement),
      grade: metaReliable ? gradeOf(r.curriculum_type) : null,
      chapters: (chapters.get(r.id) ?? []).map(({ concept_id, ...ch }) => ch),
    };
  });
}

export const conceptText = (c) => `${c.title}\n${c.statement}`.trim();
export const isImageOnly = (c) => !c.statement.replace(/\[이미지\]/g, "").trim() && (c.statement.includes("[이미지]") || !!c.img_path);
