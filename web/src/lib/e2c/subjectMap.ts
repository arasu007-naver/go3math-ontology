import { DEFAULT_CONFIG } from "./config.ts";

// 시험 과목(enum) → KG 과목 id 접두. 매핑이 없으면 null(=고등 전체, candidate_fallback).
export function subjectPrefixes(subject: string | null, map: Record<string, string[]> = DEFAULT_CONFIG.subject_map): string[] | null {
  if (!subject) return null;
  const p = map[subject];
  return p && p.length ? p : null;
}

export const unitInPrefixes = (unitId: string, prefixes: string[]) => prefixes.some((p) => unitId === p || unitId.startsWith(`${p}-`));
