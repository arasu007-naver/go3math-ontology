"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Preview = { groups: number; targets: number; skipped: number; expectedCalls: number };

// 모두 이전 확인 창 (스펙 8장): 대상 그룹 수 · 예상 호출 수 · 검토 필요는 쓰지 않는다는 안내 · "이전" 입력 시 활성
export default function MigrateAllDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let alive = true;
    api("/api/l2o/migrate-all")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        if (alive) setPreview(d);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass bg-[#0f1420] rounded-2xl w-full max-w-md p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">모두 이전</h3>
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-white">
            닫기
          </button>
        </div>
        {error && <p className="text-[11px] text-red-300">{error}</p>}
        {!preview && !error && <p className="text-[11px] text-gray-400">대상 계산 중…</p>}
        {preview && (
          <ul className="text-[12px] text-gray-200 space-y-1">
            <li>
              대상 그룹 <b>{preview.targets}</b>개 <span className="text-gray-500">(전체 {preview.groups} · 수동/이전됨 {preview.skipped}개는 건너뜀)</span>
            </li>
            <li>
              예상 선택기 호출 <b>{preview.expectedCalls}</b>건 <span className="text-gray-500">(이미 성공한 표는 재사용)</span>
            </li>
            <li className="text-amber-200">3개 선택기가 모두 같은 단원일 때만 KG 에 기록합니다. 검토 필요는 기록하지 않고 남깁니다.</li>
            <li className="text-gray-400">단원이 바뀐 개념의 기존 엣지는 삭제하지 않고 비활성화합니다.</li>
          </ul>
        )}
        <label className="text-[11px] text-gray-400 flex flex-col gap-1">
          계속하려면 &quot;이전&quot; 을 입력하세요
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs text-gray-100 outline-none focus:border-orange-400"
            data-testid="migrate-confirm-input"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-gray-300 hover:bg-white/10">
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={typed.trim() !== "이전" || !preview || busy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white disabled:opacity-40"
          >
            {busy ? "시작 중…" : "모두 이전 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}
