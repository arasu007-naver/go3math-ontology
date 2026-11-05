"use client";

import { useEffect, useState } from "react";
import MathView from "@/components/MathView";
import { api } from "@/lib/api";

type GroupDetail = {
  id: number;
  representativeId: number;
  method: string;
  status: string;
  members: { id: number; title: string; statement: string; similarity: number | null; addedBy: string }[];
  history: { action: string; before: unknown; after: unknown; actor: string; at: string }[];
};

const ACTION: Record<string, string> = { create: "생성", merge: "병합", split: "분리", set_rep: "대표 변경" };

// 그룹 편집: 멤버 목록, 대표 변경, 분리, 이력
export default function GroupEditDialog({ groupId, onClose, onChanged }: { groupId: number; onClose: () => void; onChanged: () => void }) {
  const [g, setG] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [version, setVersion] = useState(0); // 편집 후 다시 불러오기
  useEffect(() => {
    let off = false;
    api(`/api/l2o/dedupe/group?groupId=${groupId}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json() }))
      .then(({ ok, d }) => {
        if (off) return;
        if (ok) setG(d);
        else setError(d.error);
      });
    return () => {
      off = true;
    };
  }, [groupId, version]);

  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const r = await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setBusy(false);
    if (!r.ok) return setError(d.error ?? "실패했습니다.");
    onChanged();
    setVersion((v) => v + 1);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass bg-[#0f1420] rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">
            그룹 {groupId} {g && <span className="text-[11px] text-gray-400 font-normal">· {g.method} · {g.status}</span>}
          </h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">닫기</button>
        </div>
        {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}
        {!g ? (
          <p className="text-xs text-gray-500">불러오는 중…</p>
        ) : (
          <>
            <ul className="space-y-2">
              {g.members.map((m) => (
                <li key={m.id} className="border border-white/10 rounded-lg p-2.5 flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
                      <span className="font-mono">#{m.id}</span>
                      {m.id === g.representativeId && <span className="text-orange-400 font-semibold">★ 대표</span>}
                      {m.similarity != null && <span>유사도 {m.similarity.toFixed(3)}</span>}
                      <span>· {m.addedBy}</span>
                    </div>
                    <MathView as="h4" text={m.title} className="text-xs font-semibold text-gray-100 mt-0.5" />
                    <MathView text={m.statement} className="text-[11px] text-gray-400 whitespace-pre-line line-clamp-3" />
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      disabled={busy || m.id === g.representativeId}
                      onClick={() => post("/api/l2o/dedupe/representative", { groupId: g.id, legacyId: m.id })}
                      className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-300 disabled:opacity-30"
                    >
                      대표로
                    </button>
                    <button
                      disabled={busy || g.members.length === 1}
                      onClick={() => post("/api/l2o/dedupe/split", { legacyId: m.id })}
                      className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-300 disabled:opacity-30"
                    >
                      분리
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <h4 className="text-xs font-semibold mt-4 mb-1 text-gray-300">이력</h4>
            <ul className="text-[11px] text-gray-400 space-y-0.5">
              {g.history.map((h, i) => (
                <li key={i}>
                  <span className="text-gray-500">{new Date(h.at).toLocaleString("ko-KR")}</span> · {ACTION[h.action] ?? h.action} · {h.actor} ·{" "}
                  <span className="font-mono text-gray-500">{JSON.stringify(h.after)}</span>
                </li>
              ))}
              {g.history.length === 0 && <li>이력 없음</li>}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
