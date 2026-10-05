import { KINDS, TEMPLATES, type Catalog, type Plan } from "./agentTemplates";

// 로컬 LLM(go3math-llm, OpenAI 호환). Jev 가 못 정한 질문을 템플릿 + 인자 + 키워드로 바꾼다. SQL 은 쓰지 않는다.
const BASE = (process.env.GO3_LLM_BASE_URL || "https://go3math-llm.qoolla.com").replace(/\/$/, "");
const MODEL = process.env.LOCAL_LLM_MODEL || "Qwen3.6-35B-A3B-bf16";

export async function localPlan(question: string, cat: Catalog): Promise<Plan> {
  // 이름 인자는 enum 으로 그래프에 있는 값만 고르게 한다 ("" = 없음)
  const en = (xs: string[]) => ({ type: "string", enum: ["", ...xs] });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["template", "subject", "category", "book", "kind", "keyword"],
    properties: {
      template: { type: "string", enum: [...Object.keys(TEMPLATES), "none"] },
      subject: en(cat.curriculum.map((c) => c.name)),
      category: en(cat.categories.map((c) => c.name)),
      book: en(cat.books.map((b) => b.title)),
      kind: en([...KINDS]),
      keyword: { type: "string" },
    },
  };
  const system = [
    "수학 교재 knowledge graph 조회기다. 사용자의 질문을 아래 템플릿 중 하나와 인자로 바꾼다. 맞는 템플릿이 없으면 template 을 none 으로 한다.",
    ...Object.entries(TEMPLATES).map(([k, t]) => `- ${k}: ${t.description} (필수: ${t.needs.join(", ")}${t.optional.length ? `, 선택: ${t.optional.join(", ")}` : ""})`),
    "인자는 질문에 나온 것만 채우고 나머지는 빈 문자열로 둔다. subject 는 과목, book 은 도서명이다. 서로 섞지 않는다.",
    "keyword 는 본문이나 TOC 제목에서 찾을 수학 주제어 하나(예: '나머지 정리'). 조사·의문사는 빼고 짧게.",
    "과목명(subject 목록)이나 문단 종류(정의·공식·성질·문제·해답)는 keyword 가 아니다. 과목에 대한 질문이면 과목 템플릿과 subject·kind 를 쓴다.",
  ].join("\n");

  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GO3_LLM_API_KEY || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: question },
      ],
      response_format: { type: "json_schema", json_schema: { name: "plan", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(60000), // 모델 첫 로드가 15초 안팎
  });
  if (!res.ok) throw new Error(`로컬 LLM HTTP ${res.status}`);
  const out = JSON.parse((await res.json()).choices[0].message.content) as Record<string, string>;
  const { template, ...rest } = out;
  return { template, args: Object.fromEntries(Object.entries(rest).filter(([, v]) => v)) };
}
