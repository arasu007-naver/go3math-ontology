"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { SELECTORS, type SelectorName } from "@/lib/l2o/types";

type Unit = { unitId: string; path: string };
type Cands = { status: string; currentUnitId: string | null; suggestedUnitId: string | null; candidates: Unit[]; all: Unit[] };
type Vote = { selector: SelectorName; unitId: string | null; unitPath: string | null; confidence: number | null; error: string | null; reason: string | null };
const LABEL: Record<SelectorName, string> = { jev: "JEV", claude: "Claude", gemini: "Gemini" };

// 단원 결정/수정 창 (스펙 5.5·9): 3표와 이유, 후보(제안 단원 미리 선택), 전체 단원 검색, 사유 → 확정 시 즉시 KG 반영
export default function UnitDecisionDialog({
  groupId,
  title,
  onClose,
  onDone,
}: {
  groupId: number;
  title: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [cands, setCands] = useState<Cands | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api(`/api/l2o/units/candidates?groupId=${groupId}`), api(`/api/l2o/history?groupId=${groupId}`)])
      .then(async ([a, b]) => {
        const c = await a.json();
        const h = await b.json();
        if (!a.ok) throw new Error(c.error ?? `HTTP ${a.status}`);
        if (!alive) return;
        setCands(c);
        setPicked(c.currentUnitId ?? c.suggestedUnitId ?? null);
        // 선택기별 최신 표 1개씩
        const latest = new Map<string, Vote>();
        for (const v of (h.votes ?? []) as Vote[]) if (!latest.has(v.selector)) latest.set(v.selector, v);
        setVotes(SELECTORS.map((s) => latest.get(s)).filter((v): v is Vote => !!v));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [groupId]);

  const candIds = useMemo(() => new Set(cands?.candidates.map((c) => c.unitId)), [cands]);
  const searched = useMemo(() => {
    const t = q.trim();
    if (!cands || !t) return [];
    return cands.all.filter((u) => !candIds.has(u.unitId) && (u.path.includes(t) || u.unitId.toLowerCase().includes(t.toLowerCase()))).slice(0, 20);
  }, [q, cands, candIds]);
  const pathOf = (id: string | null) => (id ? (cands?.all.find((u) => u.unitId === id)?.path ?? id) : "-");
  const editing = !!cands?.currentUnitId;

  const save = async () => {
    if (!picked) return;
    setSaving(true);
    setError(null);
    try {
      const r = await api("/api/l2o/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId, unitId: picked, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      onDone(`그룹 ${groupId}: ${pathOf(picked)} 로 결정 · KG ${d.kg.created ? "개념 생성" : "개념 갱신"} / 엣지 ${d.kg.edge}${d.kg.retiredEdges ? ` (비활성 ${d.kg.retiredEdges})` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const option = (u: Unit) => (
    <label key={u.unitId} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-white/5 ${picked === u.unitId ? "bg-orange-500/10" : ""}`}>
      <input type="radio" name="unit" checked={picked === u.unitId} onChange={() => setPicked(u.unitId)} />
      <span className="text-gray-100">{u.path}</span>
      <span className="text-gray-500 text-[10px]">{u.unitId}</span>
      {u.unitId === cands?.suggestedUnitId && <span className="text-[10px] text-amber-300">제안</span>}
      {u.unitId === cands?.currentUnitId && <span className="text-[10px] text-emerald-300">현재</span>}
      {votes.filter((v) => v.unitId === u.unitId).map((v) => (
        <span key={v.selector} className="text-[10px] text-sky-300">
          {LABEL[v.selector]}
        </span>
      ))}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass bg-[#0f1420] rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">
            {editing ? "단원 수정" : "단원 결정"} · 그룹 {groupId} <span className="text-gray-400 font-normal">{title}</span>
          </h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">
            닫기
          </button>
        </div>
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        {!cands && !error && <p className="text-[11px] text-gray-400">불러오는 중…</p>}
        {cands && (
          <>
            <div className="flex flex-col gap-1 text-[11px]">
              {votes.length === 0 && <p className="text-gray-500">선택기 표가 아직 없습니다.</p>}
              {votes.map((v) => (
                <p key={v.selector} className="text-gray-300">
                  <b className="text-gray-100">{LABEL[v.selector]}</b> ·{" "}
                  {v.error ? <span className="text-red-300">오류: {v.error.slice(0, 120)}</span> : (v.unitPath ?? "판단 불가")}
                  {v.confidence != null && !v.error && <span className="text-gray-500"> {Math.round(v.confidence * 100)}%</span>}
                  {v.reason && <span className="text-gray-400"> — {v.reason}</span>}
                </p>
              ))}
            </div>
            <div className="text-[12px] flex flex-col">
              <p className="text-[11px] text-gray-500 mb-1">후보 {cands.candidates.length}개</p>
              {cands.candidates.map(option)}
            </div>
            <div className="text-[12px] flex flex-col gap-1">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="후보에 없으면 전체 단원 검색 (예: 수열, L4-HALG)"
                className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100 outline-none focus:border-orange-400"
              />
              {searched.map(option)}
              {q.trim() && !searched.length && <p className="text-[11px] text-gray-500">후보 밖에서 찾은 단원이 없습니다.</p>}
            </div>
            <label className="text-[11px] text-gray-400 flex flex-col gap-1">
              사유 (필수)
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="예: 등비수열의 합이라 '수열의 합' 단원"
                className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100 outline-none focus:border-orange-400"
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">
                선택: <span className="text-gray-100">{pathOf(picked)}</span>
              </span>
              <button
                onClick={save}
                disabled={!picked || !reason.trim() || saving || picked === cands.currentUnitId}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white disabled:opacity-40"
              >
                {saving ? "기록 중…" : "확정 (KG 반영)"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
