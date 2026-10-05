// unlimited-ocr API (서버 라우트 /api/ocr/* 경유, 토큰은 서버가 붙인다)
import { api } from "./api";
import type { BookTocRow, DocEntry, PageJson, TocData } from "./types";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await api(`/api/ocr${path}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// BookToc 은 apiv3 를 직접 호출하는 서버 라우트(/api/book-toc) 경유
// 작성자는 서버가 로그인 사용자 아이디로 정한다
export async function fetchBookTocs(page: number) {
  const res = await api(`/api/book-toc/${page}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as { content?: BookTocRow[]; number?: number; totalPages?: number; totalElements?: number; writer: string };
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
  const res = await api(`/api/ocr/get-json?key=${encodeURIComponent(key)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ocr.html 의 저장소 경로 규칙: main/<stem>/, batch/main/<stem>/, sub/<stem>/, batch/subs/<stem>/
export function jsonStorageKey(stem: string, kind: "main" | "commentary", batch: boolean, page: number) {
  if (kind === "commentary") return `${batch ? "batch/subs" : "sub"}/${stem}/${page}.json`;
  return `${batch ? "batch/main" : "main"}/${stem}/${page}.json`;
}
