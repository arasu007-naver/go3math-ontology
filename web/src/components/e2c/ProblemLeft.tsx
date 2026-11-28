"use client";

import MathView from "@/components/MathView";
import type { ProblemRowVM } from "@/lib/server/e2cQueries";

// 좌측: 메타, 문제, S번호가 붙은 해답(MathView), 이미지. 근거 단계를 고르면 해당 S행이 하이라이트된다.
export default function ProblemLeft({ row, highlight }: { row: ProblemRowVM; highlight: Set<string> }) {
  const m = row.meta;
  const meta = [m.year && `${m.year}년`, m.month && `${m.month}월`, m.exam, m.subject, m.number != null && `${m.number}번`, m.points != null && `${m.points}점`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex flex-col gap-1.5 text-xs" data-testid="e2c-left">
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
        <span className="font-mono text-gray-300">#{row.id}</span>
        <span>{meta}</span>
        {row.display.difficulty != null && <span>난이도 {row.display.difficulty}</span>}
        {row.display.curriculumType && <span>{row.display.curriculumType}</span>}
        {row.display.answer && <span>정답 {row.display.answer}</span>}
        {row.truncated && <span className="text-amber-300">잘림</span>}
        {row.skipped && <span className="text-red-300">본문 없음(skip)</span>}
      </div>
      <MathView text={row.problemText} className="text-gray-100 whitespace-pre-wrap" />
      {row.display.images.map((src) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className="max-h-48 rounded bg-white/90 self-start" loading="lazy" />
      ))}
      <div className="border-t border-white/10 pt-1 flex flex-col gap-0.5" data-testid="e2c-steps">
        {row.keySteps.map((s, i) => (
          <div key={`${s.id}${i}`} data-step={s.id} className={`flex gap-2 rounded px-1 ${highlight.has(s.id) ? "bg-yellow-400/20" : ""}`}>
            <span className="font-mono text-[10px] text-gray-500 w-7 shrink-0">{s.id}</span>
            <MathView text={s.text} className="text-gray-300" inline />
          </div>
        ))}
      </div>
    </div>
  );
}
