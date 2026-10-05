"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type TablePage = { name: string; columns: string[]; rows: Record<string, unknown>[]; total: number; page: number; pageSize: number };

const cell = (v: unknown) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
const MAX_CELL = 120;

// 쪽 번호 버튼: 현재 쪽 앞뒤 2쪽과 처음·끝
function pageNumbers(page: number, last: number): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - page) <= 2) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

// 테이블 내용을 24행씩 쪽으로 나눠 보여 주는 모달. 상단에 쪽 이동 버튼 그룹.
export default function TableRowModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<TablePage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api(`/api/db/tables?name=${encodeURIComponent(name)}&page=${page}`)
      .then(async (r) => {
        const d = await r.json();
        if (cancelled) return;
        if (!r.ok) setError(d.error || "불러오지 못했습니다");
        else {
          setError(null);
          setData(d);
        }
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [name, page]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const last = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const btn = "min-w-8 px-2 py-1 rounded-md border border-white/10 text-xs font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="glass rounded-2xl w-full max-w-6xl max-h-full flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 px-5 py-3 border-b border-white/10">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{name}</h2>
            <p className="text-[10px] text-gray-500">
              {data ? `${data.total.toLocaleString()}행 · ${page} / ${last}쪽` : "불러오는 중…"}
            </p>
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <button className={btn} onClick={() => setPage(1)} disabled={page <= 1} aria-label="처음 쪽">«</button>
            <button className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="이전 쪽">‹</button>
            {pageNumbers(page, last).map((p, i) =>
              p === "…" ? (
                <span key={`gap${i}`} className="px-1 text-xs text-gray-500">…</span>
              ) : (
                <button
                  key={p}
                  className={`${btn} ${p === page ? "border-orange-500 bg-orange-500/20 text-orange-400" : ""}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              )
            )}
            <button className={btn} onClick={() => setPage(page + 1)} disabled={page >= last} aria-label="다음 쪽">›</button>
            <button className={btn} onClick={() => setPage(last)} disabled={page >= last} aria-label="마지막 쪽">»</button>
            <button className={`${btn} ml-3`} onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>
        <div className="overflow-auto p-4">
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : !data ? null : data.rows.length === 0 ? (
            <p className="text-xs text-gray-500">행이 없습니다.</p>
          ) : (
            <table className="text-[11px] border-collapse">
              <thead>
                <tr>
                  <th className="sticky top-0 bg-gray-900 px-2 py-1 text-right text-gray-500 font-semibold">#</th>
                  {data.columns.map((c) => (
                    <th key={c} className="sticky top-0 bg-gray-900 px-2 py-1 text-left text-gray-400 font-semibold whitespace-nowrap">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-2 py-1 text-right text-gray-600">{(page - 1) * data.pageSize + i + 1}</td>
                    {data.columns.map((c) => {
                      const v = cell(r[c]);
                      return (
                        <td key={c} className="px-2 py-1 text-gray-300 align-top max-w-xs truncate" title={v.length > MAX_CELL ? v : undefined}>
                          {v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}…` : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
