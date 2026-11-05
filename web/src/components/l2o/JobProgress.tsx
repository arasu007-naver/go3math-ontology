"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { JobVM } from "@/lib/l2o/types";

type Summary = {
  groups: number;
  autoAgreed: number;
  needsReview: number;
  selectors: { selector: string; votes: number; errors: number; avgMs: number | null; agreeRate: number | null }[];
};
const SEL: Record<string, string> = { jev: "JEV", claude: "Claude", gemini: "Gemini" };

const KIND: Record<string, string> = { test: "테스트(dry-run)", migrate_all: "모두 이전" };
const STATUS: Record<string, string> = { running: "실행 중", paused: "일시정지", done: "완료", failed: "실패", cancelled: "취소됨" };

// 단원 선택 일괄 작업 진행 바: processed/total, 자동일치·검토·오류, 일시정지·재개·취소
export default function JobProgress({
  job,
  busy,
  onControl,
  onClose,
}: {
  job: JobVM;
  busy: boolean;
  onControl: (action: "pause" | "resume" | "cancel") => void;
  onClose: () => void;
}) {
  const pct = job.total ? Math.round((job.processed / job.total) * 100) : 0;
  // 끝난 작업은 요약(선택기별 일치율·평균 지연)을 한 번 읽는다
  const [summary, setSummary] = useState<{ id: string; s: Summary } | null>(null);
  const done = job.status === "done";
  useEffect(() => {
    if (!done) return;
    let alive = true;
    api(`/api/l2o/jobs/${job.id}/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && s && setSummary({ id: job.id, s }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [done, job.id]);
  const sum = done && summary?.id === job.id ? summary.s : null;
  const active = job.status === "running" || job.status === "paused";
  const btn = "px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-300 hover:bg-white/10 disabled:opacity-40";
  return (
    <section className="glass rounded-2xl px-4 py-2.5 shrink-0 flex flex-col gap-1.5" data-testid="job-progress">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-200">{KIND[job.kind] ?? job.kind}</span>
          <span className={job.status === "running" ? "text-sky-300" : job.status === "failed" ? "text-red-300" : "text-gray-400"}>
            {STATUS[job.status] ?? job.status}
          </span>
          <span className="text-gray-300">
            {job.processed}/{job.total} ({pct}%)
          </span>
          <span className="text-emerald-300">자동일치 {job.succeeded}</span>
          <span className="text-amber-300">검토 {job.needsReview}</span>
          <span className={job.failed ? "text-red-300" : "text-gray-500"}>오류 {job.failed}</span>
          {job.error && (
            <span className="text-red-300/80 truncate max-w-[28rem]" title={job.error}>
              · {job.error}
            </span>
          )}
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
            <button onClick={onClose} className={btn}>
              닫기
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full ${job.status === "running" ? "bg-sky-400" : "bg-gray-400"}`} style={{ width: `${pct}%` }} />
      </div>
      {sum && (
        <div className="flex items-center gap-3 flex-wrap text-[11px] text-gray-400" data-testid="job-summary">
          <span>
            요약: 그룹 {sum.groups} · 자동일치 <span className="text-emerald-300">{sum.autoAgreed}</span> · 검토{" "}
            <span className="text-amber-300">{sum.needsReview}</span>
          </span>
          {sum.selectors.map((x) => (
            <span key={x.selector}>
              {SEL[x.selector] ?? x.selector}: 일치율 {x.agreeRate ?? "-"}% · 평균 {x.avgMs != null ? (x.avgMs / 1000).toFixed(1) : "-"}초
              {x.errors > 0 && <span className="text-red-300"> · 오류 {x.errors}</span>}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
