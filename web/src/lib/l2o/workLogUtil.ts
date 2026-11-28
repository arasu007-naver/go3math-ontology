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
