// 테스트 전용 대체물: 메모리 저장소, 가짜 KG, 스크립트 어댑터 (DB·모델 없이 파이프라인을 돌린다)
import { DEFAULT_CONFIG } from "./config.ts";
import { preprocess, type RawProblem } from "./preprocess.ts";
import { ZERO_USAGE, type ConceptOption, type ModelName, type UnitOption } from "./types.ts";
import type { Answer, ModelAdapter, ModelRequest, ModelResult } from "./adapters/types.ts";
import type { KgSource, NewCall, PipelineDeps, PipelineStore, ResultRow, StoredCall } from "../server/e2cPipeline.ts";
import type { PrecedenceGraph } from "./precedence.ts";

export class MemStore implements PipelineStore {
  calls: NewCall[] = [];
  results = new Map<number, ResultRow>();
  async findCall(hash: string): Promise<StoredCall | null> {
    const c = this.calls.find((x) => x.inputHash === hash && x.ok);
    return c ? { ok: true, error: null, answer: c.answer as StoredCall["answer"] } : null;
  }
  async insertCall(c: NewCall) {
    this.calls.push(c);
  }
  async getResult(id: number) {
    return this.results.get(id) ?? null;
  }
  async saveResult(r: ResultRow) {
    const prev = this.results.get(r.problemId);
    if (prev && ["overridden", "confirmed", "applied"].includes(prev.status)) return "locked" as const;
    this.results.set(r.problemId, r);
    return "saved" as const;
  }
}

const sub = (id: string, name: string) => ({ id: `L3-HIGH-${id}`, name });
export const SUBJECTS = [sub("ALG", "대수"), sub("CAL1", "미적분Ⅰ")];
const mkUnits = (): UnitOption[] => {
  const out: UnitOption[] = [];
  for (const [prefix, s] of [["L4-HALG", SUBJECTS[0]], ["L4-HCAL1", SUBJECTS[1]]] as const)
    for (let i = 1; i <= 3; i++) out.push({ unitId: `${prefix}-0${i}`, subjectId: s.id, subjectName: s.name, name: `단원${i}`, order: i, text: `${s.name} > 단원${i}` });
  return out;
};
export const UNITS = mkUnits();
export const conceptsOf = (unitId: string): ConceptOption[] => Array.from({ length: 5 }, (_, i) => ({ conceptId: `${unitId}#${i + 1}`, unitId, text: `개념 ${unitId} ${i + 1}` }));

export function fakeKg(): KgSource {
  const graph: PrecedenceGraph = {
    unitPrereq: [],
    subjectPrereq: [[SUBJECTS[0].id, SUBJECTS[1].id]],
    unitSubject: Object.fromEntries(UNITS.map((u) => [u.unitId, u.subjectId])),
    subjectOrder: { [SUBJECTS[0].id]: 0, [SUBJECTS[1].id]: 1 },
    unitOrder: Object.fromEntries(UNITS.map((u) => [u.unitId, u.order])),
  };
  return { units: async () => UNITS, graph: async () => graph, conceptsOfUnit: async (u) => conceptsOf(u) };
}

export type Script = (req: ModelRequest, n: number) => { unit?: string[]; primary?: string; secondary?: string[]; error?: string; confidence?: number };
export function scripted(name: ModelName, script: Script): ModelAdapter & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    name,
    model: `${name}-test`,
    calls,
    async call(req): Promise<ModelResult> {
      calls.push(req);
      const s = script(req, calls.length);
      if (s.error) return { ok: false, error: s.error, raw: null, usage: ZERO_USAGE, latencyMs: 1, model: `${name}-test` };
      const confidence = s.confidence ?? 0.9;
      const ids = req.options.map((o) => o.id);
      const answer: Answer =
        req.stage === "unit" || req.stage === "grok_unit"
          ? { kind: "unit", unitIds: s.unit ?? [ids[0]], confidence, evidenceSteps: ["S1"] }
          : { kind: "concept", primary: s.primary ?? ids[0], secondary: s.secondary ?? [], confidence, evidenceSteps: [] };
      return { ok: true, answer, raw: { stub: true }, usage: { inputTokens: 1000, outputTokens: 50, cachedInputTokens: 0, cacheWriteTokens: 0, costUsd: name === "grok" ? 0.01 : null }, latencyMs: 1, model: `${name}-test` };
    },
  };
}

export const rawProblem = (id: number, over: Partial<RawProblem> = {}): RawProblem => ({
  id, statement: `<p>문제 ${id}: 함수 \`f(x)=x^${id}\` 의 값을 구하시오. 충분히 길게 쓴다.</p>`, note: `\`f(2)=4\` 이다. 따라서 답은 ${id} 이다.`,
  year: 2022, month: 11, subscriber: "평가원", subject: "COMMON", number: id, points: 3, ...over,
});
export const problemOf = (id: number, over: Partial<RawProblem> = {}) => preprocess(rawProblem(id, over));

export function makeDeps(adapters: Record<ModelName, ModelAdapter>, store = new MemStore(), embedCalls = { n: 0 }): PipelineDeps & { store: MemStore; embedCalls: { n: number } } {
  return {
    store, kg: fakeKg(), adapters, config: { ...DEFAULT_CONFIG, max_unit_candidates: 15 }, embedCalls,
    embed: async (texts) => {
      embedCalls.n++;
      return texts.map((t, i) => [t.length, i, 1]);
    },
  };
}

import type { JobKind, JobRow, JobScope, JobStore } from "../server/e2cJobs.ts";
export class MemJobStore implements JobStore {
  jobs = new Map<string, JobRow>();
  n = 0;
  order: number[];
  cachedCalls: number;
  constructor(order: number[] = [], cachedCalls = 0) {
    this.order = order;
    this.cachedCalls = cachedCalls;
  }
  async get(id: string) {
    return this.jobs.get(id) ?? null;
  }
  async patch(id: string, patch: Partial<JobRow>) {
    this.jobs.set(id, { ...this.jobs.get(id)!, ...patch });
  }
  async create(row: Omit<JobRow, "id">) {
    const j = { ...row, id: `job${++this.n}` } as JobRow;
    this.jobs.set(j.id, j);
    return j;
  }
  async findBusy() {
    return [...this.jobs.values()].find((j) => j.status === "running") ?? null;
  }
  async resolveScope(_k: JobKind, s: JobScope) {
    return "ids" in s ? s.ids : this.order;
  }
  async estimateInputs() {
    return { cachedCalls: this.cachedCalls, avgChars: 1500 };
  }
}
