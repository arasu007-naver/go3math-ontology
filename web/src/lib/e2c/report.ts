import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG, type Pricing } from "./config.ts";
import { savedCost } from "./cost.ts";
import type { NewCall, ResultRow } from "../server/e2cPipeline.ts";
import type { ModelName } from "./types.ts";

// 리포트 (reports/e2c-<kind>-<date>.md): 대상·상태·사유·결정 경로·모델별 호출/비용·캐시/Batch 절감, 파일럿이면 라벨 기준 지표(§17)
export type PilotLabel = { problemId: number; unitId: string; primaryConceptId: string; secondaryConceptIds: string[] };
export type ReportData = {
  kind: string;
  date: string; // YYYY-MM-DD
  jobId?: string;
  mode?: string;
  targetCount: number; // 대상 필터(MATH, is_on=1) 건수
  rows: ResultRow[];
  calls: NewCall[];
  reusedByModel?: Record<string, number>;
  labels?: PilotLabel[];
  pricing?: Record<string, Pricing>;
};

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const usd = (n: number) => `$${n.toFixed(4)}`;
const count = <T,>(xs: T[], key: (x: T) => string | null | undefined) => {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};
const table = (head: string[], rows: (string | number)[][]) =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

type Detail = { proposals?: { model: ModelName; picked?: string | null; primary?: string | null; ok: boolean }[]; shadow?: { picked?: string | null; primary?: string | null } | null };

export function pilotMetrics(rows: ResultRow[], labels: PilotLabel[]) {
  const byId = new Map(rows.map((r) => [r.problemId, r]));
  const L = labels.filter((l) => byId.has(l.problemId));
  const unitOk = (r: ResultRow, l: PilotLabel) => r.finalUnitId === l.unitId;
  const hit = L.filter((l) => unitOk(byId.get(l.problemId)!, l));
  const conceptHit = L.filter((l) => byId.get(l.problemId)!.primaryConceptId === l.primaryConceptId);
  let tp = 0, proposed = 0, truth = 0;
  for (const l of L) {
    const r = byId.get(l.problemId)!;
    tp += r.secondaryConceptIds.filter((c) => l.secondaryConceptIds.includes(c)).length;
    proposed += r.secondaryConceptIds.length;
    truth += l.secondaryConceptIds.length;
  }
  const modelUnit = (["jev", "claude", "gemini"] as ModelName[]).map((m) => {
    const v = L.flatMap((l) => {
      const p = ((byId.get(l.problemId)!.unitDetail as Detail | null)?.proposals ?? []).find((x) => x.model === m && x.ok);
      return p ? [p.picked === l.unitId] : [];
    });
    return [m, v.length, v.filter(Boolean).length] as const;
  });
  const shadow = L.flatMap((l) => {
    const r = byId.get(l.problemId)!;
    const s = (r.unitDetail as Detail | null)?.shadow;
    return r.unitSource === "majority" && s?.picked ? [s.picked === r.finalUnitId] : [];
  });
  const auto = L.filter((l) => byId.get(l.problemId)!.status === "auto");
  return {
    labeled: L.length,
    unitAccuracy: hit.length,
    primaryAccuracy: conceptHit.length,
    secondaryPrecision: [tp, proposed] as const,
    secondaryRecall: [tp, truth] as const,
    modelUnit,
    shadowAgree: [shadow.filter(Boolean).length, shadow.length] as const,
    autoAccuracy: [auto.filter((l) => unitOk(byId.get(l.problemId)!, l) && byId.get(l.problemId)!.primaryConceptId === l.primaryConceptId).length, auto.length] as const,
    grokUnitAccuracy: (() => {
      const g = L.filter((l) => byId.get(l.problemId)!.unitSource === "grok");
      return [g.filter((l) => unitOk(byId.get(l.problemId)!, l)).length, g.length] as const;
    })(),
  };
}

export function buildReport(d: ReportData): string {
  const pricing = d.pricing ?? DEFAULT_CONFIG.pricing;
  const total = d.rows.length;
  const out: string[] = [`# e2c 리포트: ${d.kind} (${d.date})`, ""];
  if (d.jobId) out.push(`- job: \`${d.jobId}\`${d.mode ? ` (${d.mode})` : ""}`);
  out.push(`- 대상 필터 건수(subject_type=MATH, is_on=1): ${d.targetCount}`, `- 처리 문항: ${total}`, "");

  out.push("## 상태", table(["상태", "건수", "비율"], count(d.rows, (r) => r.status).map(([k, n]) => [k, n, pct(n, total)])), "");
  out.push("## 사유 코드", table(["코드", "건수"], count(d.rows.flatMap((r) => r.reasons.map((x) => ({ x }))), (r) => r.x)), "");
  out.push(
    "## 결정 경로",
    table(["단계", "majority", "grok", "manual"], [
      ["단원", ...(["majority", "grok", "manual"] as const).map((s) => d.rows.filter((r) => r.unitSource === s).length)],
      ["개념", ...(["majority", "grok", "manual"] as const).map((s) => d.rows.filter((r) => r.conceptSource === s).length)],
    ]),
    ""
  );

  const models: ModelName[] = ["jev", "claude", "gemini", "grok"];
  const stat = models.map((m) => {
    const cs = d.calls.filter((c) => c.adapter === m);
    const ok = cs.filter((c) => c.ok).length;
    const cost = cs.reduce((n, c) => n + c.costUsd, 0);
    const saved = cs.reduce((n, c) => n + savedCost(m, c.usage, pricing, c.batchDiscount), 0);
    const avgMs = cs.length ? Math.round(cs.reduce((n, c) => n + c.latencyMs, 0) / cs.length) : 0;
    const reused = d.reusedByModel?.[m] ?? 0;
    const avgCost = cs.length ? cost / cs.length : 0;
    return { m, calls: cs.length, ok, err: cs.length - ok, cost, saved, avgMs, reused, reuseSaved: reused * avgCost, batch: cs.filter((c) => c.batchDiscount).length, inTok: cs.reduce((n, c) => n + c.usage.inputTokens, 0), cachedTok: cs.reduce((n, c) => n + c.usage.cachedInputTokens, 0) };
  });
  out.push("## 모델별 호출", table(["모델", "호출", "성공", "오류", "평균 지연(ms)", "비용(USD)"], stat.map((s) => [s.m, s.calls, s.ok, s.err, s.avgMs, usd(s.cost)])), "");
  const grokCalls = d.calls.filter((c) => c.adapter === "grok");
  out.push(
    "## Grok",
    `- 단원 결정 호출: ${grokCalls.filter((c) => c.stage === "grok_unit" && c.role === "judge").length}`,
    `- 개념 결정 호출: ${grokCalls.filter((c) => c.stage === "grok_concept" && c.role === "judge").length}`,
    `- 그림자 호출: ${grokCalls.filter((c) => c.role === "shadow_judge").length}`,
    ""
  );
  const totalCost = stat.reduce((n, s) => n + s.cost, 0);
  const inTok = stat.reduce((n, s) => n + s.inTok, 0);
  const cachedTok = stat.reduce((n, s) => n + s.cachedTok, 0);
  out.push(
    "## 비용",
    `- 총 비용: ${usd(totalCost)}`,
    `- 문항당 평균: ${usd(total ? totalCost / total : 0)}`,
    `- 전체 7,142문항 환산(선형): ${usd(total ? (totalCost / total) * 7142 : 0)}`,
    ""
  );
  out.push(
    "## 캐시·Batch 절감",
    table(["모델", "결과 캐시 재사용(건)", "Batch 처리(건)", "캐시 입력 토큰", "입력 토큰", "추정 절감(USD)"], stat.map((s) => [s.m, s.reused, s.batch, s.cachedTok, s.inTok, usd(s.saved + s.reuseSaved)])),
    "",
    `- 모델별 결과 캐시 재사용 합계: ${stat.reduce((n, s) => n + s.reused, 0)}건`,
    `- 캐시 입력 토큰 비율: ${pct(cachedTok, inTok)}`,
    `- Batch 처리 건수: ${stat.reduce((n, s) => n + s.batch, 0)}건`,
    `- Batch·캐시로 줄인 추정 금액: ${usd(stat.reduce((n, s) => n + s.saved + s.reuseSaved, 0))}`,
    ""
  );

  if (d.kind === "pilot" || d.labels?.length) {
    const m = pilotMetrics(d.rows, d.labels ?? []);
    out.push(
      "## 파일럿 지표 (§17)",
      `- 라벨 입력 문항: ${m.labeled}`,
      `- 단원 정확도(채택 단원 = 라벨): ${m.unitAccuracy}/${m.labeled} (${pct(m.unitAccuracy, m.labeled)})`,
      `- 주 개념 정확도: ${m.primaryAccuracy}/${m.labeled} (${pct(m.primaryAccuracy, m.labeled)})`,
      `- 보조 개념 정밀도: ${pct(...m.secondaryPrecision)} / 재현율: ${pct(...m.secondaryRecall)}`,
      `- 자동 확정(auto) 정확도: ${m.autoAccuracy[0]}/${m.autoAccuracy[1]} (${pct(...m.autoAccuracy)})`,
      `- Grok 결정 단원 정확도: ${m.grokUnitAccuracy[0]}/${m.grokUnitAccuracy[1]} (${pct(...m.grokUnitAccuracy)})`,
      `- 그림자 Grok 과 다수결 단원 일치율: ${m.shadowAgree[0]}/${m.shadowAgree[1]} (${pct(...m.shadowAgree)})`,
      "",
      table(["모델", "단원 표(성공)", "단원 정확", "정확도"], m.modelUnit.map(([n, t, h]) => [n, t, h, pct(h, t)])),
      ""
    );
  }
  return out.join("\n");
}

export function writeReport(rootDir: string, d: ReportData): string {
  const dir = path.join(rootDir, "reports");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `e2c-${d.kind}-${d.date}.md`);
  fs.writeFileSync(file, buildReport(d));
  return file;
}
