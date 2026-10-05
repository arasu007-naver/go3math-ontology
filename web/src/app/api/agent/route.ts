import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { catalogText, RULES, SCHEMA_DOC } from "@/lib/server/agentPrompt";
import { nodeLinks, QueryRejected, runGraphQuery, type QueryResult } from "@/lib/server/agentQuery";
import { describePlan, KEYWORD_TEMPLATES, loadCatalog, resolvePlan, runTemplate, TEMPLATES, type Args, type Catalog, type Plan } from "@/lib/server/agentTemplates";
import { jevRoute, jevVerify } from "@/lib/server/jev";
import { localPlan } from "@/lib/server/localLlm";

// 에이전트 흐름(스펙): 자연어 → 그래프 쿼리 → 실행 → 결과셋(노드 URL)을 프론트에 전달.
//   1) Jev 가 템플릿과 인자를 고른다 (확신이 높을 때만 실행)
//   2) 아니면 로컬 LLM(Qwen3.6)이 템플릿·인자·키워드를 정하고, Jev 가 그 계획을 다시 판정한다
//   3) 그래도 안 되면 Claude 가 SQL 을 쓴다 (읽기 전용 + kg 스키마 검사)
// 어느 모델에도 문단 본문과 쿼리 결과는 보내지 않는다.
const IN_SCOPE_MIN = 0.1; // 이보다 낮으면 그래프 밖 질문 (수학 주제 질문도 0.3 안팎이 나와서 낮게 둔다)
const TEMPLATE_MIN = 0.6;
const ARG_MIN = 0.5;
const VERIFY_MIN = 0.5;
const NOT_IN_GRAPH = "그래프에 없는 내용입니다.";

type Route = "jev" | "local" | "claude";
type Turn = { question: string; summary: string };

export async function POST(request: Request) {
  const s = await requireSession();
  if (s instanceof Response) return s;
  const { question: raw, history } = (await request.json()) as { question?: string; history?: Turn[] };
  const question = raw?.trim();
  if (!question) return Response.json({ error: "질문을 입력하세요." }, { status: 400 });

  const cat = await loadCatalog();
  const trace: string[] = [];

  // 1) Jev
  try {
    const j = await jevRoute(question, cat);
    trace.push(`jev in_scope=${j.inScope.toFixed(2)} template=${j.template.choice}(${j.template.confidence.toFixed(2)})`);
    if (j.inScope < IN_SCOPE_MIN) return done("jev", trace, null, { summary: "그래프 밖의 질문입니다." });
    const plan = jevPlan(j);
    if (!plan) trace.push(`jev 계획 보류: subject=${j.subject.choice}(${j.subject.confidence.toFixed(2)}) category=${j.category.choice}(${j.category.confidence.toFixed(2)}) book=${j.book.choice}(${j.book.confidence.toFixed(2)}) kind=${j.kind.choice}(${j.kind.confidence.toFixed(2)})`);
    if (plan) {
      const resolved = resolvePlan(plan, cat);
      if (resolved) return done("jev", trace, await runTemplate(plan, resolved), { plan: describePlan(plan) });
    }
  } catch (e) {
    trace.push(`jev 실패: ${(e as Error).message}`);
  }

  // 2) 로컬 LLM + Jev 재판정
  try {
    const plan = await localPlan(question, cat);
    trace.push(`local ${describePlan(plan)}`);
    const resolved = plan.template !== "none" ? resolvePlan(plan, cat) : null;
    if (resolved) {
      let fits: number | null = null;
      try {
        fits = await jevVerify(question, plan);
        trace.push(`jev verify=${fits.toFixed(2)}`);
      } catch (e) {
        trace.push(`jev verify 실패: ${(e as Error).message}`); // 인자는 enum 으로 이미 그래프 이름만 허용
      }
      if (fits == null || fits >= VERIFY_MIN) return done("local", trace, await runTemplate(plan, resolved), { plan: describePlan(plan) });
    }
  } catch (e) {
    trace.push(`local 실패: ${(e as Error).message}`);
  }

  // 3) Claude
  return claude(question, history, cat, trace);
}

// Jev 답에서 실행할 계획을 만든다. 키워드가 필요한 템플릿은 Jev 가 채울 수 없으므로 넘긴다.
function jevPlan(j: Awaited<ReturnType<typeof jevRoute>>): Plan | null {
  const name = j.template.choice;
  const t = TEMPLATES[name];
  if (!t || j.template.confidence < TEMPLATE_MIN || KEYWORD_TEMPLATES.has(name)) return null;
  const pick = (a: { choice: string; confidence: number }, empty: string) =>
    a.choice !== empty && a.confidence >= ARG_MIN ? a.choice : undefined;
  const args: Args = {
    subject: pick(j.subject, "none"),
    category: pick(j.category, "none"),
    book: pick(j.book, "none"),
    kind: pick(j.kind, "any"),
  };
  if (!t.needs.every((n) => args[n])) return null;
  // 템플릿이 쓰지 않는 인자는 버린다
  const used = new Set<string>([...t.needs, ...t.optional]);
  return { template: name, args: Object.fromEntries(Object.entries(args).filter(([k, v]) => v && used.has(k))) };
}

function done(route: Route, trace: string[], result: QueryResult | null, extra: { plan?: string; sql?: string; summary?: string; error?: string }) {
  const r = result ?? { columns: [], rows: [], truncated: false };
  return Response.json({
    route,
    trace,
    answer: r.rows.length ? `${r.rows.length}${r.truncated ? "+" : ""}건을 찾았습니다.` : NOT_IN_GRAPH,
    summary: extra.summary ?? "",
    plan: extra.plan ?? "",
    sql: extra.sql ?? "",
    error: extra.error,
    ...r,
    links: nodeLinks(r.rows),
  });
}

const QueryPlan = z.object({ answerable: z.boolean(), sql: z.string(), summary: z.string() });

async function claude(question: string, history: Turn[] | undefined, cat: Catalog, trace: string[]) {
  trace.push("claude");
  // 이전 대화는 질문과 쿼리 요약(모델이 쓴 문장)만 넘긴다
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of (history || []).slice(-4)) {
    if (t.summary) messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.summary });
  }
  messages.push({ role: "user", content: question });

  let plan: z.infer<typeof QueryPlan>;
  try {
    const client = new Anthropic();
    const response = await client.beta.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: `${RULES}\n${SCHEMA_DOC}` },
        { type: "text", text: catalogText(cat) },
      ],
      messages,
      output_config: { format: betaZodOutputFormat(QueryPlan) },
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return done("claude", trace, null, {});
    plan = response.parsed_output;
  } catch (e) {
    const error =
      e instanceof Anthropic.AuthenticationError
        ? "LLM API 키(ANTHROPIC_API_KEY)가 설정되지 않았거나 잘못되었습니다."
        : e instanceof Anthropic.APIConnectionError
          ? "Claude API 에 연결할 수 없습니다."
          : e instanceof Anthropic.RateLimitError
            ? "LLM 요청 한도 초과. 잠시 후 다시 시도하세요."
            : e instanceof Anthropic.APIError
              ? `LLM 오류 (${e.status})`
              : `LLM 호출 실패: ${(e as Error).message.slice(0, 200)}`;
    return Response.json({ route: "claude", trace, error, answer: "지금은 답할 수 없습니다.", columns: [], rows: [], links: [] }, { status: 502 });
  }

  if (!plan.answerable || !plan.sql.trim()) return done("claude", trace, null, { summary: plan.summary });
  try {
    return done("claude", trace, await runGraphQuery(plan.sql), { summary: plan.summary, sql: plan.sql });
  } catch (e) {
    const error = e instanceof QueryRejected ? e.message : `쿼리 실행 실패: ${(e as Error).message}`;
    return done("claude", trace, null, { summary: plan.summary, sql: plan.sql, error });
  }
}
