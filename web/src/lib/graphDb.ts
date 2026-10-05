import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { BookInput, PageInput, ProblemRef, SavedPage, SavedParagraph } from "./types";

// TOC 중심 knowledge graph (스펙 2026-10-05). Postgres 스키마 kg (db/schema.sql).
// 노드: category(최상위 7) / curriculum(교육과정·과목) / book / toc / page / paragraph. 관계는 스펙의 시작 범위 8가지.
export const EDGE = {
  CATEGORY_HAS: "CATEGORY_HAS", // 최상위 카테고리 → 교육과정·과목 노드
  PREREQ_OF: "PREREQ_OF", // 과목 A → 과목 B (A 가 B 의 선수)
  MAPS_TO: "MAPS_TO", // 교육과정·과목 노드 → 교재 TOC 항목
  BOOK_HAS_TOC: "HAS_TOC", // 도서 → (최상위) TOC 항목
  TOC_HAS_CHILD: "HAS_CHILD", // TOC 항목 → 하위 TOC 항목
  TOC_POINTS_PAGE: "POINTS_TO", // TOC 항목 → 페이지
  PAGE_HAS_PARAGRAPH: "HAS_PARAGRAPH", // 페이지 → 문단
  ANSWER_OF: "ANSWERS", // 해답 문단 → 문제 문단
} as const;

// DATABASE_URL 이 없으면 pg 가 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD 를 읽는다
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});
let schemaReady: Promise<void> | null = null;

function ensureSchema() {
  schemaReady ??= pool
    .query(fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"))
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export async function withReadOnly<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  await ensureSchema();
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SET LOCAL statement_timeout = '5s'");
    await c.query("SET LOCAL search_path = kg");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

async function q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  return (await pool.query(sql, params)).rows as T[];
}

const nfc = (s: string) => s.normalize("NFC");
export const CURRICULUM_BOOK = "curriculum";
export const ids = {
  category: (name: string) => `cat:${nfc(name)}`,
  curriculum: (name: string) => `cur:${nfc(name)}`,
  book: (stem: string) => `book:${nfc(stem)}`,
  toc: (stem: string, key: string) => `toc:${nfc(stem)}:${key}`,
  page: (stem: string, kind: string, page: number) => `page:${nfc(stem)}:${kind}:${page}`,
  paragraph: (stem: string, kind: string, page: number, idx: number) => `para:${nfc(stem)}:${kind}:${page}:${idx}`,
};

function upsertNode(c: PoolClient, id: string, type: string, book: string, props: object) {
  return c.query(
    `INSERT INTO kg.nodes (id, type, book, props) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET props = EXCLUDED.props, updated_at = now()`,
    [id, type, book, JSON.stringify(props)]
  );
}

function addEdge(c: PoolClient, src: string, dst: string, type: string) {
  return c.query(`INSERT INTO kg.edges (src, dst, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [src, dst, type]);
}

// 도서 + TOC 트리 저장. TOC 구조 간선은 매번 다시 만든다(노드 id는 키 기준이라 페이지 연결은 유지).
export async function saveBook(input: BookInput) {
  const bookId = ids.book(input.stem);
  await tx(async (c) => {
    await upsertNode(c, bookId, "book", bookId, {
      title: input.title,
      stem: nfc(input.stem),
      documentId: input.documentId,
      sourceOrder: input.sourceOrder,
      pageOffset: input.pageOffset,
      commentaryStem: input.commentaryStem,
    });
    const keep = input.toc.map((t) => ids.toc(input.stem, t.key));
    await c.query(`DELETE FROM kg.edges WHERE src = $1 AND type = $2`, [bookId, EDGE.BOOK_HAS_TOC]);
    await c.query(
      `DELETE FROM kg.edges WHERE type = $2 AND src IN (SELECT id FROM kg.nodes WHERE book = $1 AND type = 'toc')`,
      [bookId, EDGE.TOC_HAS_CHILD]
    );
    await c.query(`DELETE FROM kg.nodes WHERE book = $1 AND type = 'toc' AND NOT (id = ANY($2))`, [bookId, keep]);
    // TOC 는 수백 개라 원격 DB 왕복을 줄이도록 한 번에 넣는다
    const tocRows = input.toc.map((t) => ({
      id: ids.toc(input.stem, t.key),
      props: { key: t.key, level: t.level, label: t.label, page: t.page, order: t.order },
    }));
    await c.query(
      `INSERT INTO kg.nodes (id, type, book, props)
       SELECT r.id, 'toc', $1, r.props FROM jsonb_to_recordset($2::jsonb) AS r(id text, props jsonb)
       ON CONFLICT (id) DO UPDATE SET props = EXCLUDED.props, updated_at = now()`,
      [bookId, JSON.stringify(tocRows)]
    );
    const edgeRows = input.toc.map((t) => ({
      src: t.parentKey == null ? bookId : ids.toc(input.stem, t.parentKey),
      dst: ids.toc(input.stem, t.key),
      type: t.parentKey == null ? EDGE.BOOK_HAS_TOC : EDGE.TOC_HAS_CHILD,
    }));
    await c.query(
      `INSERT INTO kg.edges (src, dst, type)
       SELECT r.src, r.dst, r.type FROM jsonb_to_recordset($1::jsonb) AS r(src text, dst text, type text)
       ON CONFLICT DO NOTHING`,
      [JSON.stringify(edgeRows)]
    );
  });
  return { bookId, tocCount: input.toc.length };
}

export async function getBookSummary(stem: string) {
  const bookId = ids.book(stem);
  const [book] = await q<{ props: Record<string, unknown>; updated_at: Date }>(
    `SELECT props, updated_at FROM kg.nodes WHERE id = $1`,
    [bookId]
  );
  if (!book) return null;
  const counts = await q<{ type: string; n: number }>(
    `SELECT type, COUNT(*)::int AS n FROM kg.nodes WHERE book = $1 GROUP BY type`,
    [bookId]
  );
  return {
    bookId,
    ...book.props,
    updatedAt: book.updated_at.toISOString(),
    counts: Object.fromEntries(counts.map((r) => [r.type, r.n])),
  };
}

// 페이지 + 문단 저장. 이 페이지에서 나가는 간선만 다시 만들고, 다른 페이지의 해답이 가리키는 문단 id는 유지한다.
export async function savePage(input: PageInput) {
  const bookId = ids.book(input.stem);
  const pageId = ids.page(input.stem, input.kind, input.page);
  const tocId = input.tocKey ? ids.toc(input.stem, input.tocKey) : null;

  await tx(async (c) => {
    const exists = async (id: string) => (await c.query(`SELECT 1 FROM kg.nodes WHERE id = $1`, [id])).rowCount! > 0;
    if (!(await exists(bookId))) throw new Error("도서가 그래프에 없습니다. 먼저 '도서·TOC 저장'을 하세요.");
    if (tocId && !(await exists(tocId))) throw new Error(`TOC 항목이 그래프에 없습니다: ${input.tocKey}`);

    await upsertNode(c, pageId, "page", bookId, {
      kind: input.kind,
      page: input.page,
      jsonKey: input.jsonKey,
      imageUrl: input.imageUrl,
    });
    await c.query(`DELETE FROM kg.edges WHERE dst = $1 AND type = $2`, [pageId, EDGE.TOC_POINTS_PAGE]);
    if (tocId) await addEdge(c, tocId, pageId, EDGE.TOC_POINTS_PAGE);

    const newIds = input.paragraphs.map((p) => ids.paragraph(input.stem, input.kind, input.page, p.idx));
    await c.query(
      `DELETE FROM kg.nodes WHERE id IN (SELECT dst FROM kg.edges WHERE src = $1 AND type = $2) AND NOT (id = ANY($3))`,
      [pageId, EDGE.PAGE_HAS_PARAGRAPH, newIds]
    );
    for (const [i, p] of input.paragraphs.entries()) {
      const pid = newIds[i];
      await upsertNode(c, pid, "paragraph", bookId, { idx: p.idx, kind: p.kind, category: p.category, content: p.content });
      await addEdge(c, pageId, pid, EDGE.PAGE_HAS_PARAGRAPH);
      await c.query(`DELETE FROM kg.edges WHERE src = $1 AND type = $2`, [pid, EDGE.ANSWER_OF]);
      // 더 이상 문제가 아니면 다른 해답이 가리키던 간선도 끊는다
      if (p.kind !== "문제") await c.query(`DELETE FROM kg.edges WHERE dst = $1 AND type = $2`, [pid, EDGE.ANSWER_OF]);
    }
    // 같은 페이지 안의 문제를 가리킬 수 있으므로 문단을 모두 만든 뒤 해답 간선을 건다.
    for (const [i, p] of input.paragraphs.entries()) {
      if (p.kind !== "해답" || !p.answersTo) continue;
      const target = await c.query(`SELECT props->>'kind' AS kind FROM kg.nodes WHERE id = $1 AND type = 'paragraph'`, [
        p.answersTo,
      ]);
      if (target.rows[0]?.kind !== "문제") {
        throw new Error(`해답 #${p.idx + 1}이 가리키는 문제 문단이 없습니다: ${p.answersTo}`);
      }
      await addEdge(c, newIds[i], p.answersTo, EDGE.ANSWER_OF);
    }
  });
  return { pageId, paragraphCount: input.paragraphs.length };
}

export async function getPage(stem: string, kind: string, page: number): Promise<SavedPage | null> {
  const pageId = ids.page(stem, kind, page);
  const [row] = await q<{ updated_at: Date }>(`SELECT updated_at FROM kg.nodes WHERE id = $1`, [pageId]);
  if (!row) return null;
  const [toc] = await q<{ key: string }>(
    `SELECT n.props->>'key' AS key FROM kg.edges e JOIN kg.nodes n ON n.id = e.src WHERE e.dst = $1 AND e.type = $2`,
    [pageId, EDGE.TOC_POINTS_PAGE]
  );
  const paras = await q<{ id: string; props: { idx: number; kind: SavedParagraph["kind"]; category: string; content: string }; answers_to: string | null }>(
    `SELECT n.id, n.props,
            (SELECT a.dst FROM kg.edges a WHERE a.src = n.id AND a.type = $1 LIMIT 1) AS answers_to
     FROM kg.edges e JOIN kg.nodes n ON n.id = e.dst
     WHERE e.src = $2 AND e.type = $3
     ORDER BY (n.props->>'idx')::int`,
    [EDGE.ANSWER_OF, pageId, EDGE.PAGE_HAS_PARAGRAPH]
  );
  const paragraphs: SavedParagraph[] = paras.map((r) => ({
    id: r.id,
    idx: r.props.idx,
    kind: r.props.kind,
    category: r.props.category,
    content: r.props.content,
    answersTo: r.answers_to,
  }));
  return { id: pageId, tocKey: toc?.key ?? null, paragraphs, updatedAt: row.updated_at.toISOString() };
}

// 해답이 가리킬 수 있는 문제 문단 목록 (도서 단위)
export async function listProblems(stem: string): Promise<ProblemRef[]> {
  return q<ProblemRef>(
    `SELECT n.id, (pg.props->>'page')::int AS page, pg.props->>'kind' AS kind,
            (n.props->>'idx')::int AS idx, left(n.props->>'content', 60) AS snippet
     FROM kg.nodes n
     JOIN kg.edges e ON e.dst = n.id AND e.type = $1
     JOIN kg.nodes pg ON pg.id = e.src
     WHERE n.book = $2 AND n.type = 'paragraph' AND n.props->>'kind' = '문제'
     ORDER BY kind, page, idx`,
    [EDGE.PAGE_HAS_PARAGRAPH, ids.book(stem)]
  );
}

// ---------- 교육과정·과목 그물 ----------

export type NetworkNode = { id: string; type: "category" | "curriculum"; name: string; level?: string; order: number; mapCount: number };
export type NetworkEdge = { src: string; dst: string; type: "CATEGORY_HAS" | "PREREQ_OF" };

export async function getNetwork(): Promise<{ nodes: NetworkNode[]; edges: NetworkEdge[] }> {
  const nodes = await q<NetworkNode>(
    `SELECT n.id, n.type, n.props->>'name' AS name, n.props->>'level' AS level, COALESCE((n.props->>'order')::int, 0) AS "order",
            (SELECT COUNT(*)::int FROM kg.edges m WHERE m.src = n.id AND m.type = $1) AS "mapCount"
     FROM kg.nodes n WHERE n.type IN ('category', 'curriculum') ORDER BY n.type, "order", name`,
    [EDGE.MAPS_TO]
  );
  const edges = await q<NetworkEdge>(`SELECT src, dst, type FROM kg.edges WHERE type IN ($1, $2)`, [EDGE.CATEGORY_HAS, EDGE.PREREQ_OF]);
  return { nodes, edges };
}

// 과목 노드 추가/수정 (이름이 id 라 이름 변경은 props.name 만 바뀐다)
export async function saveCurriculum(input: { id?: string; name: string; level: string; categoryIds: string[] }) {
  return tx(async (c) => {
    const id = input.id || ids.curriculum(input.name);
    const prev = await c.query(`SELECT props FROM kg.nodes WHERE id = $1 AND type = 'curriculum'`, [id]);
    if (input.id && !prev.rowCount) throw new Error(`과목 노드가 없습니다: ${input.id}`);
    if (!input.id && prev.rowCount) throw new Error(`이미 있는 이름입니다: ${input.name}`);
    const order = prev.rows[0]?.props?.order ?? 999;
    await upsertNode(c, id, "curriculum", CURRICULUM_BOOK, { name: input.name, level: input.level, order });
    await c.query(`DELETE FROM kg.edges WHERE dst = $1 AND type = $2`, [id, EDGE.CATEGORY_HAS]);
    for (const cat of input.categoryIds) {
      const ok = await c.query(`SELECT 1 FROM kg.nodes WHERE id = $1 AND type = 'category'`, [cat]);
      if (!ok.rowCount) throw new Error(`카테고리가 없습니다: ${cat}`);
      await addEdge(c, cat, id, EDGE.CATEGORY_HAS);
    }
    return { id };
  });
}

export async function deleteCurriculum(id: string) {
  await q(`DELETE FROM kg.nodes WHERE id = $1 AND type = 'curriculum'`, [id]);
}

// 선수 관계 on/off. 순환이 생기면 거부한다.
export async function setPrereq(src: string, dst: string, on: boolean) {
  return tx(async (c) => {
    if (!on) {
      await c.query(`DELETE FROM kg.edges WHERE src = $1 AND dst = $2 AND type = $3`, [src, dst, EDGE.PREREQ_OF]);
      return;
    }
    if (src === dst) throw new Error("자기 자신을 선수로 둘 수 없습니다.");
    const both = await c.query(`SELECT COUNT(*)::int AS n FROM kg.nodes WHERE id = ANY($1) AND type = 'curriculum'`, [[src, dst]]);
    if (both.rows[0].n !== 2) throw new Error("과목 노드가 아닙니다.");
    const cycle = await c.query(
      `WITH RECURSIVE r(id) AS (
         SELECT dst FROM kg.edges WHERE src = $1 AND type = $3
         UNION SELECT e.dst FROM kg.edges e JOIN r ON e.src = r.id WHERE e.type = $3
       ) SELECT 1 FROM r WHERE id = $2 LIMIT 1`,
      [dst, src, EDGE.PREREQ_OF]
    );
    if (cycle.rowCount) throw new Error("선수 관계에 순환이 생깁니다.");
    await addEdge(c, src, dst, EDGE.PREREQ_OF);
  });
}

// TOC 항목 ↔ 교육과정·과목 대응
export async function getMappings(stem: string): Promise<Record<string, string[]>> {
  const rows = await q<{ key: string; src: string }>(
    `SELECT t.props->>'key' AS key, e.src FROM kg.edges e JOIN kg.nodes t ON t.id = e.dst
     WHERE e.type = $1 AND t.book = $2 AND t.type = 'toc'`,
    [EDGE.MAPS_TO, ids.book(stem)]
  );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.key] ??= []).push(r.src);
  return out;
}

export async function setMappings(stem: string, tocKey: string, curriculumIds: string[]) {
  const tocId = ids.toc(stem, tocKey);
  await tx(async (c) => {
    if (!(await c.query(`SELECT 1 FROM kg.nodes WHERE id = $1 AND type = 'toc'`, [tocId])).rowCount) {
      throw new Error(`TOC 항목이 그래프에 없습니다: ${tocKey}`);
    }
    await c.query(`DELETE FROM kg.edges WHERE dst = $1 AND type = $2`, [tocId, EDGE.MAPS_TO]);
    for (const cur of curriculumIds) {
      if (!(await c.query(`SELECT 1 FROM kg.nodes WHERE id = $1 AND type = 'curriculum'`, [cur])).rowCount) {
        throw new Error(`과목 노드가 없습니다: ${cur}`);
      }
      await addEdge(c, cur, tocId, EDGE.MAPS_TO);
    }
  });
}

// ---------- DB 테이블 보기 (/tables) ----------

export const TABLE_PAGE_SIZE = 24;

// DB 의 모든 일반 테이블 ('스키마.테이블')
export async function listTables(): Promise<string[]> {
  const rows = await q<{ name: string }>(
    `SELECT table_schema || '.' || table_name AS name FROM information_schema.tables
     WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')
     ORDER BY table_schema, table_name`
  );
  return rows.map((r) => r.name);
}

// 테이블 한 쪽(24행). 이름은 listTables 에 있는 것만 받는다. 기본 키 순(없으면 물리 순서)으로 자른다.
export async function getTableRows(name: string, page: number) {
  if (!(await listTables()).includes(name)) return null;
  const [schema, table] = name.split(/\.(.*)/);
  return withReadOnly(async (c) => {
    const ident = `${c.escapeIdentifier(schema)}.${c.escapeIdentifier(table)}`;
    const columns = (
      await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      )
    ).rows.map((r) => r.column_name as string);
    const pk = (
      await c.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::int2[], a.attnum)`,
        [ident]
      )
    ).rows.map((r) => c.escapeIdentifier(r.attname));
    const total = (await c.query(`SELECT count(*)::int AS n FROM ${ident}`)).rows[0].n as number;
    // to_jsonb 로 바꿔 날짜·bytea·jsonb 도 그대로 JSON 으로 보낸다
    const rows = (
      await c.query(`SELECT to_jsonb(t) AS r FROM ${ident} t ORDER BY ${pk.length ? pk.map((k) => `t.${k}`).join(", ") : "t.ctid"} LIMIT $1 OFFSET $2`, [
        TABLE_PAGE_SIZE,
        (page - 1) * TABLE_PAGE_SIZE,
      ])
    ).rows.map((r) => r.r as Record<string, unknown>);
    return { name, columns, rows, total, page, pageSize: TABLE_PAGE_SIZE };
  });
}

// ---------- 노드 보기 (에이전트 결과 URL 이 여는 내용) ----------

export type NodeView = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  out: { type: string; id: string; nodeType: string; label: string }[];
  in: { type: string; id: string; nodeType: string; label: string }[];
};

const LABEL = `COALESCE(n.props->>'name', n.props->>'label', n.props->>'title',
  CASE WHEN n.type = 'page' THEN (n.props->>'page') || 'p' END,
  CASE WHEN n.type = 'paragraph' THEN (n.props->>'kind') || ' #' || ((n.props->>'idx')::int + 1) END, n.id)`;

export async function getNodeView(id: string): Promise<NodeView | null> {
  const [node] = await q<{ id: string; type: string; props: Record<string, unknown> }>(`SELECT id, type, props FROM kg.nodes WHERE id = $1`, [id]);
  if (!node) return null;
  const out = await q<NodeView["out"][number]>(
    `SELECT e.type, n.id, n.type AS "nodeType", ${LABEL} AS label FROM kg.edges e JOIN kg.nodes n ON n.id = e.dst
     WHERE e.src = $1 ORDER BY e.type, COALESCE((n.props->>'order')::int, (n.props->>'page')::int, (n.props->>'idx')::int, 0)`,
    [id]
  );
  const inc = await q<NodeView["in"][number]>(
    `SELECT e.type, n.id, n.type AS "nodeType", ${LABEL} AS label FROM kg.edges e JOIN kg.nodes n ON n.id = e.src
     WHERE e.dst = $1 ORDER BY e.type, label`,
    [id]
  );
  return { ...node, out, in: inc };
}

