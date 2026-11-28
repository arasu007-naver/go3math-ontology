import type { ModelAdapter, ModelRequest, ModelResult } from "../e2c/adapters/types.ts";
import { pickConceptOptions, pickUnitCandidates } from "../e2c/candidates.ts";
import { PROMPT_VERSIONS, type E2cConfig } from "../e2c/config.ts";
import { computeCost } from "../e2c/cost.ts";
import { callHash } from "../e2c/hash.ts";
import { pickFinalUnit, makeReach, type PrecedenceGraph } from "../e2c/precedence.ts";
import { buildPrompt, promptVersionFor } from "../e2c/promptBuild.ts";
import { preprocess, type RawProblem } from "../e2c/preprocess.ts";
import { computeReasons } from "../e2c/review.ts";
import { Semaphore } from "../e2c/semaphore.ts";
import {
  LOCKED_STATUSES, PROPOSERS, ZERO_USAGE,
  type ConceptOption, type ConceptProposal, type DecisionSource, type ModelName, type ProblemInput, type ReasonCode, type ResultStatus, type Role, type Stage,
  type UnitOption, type UnitProposal, type Usage,
} from "../e2c/types.ts";
import { tallyConcepts, tallyUnits, type ConceptTally, type UnitTally } from "../e2c/vote.ts";

// e2c 파이프라인: 전처리 → 단원(3모델 표 → 다수결/Grok) → 개념(3모델 → 다수결/Grok) → 사유 코드. DB·모델은 모두 주입한다.

export interface KgSource {
  units(): Promise<UnitOption[]>;
  graph(): Promise<PrecedenceGraph>;
  conceptsOfUnit(unitId: string): Promise<ConceptOption[]>; // is_active 개념 (option text 포함)
}

export type StoredCall = { ok: boolean; error: string | null; answer: ModelResult["answer"] | null; modelVersion?: string };
export type NewCall = {
  problemId: number; jobRunId: string | null; stage: Stage; role: Role; adapter: ModelName; model: string; promptVersion: string; inputHash: string;
  ok: boolean; error: string | null; answer: unknown; raw: unknown; usage: Usage; costUsd: number; latencyMs: number; batchId: string | null; batchDiscount: boolean;
};
export type ResultRow = {
  problemId: number;
  inputHash: string;
  status: ResultStatus;
  finalUnitId: string | null;
  unitSource: DecisionSource | null;
  unitRule: string | null;
  primaryConceptId: string | null;
  secondaryConceptIds: string[];
  conceptSource: DecisionSource | null;
  reasons: ReasonCode[];
  truncated: boolean;
  candidateFallback: boolean;
  unitDetail: unknown;
  conceptDetail: unknown;
  error: string | null;
  rerunConcept: boolean;
  jobRunId: string | null;
};
export interface PipelineStore {
  findCall(hash: string): Promise<StoredCall | null>; // 같은 input_hash 의 성공 호출
  insertCall(c: NewCall): Promise<void>; // 추가만
  getResult(problemId: number): Promise<ResultRow | null>;
  saveResult(r: ResultRow): Promise<"saved" | "locked">; // overridden/confirmed/applied 행은 바꾸지 않는다
}

export type PipelineDeps = {
  store: PipelineStore;
  kg: KgSource;
  adapters: Record<ModelName, ModelAdapter>;
  embed: (texts: string[]) => Promise<number[][]>;
  config: E2cConfig;
  concurrency?: Partial<Record<ModelName, number>>;
};
export type CallEvent = { problemId: number; stage: Stage; role: Role; model: ModelName; result: ModelResult; reused: boolean; costUsd: number };
export type RunCtx = { jobRunId: string | null; shadowGrok: boolean; onCall?: (e: CallEvent) => void };

export type CallSpec = { problem: ProblemInput; stage: Stage; role: Role; adapter: ModelAdapter; req: ModelRequest; context?: string };
export type Caller = (s: CallSpec) => Promise<{ result: ModelResult; reused: boolean }>;

const callKey = (s: CallSpec) =>
  callHash({ inputHash: s.problem.inputHash, stage: s.stage, role: s.role, options: s.req.options, promptVersion: s.req.promptVersion, model: `${s.adapter.name}:${s.adapter.model}`, context: s.context });

const fromStored = (c: StoredCall, s: CallSpec): ModelResult => ({
  ok: true, answer: c.answer ?? undefined, raw: null, usage: ZERO_USAGE, latencyMs: 0, model: s.adapter.model, modelVersion: c.modelVersion,
});

export async function recordCall(deps: PipelineDeps, ctx: RunCtx, s: CallSpec, result: ModelResult, batch?: { batchId: string }): Promise<number> {
  const costUsd = computeCost(s.adapter.name, result.usage, deps.config.pricing, !!batch);
  if (result.error !== "not_configured")
    await deps.store.insertCall({
      problemId: s.problem.id, jobRunId: ctx.jobRunId, stage: s.stage, role: s.role, adapter: s.adapter.name, model: s.adapter.model,
      promptVersion: s.req.promptVersion, inputHash: callKey(s), ok: result.ok, error: result.error ?? null, answer: result.answer ?? null, raw: result.raw,
      usage: result.usage, costUsd, latencyMs: result.latencyMs, batchId: batch?.batchId ?? null, batchDiscount: !!batch,
    });
  ctx.onCall?.({ problemId: s.problem.id, stage: s.stage, role: s.role, model: s.adapter.name, result, reused: false, costUsd });
  return costUsd;
}

// 실제 호출: 같은 입력의 성공 호출이 있으면 재사용(재호출 0), 아니면 모델별 세마포어 안에서 호출하고 기록한다.
export function makeCaller(deps: PipelineDeps, ctx: RunCtx): Caller {
  const sems = new Map<ModelName, Semaphore>();
  const sem = (n: ModelName) => sems.get(n) ?? sems.set(n, new Semaphore(deps.concurrency?.[n] ?? 4)).get(n)!;
  return async (s) => {
    const hit = await deps.store.findCall(callKey(s));
    if (hit) {
      const result = fromStored(hit, s);
      ctx.onCall?.({ problemId: s.problem.id, stage: s.stage, role: s.role, model: s.adapter.name, result, reused: true, costUsd: 0 });
      return { result, reused: true };
    }
    const result = await sem(s.adapter.name).run(() => s.adapter.call(s.req));
    await recordCall(deps, ctx, s, result);
    return { result, reused: false };
  };
}

// 계획용: 캐시에 있는 것만 돌려주고, 없는 호출은 pending 에 모은다(batch 웨이브가 제출 대상을 정할 때 쓴다).
export function makePlanCaller(deps: PipelineDeps, pending: CallSpec[]): Caller {
  return async (s) => {
    const hit = await deps.store.findCall(callKey(s));
    if (hit) return { result: fromStored(hit, s), reused: true };
    pending.push(s);
    return { result: { ok: false, error: "pending", raw: null, usage: ZERO_USAGE, latencyMs: 0, model: s.adapter.model }, reused: false };
  };
}

// ---------- 단원 단계 ----------
export type UnitStageState = {
  options: UnitOption[];
  fallback: boolean;
  proposals: UnitProposal[];
  tally: UnitTally | null;
  grok: { ok: boolean; error?: string; unitIds: string[]; picked: string | null; rule?: string; confidence: number | null; evidenceSteps: string[]; scope: string[] } | null;
  shadow: unknown;
  finalUnitId: string | null;
  source: DecisionSource | null;
  rule: string | null;
  tie: boolean;
  confidence: number | null;
  outOfCandidates: boolean;
  error: string | null;
};

const textOf = (o: { id: string; text: string }[]) => o;
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

function req(stage: Stage, role: Role, problem: ProblemInput, options: { id: string; text: string }[], maxSecondary: number, extra?: string): ModelRequest {
  return { ...buildPrompt(stage, problem, textOf(options), extra), stage, role, promptVersion: promptVersionFor(stage), maxSecondary };
}

const unitSummary = (ps: UnitProposal[]) =>
  `[모델별 의견]\n${ps.map((p) => `- ${p.model}: ${p.ok ? `${p.unitIds.join(", ")} (확신도 ${p.confidence ?? "-"})` : `실패(${p.error})`}`).join("\n")}`;

export async function unitStage(problem: ProblemInput, deps: PipelineDeps, ctx: RunCtx, caller: Caller, phase: "propose" | "all" = "all"): Promise<UnitStageState> {
  const st: UnitStageState = { options: [], fallback: false, proposals: [], tally: null, grok: null, shadow: null, finalUnitId: null, source: null, rule: null, tie: false, confidence: null, outOfCandidates: false, error: null };
  const [all, graph] = await Promise.all([deps.kg.units(), deps.kg.graph()]);
  const cand = await pickUnitCandidates(problem, all, deps.config, deps.embed);
  st.options = cand.candidates;
  st.fallback = cand.fallback;
  if (!cand.candidates.length) return { ...st, error: "no_unit_candidates" };
  const opts = cand.candidates.map((u) => ({ id: u.unitId, text: u.text }));
  const reach = makeReach(graph);

  st.proposals = await Promise.all(
    PROPOSERS.map(async (name): Promise<UnitProposal> => {
      const adapter = deps.adapters[name];
      const { result } = await caller({ problem, stage: "unit", role: "proposer", adapter, req: req("unit", "proposer", problem, opts, deps.config.max_secondary) });
      if (!result.ok || result.answer?.kind !== "unit") return { model: name, ok: false, error: result.error ?? "no_answer", unitIds: [], confidence: null, evidenceSteps: [] };
      const pick = pickFinalUnit(result.answer.unitIds, graph, reach);
      const base = { model: name, unitIds: result.answer.unitIds, probs: result.answer.probs, confidence: result.answer.confidence, evidenceSteps: result.answer.evidenceSteps };
      if (pick.error) return { ...base, ok: false, error: pick.error };
      return { ...base, ok: true, picked: pick.unitId, rule: pick.rule };
    })
  );
  if (phase === "propose") return st;

  const tally = tallyUnits(st.proposals.map((p) => ({ model: p.model, ok: p.ok, unitId: p.picked ?? null })));
  st.tally = tally;
  const okProps = st.proposals.filter((p) => p.ok);
  const union = [...new Set(okProps.flatMap((p) => p.unitIds))];
  const grokScope = (okProps.length <= 1 ? opts : opts.filter((o) => union.includes(o.id)));

  const callGrok = async (role: Role) => {
    const adapter = deps.adapters.grok;
    const extra = unitSummary(st.proposals);
    const { result } = await caller({ problem, stage: "grok_unit", role, adapter, req: req("grok_unit", role, problem, grokScope, deps.config.max_secondary, extra), context: extra });
    if (!result.ok || result.answer?.kind !== "unit")
      return { ok: false, error: result.error ?? "no_answer", unitIds: [], picked: null, confidence: null, evidenceSteps: [], scope: grokScope.map((o) => o.id) };
    const pick = pickFinalUnit(result.answer.unitIds, graph, reach);
    return {
      ok: !pick.error, error: pick.error, unitIds: result.answer.unitIds, picked: pick.unitId, rule: pick.rule, confidence: result.answer.confidence,
      evidenceSteps: result.answer.evidenceSteps, scope: grokScope.map((o) => o.id),
    };
  };

  if (tally.status === "error") return { ...st, error: "all_models_failed" };
  if (tally.status === "decided") {
    st.finalUnitId = tally.unitId;
    st.source = "majority";
    const sup = okProps.filter((p) => p.picked === tally.unitId);
    st.rule = sup.some((p) => p.rule === "curriculum_order") ? "curriculum_order" : "precedence";
    st.tie = sup.some((p) => p.rule === "curriculum_order");
    st.confidence = avg(sup.map((p) => p.confidence));
    if (ctx.shadowGrok && grokScope.length) st.shadow = await callGrok("shadow_judge"); // 저장만 하고 결정에는 쓰지 않는다
    return st;
  }
  // Grok 이 정한다
  const g = await callGrok("judge");
  st.grok = g;
  if (!g.ok && g.error === "out_of_candidates") return { ...st, outOfCandidates: true };
  if (!g.ok || !g.picked) return { ...st, error: `grok_failed:${g.error ?? "no_pick"}` };
  st.finalUnitId = g.picked;
  st.source = "grok";
  st.rule = g.rule ?? null;
  st.confidence = g.confidence;
  return st;
}

// ---------- 개념 단계 ----------
export type ConceptStageState = {
  options: ConceptOption[];
  proposals: ConceptProposal[];
  tally: ConceptTally | null;
  grok: { ok: boolean; error?: string; primary: string | null; secondary: string[]; confidence: number | null; evidenceSteps: string[]; scope: string[] } | null;
  shadow: unknown;
  primary: string | null;
  secondary: string[];
  source: DecisionSource | null;
  confidence: number | null;
  outOfCandidates: boolean;
  error: string | null;
};

const conceptSummary = (ps: ConceptProposal[]) =>
  `[모델별 의견]\n${ps.map((p) => `- ${p.model}: ${p.ok ? `주 ${p.primary}${p.secondary.length ? `, 보조 ${p.secondary.join(", ")}` : ""} (확신도 ${p.confidence ?? "-"})` : `실패(${p.error})`}`).join("\n")}`;

export async function conceptStage(problem: ProblemInput, unitId: string, deps: PipelineDeps, ctx: RunCtx, caller: Caller, phase: "propose" | "all" = "all"): Promise<ConceptStageState> {
  const st: ConceptStageState = { options: [], proposals: [], tally: null, grok: null, shadow: null, primary: null, secondary: [], source: null, confidence: null, outOfCandidates: false, error: null };
  const all = await deps.kg.conceptsOfUnit(unitId);
  st.options = await pickConceptOptions(problem, all, deps.config.max_concept_options, deps.embed);
  if (!st.options.length) return { ...st, error: "no_concepts_in_unit" };
  const opts = st.options.map((c) => ({ id: c.conceptId, text: c.text }));
  st.proposals = await Promise.all(
    PROPOSERS.map(async (name): Promise<ConceptProposal> => {
      const { result } = await caller({ problem, stage: "concept", role: "proposer", adapter: deps.adapters[name], req: req("concept", "proposer", problem, opts, deps.config.max_secondary) });
      if (!result.ok || result.answer?.kind !== "concept") return { model: name, ok: false, error: result.error ?? "no_answer", primary: null, secondary: [], confidence: null, evidenceSteps: [] };
      const a = result.answer;
      return { model: name, ok: true, primary: a.primary, secondary: a.secondary, probs: a.probs, confidence: a.confidence, evidenceSteps: a.evidenceSteps };
    })
  );
  if (phase === "propose") return st;
  const tally = tallyConcepts(st.proposals, deps.config.max_secondary);
  st.tally = tally;
  const okProps = st.proposals.filter((p) => p.ok);
  const scope = okProps.length <= 1 ? opts : opts.filter((o) => (tally.status === "needs_grok" ? tally.union : []).includes(o.id));

  const callGrok = async (role: Role) => {
    const extra = conceptSummary(st.proposals);
    const { result } = await caller({ problem, stage: "grok_concept", role, adapter: deps.adapters.grok, req: req("grok_concept", role, problem, scope, deps.config.max_secondary, extra), context: extra });
    if (!result.ok || result.answer?.kind !== "concept") return { ok: false, error: result.error ?? "no_answer", primary: null, secondary: [], confidence: null, evidenceSteps: [], scope: scope.map((o) => o.id) };
    const a = result.answer;
    return { ok: true, primary: a.primary, secondary: a.secondary, confidence: a.confidence, evidenceSteps: a.evidenceSteps, scope: scope.map((o) => o.id) };
  };

  if (tally.status === "error") return { ...st, error: "all_models_failed" };
  if (tally.status === "decided") {
    st.primary = tally.primary;
    st.secondary = tally.secondary;
    st.source = "majority";
    st.confidence = avg(okProps.filter((p) => p.primary === tally.primary).map((p) => p.confidence));
    if (ctx.shadowGrok) {
      const unionIds = new Set(okProps.flatMap((p) => [p.primary!, ...p.secondary]));
      const sc = opts.filter((o) => unionIds.has(o.id));
      if (sc.length) {
        const extra = conceptSummary(st.proposals);
        const { result } = await caller({ problem, stage: "grok_concept", role: "shadow_judge", adapter: deps.adapters.grok, req: req("grok_concept", "shadow_judge", problem, sc, deps.config.max_secondary, extra), context: extra });
        st.shadow = result.ok ? result.answer : { error: result.error };
      }
    }
    return st;
  }
  const g = await callGrok("judge");
  st.grok = g;
  if (!g.ok && g.error === "out_of_candidates") return { ...st, outOfCandidates: true };
  if (!g.ok || !g.primary) return { ...st, error: `grok_failed:${g.error ?? "no_pick"}` };
  st.primary = g.primary;
  st.secondary = g.secondary;
  st.source = "grok";
  st.confidence = g.confidence;
  return st;
}

// ---------- 문제 하나 ----------
export function toRaw(r: RawProblem): ProblemInput {
  return preprocess(r);
}

const emptyRow = (p: ProblemInput, ctx: RunCtx): ResultRow => ({
  problemId: p.id, inputHash: p.inputHash, status: "error", finalUnitId: null, unitSource: null, unitRule: null, primaryConceptId: null, secondaryConceptIds: [],
  conceptSource: null, reasons: [], truncated: p.truncated, candidateFallback: false, unitDetail: null, conceptDetail: null, error: null, rerunConcept: false, jobRunId: ctx.jobRunId,
});

export async function processProblem(problem: ProblemInput, deps: PipelineDeps, ctx: RunCtx, caller: Caller = makeCaller(deps, ctx)): Promise<ResultRow> {
  const prev = await deps.store.getResult(problem.id);
  if (prev && LOCKED_STATUSES.includes(prev.status)) return prev; // 수동 수정·확인·반영된 행은 어떤 재실행도 바꾸지 않는다(모델 호출도 없음)
  const row = emptyRow(problem, ctx);
  if (problem.skipped) {
    row.status = "skipped_no_text";
  } else {
    try {
      const u = await unitStage(problem, deps, ctx, caller);
      row.candidateFallback = u.fallback;
      row.unitDetail = { options: u.options.map((o) => o.unitId), proposals: u.proposals, tally: u.tally, grok: u.grok, shadow: u.shadow };
      row.unitSource = u.source;
      row.unitRule = u.rule;
      row.finalUnitId = u.finalUnitId;
      let c: ConceptStageState | null = null;
      if (u.finalUnitId) {
        c = await conceptStage(problem, u.finalUnitId, deps, ctx, caller);
        row.conceptDetail = { options: c.options.map((o) => o.conceptId), proposals: c.proposals, tally: c.tally, grok: c.grok, shadow: c.shadow };
        row.primaryConceptId = c.primary;
        row.secondaryConceptIds = c.secondary;
        row.conceptSource = c.source;
        // 저장 전 검증: 주·보조 개념이 모두 채택 단원 소속이어야 한다
        const ids = new Set((await deps.kg.conceptsOfUnit(u.finalUnitId)).map((x) => x.conceptId));
        if (c.primary && ![c.primary, ...c.secondary].every((x) => ids.has(x)) ) {
          row.primaryConceptId = null;
          row.secondaryConceptIds = [];
          c.error = "concept_outside_unit";
        }
      }
      const err = u.error ?? c?.error ?? null;
      const outOf = u.outOfCandidates || !!c?.outOfCandidates;
      if (err || (!u.finalUnitId && !outOf)) {
        row.status = "error";
        row.error = err ?? "unit_undecided";
      } else {
        const { reasons, status } = computeReasons(
          {
            unitSource: u.source === "grok" ? "grok" : u.source ? "majority" : null,
            conceptSource: c?.source === "grok" ? "grok" : c?.source ? "majority" : null,
            unitFlags: u.tally?.flags ?? [],
            conceptFlags: c?.tally?.flags ?? [],
            unitTie: u.tie,
            unitConf: u.confidence,
            conceptConf: c?.confidence ?? null,
            hintConflict: false,
            outOfCandidates: outOf,
            truncated: problem.truncated,
            candidateFallback: u.fallback,
          },
          deps.config
        );
        row.reasons = reasons;
        row.status = outOf ? "needs_review" : status;
      }
    } catch (e) {
      row.status = "error";
      row.error = e instanceof Error ? e.message : String(e);
    }
  }
  await deps.store.saveResult(row);
  return row;
}
