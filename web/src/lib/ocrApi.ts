// unlimited-ocr API (next.config.ts 의 /api/ocr/* 프록시 경유)
import type { BookTocRow, DocEntry, PageJson, TocData } from "./types";

export class OcrAuthError extends Error {}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/ocr${path}`, { signal, credentials: "include" });
  if (res.status === 401) throw new OcrAuthError("unlimited-ocr 로그인이 필요합니다.");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// BookToc 은 apiv3 를 직접 호출하는 서버 라우트(/api/book-toc) 경유
export async function fetchBookTocs(writer: string, page: number) {
  const res = await fetch(`/api/book-toc/by-writer/${encodeURIComponent(writer)}/${page}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as { content?: BookTocRow[]; number?: number; totalPages?: number; totalElements?: number };
}

export function fetchDocs(page: number) {
  return getJson<{ entries?: DocEntry[]; page?: number; total_pages?: number; total?: number }>(
    `/toc-list?page=${page}&page_size=8`
  );
}

export function fetchToc(docId: string) {
  return getJson<TocData>(`/get-toc?id=${encodeURIComponent(docId)}`);
}

// MinIO 폴더명이 NFC/NFD 섞여 있으므로 서버가 돌려준 실제 키로 URL을 만든다 (ocr.html getS3PageUrls 와 동일)
export async function fetchPageUrls(stem: string, kind: "main" | "commentary") {
  const data = await getJson<{ pages?: { page: number; key: string }[] }>(
    `/list-pages?pdf_name=${encodeURIComponent(stem)}&kind=${kind}`
  );
  return (data.pages || [])
    .map((p) => ({
      page: Number(p.page),
      url: `https://s3.qoolla.com/qoollastorage/${String(p.key).split("/").map(encodeURIComponent).join("/")}`,
    }))
    .sort((a, b) => a.page - b.page);
}

export async function fetchJsonPages(stem: string, kind: "main" | "commentary") {
  const data = await getJson<{ batch_pages?: number[]; main_pages?: number[] }>(
    `/list-json-pages?pdf_name=${encodeURIComponent(stem)}&kind=${kind}`
  );
  return { batch: new Set(data.batch_pages || []), main: new Set(data.main_pages || []) };
}

// 404 면 null
export async function fetchPageJson(key: string, signal?: AbortSignal): Promise<PageJson | null> {
  const res = await fetch(`/api/ocr/get-json?key=${encodeURIComponent(key)}`, { signal, credentials: "include" });
  if (res.status === 401) throw new OcrAuthError("unlimited-ocr 로그인이 필요합니다.");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ocr.html 의 저장소 경로 규칙: main/<stem>/, batch/main/<stem>/, sub/<stem>/, batch/subs/<stem>/
export function jsonStorageKey(stem: string, kind: "main" | "commentary", batch: boolean, page: number) {
  if (kind === "commentary") return `${batch ? "batch/subs" : "sub"}/${stem}/${page}.json`;
  return `${batch ? "batch/main" : "main"}/${stem}/${page}.json`;
}
