"use client";

import { Send } from "lucide-react";
import { Fragment, useState } from "react";
import { api } from "@/lib/api";
import NodeCard from "./NodeCard";

type Result = {
  route?: "jev" | "local" | "claude";
  trace?: string[];
  plan?: string;
  answer?: string;
  summary?: string;
  sql?: string;
  error?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  links: Record<string, string>[];
  truncated?: boolean;
};
type Turn = { question: string; result: Result | null };

// 결과에서 펼쳐 볼 노드(문단 → 페이지 순) id
function previewId(row: Record<string, unknown>): string | null {
  const vals = Object.values(row).filter((v): v is string => typeof v === "string");
  return vals.find((v) => v.startsWith("para:")) ?? vals.find((v) => v.startsWith("page:")) ?? null;
}

export default function AgentChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => t.result?.summary).map((t) => ({ question: t.question, summary: t.result!.summary! }));
    setTurns((ts) => [...ts, { question: q, result: null }]);
    setQuestion("");
    setBusy(true);
    let result: Result;
    try {
      const res = await api("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      result = await res.json();
    } catch (err) {
      result = { error: (err as Error).message, columns: [], rows: [], links: [] };
    }
    setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { ...t, result } : t)));
    setBusy(false);
  };

  return (
    <main className="flex-1 flex flex-col overflow-hidden p-4 gap-4 max-w-6xl w-full mx-auto">
      <div className="flex-1 overflow-y-auto space-y-4">
        {turns.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-10">
            예: “이론 수학 대전에서 나머지 정리 문제가 있는 페이지는?”, “미적분I 의 선수과목은?”, “공통수학1 에 대응된 TOC 항목은?”
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="ml-auto max-w-[70%] w-fit px-3 py-2 rounded-xl bg-orange-500/15 border border-orange-500/30 text-xs text-gray-100">{t.question}</div>
            <div className="glass rounded-xl p-3 space-y-2 text-xs">
              {!t.result ? (
                <p className="text-gray-500 animate-pulse">그래프 쿼리를 만드는 중...</p>
              ) : (
                <>
                  <p className={`font-bold ${t.result.rows.length ? "text-emerald-400" : "text-gray-300"}`}>{t.result.answer ?? "오류"}</p>
                  {t.result.route && (
                    <p className="text-[10px] text-gray-500">
                      <span className="px-1.5 py-0.5 rounded border border-white/10 text-gray-300 font-mono mr-1">
                        {{ jev: "Jev", local: "로컬 Qwen3.6", claude: "Claude" }[t.result.route]}
                      </span>
                      {t.result.plan && <span className="font-mono">{t.result.plan}</span>}
                    </p>
                  )}
                  {t.result.summary && <p className="text-gray-400">{t.result.summary}</p>}
                  {t.result.error && <p className="text-red-400">{t.result.error}</p>}
                  {t.result.sql && (
                    <details>
                      <summary className="text-[10px] text-gray-500 cursor-pointer">Claude 가 만든 쿼리</summary>
                      <pre className="mt-1 p-2 rounded bg-black/40 text-[10px] text-gray-300 overflow-x-auto whitespace-pre-wrap">{t.result.sql}</pre>
                    </details>
                  )}
                  {t.result.trace && t.result.trace.length > 0 && (
                    <details>
                      <summary className="text-[10px] text-gray-500 cursor-pointer">처리 경로</summary>
                      <ul className="mt-1 text-[10px] text-gray-500 font-mono list-disc pl-4">
                        {t.result.trace.map((x, k) => (
                          <li key={k}>{x}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {t.result.rows.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-white/10">
                            {t.result.columns.map((c) => (
                              <th key={c} className="px-2 py-1 font-semibold">{c}</th>
                            ))}
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {t.result.rows.map((row, r) => {
                            const pid = previewId(row);
                            const key = `${i}:${r}`;
                            return (
                              <Fragment key={key}>
                                <tr className="border-b border-white/5 align-top">
                                  {t.result!.columns.map((c) => {
                                    const v = row[c];
                                    const href = t.result!.links[r]?.[c];
                                    const text = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
                                    return (
                                      <td key={c} className="px-2 py-1 text-gray-300 max-w-[320px] truncate" title={text}>
                                        {href ? (
                                          <a href={href} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-mono text-[10px]">
                                            {text}
                                          </a>
                                        ) : (
                                          text
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="px-2 py-1 text-right">
                                    {pid && (
                                      <button onClick={() => setOpen(open === key ? null : key)} className="text-[10px] text-orange-400 hover:underline">
                                        {open === key ? "닫기" : "열기"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                                {open === key && pid && (
                                  <tr>
                                    <td colSpan={t.result!.columns.length + 1} className="p-2">
                                      <NodeCard id={pid} compact />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                      {t.result.truncated && <p className="text-[10px] text-gray-500 mt-1">처음 100건만 표시합니다.</p>}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={ask} className="flex gap-2 shrink-0">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="그래프에 입력된 교재·과목에 대해 물어보세요"
          className="flex-1 bg-[#121824] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 outline-none focus:border-orange-500"
        />
        <button disabled={busy || !question.trim()} className="px-4 rounded-xl bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-40">
          <Send className="w-4 h-4" />
        </button>
      </form>
    </main>
  );
}
