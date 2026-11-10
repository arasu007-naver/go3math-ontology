"use client";

import { useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";

type Result = {
  bookStem: string;
  chapters: number[];
  counts: { indices: number; dictionary: number; flashcards: number; quizzes: number; unlinked: number };
};

type OrderProgress = {
  running: boolean;
  total: number;
  done: number;
  current: string;
  agreed: number;
  jev: number;
  saved: number;
  undecided: number;
  cycles: number;
  failed: number;
};

// 단발성 기능 모음. 한 줄에 기능 하나씩 둔다.
export default function UtilitiesPage() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const uploadIndices = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 고를 수 있게
    if (!file) return;
    setBusy(true);
    setResult(null);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await api("/api/book-indices", { method: "POST", body });
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.error || `업로드 실패 (HTTP ${res.status})`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 개념 정렬: 단원 목록을 받아 단원을 하나씩 처리한다. 화면을 닫으면 멈춘다.
  const [order, setOrder] = useState<OrderProgress | null>(null);
  const [orderError, setOrderError] = useState("");
  const stopOrder = useRef(false);

  const runOrder = async () => {
    stopOrder.current = false;
    setOrderError("");
    try {
      const { units } = (await (await api("/api/concept-order")).json()) as { units: { unitId: string; path: string }[] };
      const p: OrderProgress = { running: true, total: units.length, done: 0, current: "", agreed: 0, jev: 0, saved: 0, undecided: 0, cycles: 0, failed: 0 };
      for (const u of units) {
        if (stopOrder.current) break;
        p.current = u.path;
        setOrder({ ...p });
        const res = await api("/api/concept-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitId: u.unitId }),
        });
        const d = await res.json();
        if (res.ok) {
          p.agreed += d.agreed;
          p.jev += d.disputes - d.undecided;
          p.saved += d.saved;
          p.undecided += d.undecided;
          p.cycles += d.cyclesDropped;
        } else {
          p.failed++;
          setOrderError(`${u.path}: ${d.error}`);
        }
        p.done++;
      }
      setOrder({ ...p, running: false });
    } catch (err) {
      setOrderError((err as Error).message);
      setOrder((o) => o && { ...o, running: false });
    }
  };

  return (
    <>
      <AppHeader subtitle="유틸리티" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto glass rounded-2xl p-4 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-12 font-semibold text-gray-300">색인</span>
            <label
              className={`px-3 py-1 rounded-full border border-white/10 text-xs font-semibold text-gray-300 ${
                busy ? "opacity-50" : "cursor-pointer hover:bg-white/10"
              }`}
            >
              {busy ? "업로드 중…" : "파일 선택"}
              <input type="file" accept=".zip" className="hidden" disabled={busy} onChange={uploadIndices} />
            </label>
            {result && (
              <span className="text-xs text-gray-400">
                {result.bookStem} · 제{result.chapters.join(", ")}장 — 색인 {result.counts.indices}, 딕셔너리 {result.counts.dictionary}, 플래시카드{" "}
                {result.counts.flashcards}, 퀴즈 {result.counts.quizzes}
                {result.counts.unlinked > 0 && <span className="text-amber-400"> (색인과 연결 안 된 항목 {result.counts.unlinked})</span>}
              </span>
            )}
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
          <div className="flex items-center gap-3 mt-3">
            <span className="w-12 font-semibold text-gray-300">개념</span>
            <button
              onClick={order?.running ? () => (stopOrder.current = true) : runOrder}
              className="px-3 py-1 rounded-full border border-white/10 text-xs font-semibold text-gray-300 cursor-pointer hover:bg-white/10"
            >
              {order?.running ? "중지" : "개념 정렬"}
            </button>
            {order && (
              <span className="text-xs text-gray-400">
                {order.done}/{order.total} 단원{order.running && order.current ? ` · ${order.current}` : ""} — 확정 {order.agreed}, JEV 결정 {order.jev}, 저장{" "}
                {order.saved}
                {order.undecided > 0 && `, 미정 ${order.undecided}`}
                {order.cycles > 0 && `, 순환 제외 ${order.cycles}`}
                {order.failed > 0 && <span className="text-red-400"> · 실패 {order.failed}단원</span>}
                {!order.running && <span className="text-gray-500"> · {order.done < order.total ? "중지됨" : "완료"}</span>}
              </span>
            )}
            {orderError && <span className="text-xs text-red-400">{orderError}</span>}
          </div>
        </div>
      </main>
    </>
  );
}
