import crypto from "node:crypto";
import { decide, type Decision, type SelectorName, type Vote } from "@/lib/l2o/units";
import { getConceptsByIds } from "./legacyDb";
import { pool } from "./l2oPool";
import { writeGroupToKg, type KgWriteResult } from "./l2oKg";
import { getCandidateUnits } from "./l2oUnits";
import { PROMPT_VERSION, type SelectorInput, type UnitSelector } from "./selectors/common";
import { claudeSelector } from "./selectors/claude";
import { geminiSelector } from "./selectors/gemini";
import { jevSelector } from "./selectors/jev";

// 대표 개념 하나: 후보 축소 → 3선택기(병렬) → 판정 → selector_vote 기록 + migration_result 갱신.
// dryRun=false 이고 3/3 자동일치면 KG 에 기록하고 migrated 가 된다(검토 필요는 쓰지 않음).
export const SELECTOR_LIST: UnitSelector[] = [jevSelector, claudeSelector, geminiSelector];

// 선택기별 동시 호출 수 제한 (SELECTOR_CONCURRENCY, 기본 4)
const LIMIT = Number(process.env.SELECTOR_CONCURRENCY) || 4;
const active = new Map<SelectorName, number>();
const waiting = new Map<SelectorName, (() => void)[]>();
async function limited<T>(name: SelectorName, fn: () => Promise<T>): Promise<T> {
  if ((active.get(name) ?? 0) >= LIMIT) await new Promise<void>((r) => (waiting.get(name) ?? waiting.set(name, []).get(name)!).push(r));
  active.set(name, (active.get(name) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    active.set(name, active.get(name)! - 1);
    waiting.get(name)?.shift()?.();
  }
}

const hashOf = (s: UnitSelector, i: SelectorInput) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify({ selector: s.name, model: s.model, prompt: i.promptVersion, concept: i.concept, candidates: i.candidates }))
    .digest("hex");

export type SelectResult = {
  groupId: number;
  status: string;
  decision?: Decision; // 건너뛴 그룹은 없음
  votes: (Vote & { reused: boolean; latencyMs: number | null })[];
  candidateCount: number;
  candidateFallback: boolean;
  skipped?: string;
  kg?: KgWriteResult;
};

export async function selectForGroup(groupId: number, opts: { jobId?: string | null; dryRun: boolean; force?: boolean }): Promise<SelectResult> {
  const g = await pool.query(
    `SELECT g.representative_legacy_id AS rep, r.status AS r_status FROM l2o.dedupe_group g LEFT JOIN l2o.migration_result r ON r.group_id = g.id WHERE g.id = $1`,
    [groupId]
  );
  if (!g.rows[0]) throw new Error(`없는 그룹입니다: ${groupId}`);
  // 수동 결정·이미 KG 반영된 그룹은 다시 고르지 않는다(선택기 호출 전에 건너뜀). 단원을 바꾸려면 단원 수정(override).
  const prevStatus: string | null = g.rows[0].r_status;
  if (prevStatus === "overridden" || prevStatus === "migrated") {
    return { groupId, status: prevStatus, votes: [], candidateCount: 0, candidateFallback: false, skipped: prevStatus };
  }
  const [concept] = await getConceptsByIds([Number(g.rows[0].rep)]);
  if (!concept || !concept.isOn) throw new Error(`대표 #${g.rows[0].rep} 가 없거나 제외(is_on=0)입니다.`);

  const { candidates, fallback } = await getCandidateUnits(concept);
  const input: SelectorInput = {
    groupId,
    concept: { legacyId: concept.id, title: concept.title, statement: concept.statement, schoolType: concept.schoolType, mathField: concept.mathField },
    candidates,
    promptVersion: PROMPT_VERSION,
  };
  const candidateIds = candidates.map((c) => c.unitId);

  // 3선택기 병렬. 같은 input_hash 의 성공 표가 있으면 재사용(force 면 새로 호출). 한 선택기가 실패해도 나머지로 판정.
  const settled = await Promise.allSettled(
    SELECTOR_LIST.map(async (s) => {
      const hash = hashOf(s, input);
      if (!opts.force) {
        const prev = await pool.query(
          `SELECT selected_unit_id, confidence, latency_ms FROM l2o.selector_vote WHERE input_hash = $1 AND error IS NULL ORDER BY created_at DESC LIMIT 1`,
          [hash]
        );
        if (prev.rows[0]) {
          return { selector: s.name, unitId: prev.rows[0].selected_unit_id, confidence: prev.rows[0].confidence, reused: true, latencyMs: prev.rows[0].latency_ms };
        }
      }
      const out = await limited(s.name, () => s.select(input));
      await pool.query(
        `INSERT INTO l2o.selector_vote (job_run_id, group_id, selector, model, model_version, prompt_version, candidate_unit_ids, selected_unit_id,
                                        confidence, scores, raw_response, latency_ms, error, input_hash, candidate_fallback)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          opts.jobId ?? null, groupId, s.name, out.model, out.modelVersion ?? null, PROMPT_VERSION, candidateIds, out.selectedUnitId,
          out.confidence, out.scores ? JSON.stringify(out.scores) : null, out.raw == null ? null : JSON.stringify(out.raw), out.latencyMs,
          out.error ?? null, hash, fallback,
        ]
      );
      return { selector: s.name, unitId: out.selectedUnitId, confidence: out.confidence, error: out.error, reused: false, latencyMs: out.latencyMs };
    })
  );
  const votes = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { selector: SELECTOR_LIST[i].name, unitId: null, confidence: null, error: String(r.reason).slice(0, 300), reused: false, latencyMs: null }
  );
  const decision = decide(votes);

  await pool.query(
    `INSERT INTO l2o.migration_result (group_id, status, majority_unit_id, agree_count, final_unit_id, dry_run_only, last_job_run_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (group_id) DO UPDATE SET status = EXCLUDED.status, majority_unit_id = EXCLUDED.majority_unit_id, agree_count = EXCLUDED.agree_count,
       final_unit_id = EXCLUDED.final_unit_id, dry_run_only = EXCLUDED.dry_run_only, last_job_run_id = EXCLUDED.last_job_run_id, updated_at = now()`,
    [
      groupId, decision.status, decision.majorityUnitId, decision.agreeCount,
      decision.status === "auto_agreed" ? decision.majorityUnitId : null, opts.dryRun, opts.jobId ?? null,
    ]
  );
  if (opts.dryRun || decision.status !== "auto_agreed") {
    return { groupId, status: decision.status, decision, votes, candidateCount: candidates.length, candidateFallback: fallback };
  }
  const confs = votes.map((v) => v.confidence).filter((x): x is number => x != null);
  const kg = await writeGroupToKg({
    groupId,
    unitId: decision.majorityUnitId,
    judgedBy: "legacy2ontology:3/3",
    confidence: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 1000) / 1000 : null,
    rationale: `3/3 일치 (${votes.map((v) => `${v.selector} ${v.confidence ?? "-"}`).join(", ")}; 후보 ${candidates.length}개${fallback ? ", 확장" : ""}; ${PROMPT_VERSION})`,
    jobId: opts.jobId ?? null,
  });
  return { groupId, status: "migrated", decision, votes, candidateCount: candidates.length, candidateFallback: fallback, kg };
}
