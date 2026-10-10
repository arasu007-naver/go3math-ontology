"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const NAV = [
  { href: "/", label: "도서 입력" },
  { href: "/network", label: "과목 그물" },
  { href: "/agent", label: "에이전트" },
  { href: "/tables", label: "테이블" },
  { href: "/md-viewer", label: "MD 뷰어" },
  { href: "/quiz-viewer", label: "퀴즈 뷰어" },
  { href: "/aside", label: "Aside" },
];

export default function AppHeader({ subtitle }: { subtitle: string }) {
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    api("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => {});
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <header className="border-b border-white/5 py-3 px-6 flex items-center justify-between shrink-0 glass sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center shadow-lg shadow-orange-500/20">
          <span className="text-white font-extrabold text-lg">Q</span>
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Go3 Math Ontology</h1>
          <p className="text-[9px] text-gray-500 font-medium">{subtitle}</p>
        </div>
        <nav className="flex items-center gap-1 ml-6">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                pathname === n.href ? "border-orange-500 bg-orange-500/20 text-orange-400" : "border-white/10 text-gray-400 hover:text-white"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-xs">
        {user && <span className="text-gray-400">{user.name}</span>}
        <button onClick={logout} className="px-3 py-1 rounded-full border border-white/10 text-gray-300 hover:bg-white/10 font-semibold">
          로그아웃
        </button>
      </div>
    </header>
  );
}
