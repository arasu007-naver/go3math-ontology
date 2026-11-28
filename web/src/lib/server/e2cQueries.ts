import fs from "node:fs";
import path from "node:path";
import { preprocess } from "@/lib/e2c/preprocess";
import { writeReport, type PilotLabel } from "@/lib/e2c/report";
import type { KeyStep, ProblemMeta } from "@/lib/e2c/types";
import { countProblems, getProblems, listProblemIds } from "./e2cLegacyDb";
import { pgJobs, rowToResult } from "./e2cService";
import type { ResultRow } from "./e2cPipeline";
import { pool } from "./l2oPool";

// 검토 화면용 조회 (problems 목록, 리포트 수집). 원본 MariaDB 는 읽기만 한다.
export type ProblemFilters = { status?: string; reason?: string; source?: string; subject?: string; year?: number; page: number; pageSize: number };
export type CallSummary = {
  stage: string;
  role: string;
  adapter: string;
  model: string | null;
  ok: boolean;
  error: string | null;
  costUsd: number;
  cachedInputTokens: number;
  batch: boolean;
  answer: unknown;
};
export type ProblemRowVM = {
  id: number;
  meta: ProblemMeta;
  display: { curriculumType: string | null; difficulty: number | null; classification: string | null; originDate: string | null; answer: string | null; images: string[] };
  problemText: string;
  solutionText: string;
  keySteps: KeyStep[];
  truncated: boolean;
  skipped: boolean;
  result: ResultRow | null;
  calls: CallSummary[];
  label: PilotLabel | null;
};

export async function listProblems(f: ProblemFilters): Promise<{ total: number; items: ProblemRowVM[] }> {
  const offset = (f.page - 1) * f.pageSize;
  let pageIds: number[];
  let total: number;
  const resultFilter = !!(f.status || f.reason || f.source);
  const metaIds = f.subject || f.year ? (await listProblemIds({ subject: f.subject, year: f.year })).map((x) => x.id) : null;
  if (resultFilter) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (f.status) {
      args.push(f.status);
      where.push(`status = $${args.length}`);
    }
    if (f.reason) {
      args.push(f.reason);
      where.push(`reasons ? $${args.length}`);
    }
    if (f.source) {
      args.push(f.source);
      where.push(`(unit_decision_source = $${args.length} OR concept_decision_source = $${args.length})`);
    }
    if (metaIds) {
      args.push(metaIds);
      where.push(`problem_id = ANY($${args.length}::bigint[])`);
    }
    const t = await pool.query(`SELECT count(*)::int AS n FROM e2c.problem_result WHERE ${where.join(" AND ")}`, args);
    total = t.rows[0].n;
    const r = await pool.query(`SELECT problem_id FROM e2c.problem_result WHERE ${where.join(" AND ")} ORDER BY problem_id LIMIT ${f.pageSize} OFFSET ${offset}`, args);
    pageIds = r.rows.map((x) => Number(x.problem_id));
  } else {
    const all = metaIds ?? (await listProblemIds()).map((x) => x.id);
    total = all.length;
    pageIds = all.slice(offset, offset + f.pageSize);
  }
  if (!pageIds.length) return { total, items: [] };
  const [raws, results, calls, labels] = await Promise.all([
    getProblems(pageIds),
    pool.query(`SELECT * FROM e2c.problem_result WHERE problem_id = ANY($1::bigint[])`, [pageIds]),
    pool.query(
      `SELECT DISTINCT ON (problem_id, stage, role, adapter) problem_id, stage, role, adapter, model, ok, error, cost_usd, cached_input_tokens, batch_discount, answer
         FROM e2c.model_call WHERE problem_id = ANY($1::bigint[]) ORDER BY problem_id, stage, role, adapter, id DESC`,
      [pageIds]
    ),
    pool.query(`SELECT * FROM e2c.pilot_label WHERE problem_id = ANY($1::bigint[])`, [pageIds]),
  ]);
  const resBy = new Map(results.rows.map((x) => [Number(x.problem_id), rowToResult(x)]));
  const labBy = new Map<number, PilotLabel>(labels.rows.map((x) => [Number(x.problem_id), toLabel(x)]));
  const callBy = new Map<number, CallSummary[]>();
  for (const c of calls.rows) {
    const k = Number(c.problem_id);
    if (!callBy.has(k)) callBy.set(k, []);
    callBy.get(k)!.push({
      stage: c.stage, role: c.role, adapter: c.adapter, model: c.model, ok: c.ok, error: c.error, costUsd: Number(c.cost_usd),
      cachedInputTokens: Number(c.cached_input_tokens), batch: !!c.batch_discount, answer: c.answer,
    });
  }
  const items = raws.map((r): ProblemRowVM => {
    const p = preprocess(r);
    return {
      id: r.id,
      meta: p.meta,
      display: { curriculumType: r.curriculumType, difficulty: r.difficulty, classification: r.classification, originDate: r.originDate, answer: r.answer, images: r.images },
      problemText: p.problemText,
      solutionText: p.solutionText,
      keySteps: p.keySteps,
      truncated: p.truncated,
      skipped: p.skipped,
      result: resBy.get(r.id) ?? null,
      calls: callBy.get(r.id) ?? [],
      label: labBy.get(r.id) ?? null,
    };
  });
  return { total, items };
}

const toLabel = (x: Record<string, unknown>): PilotLabel => ({
  problemId: Number(x.problem_id),
  unitId: String(x.unit_id),
  primaryConceptId: String(x.primary_concept_id),
  secondaryConceptIds: x.secondary_concept_ids as string[],
});

// 리포트: job 의 결과·호출·라벨을 모아 reports/e2c-<kind>-<date>.md 를 만든다
export async function createReport(jobRunId: string): Promise<string> {
  const job = await pgJobs.get(jobRunId);
  if (!job) throw new Error("없는 작업입니다.");
  const [rows, calls, labels, targetCount] = await Promise.all([
    pool.query(`SELECT * FROM e2c.problem_result WHERE problem_id = ANY($1::bigint[])`, [job.ids]),
    pool.query(`SELECT * FROM e2c.model_call WHERE job_run_id = $1`, [jobRunId]),
    pool.query(`SELECT * FROM e2c.pilot_label WHERE problem_id = ANY($1::bigint[])`, [job.ids]),
    countProblems(),
  ]);
  const root = path.resolve(process.cwd(), "..");
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  const file = writeReport(root, {
    kind: job.kind,
    date: new Date().toISOString().slice(0, 10),
    jobId: job.id,
    mode: job.mode,
    targetCount,
    rows: rows.rows.map(rowToResult),
    reusedByModel: job.reusedByModel,
    labels: labels.rows.map(toLabel),
    calls: calls.rows.map((c) => ({
      problemId: Number(c.problem_id), jobRunId: c.job_run_id, stage: c.stage, role: c.role, adapter: c.adapter, model: c.model, promptVersion: c.prompt_version,
      inputHash: c.input_hash, ok: c.ok, error: c.error, answer: c.answer, raw: null, costUsd: Number(c.cost_usd), latencyMs: Number(c.latency_ms ?? 0),
      batchId: c.batch_id, batchDiscount: !!c.batch_discount,
      usage: {
        inputTokens: Number(c.input_tokens), outputTokens: Number(c.output_tokens), cachedInputTokens: Number(c.cached_input_tokens),
        cacheWriteTokens: Number(c.cache_write_tokens), costUsd: null,
      },
    })),
  });
  return path.relative(root, file);
}
