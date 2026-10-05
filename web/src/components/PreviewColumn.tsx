"use client";

import { ChevronLeft, ChevronRight, Copy, Database, Eye, FolderSearch, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatItemBodyForPreview, itemBodyRaw, typeset } from "@/lib/format";
import type { PageJson } from "@/lib/types";

export type PreviewPage = { page: number; url: string };
export type JsonState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; key: string; data: PageJson }
  | { status: "missing"; key: string }
  | { status: "error"; message: string };

type Props = {
  hasBook: boolean;
  hasCommentary: boolean;
  previewMode: "origin" | "commentary";
  onPreviewMode: (m: "origin" | "commentary") => void;
  pages: PreviewPage[] | null; // null = 로딩 중
  pageIndex: number;
  onPageIndex: (i: number) => void;
  storagePath: string;
  jsonStoragePath: string;
  jsonMode: "main" | "batch";
  onJsonMode: (m: "main" | "batch") => void;
  jsonPages: { main: Set<number>; batch: Set<number> } | null;
  json: JsonState;
  onToast: (msg: string, type?: "success" | "error") => void;
};

const modeBtn = (active: boolean, color: string) =>
  `px-2 py-0.5 text-[9px] font-bold rounded transition-all ${active ? `${color} text-white shadow-sm` : "text-gray-400 hover:text-white"}`;

// ocr.html 왼쪽 컬럼: 미리보기(본문/해설서, 회전, 페이지 이동) + 페이지 추출 JSON
export default function PreviewColumn(p: Props) {
  const [rotated, setRotated] = useState(false);
  const gotoRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const pages = p.pages || [];
  const cur = pages[p.pageIndex];

  useEffect(() => {
    if (p.json.status === "ok") typeset(itemsRef.current);
  }, [p.json]);

  const existing = p.jsonPages ? (p.jsonMode === "batch" ? p.jsonPages.batch : p.jsonPages.main) : null;
  const missingCount = existing ? pages.filter((pg) => !existing.has(pg.page)).length : 0;

  const go = (i: number) => {
    if (i >= 0 && i < pages.length) p.onPageIndex(i);
  };
  const goto = () => {
    const n = parseInt(gotoRef.current?.value || "", 10);
    if (isNaN(n)) return p.onToast("이동할 페이지 번호를 입력하세요.", "error");
    const i = pages.findIndex((pg) => pg.page === n);
    if (i === -1) return p.onToast(`페이지 ${n}가 존재하지 않습니다.`, "error");
    p.onPageIndex(i);
  };

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => p.onToast("클립보드에 복사되었습니다!"),
      () => p.onToast("복사에 실패했습니다.", "error")
    );

  return (
    <section className="w-1/2 flex flex-col gap-4 overflow-hidden">
      {/* 미리보기 */}
      <div className="flex-[3] flex flex-col glass rounded-2xl overflow-hidden relative">
        <div className="px-4 py-2 border-b border-white/5 bg-white/5 flex items-center justify-between shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Eye className="w-4 h-4 text-blue-400" />
            <span className="text-xs font-bold text-gray-300">미리보기</span>
            <div className="flex items-center gap-1 bg-black/35 p-0.5 rounded-lg border border-white/5 ml-1">
              <button className={modeBtn(p.previewMode === "origin", "bg-blue-600")} onClick={() => p.onPreviewMode("origin")}>
                본문
              </button>
              <button
                className={modeBtn(p.previewMode === "commentary", "bg-blue-600")}
                onClick={() => (p.hasCommentary ? p.onPreviewMode("commentary") : p.onToast("해설서 파일이 없습니다. TOC에 commentary가 연결되어 있는지 확인하세요.", "error"))}
              >
                해설서
              </button>
            </div>
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-400 text-[10px] font-mono ml-1 max-w-[280px] truncate shadow-sm"
              title={`STORAGE Path: ${p.storagePath}`}
            >
              <span className="text-gray-500 font-sans font-semibold text-[9px]">STORAGE:</span>
              <span className="text-orange-300 font-bold truncate">{p.storagePath}</span>
            </div>
            <button
              onClick={() => setRotated((r) => !r)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded-md border transition-all flex items-center gap-1 shadow-sm ml-1 ${
                rotated ? "border-amber-500 text-amber-400 bg-amber-500/20" : "border-white/10 text-gray-300 bg-white/5 hover:border-amber-500/50"
              }`}
              title="미리보기 화면 180도 회전 표시/해제"
            >
              <RotateCw className="w-3.5 h-3.5" /> 180° 회전
            </button>
          </div>
          {pages.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 border border-white/10 rounded-lg p-0.5 bg-black/25">
                <button className="p-1 rounded hover:bg-white/10 text-gray-400 disabled:opacity-30" disabled={p.pageIndex === 0} onClick={() => go(p.pageIndex - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-semibold text-gray-400 font-mono px-1">
                  {p.pageIndex + 1} / {pages.length}
                </span>
                <button
                  className="p-1 rounded hover:bg-white/10 text-gray-400 disabled:opacity-30"
                  disabled={p.pageIndex === pages.length - 1}
                  onClick={() => go(p.pageIndex + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button className="px-2 py-1 text-[10px] font-semibold border border-white/10 rounded hover:bg-white/10 text-gray-400 hover:text-white" onClick={() => go(0)}>
                  맨 처음으로
                </button>
                <button
                  className="px-2 py-1 text-[10px] font-semibold border border-white/10 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                  onClick={() => go(pages.length - 1)}
                >
                  마지막 페이지로
                </button>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  key={cur?.page}
                  ref={gotoRef}
                  defaultValue={cur?.page}
                  onKeyDown={(e) => e.key === "Enter" && goto()}
                  className="w-14 bg-[#121824] border border-white/10 text-[10px] text-center rounded px-1.5 py-1 outline-none focus:border-blue-500 text-gray-300 font-mono"
                  placeholder="Page"
                />
                <button className="px-2 py-1 text-[10px] font-bold rounded bg-blue-600 hover:bg-blue-700 text-white shadow-sm" onClick={goto}>
                  이동
                </button>
              </div>
              {existing && (
                <div className="flex items-center gap-1.5 pl-2 border-l border-white/10 text-xs font-bold text-red-500 font-mono select-none">
                  <span>JSON 미추출: {missingCount}개</span>
                  <span className="text-red-400/40 font-normal">|</span>
                  <span>현재 페이지: {cur && existing.has(cur.page) ? "추출됨" : "미추출"}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 bg-[#0d1117] flex items-center justify-center p-4 overflow-auto">
          {!p.hasBook ? (
            <p className="text-xs text-gray-500">도서를 선택하면 본문 전체 페이지가 표시됩니다. 본문/해설서 토글로 전환하세요.</p>
          ) : p.pages === null ? (
            <p className="text-xs text-gray-500">전체 페이지 목록을 불러오는 중...</p>
          ) : !cur ? (
            <p className="text-xs text-red-400">페이지가 없습니다: {p.storagePath}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cur.url}
              alt={`Page ${cur.page}`}
              className="max-w-full max-h-full rounded-xl shadow-xl border border-white/5 object-contain transition-transform duration-300"
              style={rotated ? { transform: "rotate(180deg)" } : undefined}
            />
          )}
        </div>
      </div>

      {/* 페이지 추출 JSON */}
      <div className="flex-[2] flex flex-col glass rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/5 bg-white/5 flex items-center gap-2 flex-wrap shrink-0">
          <Database className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-gray-300">페이지 추출 JSON</span>
          <div className="flex items-center gap-1 bg-black/35 p-0.5 rounded-lg border border-white/5 ml-1">
            <button className={modeBtn(p.jsonMode === "main", "bg-emerald-600")} onClick={() => p.onJsonMode("main")} title="기본 저장소 경로 (main/ 또는 sub/)">
              기본(main)
            </button>
            <button className={modeBtn(p.jsonMode === "batch", "bg-emerald-600")} onClick={() => p.onJsonMode("batch")} title="배치 저장소 경로 (batch/main/ 또는 batch/subs/)">
              Batch(batch/main)
            </button>
          </div>
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-400 text-[10px] font-mono ml-1 max-w-[280px] truncate shadow-sm"
            title={`JSON STORAGE Path: ${p.jsonStoragePath}`}
          >
            <span className="text-gray-500 font-sans font-semibold text-[9px]">STORAGE:</span>
            <span className="text-emerald-300 font-bold truncate">{p.jsonStoragePath}</span>
          </div>
        </div>
        <div ref={itemsRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {p.json.status === "idle" && <p className="text-xs text-gray-500 text-center py-6">선택된 페이지 데이터가 없습니다.</p>}
          {p.json.status === "loading" && <p className="text-xs text-gray-500 text-center py-6 animate-pulse">페이지 데이터를 불러오고 있습니다...</p>}
          {p.json.status === "error" && <p className="text-xs text-red-400 text-center py-6 font-bold">{p.json.message}</p>}
          {p.json.status === "missing" && (
            <div className="text-center py-6 space-y-3">
              <p className="text-xs text-gray-500 font-semibold">이 페이지에 해당하는 {p.json.key}가 S3에 존재하지 않습니다.</p>
              <button
                onClick={() => p.onJsonMode(p.jsonMode === "batch" ? "main" : "batch")}
                className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-emerald-400 inline-flex items-center gap-1"
              >
                <FolderSearch className="w-3.5 h-3.5" />
                <span>{p.jsonMode === "batch" ? "기본 (main/)" : "Batch (batch/main/)"} 경로로 다시 조회</span>
              </button>
            </div>
          )}
          {p.json.status === "ok" &&
            ((p.json.data.items || []).length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">구조화된 항목 세그먼트가 없습니다.</p>
            ) : (
              (p.json.data.items || []).map((item, idx) => {
                const cat = item.category || "기타";
                const badge =
                  cat === "개념"
                    ? "bg-blue-500/10 border-blue-500/20 text-blue-400"
                    : cat === "해답"
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-white/5 border-white/10 text-gray-400";
                return (
                  <div key={idx} className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-2 hover:bg-white/10 hover:border-white/10 transition-all">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${badge}`}>{cat}</span>
                      <span className="text-[10px] text-gray-500 font-bold"># {idx + 1}</span>
                    </div>
                    <div
                      className="db-item-body text-xs text-gray-300 leading-relaxed font-medium"
                      dangerouslySetInnerHTML={{ __html: formatItemBodyForPreview(itemBodyRaw(item)) }}
                    />
                    <div className="flex items-center justify-between pt-2 border-t border-white/5 mt-2">
                      <span className="text-[9px] text-gray-500 font-mono">단일 항목 복사</span>
                      <button onClick={() => copy(itemBodyRaw(item))} className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white" title="내용 복사">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            ))}
        </div>
      </div>
    </section>
  );
}
