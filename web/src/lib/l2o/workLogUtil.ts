// 작업 이력(kg.work_log) 순수 로직 — 외부 의존 없음 (npm run test:l2o 로 테스트)

type QuizLike = { quiz_type?: unknown; options?: unknown };

// 서술형: quiz_type 이 descriptive 이거나 options 가 없거나 빈 배열
export function isDescriptiveQuiz(q: QuizLike): boolean {
  if (q.quiz_type === "descriptive") return true;
  return !Array.isArray(q.options) || q.options.length === 0;
}

export function splitQuizzes(items: QuizLike[]): { quiz: number; descriptive: number } {
  let descriptive = 0;
  for (const q of items) if (isDescriptiveQuiz(q)) descriptive++;
  return { quiz: items.length - descriptive, descriptive };
}

export function actorOfJudgedBy(judgedBy: string | null | undefined): string {
  const m = /^override:(.+)$/.exec(judgedBy ?? "");
  return m ? m[1] : "system";
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// 날짜 이동 계산. days 는 로그가 있는 날짜(YYYY-MM-DD) 내림차순. date 가 없으면 가장 최근.
export function computeDayNav(days: string[], date?: string) {
  if (days.length === 0) return { date: null, pageIndex: null, firstDate: null, lastDate: null, newerDate: null, olderDate: null };
  const cur = date ?? days[0];
  const idx = days.indexOf(cur);
  return {
    date: cur,
    pageIndex: idx >= 0 ? idx + 1 : null,
    firstDate: days[0],
    lastDate: days[days.length - 1],
    newerDate: [...days].reverse().find((d) => d > cur) ?? null,
    olderDate: days.find((d) => d < cur) ?? null,
  };
}

// 시각을 Asia/Seoul 기준 YYYY-MM-DD 로 (DB 의 (created_at AT TIME ZONE 'Asia/Seoul')::date 와 같은 규칙)
export function kstDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 기준선 비교값
export function baselineDiff(legacyActive: number | null, represented: number, questionsTotal: number | null, problemLinks: number | null) {
  return {
    conceptsNotMigrated: Math.max(0, (legacyActive ?? 0) - represented),
    problemsNotLinked: (questionsTotal ?? 0) - (problemLinks ?? 0),
  };
}

// 이동 버튼 활성 조건: 대상이 있고 현재 날짜와 다를 때
export function canMoveTo(target: string | null, current: string | null): boolean {
  return target != null && target !== current;
}
