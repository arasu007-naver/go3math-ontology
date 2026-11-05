"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type History = {
  groupId: number;
  kgConcept: { id: number; sourceId: number; mergedSourceIds: number[] } | null;
  votes: {
    at: string;
    selector: string;
    model: string | null;
    unitPath: string | null;
    confidence: number | null;
    error: string | null;
    latencyMs: number | null;
    reason: string | null;
    candidates: number;
    candidateFallback: boolean;
    job: string | null;
  }[];
  overrides: { at: string; previousUnitPath: string | null; unitPath: string; reason: string | null; actor: string }[];
  edges: {
    id: number;
    unitPath: string;
    isPrimary: boolean;
    isActive: boolean;
    confidence: number | null;
    judgedBy: string;
    rationale: string | null;
    createdAt: string;
    supersededAt: string | null;
    supersededBy: number | null;
  }[];
};

const when = (s: string | null) => (s ? new Date(s).toLocaleString("ko-KR", { hour12: false }) : "");

// 이력 창: KG 엣지(활성/비활성·대체) · 수동 결정 · 선택기 표(최근 60개)
export default function HistoryDialog({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const [h, setH] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api(`/api/l2o/history?groupId=${groupId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (alive) setH(d);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [groupId]);

  const head = "text-[11px] font-semibold text-gray-300 mt-2";
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass bg-[#0f1420] rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-1 text-[11px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">이력 · 그룹 {groupId}</h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">
            닫기
          </button>
        </div>
        {error && <p className="text-red-300">{error}</p>}
        {!h && !error && <p className="text-gray-400">불러오는 중…</p>}
        {h && (
          <>
            <p className={head}>KG</p>
            {h.kgConcept ? (
              <p className="text-gray-300">
                개념 #{h.kgConcept.id} · source_id {h.kgConcept.sourceId}
                {h.kgConcept.mergedSourceIds.length > 0 && ` · merged ${h.kgConcept.mergedSourceIds.join(", ")}`}
              </p>
            ) : (
              <p className="text-gray-500">아직 KG 에 기록되지 않았습니다.</p>
            )}
            {h.edges.map((e) => (
              <p key={e.id} className={e.isActive ? "text-gray-100" : "text-gray-500 line-through decoration-gray-600"}>
                엣지 #{e.id} {e.isActive ? "활성" : "비활성"} · {e.unitPath} · {e.judgedBy}
                {e.confidence != null && ` · ${Math.round(e.confidence * 100)}%`} · {when(e.createdAt)}
                {e.supersededBy && ` → #${e.supersededBy} 로 대체 (${when(e.supersededAt)})`}
                {e.rationale && <span className="text-gray-500 no-underline"> — {e.rationale}</span>}
              </p>
            ))}

            <p className={head}>수동 결정</p>
            {h.overrides.length === 0 && <p className="text-gray-500">없음</p>}
            {h.overrides.map((o, i) => (
              <p key={i} className="text-gray-300">
                {when(o.at)} · {o.actor} · {o.previousUnitPath ?? "-"} → <b className="text-gray-100">{o.unitPath}</b>
                {o.reason && <span className="text-gray-400"> — {o.reason}</span>}
              </p>
            ))}

            <p className={head}>선택기 표 (최근 {h.votes.length}개)</p>
            {h.votes.map((v, i) => (
              <p key={i} className="text-gray-300">
                {when(v.at)} · <b>{v.selector}</b> · {v.error ? <span className="text-red-300">오류 {v.error.slice(0, 100)}</span> : (v.unitPath ?? "판단 불가")}
                {v.confidence != null && !v.error && ` ${Math.round(v.confidence * 100)}%`}
                <span className="text-gray-500">
                  {" "}
                  · 후보 {v.candidates}
                  {v.candidateFallback && "(확장)"}
                  {v.latencyMs != null && ` · ${(v.latencyMs / 1000).toFixed(1)}초`}
                  {v.job && ` · ${v.job}`}
                </span>
                {v.reason && <span className="text-gray-400"> — {v.reason}</span>}
              </p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
