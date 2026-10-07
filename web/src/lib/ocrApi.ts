// unlimited-ocr 데이터 조회. 문서 목록·TOC 는 /api/docs(DB), 페이지·추출 JSON 은 /api/ocr/*(S3) 를 서버가 직접 읽는다
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

// TOC 문서 목록과 TOC 는 서버 라우트(/api/docs)가 DB(public.documents)에서 직접 읽는다
async function getDocsJson<T>(query: string): Promise<T> {
  const res = await api(`/api/docs?${query}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function fetchDocs(page: number) {
  return getDocsJson<{ entries?: DocEntry[]; page?: number; total_pages?: number; total?: number }>(`page=${page}&page_size=8`);
}

export function fetchToc(docId: string) {
  return getDocsJson<TocData>(`id=${encodeURIComponent(docId)}`);
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
