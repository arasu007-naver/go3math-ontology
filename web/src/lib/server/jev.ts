import { KINDS, TEMPLATES, type Catalog, type Plan } from "./agentTemplates";

// Jev(TypeSafe System One): 생성하지 않고 noul / choice / score 로 판정만 한다. state 에는 질문(과 계획)만 넣는다.
const JEV_URL = "https://api.typesafe.ai/v1/systemone";

type NoulAnswer = { noul: number };
type ChoiceAnswer = { choice: string; confidence: number; probabilities: Record<string, number> };

async function jev<T>(state: string, questions: Record<string, unknown>): Promise<T> {
  const key = process.env.JEV_KEY;
  if (!key) throw new Error("JEV_KEY 가 설정되지 않았습니다.");
  const res = await fetch(JEV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  return (await res.json()).answers as T;
}

const names = (xs: string[]) => Object.fromEntries([...xs.map((x) => [x, null]), ["none", null]]);

export type JevRoute = {
  inScope: number;
  template: ChoiceAnswer;
  subject: ChoiceAnswer;
  category: ChoiceAnswer;
  book: ChoiceAnswer;
  kind: ChoiceAnswer;
};

// 질문 하나에 한 번 호출: 범위 판정 + 템플릿 + 인자 후보
export async function jevRoute(question: string, cat: Catalog): Promise<JevRoute> {
  const a = await jev<Record<string, NoulAnswer & ChoiceAnswer>>(`question: ${question}`, {
    in_scope: {
      type: "noul",
      instructions: "Could this question be about Korean math textbook content (math topics, definitions, formulas, problems, solutions), textbook tables of contents, or curriculum subjects/categories?",
    },
    template: {
      type: "choice",
      instructions: "Which query answers the question?",
      criteria: { ...Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.description])), none: "none of these" },
    },
    subject: { type: "choice", instructions: "Which curriculum subject does the question name?", criteria: names(cat.curriculum.map((c) => c.name)) },
    category: { type: "choice", instructions: "Which top-level math category does the question name?", criteria: names(cat.categories.map((c) => c.name)) },
    book: { type: "choice", instructions: "Which textbook does the question name?", criteria: names(cat.books.map((b) => b.title)) },
    kind: {
      type: "choice",
      instructions: "Which paragraph kind does the question ask for?",
      criteria: { ...Object.fromEntries(KINDS.map((k) => [k, null])), any: "no specific kind" },
    },
  });
  return { inScope: a.in_scope.noul, template: a.template, subject: a.subject, category: a.category, book: a.book, kind: a.kind };
}

// 로컬 LLM 이 만든 계획이 질문에 맞는지 다시 판정
export async function jevVerify(question: string, plan: Plan): Promise<number> {
  const t = TEMPLATES[plan.template];
  const args = Object.entries(plan.args)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const a = await jev<{ fits: NoulAnswer }>(`question: ${question}\nplanned query: ${t.description}\n${args}`, {
    fits: { type: "noul", instructions: "Does the planned query with these arguments answer the question?" },
  });
  return a.fits.noul;
}
