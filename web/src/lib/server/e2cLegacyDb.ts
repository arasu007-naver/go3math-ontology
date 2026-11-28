import mysql, { type RowDataPacket } from "mysql2/promise";
import { PROBLEM_COLS as C, PROBLEM_TABLE } from "@/lib/e2c/schema-names";
import type { RawProblem } from "@/lib/e2c/preprocess";
import { imagesOf } from "./legacyDb";

// 기출문제 원본 MariaDB (읽기 전용). SELECT 만 하고, 연결마다 세션을 READ ONLY 로 연다.
// 이 파일 밖으로는 아래의 조회 함수만 내보낸다(쓰기 경로 없음). 테이블·컬럼 이름은 e2c/schema-names.ts 의 상수다.
let pool: mysql.Pool | null = null;
function db() {
  if (pool) return pool;
  const uri = process.env.MARIADB_DSN;
  if (!uri) throw new Error("MARIADB_DSN 이 설정되지 않았습니다.");
  pool = mysql.createPool({ uri, connectionLimit: 4, dateStrings: true });
  pool.pool.on("connection", (conn) => conn.query("SET SESSION TRANSACTION READ ONLY"));
  return pool;
}

// 대상: 수학 문항 중 노출(is_on=1)된 것만
const TARGET = "subject_type = 'MATH' AND is_on = 1";

export type ProblemFilter = { subject?: string; year?: number };
export type ProblemRow = RawProblem & {
  curriculumType: string | null;
  difficulty: number | null;
  classification: string | null;
  originDate: string | null;
  answer: string | null;
  images: string[];
};

function where(f: ProblemFilter): { sql: string; args: unknown[] } {
  const parts = [TARGET];
  const args: unknown[] = [];
  if (f.subject) {
    parts.push(`${C.subject} = ?`);
    args.push(f.subject);
  }
  if (f.year) {
    parts.push(`${C.year} = ?`);
    args.push(f.year);
  }
  return { sql: parts.join(" AND "), args };
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function countProblems(f: ProblemFilter = {}): Promise<number> {
  const w = where(f);
  const [rows] = await db().query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${PROBLEM_TABLE} WHERE ${w.sql}`, w.args);
  return Number(rows[0].n);
}

// 처리 순서 계산용 (id, 과목, 연도, 난이도)
export async function listProblemIds(f: ProblemFilter = {}): Promise<{ id: number; subject: string | null; year: number | null; difficulty: number | null }[]> {
  const w = where(f);
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT ${C.id} AS id, ${C.subject} AS subject, ${C.year} AS year, ${C.difficulty} AS difficulty FROM ${PROBLEM_TABLE} WHERE ${w.sql} ORDER BY ${C.id} ASC`,
    w.args
  );
  return rows.map((r) => ({ id: Number(r.id), subject: r.subject ?? null, year: num(r.year), difficulty: num(r.difficulty) }));
}

export async function getProblems(ids: number[]): Promise<ProblemRow[]> {
  if (!ids.length) return [];
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT ${C.id} AS id, ${C.statement} AS statement, ${C.note} AS note, ${C.year} AS year, ${C.month} AS month, ${C.subscriber} AS subscriber,
            ${C.subject} AS subject, ${C.number} AS number, ${C.points} AS points, ${C.curriculumType} AS curriculum_type,
            ${C.difficulty} AS difficulty, ${C.classification} AS classification, ${C.originDate} AS origin_date, ${C.imgPath} AS img_path, ${C.answer} AS answer
       FROM ${PROBLEM_TABLE} WHERE ${TARGET} AND ${C.id} IN (?) ORDER BY ${C.id} ASC`,
    [ids]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    statement: r.statement ?? null,
    note: r.note ?? null,
    year: num(r.year),
    month: num(r.month),
    subscriber: r.subscriber ?? null,
    subject: r.subject ?? null,
    number: num(r.number),
    points: num(r.points),
    curriculumType: r.curriculum_type ?? null,
    difficulty: num(r.difficulty),
    classification: r.classification ?? null,
    originDate: r.origin_date ?? null,
    answer: r.answer == null ? null : String(r.answer),
    images: [...imagesOf(r.statement, r.img_path), ...imagesOf(r.note, r.img_path)],
  }));
}
