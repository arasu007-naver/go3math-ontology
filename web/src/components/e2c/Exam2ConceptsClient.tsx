"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import E2cJobBar from "@/components/e2c/E2cJobBar";
import ProblemLeft from "@/components/e2c/ProblemLeft";
import ProblemRight, { type UnitItem } from "@/components/e2c/ProblemRight";
import { api } from "@/lib/api";
import type { JobVM } from "@/lib/server/e2cJobs";
import type { ProblemRowVM } from "@/lib/server/e2cQueries";

const STATUSES = ["auto", "needs_review", "error", "skipped_no_text", "overridden", "confirmed"];
const REASONS = ["unit_grok", "concept_grok", "two_models_only", "insufficient_models", "unit_tie", "unit_low_conf", "concept_low_conf", "unit_hint_conflict", "out_of_candidates", "truncated", "majority_2of3", "candidate_fallback"];
const SOURCES = ["majority", "grok", "manual"];
const SUBJECTS = ["COMMON", "CALCULUS", "STATISTICS", "GEOMETRY", "GA_TYPE", "NA_TYPE", "A_TYPE", "B_TYPE"];
const PAGE_SIZE = 20;

type Filters = { status: string; reason: string; source: string; subject: string; year: string };
const EMPTY: Filters = { status: "", reason: "", source: "", subject: "", year: "" };

// 기출문제 → 단원 1개 → 개념 검토 화면. 좌: 문제·S번호 해답, 우: 모델별 표·집계·결정 경로·사유·수동 수정. J/K 이동, Enter 확인.
export default function Exam2ConceptsClient({ activeJob }: { activeJob: JobVM | null }) {
  const [items, setItems] = useState<ProblemRowVM[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [job, setJob] = useState<JobVM | null>(activeJob);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState(0);
  const [dryRun, setDryRun] = useState(true);
  const [shadow, setShadow] = useState(false);
  const [pilotMode, setPilotMode] = useState(false);
  const [highlight, setHighlight] = useState<{ id: number; steps: Set<string> } | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const load = useCallback(async () => {
    const q = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    const res = await api(`/api/e2c/problems?${q}`);
    if (!res.ok) {
      setMsg(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `목록을 읽지 못했습니다 (HTTP ${res.status}).`);
      return;
    }
    const d = (await res.json()) as { total: number; items: ProblemRowVM[] };
    setItems(d.items);
    setTotal(d.total);
    setFocus((f) => Math.min(f, Math.max(0, d.items.length - 1)));
  }, [page, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 필터·쪽이 바뀌면 목록을 다시 읽는다
    void load();
  }, [load]);
  useEffect(() => {
    api("/api/e2c/units")
      .then((r) => (r.ok ? r.json() : []))
      .then(setUnits)
      .catch(() => {});
  }, []);

  // 실행 중인 작업은 3초마다 상태를 읽고, 끝나면 목록을 다시 읽는다
  const running = job?.status === "running";
  useEffect(() => {
    if (!job || !running) return;
    const t = setInterval(async () => {
      const r = await api(`/api/e2c/jobs/${job.id}`);
      if (r.ok) {
        const next = (await r.json()) as JobVM;
        setJob(next);
        if (next.status !== "running") void load();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [job, running, load]);

  const start = async (kind: string, scope: unknown, mode?: string, force = false) => {
    setBusy(true);
    setMsg(null);
    setReport(null);
    try {
      const res = await api("/api/e2c/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, mode, scope, dryRun, shadowGrok: shadow, force }),
      });
      const d = await res.json();
      if (res.status === 202 && d.budgetWarning) {
        if (confirm(`예상 비용 $${Number(d.estimatedCostUsd).toFixed(2)} 이(가) 상한을 넘습니다. 그래도 시작할까요?`)) await start(kind, scope, mode, true);
      } else if (!res.ok) setMsg(d.error ?? `시작하지 못했습니다 (HTTP ${res.status}).`);
      else setJob(d as JobVM);
    } finally {
      setBusy(false);
    }
  };

  const control = async (a: "pause" | "resume" | "cancel") => {
    if (!job) return;
    setBusy(true);
    try {
      const res = await api(`/api/e2c/jobs/${job.id}/${a}`, { method: "POST" });
      const d = await res.json();
      if (res.ok) setJob(d as JobVM);
      else setMsg(d.error ?? "실패");
    } finally {
      setBusy(false);
    }
  };

  const makeReport = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const res = await api("/api/e2c/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobRunId: job.id }) });
      const d = await res.json();
      setReport(res.ok ? d.path : null);
      if (!res.ok) setMsg(d.error ?? "리포트를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  // 키보드: J/K 이동, Enter 확인
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === "j" || e.key === "J") setFocus((f) => Math.min(f + 1, items.length - 1));
      else if (e.key === "k" || e.key === "K") setFocus((f) => Math.max(f - 1, 0));
      else if (e.key === "Enter" && !pilotMode) {
        const row = items[focus];
        if (row?.result && row.result.finalUnitId && row.result.primaryConceptId && row.result.status !== "confirmed" && row.result.status !== "applied") {
          const res = await api("/api/e2c/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problemId: row.id }) });
          if (res.ok) void load();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, focus, pilotMode, load]);

  useEffect(() => {
    const id = items[focus]?.id;
    if (id != null) rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [focus, items]);

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sel = "bg-transparent border border-white/10 rounded px-1 py-0.5 text-[11px] text-gray-200";
  const btn = "px-3 py-1 rounded-lg text-xs font-semibold border border-white/10 text-gray-100 hover:bg-white/10 disabled:opacity-40";
  const jobBusy = job?.status === "running";
  const setF = (k: keyof Filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setPage(1);
  };
  const opt = (v: string) => (
    <option key={v} value={v} className="bg-[#0f1420]">
      {v}
    </option>
  );

  return (
    <main className="flex flex-col gap-3 p-4 min-h-0 flex-1" data-testid="e2c-page">
      <section className="glass rounded-2xl px-4 py-2.5 shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button className={btn} disabled={busy || jobBusy} onClick={() => start("pilot", { pilot: true })}>
            파일럿 실행
          </button>
          <button className={btn} disabled={busy || jobBusy || selected.size === 0} onClick={() => start("run_ids", { ids: [...selected] })}>
            선택 문항 실행 ({selected.size})
          </button>
          <button className={btn} disabled={busy || jobBusy} onClick={() => start("run_all", { all: true }, "batch")}>
            전체 실행(batch)
          </button>
          <button className={btn} disabled={busy || jobBusy} onClick={() => start("rerun_review", { all: true })}>
            검토 필요 재실행
          </button>
          <label className="text-[11px] text-gray-300 flex items-center gap-1">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> dry-run
          </label>
          <label className="text-[11px] text-gray-300 flex items-center gap-1">
            <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} /> 그림자 Grok
          </label>
          <label className="text-[11px] text-gray-300 flex items-center gap-1">
            <input type="checkbox" checked={pilotMode} onChange={(e) => setPilotMode(e.target.checked)} /> 파일럿 라벨 모드
          </label>
          {msg && <span className="text-[11px] text-red-300">{msg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
          <span>필터</span>
          <select className={sel} value={filters.status} onChange={setF("status")} data-testid="f-status">
            <option value="" className="bg-[#0f1420]">상태 전체</option>
            {STATUSES.map(opt)}
          </select>
          <select className={sel} value={filters.reason} onChange={setF("reason")}>
            <option value="" className="bg-[#0f1420]">사유 전체</option>
            {REASONS.map(opt)}
          </select>
          <select className={sel} value={filters.source} onChange={setF("source")}>
            <option value="" className="bg-[#0f1420]">결정 경로 전체</option>
            {SOURCES.map(opt)}
          </select>
          <select className={sel} value={filters.subject} onChange={setF("subject")}>
            <option value="" className="bg-[#0f1420]">과목 전체</option>
            {SUBJECTS.map(opt)}
          </select>
          <input className={`${sel} w-20`} placeholder="연도" value={filters.year} onChange={setF("year")} />
          <span className="ml-auto">총 {total}건 · J/K 이동 · Enter 확인</span>
        </div>
      </section>

      {job && <E2cJobBar job={job} busy={busy} report={report} onControl={control} onReport={makeReport} onClose={() => setJob(null)} />}

      <section className="glass rounded-2xl flex-1 min-h-0 overflow-auto" data-testid="e2c-rows">
        {items.map((row, i) => (
          <div
            key={row.id}
            ref={(el) => {
              if (el) rowRefs.current.set(row.id, el);
              else rowRefs.current.delete(row.id);
            }}
            onClick={() => setFocus(i)}
            className={`grid grid-cols-2 gap-4 border-b border-white/5 px-3 py-2.5 ${i === focus ? "bg-white/[0.04] ring-1 ring-sky-400/40" : ""}`}
            data-testid="e2c-row"
          >
            <div className="flex gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(row.id)}
                onChange={() =>
                  setSelected((s) => {
                    const n = new Set(s);
                    if (n.has(row.id)) n.delete(row.id);
                    else n.add(row.id);
                    return n;
                  })
                }
              />
              <div className="flex-1 min-w-0">
                <ProblemLeft row={row} highlight={highlight?.id === row.id ? highlight.steps : new Set()} />
              </div>
            </div>
            <ProblemRight
              row={row}
              units={units}
              pilotMode={pilotMode}
              busy={busy}
              onHighlight={(steps) => setHighlight({ id: row.id, steps: new Set(steps) })}
              onChanged={() => void load()}
            />
          </div>
        ))}
        {items.length === 0 && <p className="p-6 text-center text-xs text-gray-500">조건에 맞는 문항이 없습니다.</p>}
      </section>

      <div className="flex items-center justify-center gap-2 text-xs text-gray-300 shrink-0">
        <button className={btn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          이전
        </button>
        <span>
          {page} / {lastPage}
        </span>
        <button className={btn} disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
          다음
        </button>
      </div>
    </main>
  );
}
