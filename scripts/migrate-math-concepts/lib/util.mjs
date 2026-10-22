import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// ---------- 파일 ----------
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return fallback;
    throw e;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 1));
  fs.renameSync(file + ".tmp", file);
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// ---------- CSV (엑셀에서 열 수 있게 BOM + CRLF. 목록 값은 공백으로 구분) ----------
const cell = (v) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join(" ") : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function writeCsv(file, header, rows) {
  const lines = [header, ...rows.map((r) => header.map((h) => r[h]))].map((r) => r.map(cell).join(","));
  writeText(file, "﻿" + lines.join("\r\n") + "\r\n");
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [header = [], ...rest] = rows;
  return rest.filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export const readCsv = (file) => (fs.existsSync(file) ? parseCsv(fs.readFileSync(file, "utf8")) : []);
export const splitList = (s) => String(s ?? "").split(/[\s;,]+/).filter(Boolean);

// ---------- 텍스트·벡터 ----------
// HTML 태그를 걷어낸다. 백틱(`) 안(AsciiMath 수식)은 손대지 않는다. 이미지는 [이미지] 로 남긴다.
const HTML_TAG = /<\/?(?:div|span|p|br|img|b|i|u|strong|em|sup|sub|font|table|thead|tbody|tr|td|th|ul|ol|li|hr|a|center)\b[^>]*>/gi;
export const stripHtml = (s) =>
  String(s ?? "")
    .split("`")
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/<img\b[^>]*>/gi, " [이미지] ")
            .replace(/<br\s*\/?>|<\/(?:div|p|li|tr)>/gi, "\n")
            .replace(HTML_TAG, "")
            .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
            .replace(/[ \t]+/g, " ")
            .replace(/ *\n[ \n]*/g, "\n")
    )
    .join("`")
    .trim();

// 제목 정규화: 공백·괄호·기호 제거, 소문자 (스펙 4장 단계 0)
export const normalizeTitle = (s) =>
  String(s ?? "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export const titleSimilarity = (a, b) => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- 학년 ----------
// 학년 번호: 초1~6 = 1~6, 중1~3 = 7~9, 고1~3 = 10~12
export function gradeOf(curriculumType) {
  const m = /^(ELEMENTARY|MIDDLESCHOOL|HIGHSCHOOL)_(\d)$/.exec(curriculumType ?? "");
  return m ? { ELEMENTARY: 0, MIDDLESCHOOL: 6, HIGHSCHOOL: 9 }[m[1]] + Number(m[2]) : null;
}
export const gradeLabel = (g) => (g == null ? "?" : g <= 6 ? `초${g}` : g <= 9 ? `중${g - 6}` : `고${g - 9}`);

// ---------- 비동기 ----------
export async function pool(items, n, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const k = next++;
      await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 레이트리밋(429)·5xx·네트워크 오류는 지수 백오프로 재시도
export async function withRetry(fn, { tries = 6, base = 1000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e.retryable ?? e.name === "TypeError"; // fetch 네트워크 오류는 TypeError
      if (attempt >= tries - 1 || !retryable) throw e;
      await sleep(base * 2 ** attempt * (0.5 + Math.random()));
    }
  }
}

export async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
    e.retryable = r.status === 429 || r.status >= 500;
    throw e;
  }
  return JSON.parse(text);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    if (m[2] != null) args[m[1]] = m[2];
    else if (argv[i + 1] != null && !argv[i + 1].startsWith("--")) args[m[1]] = argv[++i];
    else args[m[1]] = true;
  }
  return args;
}
