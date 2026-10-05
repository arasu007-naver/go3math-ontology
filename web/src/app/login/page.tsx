"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `로그인 실패 (HTTP ${res.status})`);
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm glass rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center">
            <span className="text-white font-extrabold text-lg">Q</span>
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-100">Go3 Math Ontology</h1>
            <p className="text-[10px] text-gray-500">mentor.qoolla.com 에서 가상 계정 생성</p>
          </div>
        </div>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold text-gray-400">아이디(이메일)</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            className="w-full bg-[#121824] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold text-gray-400">비밀번호</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full bg-[#121824] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-gray-200 outline-none focus:border-orange-500"
          />
        </label>
        {error && <p className="text-xs text-red-400 font-semibold">{error}</p>}
        <button
          disabled={busy}
          className="w-full py-2 text-xs font-bold rounded-lg bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
        >
          {busy ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </main>
  );
}
