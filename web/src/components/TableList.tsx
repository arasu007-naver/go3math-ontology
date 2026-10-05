"use client";

import { useState } from "react";
import TableRowModal from "./table-row-modal";

// DB 테이블 목록. 한 줄에 테이블 하나, 오른쪽 끝 '보기' 버튼이 내용 모달을 연다.
export default function TableList({ tables }: { tables: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <ul className="divide-y divide-white/5">
        {tables.map((t) => (
          <li key={t} className="flex items-center justify-between px-4 py-2.5">
            <span className="text-sm text-gray-200 font-mono">{t}</span>
            <button
              onClick={() => setOpen(t)}
              className="px-3 py-1 rounded-full text-xs font-semibold border border-orange-500/60 text-orange-400 hover:bg-orange-500/20"
            >
              보기
            </button>
          </li>
        ))}
      </ul>
      {open && <TableRowModal name={open} onClose={() => setOpen(null)} />}
    </>
  );
}
