import type { PoolClient } from "pg";
import { pool } from "./l2oPool";
import { countLegacyForBaseline } from "./legacyDb";
import { baselineDiff, computeDayNav, isDescriptiveQuiz } from "@/lib/l2o/workLogUtil";

// 작업 이력 kg.work_log: 기록 · 조회 · 서버 시작 시 기준선 시드. 로그 실패가 본 작업을 실패시키지 않게 한다.
export type WorkLogCategory = "concept" | "problem" | "book_index" | "dictionary" | "flashcard" | "quiz" | "descriptive_quiz" | "baseline";
export type WorkLogAction = "create" | "update" | "delete" | "migrate" | "baseline";
export type WorkLogEntry = {
  category: WorkLogCategory;
  action: WorkLogAction;
  summary: string;
  itemCount?: number;
  bookStem?: string | null;
  detail?: Record<string, unknown>;
  actor?: string | null;
};

const DDL = `
CREATE TABLE IF NOT EXISTS kg.work_log (
  id         BIGSERIAL PRIMARY KEY,
  category   TEXT NOT NULL CHECK (category IN ('concept','problem','book_index','dictionary','flashcard','quiz','descriptive_quiz','baseline')),
  action     TEXT NOT NULL CHECK (action IN ('create','update','delete','migrate','baseline')),
  summary    TEXT NOT NULL,
  item_count INT  NOT NULL DEFAULT 1,
  book_stem  TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_log_created ON kg.work_log (created_at DESC, id DESC);
`;

export async function ensureWorkLogTable(client?: PoolClient): Promise<void> {
  await (client ?? pool).query(DDL);
}

const INSERT_SQL = `INSERT INTO kg.work_log (category, action, summary, item_count, book_stem, detail, actor)
  SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[], $6::jsonb[], $7::text[])`;

async function insertEntries(entries: WorkLogEntry[], runner: { query: PoolClient["query"] }) {
  await runner.query(INSERT_SQL, [
    entries.map((e) => e.category),
    entries.map((e) => e.action),
    entries.map((e) => e.summary),
    entries.map((e) => e.itemCount ?? 1),
    entries.map((e) => e.bookStem ?? null),
    entries.map((e) => JSON.stringify(e.detail ?? {})),
    entries.map((e) => e.actor ?? null),
  ]);
}

// client 를 넘기면 그 트랜잭션 안에서 기록(실패는 호출자에게 전달). 없으면 pool 로 기록하고 실패해도 던지지 않는다.
export async function writeWorkLogs(entries: WorkLogEntry[], client?: PoolClient): Promise<void> {
  if (entries.length === 0) return;
  if (client) return insertEntries(entries, client);
  try {
    await insertEntries(entries, pool);
  } catch (e) {
    console.error("[work-log] 기록 실패", e);
  }
}

export async function writeWorkLog(entry: WorkLogEntry, client?: PoolClient): Promise<void> {
  return writeWorkLogs([entry], client);
}

export type WorkLogItem = {
  id: number;
  category: WorkLogCategory;
  action: WorkLogAction;
  summary: string;
  itemCount: number;
  bookStem: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};
export type WorkLogPage = {
  total: number;
  dayCount: number;
  date: string | null;
  pageIndex: number | null;
  firstDate: string | null;
  lastDate: string | null;
  newerDate: string | null;
  olderDate: string | null;
  items: WorkLogItem[];
};

const KST_DAY = `(created_at AT TIME ZONE 'Asia/Seoul')::date`;

// 하루(Asia/Seoul) 단위 조회. date 가 없으면 가장 최근 날짜.
export async function listWorkLogByDate(date?: string): Promise<WorkLogPage> {
  const days = await pool.query(`SELECT to_char(${KST_DAY}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n FROM kg.work_log GROUP BY 1 ORDER BY 1 DESC`);
  const list: string[] = days.rows.map((r) => r.d);
  const total = days.rows.reduce((s, r) => s + Number(r.n), 0);
  if (list.length === 0) {
    return { total: 0, dayCount: 0, date: null, pageIndex: null, firstDate: null, lastDate: null, newerDate: null, olderDate: null, items: [] };
  }
  const nav = computeDayNav(list, date);
  const cur = nav.date as string;
  const idx = list.indexOf(cur);
  let items: WorkLogItem[] = [];
  if (idx >= 0) {
    const r = await pool.query(
      `SELECT id, category, action, summary, item_count, book_stem, actor, detail, created_at FROM kg.work_log
        WHERE ${KST_DAY} = $1::date ORDER BY created_at DESC, id DESC`,
      [cur]
    );
    items = r.rows.map((x) => ({
      id: Number(x.id),
      category: x.category,
      action: x.action,
      summary: x.summary,
      itemCount: Number(x.item_count),
      bookStem: x.book_stem ?? null,
      actor: x.actor ?? null,
      detail: x.detail ?? {},
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }
  return { total, dayCount: list.length, ...nav, date: cur, items } as WorkLogPage;
}

const num = async (sql: string, c: PoolClient): Promise<number> => Number((await c.query(sql)).rows[0].n);

// 이력이 하나도 없으면 legacy 와 KG 의 현황 비교를 기준선 1건으로 남긴다. 동시 실행은 advisory lock 으로 막는다.
export async function seedBaselineIfEmpty(): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kg.work_log.baseline'))");
    if ((await client.query("SELECT 1 FROM kg.work_log LIMIT 1")).rows.length > 0) {
      await client.query("ROLLBACK");
      return false;
    }

    let legacy: { mathConcepts: { total: number | null; active: number | null }; questionsUnits: { total: number | null }; error?: string } = {
      mathConcepts: { total: null, active: null },
      questionsUnits: { total: null },
    };
    try {
      const l = await countLegacyForBaseline();
      legacy = { mathConcepts: { total: l.mathConceptsTotal, active: l.mathConceptsActive }, questionsUnits: { total: l.questionsUnitsTotal } };
    } catch (e) {
      legacy.error = (e as Error).message;
    }

    const mc = (
      await client.query(
        `SELECT COUNT(*) FILTER (WHERE source_id > 0)::int AS n,
                COALESCE(SUM(1 + COALESCE(array_length(merged_source_ids, 1), 0)) FILTER (WHERE source_id > 0), 0)::int AS rep
           FROM kg.math_concepts`
      )
    ).rows[0];
    const migrated = (await client.query("SELECT to_regclass('l2o.migration_result') AS t")).rows[0].t
      ? await num("SELECT COUNT(*)::int AS n FROM l2o.migration_result WHERE status = 'migrated'", client)
      : null;
    const kg = {
      mathConcepts: Number(mc.n),
      representedLegacyIds: Number(mc.rep),
      activeUnitEdges: await num("SELECT COUNT(*)::int AS n FROM kg.concept_unit_edges WHERE is_active", client),
      migratedGroups: migrated,
      problemLinks: null as number | null,
      bookIndex: await num("SELECT COUNT(*)::int AS n FROM kg.book_index", client),
      dictionary: await num("SELECT COUNT(*)::int AS n FROM kg.dictionary", client),
      flashcards: await num("SELECT COUNT(*)::int AS n FROM kg.flashcards", client),
      quizzes: await num("SELECT COUNT(*)::int AS n FROM kg.quizzes WHERE jsonb_array_length(options) > 0", client),
      descriptiveQuizzes: await num("SELECT COUNT(*)::int AS n FROM kg.quizzes WHERE jsonb_array_length(options) = 0", client),
    };
    const diff = baselineDiff(legacy.mathConcepts.active, kg.representedLegacyIds, legacy.questionsUnits.total, kg.problemLinks);
    const f = (v: number | null) => (v == null ? "?" : String(v));
    const summary =
      `기준선: legacy 개념 ${f(legacy.mathConcepts.total)}(활성 ${f(legacy.mathConcepts.active)}) / KG 개념 ${kg.mathConcepts}(legacy ${kg.representedLegacyIds}건 대표) / 미이전 ${diff.conceptsNotMigrated}, ` +
      `questions_units ${f(legacy.questionsUnits.total)} / 문제 연동 ${f(kg.problemLinks)}, ` +
      `색인 ${kg.bookIndex}·딕셔너리 ${kg.dictionary}·플래시카드 ${kg.flashcards}·객관식 ${kg.quizzes}·서술형 ${kg.descriptiveQuizzes}`;
    await insertEntries([{ category: "baseline", action: "baseline", summary, itemCount: 1, detail: { legacy, kg, diff }, actor: "system" }], client);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type StemItem = { book_stem?: string | null };
const stemsOf = (items: StemItem[]) => [...new Set(items.map((i) => i.book_stem).filter((s): s is string => !!s))];

// 일괄 등록(POST /api/dictionary, /process): category 마다 1행. 0건인 category 는 기록하지 않는다.
export async function logBulkCreate(
  groups: { bookIndex?: StemItem[]; dictionary?: StemItem[]; flashcards?: StemItem[]; quizzes?: (StemItem & { quiz_type?: unknown; options?: unknown })[] },
  actor: string
): Promise<void> {
  const rows: { category: WorkLogCategory; label: string; items: StemItem[] }[] = [];
  const quizzes = groups.quizzes ?? [];
  const desc = quizzes.filter((q) => isDescriptiveQuiz(q));
  const obj = quizzes.filter((q) => !isDescriptiveQuiz(q));
  rows.push(
    { category: "book_index", label: "색인", items: groups.bookIndex ?? [] },
    { category: "dictionary", label: "딕셔너리", items: groups.dictionary ?? [] },
    { category: "flashcard", label: "플래시카드", items: groups.flashcards ?? [] },
    { category: "quiz", label: "객관식 퀴즈", items: obj },
    { category: "descriptive_quiz", label: "서술형 퀴즈", items: desc }
  );
  const entries: WorkLogEntry[] = rows
    .filter((r) => r.items.length > 0)
    .map((r) => {
      const bookStems = stemsOf(r.items);
      return {
        category: r.category,
        action: "create" as const,
        summary: `${r.label} ${r.items.length}건 등록${bookStems[0] ? ` (${bookStems[0]})` : ""}`,
        itemCount: r.items.length,
        bookStem: bookStems[0] ?? null,
        detail: { bookStems },
        actor,
      };
    });
  await writeWorkLogs(entries);
}
