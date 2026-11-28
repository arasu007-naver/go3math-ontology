"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { api } from "@/lib/api";

type Item = {
  id: number;
  category: string;
  action: string;
  summary: string;
  itemCount: number;
  bookStem: string | null;
  actor: string | null;
  createdAt: string;
};
type Page = {
  total: number;
  dayCount: number;
  date: string | null;
  pageIndex: number | null;
  firstDate: string | null;
  lastDate: string | null;
  newerDate: string | null;
  olderDate: string | null;
  items: Item[];
};

const CATEGORY: Record<string, string> = {
  concept: "개념 전이",
  problem: "문제",
  book_index: "색인",
  dictionary: "딕셔너리",
  flashcard: "플래시카드",
  quiz: "객관식 퀴즈",
  descriptive_quiz: "서술형 퀴즈",
  baseline: "기준선",
};
const ACTION: Record<string, string> = { create: "등록", update: "수정", delete: "삭제", migrate: "전이", baseline: "기준선" };

const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));

// 작업 이력: 로그가 있는 하루(Asia/Seoul)가 한 페이지
export default function WorkLogPage() {
  const [data, setData] = useState<Page | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (date?: string) => {
    try {
      setLoading(true);
      setError("");
      const res = await api(`/api/work-log${date ? `?date=${encodeURIComponent(date)}` : ""}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setData(d);
      setInput(d.date ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 처음 열면 날짜 없이 호출해 가장 최근 날짜를 보여준다
    let alive = true;
    api("/api/work-log")
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!alive) return;
        if (!ok) throw new Error(d.error || "불러오지 못했습니다.");
        setData(d);
        setInput(d.date ?? "");
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  const cur = data?.date ?? null;
  const go = (d: string | null | undefined) => (d && d !== cur ? () => void load(d) : undefined);
  const nav = (label: string, text: string, target: string | null | undefined) => {
    const onClick = go(target);
    return (
      <button key={label} title={label} aria-label={label} disabled={!onClick || loading} onClick={onClick} className="px-2.5 py-1 rounded-lg border border-white/10 text-xs font-semibold text-gray-300 hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent">
        {text}
      </button>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader subtitle="작업 이력" />
      <main className="flex-1 p-6 max-w-5xl w-full mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span className="text-sm font-bold text-white">전체 {data?.total ?? 0}건</span>
          {data?.date && (
            <span className="text-xs text-gray-400">
              {data.date} ({data.pageIndex ?? "-"} / {data.dayCount}일)
            </span>
          )}
          {nav("맨앞으로", "⏮", data?.firstDate)}
          {nav(">", ">", data?.olderDate)}
          {nav("<", "<", data?.newerDate)}
          {nav("맨뒤로", "⏭", data?.lastDate)}
          <input type="date" value={input} onChange={(e) => setInput(e.target.value)} className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-200" />
          <button title="조회" aria-label="조회" disabled={!input || loading} onClick={() => void load(input)} className="p-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-30">
            <Eye className="w-4 h-4" />
          </button>
        </div>

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
        {data && data.total === 0 && <p className="text-sm text-gray-500">기록된 작업 이력이 없습니다</p>}
        {data && data.total > 0 && data.items.length === 0 && <p className="text-sm text-gray-500">{data.date} 에는 이력이 없습니다</p>}

        <ul className="space-y-1.5">
          {data?.items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] text-xs">
              <span className="font-mono text-gray-500">{timeOf(it.createdAt)}</span>
              <span className="px-2 py-0.5 rounded-full border border-orange-500/40 text-orange-400 font-semibold">{CATEGORY[it.category] ?? it.category}</span>
              <span className="px-2 py-0.5 rounded-full border border-white/10 text-gray-300">{ACTION[it.action] ?? it.action}</span>
              <span className="text-gray-100 flex-1 min-w-[12rem]">{it.summary}</span>
              <span className="text-gray-400">{it.itemCount}건</span>
              {it.bookStem && <span className="text-gray-500">{it.bookStem}</span>}
              <span className="text-gray-500">{it.actor ?? "-"}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
