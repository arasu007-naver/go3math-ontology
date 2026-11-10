// 색인 zip(제n장-indices/dictonary/flashcards/quizzes.json) 해석. DB·zip 라이브러리에 의존하지 않는 순수 함수.

export const KINDS = ["indices", "dictionary", "flashcards", "quizzes"] as const;
export type Kind = (typeof KINDS)[number];
export type ChapterFiles = Record<Kind, string>; // 종류 → zip 안 파일 경로

// Windows 에서 만든 zip 은 한글 파일명이 깨질 수 있어 "숫자 … -종류.json" 으로 찾는다. dictonary/dictionary 철자 둘 다 받는다.
const FILE_RE = /(\d+)\D*-(indices|dictonary|dictionary|flashcards|quizzes)\.json$/i;

// zip 안 파일 경로들을 장 번호별 한 벌로 묶는다. missing 은 한 벌에서 빠진 파일 이름.
export function groupChapterFiles(names: string[]): { chapters: Map<number, ChapterFiles>; missing: string[] } {
  const found = new Map<number, Partial<ChapterFiles>>();
  for (const name of names) {
    if (name.startsWith("__MACOSX/")) continue;
    const m = FILE_RE.exec(name.split(/[\\/]/).pop() ?? "");
    if (!m) continue;
    const n = Number(m[1]);
    const kind = (m[2].toLowerCase() === "dictonary" ? "dictionary" : m[2].toLowerCase()) as Kind;
    found.set(n, { ...found.get(n), [kind]: name });
  }
  const chapters = new Map<number, ChapterFiles>();
  const missing: string[] = [];
  for (const n of [...found.keys()].sort((a, b) => a - b)) {
    const files = found.get(n)!;
    const lack = KINDS.filter((k) => !files[k]);
    if (lack.length) missing.push(...lack.map((k) => `제${n}장-${k === "dictionary" ? "dictonary" : k}.json`));
    else chapters.set(n, files as ChapterFiles);
  }
  return { chapters, missing };
}

// 색인명 비교용 (유니코드 정규화 + 앞뒤 공백 제거)
export const indexKey = (v: unknown): string => (typeof v === "string" ? v.normalize("NFC").trim() : "");

// 항목의 index 키로 색인 id 를 찾는다. 없으면 null.
export function linkIndexId(item: { index?: unknown }, idByTerm: Map<string, number>): number | null {
  return idByTerm.get(indexKey(item.index)) ?? null;
}

export function toPages(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : [];
}
