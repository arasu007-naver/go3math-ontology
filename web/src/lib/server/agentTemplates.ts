import { withReadOnly } from "@/lib/graphDb";
import { MAX_ROWS, type QueryResult } from "./agentQuery";

// 정해진 조회 템플릿. Jev / 로컬 LLM 은 템플릿과 인자(그래프에 있는 이름)만 고르고, SQL 은 서버가 고정해 둔다.
export const KINDS = ["정의", "공식", "성질", "문제", "해답"] as const;

export type Catalog = {
  categories: { id: string; name: string }[];
  curriculum: { id: string; name: string; level: string }[];
  books: { id: string; title: string }[];
};

export async function loadCatalog(): Promise<Catalog> {
  return withReadOnly(async (c) => {
    const cat = await c.query(`SELECT id, props->>'name' AS name FROM nodes WHERE type = 'category' ORDER BY (props->>'order')::int`);
    const cur = await c.query(
      `SELECT id, props->>'name' AS name, props->>'level' AS level FROM nodes WHERE type = 'curriculum' ORDER BY (props->>'order')::int, props->>'name'`
    );
    const books = await c.query(`SELECT id, props->>'title' AS title FROM nodes WHERE type = 'book' ORDER BY props->>'title'`);
    return { categories: cat.rows, curriculum: cur.rows, books: books.rows };
  });
}

// 인자는 이름(사람이 읽는 값). 실행 직전에 id 로 바꾼다.
export type Args = { subject?: string; category?: string; book?: string; keyword?: string; kind?: string };
type ArgName = keyof Args;

type Template = {
  description: string; // Jev criteria / 로컬 LLM 설명 / 화면 표시
  needs: ArgName[];
  optional: ArgName[];
  sql: string;
  params: (a: Resolved) => unknown[];
};
type Resolved = { subject?: string; category?: string; book?: string; keyword?: string; kind?: string };

// 한국어는 띄어쓰기가 들쭉날쭉해서(나머지정리 / 나머지 정리) 공백을 빼고 비교한다
const like = (s: string) => `%${s.replace(/\s+/g, "").replace(/[\\%_]/g, "\\$&")}%`;

export const TEMPLATES: Record<string, Template> = {
  prereq_of: {
    description: "prerequisite subjects of a subject (선수과목)",
    needs: ["subject"],
    optional: [],
    sql: `SELECT a.id AS prereq_id, a.props->>'name' AS prereq, b.id AS subject_id, b.props->>'name' AS subject
          FROM edges e JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
          WHERE e.type = 'PREREQ_OF' AND e.dst = $1 ORDER BY (a.props->>'order')::int`,
    params: (a) => [a.subject],
  },
  next_of: {
    description: "subjects that require a subject as a prerequisite (후속과목)",
    needs: ["subject"],
    optional: [],
    sql: `SELECT a.id AS subject_id, a.props->>'name' AS subject, b.id AS next_id, b.props->>'name' AS next_subject
          FROM edges e JOIN nodes a ON a.id = e.src JOIN nodes b ON b.id = e.dst
          WHERE e.type = 'PREREQ_OF' AND e.src = $1 ORDER BY (b.props->>'order')::int`,
    params: (a) => [a.subject],
  },
  subjects_in_category: {
    description: "subjects or curriculum nodes belonging to a top-level category",
    needs: ["category"],
    optional: [],
    sql: `SELECT c.id AS category_id, c.props->>'name' AS category, s.id AS subject_id, s.props->>'name' AS subject, s.props->>'level' AS level
          FROM edges e JOIN nodes c ON c.id = e.src JOIN nodes s ON s.id = e.dst
          WHERE e.type = 'CATEGORY_HAS' AND e.src = $1 ORDER BY (s.props->>'order')::int`,
    params: (a) => [a.category],
  },
  toc_for_subject: {
    description: "textbook TOC items mapped to a subject",
    needs: ["subject"],
    optional: ["book"],
    sql: `SELECT s.props->>'name' AS subject, b.id AS book_id, b.props->>'title' AS book, t.id AS toc_id, t.props->>'label' AS toc, (t.props->>'page')::int AS toc_page
          FROM edges m JOIN nodes s ON s.id = m.src JOIN nodes t ON t.id = m.dst JOIN nodes b ON b.id = t.book
          WHERE m.type = 'MAPS_TO' AND m.src = $1 AND ($2::text IS NULL OR t.book = $2)
          ORDER BY book, (t.props->>'order')::int`,
    params: (a) => [a.subject, a.book ?? null],
  },
  paragraphs_for_subject: {
    description: "paragraphs of a curriculum subject, optionally only one kind (e.g. only problems / only definitions of 공통수학1)",
    needs: ["subject"],
    optional: ["kind", "book"],
    sql: `WITH RECURSIVE sub(id) AS (
            SELECT dst FROM edges WHERE type = 'MAPS_TO' AND src = $1
            UNION SELECT e.dst FROM edges e JOIN sub ON e.src = sub.id WHERE e.type = 'HAS_CHILD')
          SELECT b.id AS book_id, b.props->>'title' AS book, t.id AS toc_id, t.props->>'label' AS toc,
                 pg.id AS page_id, (pg.props->>'page')::int AS page, p.id AS paragraph_id, p.props->>'kind' AS kind
          FROM sub JOIN nodes t ON t.id = sub.id
          JOIN edges pt ON pt.src = t.id AND pt.type = 'POINTS_TO' JOIN nodes pg ON pg.id = pt.dst
          JOIN edges hp ON hp.src = pg.id AND hp.type = 'HAS_PARAGRAPH' JOIN nodes p ON p.id = hp.dst
          JOIN nodes b ON b.id = p.book
          WHERE ($2::text IS NULL OR p.props->>'kind' = $2) AND ($3::text IS NULL OR p.book = $3)
          ORDER BY book, page, (p.props->>'idx')::int`,
    params: (a) => [a.subject, a.kind ?? null, a.book ?? null],
  },
  book_toc: {
    description: "table of contents (chapters and sections) of a book",
    needs: ["book"],
    optional: [],
    sql: `SELECT t.id AS toc_id, t.props->>'level' AS level, t.props->>'label' AS toc, (t.props->>'page')::int AS page
          FROM nodes t WHERE t.book = $1 AND t.type = 'toc' AND t.props->>'level' IN ('chapter', 'section')
          ORDER BY (t.props->>'order')::int`,
    params: (a) => [a.book],
  },
  paragraphs_by_keyword: {
    description: "paragraphs whose text contains a math topic keyword (e.g. 나머지 정리), not a subject name",
    needs: ["keyword"],
    optional: ["kind", "book"],
    sql: `SELECT b.id AS book_id, b.props->>'title' AS book,
                 (SELECT t.id FROM edges pt JOIN nodes t ON t.id = pt.src WHERE pt.dst = pg.id AND pt.type = 'POINTS_TO' LIMIT 1) AS toc_id,
                 pg.id AS page_id, (pg.props->>'page')::int AS page, p.id AS paragraph_id, p.props->>'kind' AS kind
          FROM nodes p JOIN edges hp ON hp.dst = p.id AND hp.type = 'HAS_PARAGRAPH' JOIN nodes pg ON pg.id = hp.src JOIN nodes b ON b.id = p.book
          WHERE p.type = 'paragraph' AND replace(p.props->>'content', ' ', '') ILIKE $1
            AND ($2::text IS NULL OR p.props->>'kind' = $2) AND ($3::text IS NULL OR p.book = $3)
          ORDER BY book, page, (p.props->>'idx')::int`,
    params: (a) => [like(a.keyword!), a.kind ?? null, a.book ?? null],
  },
  toc_by_keyword: {
    description: "TOC items whose title contains a keyword",
    needs: ["keyword"],
    optional: ["book"],
    sql: `SELECT b.id AS book_id, b.props->>'title' AS book, t.id AS toc_id, t.props->>'label' AS toc, (t.props->>'page')::int AS toc_page
          FROM nodes t JOIN nodes b ON b.id = t.book
          WHERE t.type = 'toc' AND replace(t.props->>'label', ' ', '') ILIKE $1 AND ($2::text IS NULL OR t.book = $2)
          ORDER BY book, (t.props->>'order')::int`,
    params: (a) => [like(a.keyword!), a.book ?? null],
  },
  problems_with_answers: {
    description: "problems about a math topic keyword (e.g. 나머지 정리) together with their solutions, not a subject name",
    needs: ["keyword"],
    optional: ["book"],
    sql: `SELECT b.id AS book_id, b.props->>'title' AS book, pq.id AS page_id, (pq.props->>'page')::int AS page,
                 q.id AS problem_id, a.id AS answer_id
          FROM nodes q JOIN edges hq ON hq.dst = q.id AND hq.type = 'HAS_PARAGRAPH' JOIN nodes pq ON pq.id = hq.src JOIN nodes b ON b.id = q.book
          LEFT JOIN edges an ON an.dst = q.id AND an.type = 'ANSWERS' LEFT JOIN nodes a ON a.id = an.src
          WHERE q.type = 'paragraph' AND q.props->>'kind' = '문제' AND replace(q.props->>'content', ' ', '') ILIKE $1 AND ($2::text IS NULL OR q.book = $2)
          ORDER BY book, page, (q.props->>'idx')::int`,
    params: (a) => [like(a.keyword!), a.book ?? null],
  },
};

export const KEYWORD_TEMPLATES = new Set(Object.entries(TEMPLATES).filter(([, t]) => t.needs.includes("keyword")).map(([k]) => k));

export type Plan = { template: string; args: Args };

// 이름 인자를 그래프의 id 로 바꾼다. 필수 인자가 없거나 목록에 없는 이름이면 null.
export function resolvePlan(plan: Plan, cat: Catalog): Resolved | null {
  const t = TEMPLATES[plan.template];
  if (!t) return null;
  const r: Resolved = {};
  const a = plan.args;
  if (a.subject) r.subject = cat.curriculum.find((x) => x.name === a.subject)?.id;
  if (a.category) r.category = cat.categories.find((x) => x.name === a.category)?.id;
  if (a.book) r.book = cat.books.find((x) => x.title === a.book)?.id;
  if (a.kind && (KINDS as readonly string[]).includes(a.kind)) r.kind = a.kind;
  if (a.keyword?.trim()) r.keyword = a.keyword.trim();
  return t.needs.every((n) => r[n]) ? r : null;
}

export function describePlan(plan: Plan) {
  const args = Object.entries(plan.args)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${plan.template}(${args})`;
}

export async function runTemplate(plan: Plan, resolved: Resolved): Promise<QueryResult> {
  const t = TEMPLATES[plan.template];
  return withReadOnly(async (c) => {
    const res = await c.query(`${t.sql} LIMIT ${MAX_ROWS + 1}`, t.params(resolved));
    return { columns: res.fields.map((f) => f.name), rows: res.rows.slice(0, MAX_ROWS), truncated: res.rows.length > MAX_ROWS };
  });
}
