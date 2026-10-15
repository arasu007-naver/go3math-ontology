import { Pool } from "pg";
import { getBytes, putText } from "./s3";

// 교재 PDF → Mathpix MD 전환 (office-manager PDFUploaderModal 과 같은 Mathpix v3/pdf 흐름).
// Mathpix 키는 .env.local 의 MATHPIX_APP_ID / MATHPIX_APP_KEY 를 쓰고 브라우저로 내보내지 않는다.
const MATHPIX_API = "https://api.mathpix.com/v3/pdf";
const ORIGIN_PREFIX = process.env.S3_ORIGIN_PREFIX || "origin";
const MD_PREFIX = process.env.S3_MD_PREFIX || "mathpix";

const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {});

export type ConvertStatus = "submitted" | "completed" | "saved" | "failed";
export type ConvertLog = {
  id: number;
  book_stem: string;
  book_title: string | null;
  pdf_key: string;
  mathpix_pdf_id: string;
  status: ConvertStatus;
  md_key: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function mathpixHeaders() {
  const app_id = process.env.MATHPIX_APP_ID;
  const app_key = process.env.MATHPIX_APP_KEY;
  if (!app_id || !app_key) throw new Error("MATHPIX_APP_ID / MATHPIX_APP_KEY 가 설정되지 않았습니다.");
  return { app_id, app_key };
}

async function updateLog(id: number, status: ConvertStatus, fields: { md_key?: string; error?: string } = {}) {
  const r = await pool.query<ConvertLog>(
    `UPDATE kg.document_convert_log
     SET status = $2, md_key = COALESCE($3, md_key), error = $4, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status, fields.md_key ?? null, fields.error ?? null]
  );
  return r.rows[0];
}

export async function latestLog(bookStem: string): Promise<ConvertLog | null> {
  const r = await pool.query<ConvertLog>(
    `SELECT * FROM kg.document_convert_log WHERE book_stem = $1 ORDER BY created_at DESC LIMIT 1`,
    [bookStem]
  );
  return r.rows[0] ?? null;
}

// 1. PDF → Mathpix: 원본 PDF 를 Mathpix 에 올리고 받은 pdf_id 를 submitted 로 기록
export async function submitPdf(bookStem: string, bookTitle: string | null): Promise<ConvertLog> {
  const pdfKey = `${ORIGIN_PREFIX}/${bookStem}.pdf`;
  const bytes = await getBytes(pdfKey);
  if (!bytes) throw new Error(`원본 PDF 가 없습니다: ${pdfKey}`);

  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), `${bookStem}.pdf`);
  const res = await fetch(MATHPIX_API, { method: "POST", headers: mathpixHeaders(), body: form });
  const j = (await res.json()) as { pdf_id?: string; error?: string };
  if (!res.ok || !j.pdf_id) throw new Error(`Mathpix 제출 실패: ${j.error || res.status}`);

  const r = await pool.query<ConvertLog>(
    `INSERT INTO kg.document_convert_log (book_stem, book_title, pdf_key, mathpix_pdf_id)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [bookStem, bookTitle, pdfKey, j.pdf_id]
  );
  return r.rows[0];
}

// 2. Mathpix 조회: submitted 인 기록의 처리 상태를 확인해 completed / failed 로 바꾼다
export async function refreshStatus(log: ConvertLog): Promise<ConvertLog> {
  if (log.status !== "submitted") return log;
  const res = await fetch(`${MATHPIX_API}/${log.mathpix_pdf_id}`, { headers: mathpixHeaders(), cache: "no-store" });
  const j = (await res.json()) as { status?: string; error?: string };
  if (j.status === "completed") return updateLog(log.id, "completed");
  if (j.status === "error" || j.status === "failed" || !res.ok) {
    return updateLog(log.id, "failed", { error: j.error || j.status || `HTTP ${res.status}` });
  }
  return log;
}

// 3. 저장: 전환된 MD 를 qoollastorage 의 <S3_MD_PREFIX>/<stem>.md 로 저장
export async function saveMd(log: ConvertLog): Promise<ConvertLog> {
  if (log.status !== "completed" && log.status !== "saved") throw new Error("MD 전환이 완료되지 않았습니다.");
  const res = await fetch(`${MATHPIX_API}/${log.mathpix_pdf_id}.md`, { headers: mathpixHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`Mathpix MD 다운로드 실패 (${res.status})`);
  const mdKey = `${MD_PREFIX}/${log.book_stem}.md`;
  await putText(mdKey, await res.text());
  return updateLog(log.id, "saved", { md_key: mdKey });
}
