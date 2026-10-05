"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { fetchBookTocs, fetchDocs } from "@/lib/ocrApi";
import type { BookTocRow, DocEntry } from "@/lib/types";

const navBtn =
  "p-1.5 rounded-lg border border-white/10 hover:bg-white/10 text-gray-300 disabled:opacity-30 disabled:hover:bg-transparent transition-all";
const tabIdle = "border-white/10 bg-white/5 text-gray-300 hover:border-white/20";
const tabActive = "border-orange-500 bg-orange-500/20 text-orange-400 font-bold";

type Props = {
  selectedKey: string | null; // "booktoc:<id>" | "document:<id>"
  onSelectBookToc: (row: BookTocRow) => void;
  onSelectDoc: (entry: DocEntry) => void;
  onError: (err: unknown) => void;
};

// ocr.html 상단 두 줄: BookToc(작성자별) 목록 + TOC 문서 목록, 각각 페이지네이션
export default function BookBars({ selectedKey, onSelectBookToc, onSelectDoc, onError }: Props) {
  const [writer, setWriter] = useState(""); // 로그인 사용자 아이디 (서버가 정함)
  const [bookTocs, setBookTocs] = useState<BookTocRow[] | null>(null);
  const [btPage, setBtPage] = useState({ page: 0, totalPages: 1, total: 0 });
  const [btError, setBtError] = useState(false);

  const [docs, setDocs] = useState<DocEntry[] | null>(null);
  const [docPage, setDocPage] = useState({ page: 1, totalPages: 1, total: 0 });
  const [docError, setDocError] = useState(false);

  const loadBookTocs = useCallback(
    async (page: number) => {
      setBookTocs(null);
      setBtError(false);
      try {
        const data = await fetchBookTocs(page);
        setWriter(data.writer);
        setBookTocs(data.content || []);
        setBtPage({ page: data.number ?? page, totalPages: data.totalPages || 1, total: data.totalElements || 0 });
      } catch (e) {
        setBtError(true);
        onError(e);
      }
    },
    [onError]
  );

  const loadDocs = useCallback(
    async (page: number) => {
      setDocs(null);
      setDocError(false);
      try {
        const data = await fetchDocs(page);
        setDocs(data.entries || []);
        setDocPage({ page: data.page || page, totalPages: data.total_pages || 1, total: data.total || 0 });
      } catch (e) {
        setDocError(true);
        onError(e);
      }
    },
    [onError]
  );

  useEffect(() => {
    // 첫 화면에서 목록을 불러온다 (로딩 표시를 위한 상태 초기화 포함)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBookTocs(0);
    loadDocs(1);
  }, [loadBookTocs, loadDocs]);

  return (
    <>
      <div className="border-b border-white/5 py-3 px-6 flex items-center justify-between shrink-0 glass shadow-sm gap-6">
        <div className="flex flex-wrap items-center gap-2 max-w-[65%] overflow-x-auto py-1">
          {btError ? (
            <span className="text-xs text-red-400 py-1">목록 로드 오류</span>
          ) : bookTocs === null ? (
            <span className="text-xs text-gray-500 py-1">BookToc 로딩 중...</span>
          ) : bookTocs.length === 0 ? (
            <span className="text-xs text-gray-500 py-1">저장된 BookToc이 없습니다.</span>
          ) : (
            bookTocs.map((b) => (
              <button
                key={b.id}
                onClick={() => onSelectBookToc(b)}
                className={`px-3 py-1 text-xs rounded-lg border transition-all shrink-0 ${
                  selectedKey === `booktoc:${b.id}` ? tabActive : tabIdle
                }`}
              >
                {b.bookTitle}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 font-medium text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-400">작성자:</span>
            <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-200 font-mono" title="로그인한 사용자 아이디">
              {writer || "-"}
            </span>
          </div>
          <span className="text-xs text-gray-400 font-medium">
            {btPage.page + 1} / {btPage.totalPages} (총 {btPage.total})
          </span>
          <div className="flex items-center gap-1">
            <button className={navBtn} title="처음" disabled={btPage.page <= 0} onClick={() => loadBookTocs(0)}>
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button className={navBtn} title="이전" disabled={btPage.page <= 0} onClick={() => loadBookTocs(btPage.page - 1)}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              className={navBtn}
              title="다음"
              disabled={btPage.page >= btPage.totalPages - 1}
              onClick={() => loadBookTocs(btPage.page + 1)}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              className={navBtn}
              title="끝"
              disabled={btPage.page >= btPage.totalPages - 1}
              onClick={() => loadBookTocs(btPage.totalPages - 1)}
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="border-b border-white/5 py-3 px-6 flex items-center justify-between shrink-0 glass shadow-sm gap-6">
        <div className="flex flex-wrap items-center gap-2 max-w-[70%] overflow-x-auto py-1">
          {docError ? (
            <span className="text-xs text-red-400 py-1">목록 로드 오류</span>
          ) : docs === null ? (
            <span className="text-xs text-gray-500 py-1">TOC 도서 로딩 중...</span>
          ) : docs.length === 0 ? (
            <span className="text-xs text-gray-500 py-1">등록된 TOC 도서가 없습니다.</span>
          ) : (
            docs.map((d) => {
              const status =
                d.status === "processing"
                  ? { c: "border-blue-500/40 bg-blue-500/10 text-blue-400", l: "진행중" }
                  : d.status === "queued"
                    ? { c: "border-amber-500/40 bg-amber-500/10 text-amber-400", l: "대기중" }
                    : d.status === "done"
                      ? { c: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400", l: "완료" }
                      : { c: tabIdle, l: "" };
              const active = selectedKey === `document:${d.id}`;
              return (
                <button
                  key={d.id}
                  onClick={() => onSelectDoc(d)}
                  className={`flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs font-semibold transition-all shadow-sm shrink-0 ${
                    active ? tabActive : status.c
                  }`}
                >
                  <span>{d.main_stem || String(d.name).replace(".json", "")}</span>
                  {status.l && (
                    <span
                      className={`text-[8px] font-bold px-1 rounded ${
                        d.status === "done" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"
                      }`}
                    >
                      {status.l}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-4 shrink-0 font-medium">
          <span className="text-xs text-gray-400 font-medium">
            전체 {docPage.total}개 ({docPage.page}/{docPage.totalPages} 페이지)
          </span>
          <div className="flex items-center gap-1.5">
            <button className={navBtn} disabled={docPage.page <= 1} onClick={() => loadDocs(docPage.page - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className={navBtn} disabled={docPage.page >= docPage.totalPages} onClick={() => loadDocs(docPage.page + 1)}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
