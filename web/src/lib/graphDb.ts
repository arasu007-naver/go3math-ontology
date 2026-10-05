import fs from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { BookInput, PageInput, ProblemRef, SavedPage, SavedParagraph } from "./types";

// TOC 중심 knowledge graph (스펙 2026-10-05). 노드: book / toc / page / paragraph. Postgres 스키마 kg.
// 관계는 시작 범위의 5가지만 쓴다.
export const EDGE = {
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

async function q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  return (await pool.query(sql, params)).rows as T[];
}

const nfc = (s: string) => s.normalize("NFC");
export const ids = {
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

    await upsertNode(c, pageId, "page", bookId, { kind: input.kind, page: input.page, jsonKey: input.jsonKey });
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
