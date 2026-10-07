"use client";

import { ChevronLeft, ChevronRight, Eye, Minus, Plus, RotateCw } from "lucide-react";
import { useRef, useState } from "react";
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
  jsonPages: { main: Set<number>; batch: Set<number> } | null; // 추출 JSON 이 있는 페이지 (main/, batch/main/)
  onToast: (msg: string, type?: "success" | "error") => void;
};

const modeBtn = (active: boolean, color: string) =>
  `px-2 py-0.5 text-[9px] font-bold rounded transition-all ${active ? `${color} text-white shadow-sm` : "text-gray-400 hover:text-white"}`;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

// ocr.html 왼쪽 컬럼: 미리보기(본문/해설서, 회전, 확대·축소, 페이지 이동)
export default function PreviewColumn(p: Props) {
  const [rotated, setRotated] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = 화면에 맞춤
  const gotoRef = useRef<HTMLInputElement>(null);
  const pages = p.pages || [];
  const cur = pages[p.pageIndex];

  // main/ 또는 batch/main/ 어느 쪽에든 있으면 추출된 페이지
  const extracted = (n: number) => !!p.jsonPages && (p.jsonPages.main.has(n) || p.jsonPages.batch.has(n));
  const missingCount = p.jsonPages ? pages.filter((pg) => !extracted(pg.page)).length : 0;
  const zoomBy = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.indexOf(zoom) + dir;
    if (i >= 0 && i < ZOOM_STEPS.length) setZoom(ZOOM_STEPS[i]);
  };

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

  return (
    <section className="w-1/2 flex flex-col gap-4 overflow-hidden">
      {/* 미리보기 */}
      <div className="flex-1 flex flex-col glass rounded-2xl overflow-hidden relative">
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
            <div className="flex items-center gap-0.5 border border-white/10 rounded-lg p-0.5 bg-black/25 ml-1">
              <button
                className="p-1 rounded hover:bg-white/10 text-gray-300 disabled:opacity-30"
                onClick={() => zoomBy(-1)}
                disabled={zoom === ZOOM_STEPS[0]}
                title="이미지 축소"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                className="px-1 text-[10px] font-mono text-gray-400 hover:text-white min-w-[38px]"
                onClick={() => setZoom(1)}
                title="화면에 맞춤 (100%)"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="p-1 rounded hover:bg-white/10 text-gray-300 disabled:opacity-30"
                onClick={() => zoomBy(1)}
                disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                title="이미지 확대"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
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
              {p.jsonPages && (
                <div className="flex items-center gap-1.5 pl-2 border-l border-white/10 text-xs font-bold text-red-500 font-mono select-none">
                  <span>JSON 미추출: {missingCount}개</span>
                  <span className="text-red-400/40 font-normal">|</span>
                  <span>현재 페이지: {cur && extracted(cur.page) ? "추출됨" : "미추출"}</span>
                </div>
              )}
            </div>
          )}
        </div>
        {/* 100% = 화면에 맞춤. 확대하면 스크롤로 본다 (m-auto: 작을 때 가운데, 클 때 스크롤 가능) */}
        <div className="flex-1 bg-[#0d1117] flex p-4 overflow-auto">
          {!p.hasBook ? (
            <p className="m-auto text-xs text-gray-500">도서를 선택하면 본문 전체 페이지가 표시됩니다. 본문/해설서 토글로 전환하세요.</p>
          ) : p.pages === null ? (
            <p className="m-auto text-xs text-gray-500">전체 페이지 목록을 불러오는 중...</p>
          ) : !cur ? (
            <p className="m-auto text-xs text-red-400">페이지가 없습니다: {p.storagePath}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cur.url}
              alt={`Page ${cur.page}`}
              className={`m-auto rounded-xl shadow-xl border border-white/5 object-contain transition-transform duration-300 ${
                zoom === 1 ? "max-w-full max-h-full" : "max-w-none"
              }`}
              style={{ ...(zoom === 1 ? {} : { height: `${zoom * 100}%` }), ...(rotated ? { transform: "rotate(180deg)" } : {}) }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
