"use client";

import type { JobVM } from "@/lib/server/e2cJobs";

const KIND: Record<string, string> = { pilot: "파일럿", run_all: "전체 실행", run_ids: "선택 문항", rerun_review: "검토 필요 재실행" };
const STATUS: Record<string, string> = { running: "실행 중", paused: "일시정지", done: "완료", failed: "실패", cancelled: "취소됨" };
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

// e2c 작업 진행 바: 진행률, 누적·예상 비용, Grok 호출 수, 캐시 적중, 일시정지·재개·취소, 리포트
export default function E2cJobBar({
  job,
  busy,
  report,
  onControl,
  onReport,
  onClose,
}: {
  job: JobVM;
  busy: boolean;
  report: string | null;
  onControl: (a: "pause" | "resume" | "cancel") => void;
  onReport: () => void;
  onClose: () => void;
}) {
  const pct = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  const active = job.status === "running" || job.status === "paused";
  const cachePct = job.inputTokens ? Math.round((job.cachedInputTokens / job.inputTokens) * 100) : 0;
  const btn = "px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-300 hover:bg-white/10 disabled:opacity-40";
  return (
    <section className="glass rounded-2xl px-4 py-2.5 shrink-0 flex flex-col gap-1.5" data-testid="e2c-job">
      <div className="flex items-center justify-between gap-3 text-[11px] flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-200">
            {KIND[job.kind] ?? job.kind} · {job.mode}
            {job.dryRun ? " · dry-run" : ""}
            {job.wave ? ` · ${job.wave}` : ""}
          </span>
          <span className={job.status === "running" ? "text-sky-300" : job.status === "failed" ? "text-red-300" : "text-gray-400"}>{STATUS[job.status] ?? job.status}</span>
          <span className="text-gray-300">
            {job.processed}/{job.total} ({pct}%)
          </span>
          <span className="text-amber-300">검토 {job.needsReview}</span>
          <span className={job.failed ? "text-red-300" : "text-gray-500"}>오류 {job.failed}</span>
          <span className="text-gray-300" data-testid="e2c-cost">
            누적 {usd(job.costUsd)} / 예상 {usd(job.estimatedCostUsd)}
            {job.budgetUsd ? ` / 상한 ${usd(job.budgetUsd)}` : ""}
          </span>
          <span className="text-gray-300">
            Grok 호출 단원 {job.grokUnitCalls} · 개념 {job.grokConceptCalls}
          </span>
          <span className="text-emerald-300" data-testid="e2c-cache">
            캐시 재사용 {job.cacheReusedCalls}건 · 캐시 입력 {cachePct}%
          </span>
          {job.error && <span className="text-red-300/80 truncate max-w-[24rem]">· {job.error}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {job.status === "running" && (
            <button onClick={() => onControl("pause")} disabled={busy} className={btn}>
              일시정지
            </button>
          )}
          {job.status === "paused" && (
            <button onClick={() => onControl("resume")} disabled={busy} className={btn}>
              재개
            </button>
          )}
          {active && (
            <button onClick={() => onControl("cancel")} disabled={busy} className={btn}>
              취소
            </button>
          )}
          {!active && (
            <>
              <button onClick={onReport} disabled={busy} className={btn}>
                리포트 생성
              </button>
              <button onClick={onClose} className={btn}>
                닫기
              </button>
            </>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${job.status === "running" ? "bg-sky-400" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
      </div>
      {report && <div className="text-[11px] text-emerald-300">리포트: {report}</div>}
    </section>
  );
}
