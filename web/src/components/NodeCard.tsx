"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatItemBodyForPreview, typeset } from "@/lib/format";

type NodeView = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  out: { type: string; id: string; nodeType: string; label: string }[];
  in: { type: string; id: string; nodeType: string; label: string }[];
};

const TYPE_LABEL: Record<string, string> = {
  category: "최상위 카테고리",
  curriculum: "교육과정·과목",
  book: "도서",
  toc: "TOC 항목",
  page: "페이지",
  paragraph: "문단",
};

export const nodeHref = (id: string) => `/node?id=${encodeURIComponent(id)}`;

// 그래프 노드 하나의 내용(문단 본문, 페이지 이미지)과 연결을 보여 준다. 에이전트 결과 URL 이 여는 화면.
export default function NodeCard({ id, compact = false }: { id: string; compact?: boolean }) {
  const [node, setNode] = useState<NodeView | null | undefined>(undefined);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    api(`/api/graph/node?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => !cancelled && setNode(d.node ?? null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (node) typeset(body.current);
  }, [node]);

  if (node === undefined) return <p className="text-xs text-gray-500 animate-pulse">불러오는 중...</p>;
  if (node === null) return <p className="text-xs text-red-400">그래프에 없는 노드입니다: {id}</p>;

  const p = node.props;
  const title = String(p.name ?? p.title ?? p.label ?? (node.type === "page" ? `${p.page}p (${p.kind})` : node.type === "paragraph" ? `${p.kind} #${Number(p.idx) + 1}` : node.id));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-orange-400">{TYPE_LABEL[node.type] ?? node.type}</span>
        <span className="text-sm font-bold text-gray-100">{title}</span>
        {compact && (
          <Link href={nodeHref(node.id)} target="_blank" className="text-[10px] text-blue-400 underline ml-auto">
            새 창
          </Link>
        )}
      </div>
      <div ref={body}>
        {node.type === "paragraph" && (
          <div className="db-item-body text-xs p-3 rounded-xl bg-white/5 border border-white/5" dangerouslySetInnerHTML={{ __html: formatItemBodyForPreview(String(p.content ?? "")) }} />
        )}
        {node.type === "page" && typeof p.imageUrl === "string" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt={title} className={`rounded-xl border border-white/10 ${compact ? "max-h-80" : "max-h-[70vh]"}`} />
        )}
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-4 text-xs">
          {(["in", "out"] as const).map((dir) => (
            <div key={dir} className="space-y-1">
              <p className="text-[10px] font-bold text-gray-400">{dir === "in" ? "들어오는 관계" : "나가는 관계"}</p>
              {node[dir].length === 0 && <p className="text-gray-600">없음</p>}
              {node[dir].map((e) => (
                <Link key={`${e.type}${e.id}`} href={nodeHref(e.id)} className="block text-gray-300 hover:text-white">
                  <span className="text-gray-500 font-mono text-[10px]">{e.type}</span> {e.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
