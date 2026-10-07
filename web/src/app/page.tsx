"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import BookBars from "@/components/BookBars";
import TocUnitForm from "@/components/TocUnitForm";
import PreviewColumn, { type PreviewPage } from "@/components/PreviewColumn";
import { fetchJsonPages, fetchPageUrls, fetchToc } from "@/lib/ocrApi";
import { commentaryList, stripExt } from "@/lib/toc";
import type { BookTocRow, DocEntry, SelectedBook, TocData } from "@/lib/types";

type Toast = { msg: string; type: "success" | "error" } | null;

export default function Home() {
  const [book, setBook] = useState<SelectedBook | null>(null);
  const [previewMode, setPreviewMode] = useState<"origin" | "commentary">("origin");
  // 비동기 결과는 어떤 요청에 대한 것인지(forKey)와 함께 보관하고, 현재 요청과 다르면 로딩 중으로 본다
  const [pagesResult, setPagesResult] = useState<{ forKey: string; pages: PreviewPage[] } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [jsonPagesResult, setJsonPagesResult] = useState<{ forKey: string; sets: { main: Set<number>; batch: Set<number> } } | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onError = useCallback(
    (e: unknown) => pushToast(`조회 실패: ${(e as Error).message}`, "error"),
    [pushToast]
  );

  const selectBook = useCallback((b: SelectedBook) => {
    setBook(b);
    setPreviewMode("origin");
    setPageIndex(0);
  }, []);

  const onSelectBookToc = useCallback(
    (row: BookTocRow) => {
      let toc: TocData | null = null;
      try {
        toc = row.toc ? JSON.parse(row.toc) : null;
      } catch {
        pushToast("TOC 파싱 오류", "error");
      }
      selectBook({
        source: "booktoc",
        sourceId: String(row.id),
        title: row.bookTitle,
        stem: stripExt(row.pdfFilename),
        documentId: toc?.documentId ?? null,
        toc,
        commentaryStem: stripExt(commentaryList(toc)[0] || ""),
      });
    },
    [pushToast, selectBook]
  );

  const onSelectDoc = useCallback(
    async (entry: DocEntry) => {
      try {
        const toc = await fetchToc(entry.id);
        selectBook({
          source: "document",
          sourceId: entry.id,
          title: toc.bookTitle || entry.main_stem || stripExt(entry.name),
          stem: stripExt(entry.name),
          documentId: Number(entry.id),
          toc,
          commentaryStem: stripExt(commentaryList(toc)[0] || ""),
        });
      } catch (e) {
        onError(e);
      }
    },
    [onError, selectBook]
  );

  const kind = previewMode === "commentary" ? "commentary" : "main";
  const stem = book ? (kind === "commentary" ? book.commentaryStem : book.stem) : "";

  // 도서/본문·해설서 전환 → 전체 페이지 목록 + JSON 추출 여부
  const pagesKey = stem ? `${kind}|${stem}` : "";
  const pages = !book ? null : !stem ? [] : pagesResult?.forKey === pagesKey ? pagesResult.pages : null;
  const jsonPages = jsonPagesResult?.forKey === pagesKey ? jsonPagesResult.sets : null;
  useEffect(() => {
    if (!pagesKey) return;
    let cancelled = false;
    fetchPageUrls(stem, kind)
      .then((p) => !cancelled && setPagesResult({ forKey: pagesKey, pages: p }))
      .catch((e) => {
        if (cancelled) return;
        setPagesResult({ forKey: pagesKey, pages: [] });
        onError(e);
      });
    fetchJsonPages(stem, kind)
      .then((sets) => !cancelled && setJsonPagesResult({ forKey: pagesKey, sets }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pagesKey, stem, kind, onError]);

  const changePreviewMode = (m: "origin" | "commentary") => {
    setPreviewMode(m);
    setPageIndex(0);
  };

  const curPage = pages?.[pageIndex]?.page ?? null;

  const storagePath = `${kind === "commentary" ? "commentaries" : "origin"}/${stem ? `${stem}/` : ""}`;

  return (
    <>
      <AppHeader subtitle="TOC 중심 Knowledge Graph 도서 입력" />

      <BookBars
        selectedKey={book ? `${book.source}:${book.sourceId}` : null}
        onSelectBookToc={onSelectBookToc}
        onSelectDoc={onSelectDoc}
        onError={onError}
      />

      <main className="flex-1 flex overflow-hidden p-4 gap-4">
        <PreviewColumn
          hasBook={!!book}
          hasCommentary={!!book?.commentaryStem}
          previewMode={previewMode}
          onPreviewMode={changePreviewMode}
          pages={book ? pages : []}
          pageIndex={pageIndex}
          onPageIndex={setPageIndex}
          storagePath={storagePath}
          jsonPages={jsonPages}
          onToast={pushToast}
        />
        <TocUnitForm book={book} kind={kind} page={curPage} onToast={pushToast} />
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl text-xs font-bold shadow-2xl z-50 ${
            toast.type === "error" ? "bg-red-500/90 text-white border border-red-500" : "bg-emerald-500/90 text-white border border-emerald-500"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </>
  );
}
