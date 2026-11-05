import mysql, { type RowDataPacket } from "mysql2/promise";

// 원본 MariaDB mathdb.math_concepts (읽기 전용). SELECT 만 하고, 연결마다 세션을 READ ONLY 로 연다.
// 이 파일 밖으로는 아래의 조회 함수만 내보낸다(쓰기 경로 없음).
const IMG_BASE = "https://qoolla1storage1account.blob.core.windows.net/qoollastoragecontainer/math-files/images";

let pool: mysql.Pool | null = null;
function db() {
  if (pool) return pool;
  const uri = process.env.MARIADB_DSN;
  if (!uri) throw new Error("MARIADB_DSN 이 설정되지 않았습니다.");
  pool = mysql.createPool({ uri, connectionLimit: 4, dateStrings: true });
  pool.pool.on("connection", (conn) => conn.query("SET SESSION TRANSACTION READ ONLY"));
  return pool;
}

export type LegacyConcept = {
  id: number;
  title: string;
  statement: string;
  images: string[];
  schoolType: string | null;
  mathField: string | null;
  curriculumYear: string | null;
  hasHtmlStatement: boolean;
  isOn: boolean;
};

const ENTITIES: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", amp: "&", quot: '"', "#39": "'" };

// HTML 태그를 걷어낸 텍스트. 블록 경계는 줄바꿈, backtick 안 수식은 그대로 둔다.
export function stripHtml(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>|<\/(div|p|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|lt|gt|amp|quot|#39);/g, (_, e) => ENTITIES[e])
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// 본문의 <img hwp-img-id="X"> → {IMG_BASE}/{img_path}/X.jpg
function imagesOf(html: string | null, imgPath: string | null): string[] {
  if (!html || !imgPath) return [];
  const ids = [...html.matchAll(/hwp-img-id=\\?"([^"\\]+)/g)].map((m) => m[1]);
  return [...new Set(ids)].map((id) => `${IMG_BASE}/${imgPath}/${id}.jpg`);
}

const COLUMNS = "id, raw_title, raw_statement, html_statement, img_path, school_type, math_field, curriculum_year, is_on";

function toConcept(r: RowDataPacket): LegacyConcept {
  return {
    id: Number(r.id),
    title: stripHtml(r.raw_title),
    statement: stripHtml(r.raw_statement),
    images: imagesOf(r.raw_statement, r.img_path),
    schoolType: r.school_type ?? null,
    mathField: r.math_field ?? null,
    curriculumYear: r.curriculum_year ?? null,
    hasHtmlStatement: !!r.html_statement,
    isOn: Number(r.is_on) === 1,
  };
}

// id 오름차순 한 쪽 (좌우 정렬 기준)
export async function listConcepts(offset: number, limit: number): Promise<LegacyConcept[]> {
  const [rows] = await db().query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM math_concepts ORDER BY id ASC LIMIT ? OFFSET ?`, [limit, offset]);
  return rows.map(toConcept);
}

// 중복제거 대상: is_on=1 전체
export async function listActiveConcepts(): Promise<LegacyConcept[]> {
  const [rows] = await db().query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM math_concepts WHERE is_on = 1 ORDER BY id ASC`);
  return rows.map(toConcept);
}

export async function getConceptsByIds(ids: number[]): Promise<LegacyConcept[]> {
  if (ids.length === 0) return [];
  const [rows] = await db().query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM math_concepts WHERE id IN (?) ORDER BY id ASC`, [ids]);
  return rows.map(toConcept);
}

// id 오름차순 목록에서 이 id 의 위치(1부터) — 특정 행이 있는 페이지 계산용
export async function positionOf(id: number): Promise<number> {
  const [rows] = await db().query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM math_concepts WHERE id <= ?", [id]);
  return Number(rows[0].n);
}

export async function countConcepts(): Promise<{ total: number; excluded: number }> {
  const [rows] = await db().query<RowDataPacket[]>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(is_on <> 1), 0) AS excluded FROM math_concepts"
  );
  return { total: Number(rows[0].total), excluded: Number(rows[0].excluded) };
}

// KG 기록용 원문 컬럼 (scripts/migrate-math-concepts/05-write-kg.mjs 와 같은 필드). SELECT 만.
export type LegacyRaw = {
  id: number;
  rawTitle: string;
  rawStatement: string;
  htmlTitle: string | null;
  htmlStatement: string | null;
  conceptType: string | null;
  mathField: string | null;
  curriculumType: string | null;
  schoolType: string | null;
  curriculumYear: string | null;
  difficultyLevel: number | null;
  imgPath: string | null;
  writtenBy: string | null;
  writtenAt: string | null;
  updatedAt: string | null;
};

export async function getRawConceptsByIds(ids: number[]): Promise<LegacyRaw[]> {
  if (ids.length === 0) return [];
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT id, raw_title, raw_statement, html_title, html_statement, concept_type, math_field, curriculum_type, school_type,
            curriculum_year, difficulty_level, img_path, written_by, written_at, updated_at
       FROM math_concepts WHERE id IN (?) ORDER BY id ASC`,
    [ids]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    rawTitle: r.raw_title ?? "",
    rawStatement: r.raw_statement ?? "",
    htmlTitle: r.html_title ?? null,
    htmlStatement: r.html_statement ?? null,
    conceptType: r.concept_type ?? null,
    mathField: r.math_field ?? null,
    curriculumType: r.curriculum_type ?? null,
    schoolType: r.school_type ?? null,
    curriculumYear: r.curriculum_year == null ? null : String(r.curriculum_year),
    difficultyLevel: r.difficulty_level == null ? null : Number(r.difficulty_level),
    imgPath: r.img_path ?? null,
    writtenBy: r.written_by ?? null,
    writtenAt: r.written_at ?? null,
    updatedAt: r.updated_at ?? null,
  }));
}

// 제외(is_on=0) 개념 전부 — 검토 보기 '제외'
export async function listExcludedConcepts(): Promise<LegacyConcept[]> {
  const [rows] = await db().query<RowDataPacket[]>(`SELECT ${COLUMNS} FROM math_concepts WHERE is_on <> 1 ORDER BY id ASC`);
  return rows.map(toConcept);
}
