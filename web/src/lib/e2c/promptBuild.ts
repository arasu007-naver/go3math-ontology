import { PROMPT_VERSIONS } from "./config.ts";
import type { ProblemInput, Stage } from "./types.ts";

// 프롬프트는 ① 고정 system(버전별로 바이트까지 동일) → ② 후보 options 블록(id 정렬, 같은 후보 집합이면 동일) → ③ 문제별 가변부 순서로 조립한다.
// 접두부 캐시(Claude cache_control, Gemini/xAI implicit)를 타게 하려는 순서다.
const COMMON = `당신은 한국 2022 개정 수학 교육과정 분류기입니다. 수학 기출문제와 해답을 읽고 아래 후보 목록에서만 고릅니다.
후보에 없는 id를 만들지 마세요. 수식은 backtick AsciiMath 입니다. 해답의 단계는 S1, S2 … 번호가 붙어 있고, 근거가 된 단계 번호를 evidence_steps 에 적습니다.
반드시 JSON 객체만 출력하세요(설명 문장, 코드블록 금지).`;

const SYSTEM: Record<Stage, string> = {
  unit: `${COMMON}
[작업] 문제를 푸는 데 쓰이는 단원을 used_units 에 1~3개 고르세요(관련 단원 집합). confidence 는 0~1, reason 은 300자 이내.`,
  concept: `${COMMON}
[작업] 문제의 핵심 개념 primary 1개와 보조 개념 secondary 0~3개를 고르세요. 보조에 primary 를 넣지 마세요. confidence 는 0~1, reason 은 500자 이내.`,
  grok_unit: `${COMMON}
[작업] 모델들의 의견이 갈렸습니다. 문제를 푸는 데 쓰이는 단원을 used_units 에 1~3개 고르세요. 후보는 의견에 나온 단원으로 한정됩니다. confidence 는 0~1, reason 은 300자 이내.`,
  grok_concept: `${COMMON}
[작업] 모델들의 의견이 갈렸습니다. 핵심 개념 primary 1개와 보조 개념 secondary 0~3개를 고르세요. 보조에 primary 를 넣지 마세요. confidence 는 0~1, reason 은 500자 이내.`,
};

const INSTRUCTION: Record<Stage, string> = {
  unit: "Which unit of the Korean 2022 math curriculum is needed to solve this exam problem?",
  concept: "Which concept is the main concept needed to solve this exam problem?",
  grok_unit: "Which unit of the Korean 2022 math curriculum is needed to solve this exam problem?",
  grok_concept: "Which concept is the main concept needed to solve this exam problem?",
};

export const systemFor = (stage: Stage) => SYSTEM[stage];
export const promptVersionFor = (stage: Stage) => PROMPT_VERSIONS[stage];

export type PromptOption = { id: string; text: string };
export const sortOptions = (options: PromptOption[]) => [...options].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function optionsBlock(stage: Stage, options: PromptOption[]): string {
  if (!options.length) return "";
  const title = stage === "unit" || stage === "grok_unit" ? "후보 단원" : "후보 개념";
  return `[${title}]\n${sortOptions(options).map((o) => `- ${o.id}: ${o.text}`).join("\n")}`;
}

export function problemBlock(p: ProblemInput, extra?: string): string {
  const m = p.meta;
  const meta = [m.year && `${m.year}년`, m.month && `${m.month}월`, m.exam, m.subject, m.number && `${m.number}번`, m.points && `${m.points}점`].filter(Boolean).join(" ");
  const steps = p.keySteps.map((s) => (s.id ? `${s.id}: ${s.text}` : s.text)).join("\n");
  return `[문항] ${meta}\n[문제]\n${p.problemText}\n[해답]\n${steps}${extra ? `\n\n${extra}` : ""}`;
}

export type BuiltPrompt = { system: string; optionsBlock: string; problemBlock: string; instruction: string; options: PromptOption[] };

export function buildPrompt(stage: Stage, problem: ProblemInput, options: PromptOption[], extra?: string): BuiltPrompt {
  return {
    system: SYSTEM[stage],
    optionsBlock: optionsBlock(stage, options),
    problemBlock: problemBlock(problem, extra),
    instruction: INSTRUCTION[stage],
    options: sortOptions(options),
  };
}
