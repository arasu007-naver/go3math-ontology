import { withReadOnly } from "@/lib/graphDb";

// 에이전트가 만든 SQL 실행기. 읽기 전용 트랜잭션 + kg 스키마 테이블만 허용 + 행 수 제한.
export const MAX_ROWS = 100;

// 다른 스키마를 우회해 읽거나 서버에 영향을 줄 수 있는 함수 이름
const BLOCKED = /\b(pg_\w+|information_schema|set_config|current_setting|dblink\w*|lo_\w+|query_to_xml\w*|table_to_xml\w*|cursor_to_xml\w*|xpath\w*|copy)\b/i;

export class QueryRejected extends Error {}

export function checkSql(raw: string): string {
  const sql = raw.trim().replace(/;\s*$/, "");
  if (!/^(select|with)\b/i.test(sql)) throw new QueryRejected("SELECT/WITH 문만 실행합니다.");
  if (sql.includes(";")) throw new QueryRejected("문장은 하나만 실행합니다.");
  if (BLOCKED.test(sql)) throw new QueryRejected("허용되지 않은 함수·스키마를 사용했습니다.");
  return sql;
}

type PlanNode = { "Relation Name"?: string; Schema?: string; Plans?: PlanNode[]; [k: string]: unknown };
function relations(plan: PlanNode, out: { schema?: string; name: string }[] = []) {
  if (plan["Relation Name"]) out.push({ schema: plan.Schema, name: plan["Relation Name"] });
  for (const p of plan.Plans || []) relations(p, out);
  return out;
}

export type QueryResult = { columns: string[]; rows: Record<string, unknown>[]; truncated: boolean };

export async function runGraphQuery(raw: string): Promise<QueryResult> {
  const sql = checkSql(raw);
  return withReadOnly(async (c) => {
    const explain = await c.query(`EXPLAIN (VERBOSE, FORMAT JSON) ${sql}`);
    const plan = (explain.rows[0]["QUERY PLAN"] as { Plan: PlanNode }[])[0].Plan;
    const bad = relations(plan).filter((r) => r.schema !== "kg");
    if (bad.length) throw new QueryRejected(`kg 스키마 밖의 테이블입니다: ${bad.map((r) => `${r.schema}.${r.name}`).join(", ")}`);
    const res = await c.query(`SELECT * FROM (${sql}) AS agent_q LIMIT ${MAX_ROWS + 1}`);
    return {
      columns: res.fields.map((f) => f.name),
      rows: res.rows.slice(0, MAX_ROWS),
      truncated: res.rows.length > MAX_ROWS,
    };
  });
}

// 결과 셀 중 그래프 노드 id 를 프론트가 열 URL 로 바꾼다
const NODE_ID = /^(cat|cur|book|toc|page|para):/;
export function nodeLinks(rows: Record<string, unknown>[]) {
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r)
        .filter(([, v]) => typeof v === "string" && NODE_ID.test(v))
        .map(([k, v]) => [k, `/node?id=${encodeURIComponent(v as string)}`])
    )
  );
}
