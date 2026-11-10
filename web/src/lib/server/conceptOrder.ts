import Anthropic from "@anthropic-ai/sdk";
import { compareEdges, dropCycles, parseEdges, toEdge, type Dispute, type Edge, type Verdict } from "@/lib/conceptOrder";
import { stripHtml } from "./legacyDb";
import { pool } from "./l2oPool";
import { unitPaths } from "./l2oUnits";
import { postJson, withRetry } from "./selectors/common";

// 개념 정렬(/utilities): 단원 안 개념 사이의 직접 선후관계를 Gemini·Claude 로 뽑아, 같으면 확정하고 다르면 JEV 가 둘 중 하나를 고른다.
// 결과는 kg.concept_prerequisites (src = 먼저 배우는 개념) 에 judged_by 'concept-order:agree' / 'concept-order:jev' 로 저장한다.

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-4-argon";
const JEV_URL = process.env.JEV_API_URL || "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 120000;
const STATEMENT_MAX = 1500;
const JEV_CONCURRENCY = 4;

const SYSTEM_PROMPT = `당신은 한국 2022 개정 수학 교육과정 전문가입니다. 한 단원에 속한 개념 목록을 보고 개념 사이의 직접적인 선후관계(선수 학습 관계)를 추출하세요.
- "before 를 먼저 배워야 after 를 배울 수 있다"가 분명한 관계만 넣으세요.
- 다른 개념을 거쳐 이어지는 간접 관계는 넣지 마세요(A→B, B→C 가 있으면 A→C 는 제외).
- 순환이 생기면 안 됩니다. 번호는 목록에 있는 번호만 쓰세요.
반드시 아래 JSON만 출력하세요(설명 문장, 코드블록 금지):
{"edges":[{"before":<번호>,"after":<번호>}]}
선후관계가 없으면 {"edges":[]}`;

type Concept = { id: number; title: string; statement: string };

export async function listOrderUnits(): Promise<{ unitId: string; path: string; concepts: number }[]> {
  const [r, paths] = await Promise.all([
    pool.query(
      `SELECT unit_id, count(*)::int AS n FROM kg.concept_unit_edges WHERE is_active AND is_primary GROUP BY unit_id HAVING count(*) >= 2 ORDER BY unit_id`
    ),
    unitPaths(),
  ]);
  return r.rows.map((x) => ({ unitId: x.unit_id, path: paths.get(x.unit_id) ?? x.unit_id, concepts: x.n }));
}

async function askClaude(user: string): Promise<string> {
  const client = new Anthropic({ maxRetries: 3, timeout: TIMEOUT_MS });
  const res = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: { before: { type: "integer" }, after: { type: "integer" } },
                required: ["before", "after"],
                additionalProperties: false,
              },
            },
          },
          required: ["edges"],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: user }],
  });
  return res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

async function askGemini(user: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다.");
  const res = (await withRetry(() =>
    postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              edges: {
                type: "ARRAY",
                items: { type: "OBJECT", properties: { before: { type: "INTEGER" }, after: { type: "INTEGER" } }, required: ["before", "after"] },
              },
            },
            required: ["edges"],
          },
        },
      },
      TIMEOUT_MS
    )
  )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

// 분쟁 쌍 하나: 두 모델의 답을 선택지로 주고 JEV 가 고른다. 실패하면 null(미정).
async function askJev(unitPath: string, a: Concept, b: Concept, d: Dispute): Promise<Verdict | null> {
  const key = process.env.JEV_API_KEY || process.env.JEV_KEY;
  if (!key) return null;
  const text: Record<Verdict, string> = {
    ab: "Concept A must be learned before concept B (A is a direct prerequisite of B).",
    ba: "Concept B must be learned before concept A (B is a direct prerequisite of A).",
    none: "Neither concept is a direct prerequisite of the other.",
  };
  try {
    const raw = (await withRetry(() =>
      postJson(JEV_URL, { Authorization: `Bearer ${key}` }, {
        model: "jev-latest",
        state: `Two concepts in the same unit of the Korean 2022 math curriculum (math is AsciiMath in backticks)\nunit: ${unitPath}\n\nconcept A\ntitle: ${a.title}\nstatement: ${a.statement}\n\nconcept B\ntitle: ${b.title}\nstatement: ${b.statement}`,
        questions: {
          order: {
            type: "choice",
            instructions: "What is the direct learning-order (prerequisite) relation between concept A and concept B?",
            criteria: { [d.gemini]: text[d.gemini], [d.claude]: text[d.claude] },
          },
        },
      })
    )) as { answers?: { order?: { choice?: string } } };
    const choice = raw.answers?.order?.choice;
    return choice === d.gemini || choice === d.claude ? choice : null;
  } catch {
    return null;
  }
}

export type OrderResult = {
  unitId: string;
  concepts: number;
  agreed: number; // 두 모델이 같은 관계 (저장)
  disputes: number; // 두 모델이 다른 쌍
  jevEdges: number; // JEV 가 관계 있음으로 정한 쌍 (저장)
  jevNone: number; // JEV 가 관계 없음으로 정한 쌍
  undecided: number; // JEV 실패로 미정
  cyclesDropped: number; // 순환을 만들어 뺀 관계
  saved: number;
};

export async function orderUnit(unitId: string): Promise<OrderResult> {
  const r = await pool.query(
    `SELECT c.id, c.title, c.statement FROM kg.concept_unit_edges e JOIN kg.math_concepts c ON c.id = e.concept_id
      WHERE e.unit_id = $1 AND e.is_active AND e.is_primary ORDER BY c.id`,
    [unitId]
  );
  const concepts: Concept[] = r.rows.map((x) => ({
    id: Number(x.id),
    title: stripHtml(x.title),
    statement: stripHtml(x.statement).slice(0, STATEMENT_MAX),
  }));
  if (concepts.length < 2) throw new Error(`개념이 2개 미만인 단원입니다: ${unitId}`);
  const unitPath = (await unitPaths()).get(unitId) ?? unitId;

  // 프롬프트에는 1..n 번호를 쓰고 개념 id 로 되돌린다
  const nums = concepts.map((_, i) => i + 1);
  const user = `[단원] ${unitPath}\n\n[개념 목록] (수식은 backtick AsciiMath)\n${concepts
    .map((c, i) => `${i + 1}. ${c.title}\n   ${c.statement.replace(/\s+/g, " ")}`)
    .join("\n")}`;
  const ask = async (name: string, fn: (u: string) => Promise<string>): Promise<Edge[]> => {
    for (let attempt = 0; ; attempt++) {
      const edges = parseEdges(await fn(user), nums);
      if (edges) return edges;
      if (attempt) throw new Error(`${name} 응답이 올바른 JSON 이 아닙니다.`); // 깨진 JSON 은 한 번 다시 요청
    }
  };
  const [gemini, claude] = await Promise.all([ask("Gemini", askGemini), ask("Claude", askClaude)]);
  const { agreed, disputes } = compareEdges(gemini, claude);

  const decided: (Verdict | null)[] = new Array(disputes.length).fill(null);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(JEV_CONCURRENCY, disputes.length) }, async () => {
      while (cursor < disputes.length) {
        const i = cursor++;
        const d = disputes[i];
        decided[i] = await askJev(unitPath, concepts[d.a - 1], concepts[d.b - 1], d);
      }
    })
  );
  const jevEdges = disputes.flatMap((d, i) => {
    const e = decided[i] ? toEdge(d.a, d.b, decided[i]!) : null;
    return e ? [e] : [];
  });

  // 확정 관계를 먼저 넣고, JEV 결정 관계 중 순환을 만드는 것은 뺀다
  const { kept, dropped } = dropCycles([...agreed, ...jevEdges]);
  const agreedSet = new Set(agreed);
  const ids = concepts.map((c) => c.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM kg.concept_prerequisites WHERE judged_by LIKE 'concept-order:%' AND src_concept_id = ANY($1::bigint[]) AND dst_concept_id = ANY($1::bigint[])`,
      [ids]
    );
    for (const e of kept) {
      await client.query(
        `INSERT INTO kg.concept_prerequisites (src_concept_id, dst_concept_id, judged_by) VALUES ($1, $2, $3)
         ON CONFLICT (src_concept_id, dst_concept_id) DO UPDATE SET judged_by = EXCLUDED.judged_by`,
        [ids[e[0] - 1], ids[e[1] - 1], agreedSet.has(e) ? "concept-order:agree" : "concept-order:jev"]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return {
    unitId,
    concepts: concepts.length,
    agreed: agreed.length,
    disputes: disputes.length,
    jevEdges: jevEdges.length,
    jevNone: decided.filter((v) => v === "none").length,
    undecided: decided.filter((v) => v === null).length,
    cyclesDropped: dropped.length,
    saved: kept.length,
  };
}
