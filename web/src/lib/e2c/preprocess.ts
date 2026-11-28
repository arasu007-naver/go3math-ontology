import { stripHtml } from "../server/legacyDb.ts";
import { problemHash } from "./hash.ts";
import type { KeyStep, ProblemInput, ProblemMeta } from "./types.ts";

export const MIN_CHARS = 40;
export const MAX_CHARS = 6000;
const PROBLEM_MAX = 3000;
export const ELISION = "…(중략)…";

// 출제처 + 월 → 시험 종류
export function resolveExam(subscriber: string | null, month: number | null): string | null {
  if (!subscriber) return null;
  if (subscriber.includes("평가원")) return month === 11 ? "수능" : "모평";
  if (subscriber.includes("교육청")) return "학평";
  return subscriber;
}

// 해답을 줄·문장 단위로 나눈다. backtick 수식 안은 자르지 않는다.
export function splitSteps(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let cur = "";
    let inMath = false;
    const chars = [...line];
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      cur += c;
      if (c === "`") inMath = !inMath;
      else if (!inMath && (c === "." || c === "?" || c === "!" || c === "。") && (i + 1 === chars.length || /\s/.test(chars[i + 1]))) {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

export type RawProblem = {
  id: number;
  statement: string | null;
  note: string | null;
  year: number | null;
  month: number | null;
  subscriber: string | null;
  subject: string | null;
  number: number | null;
  points: number | null;
};

export function preprocess(raw: RawProblem): ProblemInput {
  const problemFull = stripHtml(raw.statement);
  const solutionText = stripHtml(raw.note);
  const meta: ProblemMeta = {
    year: raw.year, month: raw.month, exam: resolveExam(raw.subscriber, raw.month), subject: raw.subject, number: raw.number, points: raw.points,
  };
  const all: KeyStep[] = splitSteps(solutionText).map((text, i) => ({ id: `S${i + 1}`, text }));
  const skipped = problemFull.length + solutionText.length < MIN_CHARS;
  let truncated = false;
  let problemText = problemFull;
  if (problemText.length > PROBLEM_MAX) {
    problemText = problemText.slice(0, PROBLEM_MAX) + ELISION;
    truncated = true;
  }
  let keySteps = all;
  const stepLen = (s: KeyStep) => s.text.length + s.id.length + 2;
  const total = all.reduce((n, s) => n + stepLen(s), 0);
  if (problemText.length + total > MAX_CHARS) {
    truncated = true;
    let budget = MAX_CHARS - problemText.length;
    let head = 0;
    let tail = all.length;
    // 앞뒤를 번갈아 남긴다
    while (head < tail) {
      const a = all[head];
      if (stepLen(a) > budget) break;
      budget -= stepLen(a);
      head++;
      if (head >= tail) break;
      const b = all[tail - 1];
      if (stepLen(b) > budget) break;
      budget -= stepLen(b);
      tail--;
    }
    keySteps = [...all.slice(0, head), { id: "", text: ELISION }, ...all.slice(tail)];
  }
  return {
    id: raw.id,
    meta,
    problemText,
    solutionText,
    keySteps,
    truncated,
    skipped,
    inputHash: problemHash(problemFull, solutionText, meta),
    legacyConceptHints: [],
    droppedHints: 0,
  };
}
