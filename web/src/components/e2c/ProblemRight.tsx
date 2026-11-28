"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ProblemRowVM } from "@/lib/server/e2cQueries";

export type UnitItem = { unitId: string; text: string; order: number; subjectId: string };
type Concept = { conceptId: string; text: string };

type UnitProposal = { model: string; ok: boolean; error?: string; unitIds: string[]; probs?: Record<string, number>; confidence: number | null; evidenceSteps: string[]; picked?: string | null; rule?: string };
type ConceptProposal = { model: string; ok: boolean; error?: string; primary: string | null; secondary: string[]; confidence: number | null; evidenceSteps: string[] };
type Tally = { agreement?: string; status?: string; counts?: Record<string, number>; flags?: string[] };
type Detail<P> = { options?: string[]; proposals?: P[]; tally?: Tally | null; grok?: Record<string, unknown> | null; shadow?: Record<string, unknown> | null };

const SOURCE: Record<string, string> = { majority: "다수결", grok: "Grok", manual: "수동" };
const STATUS: Record<string, string> = { auto: "자동", needs_review: "검토 필요", error: "오류", skipped_no_text: "본문 없음", overridden: "수정됨", confirmed: "확인됨", applied: "반영됨" };
const REVIEW = new Set(["unit_grok", "concept_grok", "two_models_only", "insufficient_models", "unit_tie", "unit_low_conf", "concept_low_conf", "unit_hint_conflict", "out_of_candidates", "truncated"]);
const AGREE: Record<string, string> = { "3/3": "3/3 일치", "2/3": "2/3 다수결", "2/2": "2/2 일치(두 모델)", none: "불일치", "1": "1개 성공", "0": "모두 실패" };
const MODELS = ["jev", "claude", "gemini"];
const pct = (n: number | null | undefined) => (n == null ? "-" : n.toFixed(2));

const Badge = ({ children, tone = "gray", testid }: { children: React.ReactNode; tone?: "gray" | "amber" | "emerald" | "sky" | "red"; testid?: string }) => {
  const c = { gray: "text-gray-300 border-white/10", amber: "text-amber-300 border-amber-400/30", emerald: "text-emerald-300 border-emerald-400/30", sky: "text-sky-300 border-sky-400/30", red: "text-red-300 border-red-400/30" }[tone];
  return (
    <span data-testid={testid} className={`px-1.5 py-0.5 rounded border text-[10px] ${c}`}>
      {children}
    </span>
  );
};

function Steps({ steps, onPick }: { steps: string[]; onPick: (s: string[]) => void }) {
  if (!steps.length) return <span className="text-gray-600">-</span>;
  return (
    <button className="text-sky-300 hover:underline" onClick={() => onPick(steps)} title="좌측 해답에서 근거 단계 표시">
      {steps.join(",")}
    </button>
  );
}

export default function ProblemRight({
  row,
  units,
  pilotMode,
  busy,
  onHighlight,
  onChanged,
}: {
  row: ProblemRowVM;
  units: UnitItem[];
  pilotMode: boolean;
  busy: boolean;
  onHighlight: (steps: string[]) => void;
  onChanged: () => void;
}) {
  const r = row.result;
  const unitD = (r?.unitDetail ?? null) as Detail<UnitProposal> | null;
  const conceptD = (r?.conceptDetail ?? null) as Detail<ConceptProposal> | null;
  const unitText = (id: string | null | undefined) => (id ? (units.find((u) => u.unitId === id)?.text ?? id) : "-");

  // 채택 단원의 개념(이름 표시용)
  const [labels, setLabels] = useState<{ unitId: string; map: Record<string, string> } | null>(null);
  const finalUnit = r?.finalUnitId ?? null;
  useEffect(() => {
    if (!finalUnit) return;
    let alive = true;
    api(`/api/e2c/concepts?unitId=${encodeURIComponent(finalUnit)}`)
      .then((x) => (x.ok ? x.json() : []))
      .then((cs: Concept[]) => alive && setLabels({ unitId: finalUnit, map: Object.fromEntries(cs.map((c) => [c.conceptId, c.text])) }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [finalUnit]);
  const conceptText = (id: string | null) => (id ? (labels?.unitId === finalUnit ? labels?.map[id] : undefined) ?? id : "-");

  if (!r) return <div className="text-xs text-gray-500" data-testid="e2c-right">아직 처리되지 않았습니다.</div>;
  const reasons = r.reasons ?? [];
  const calls = row.calls;

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="e2c-right">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge tone={r.status === "auto" || r.status === "confirmed" ? "emerald" : r.status === "error" ? "red" : "amber"} testid="e2c-status">
          {STATUS[r.status] ?? r.status}
        </Badge>
        {reasons.map((c) => (
          <Badge key={c} tone={REVIEW.has(c) ? "amber" : "gray"} testid="e2c-reason">
            {c}
          </Badge>
        ))}
        {r.error && <span className="text-red-300">{r.error}</span>}
      </div>

      <section className="rounded border border-white/10 p-2" data-testid="e2c-unit">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-200">단원</span>
          <span className="text-gray-100">{unitText(r.finalUnitId)}</span>
          {r.unitSource && (
            <Badge tone={r.unitSource === "majority" ? "emerald" : r.unitSource === "grok" ? "amber" : "sky"} testid="e2c-unit-source">
              {SOURCE[r.unitSource]}
              {r.unitRule ? ` · ${r.unitRule}` : ""}
            </Badge>
          )}
          {unitD?.tally?.agreement && <Badge testid="e2c-unit-agree">{AGREE[unitD.tally.agreement] ?? unitD.tally.agreement}</Badge>}
        </div>
        {unitD?.proposals && (
          <table className="w-full mt-1 text-[11px]">
            <thead className="text-gray-500 text-left">
              <tr>
                <th>모델</th>
                <th>관련 단원(확률)</th>
                <th>표(규칙)</th>
                <th>확신도</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => {
                const p = unitD.proposals!.find((x) => x.model === m);
                if (!p) return null;
                return (
                  <tr key={m} className={p.ok ? "" : "text-red-300/70"}>
                    <td className="pr-2">{m}</td>
                    <td className="pr-2">{p.ok ? p.unitIds.map((u) => `${u}${p.probs?.[u] != null ? `(${pct(p.probs[u])})` : ""}`).join(", ") : p.error}</td>
                    <td className="pr-2">{p.picked ? `${p.picked} (${p.rule})` : "-"}</td>
                    <td className="pr-2">{pct(p.confidence)}</td>
                    <td>
                      <Steps steps={p.evidenceSteps} onPick={onHighlight} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {unitD?.grok && (
          <div className="mt-1 text-[11px] text-amber-200" data-testid="e2c-unit-grok">
            Grok: {(unitD.grok.picked as string) ?? (unitD.grok.error as string) ?? "-"} (확신도 {pct(unitD.grok.confidence as number | null)})
          </div>
        )}
      </section>

      <section className="rounded border border-white/10 p-2" data-testid="e2c-concept">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-gray-200">개념</span>
          <span className="text-gray-100">주: {conceptText(r.primaryConceptId)}</span>
          {r.conceptSource && (
            <Badge tone={r.conceptSource === "majority" ? "emerald" : r.conceptSource === "grok" ? "amber" : "sky"} testid="e2c-concept-source">
              {SOURCE[r.conceptSource]}
            </Badge>
          )}
          {conceptD?.tally?.agreement && <Badge>{AGREE[conceptD.tally.agreement] ?? conceptD.tally.agreement}</Badge>}
          {r.rerunConcept && <Badge tone="amber">개념 재실행 대상</Badge>}
        </div>
        {r.secondaryConceptIds.length > 0 && <div className="text-gray-300 mt-0.5">보조: {r.secondaryConceptIds.map(conceptText).join(" / ")}</div>}
        {conceptD?.proposals && (
          <table className="w-full mt-1 text-[11px]">
            <thead className="text-gray-500 text-left">
              <tr>
                <th>모델</th>
                <th>주</th>
                <th>보조</th>
                <th>확신도</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => {
                const p = conceptD.proposals!.find((x) => x.model === m);
                if (!p) return null;
                return (
                  <tr key={m} className={p.ok ? "" : "text-red-300/70"}>
                    <td className="pr-2">{m}</td>
                    <td className="pr-2">{p.ok ? p.primary : p.error}</td>
                    <td className="pr-2">{p.secondary.join(", ") || "-"}</td>
                    <td className="pr-2">{pct(p.confidence)}</td>
                    <td>
                      <Steps steps={p.evidenceSteps} onPick={onHighlight} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {conceptD?.grok && (
          <div className="mt-1 text-[11px] text-amber-200">
            Grok: 주 {(conceptD.grok.primary as string) ?? (conceptD.grok.error as string) ?? "-"} / 보조 {((conceptD.grok.secondary as string[]) ?? []).join(", ") || "-"}
          </div>
        )}
      </section>

      {calls.length > 0 && (
        <div className="text-[10px] text-gray-500">
          호출 {calls.length}건 · ${calls.reduce((n, c) => n + c.costUsd, 0).toFixed(4)} · Batch {calls.filter((c) => c.batch).length}
        </div>
      )}

      <EditPanel row={row} units={units} pilotMode={pilotMode} busy={busy} onChanged={onChanged} />
    </div>
  );
}

// 수동 수정: 단원 선택, 주 1개 + 보조 ≤3 (선택한 단원의 개념만), 사유. 저장 → overridden, 확인 → confirmed. 파일럿 라벨 모드면 pilot_label 입력.
function EditPanel({ row, units, pilotMode, busy, onChanged }: { row: ProblemRowVM; units: UnitItem[]; pilotMode: boolean; busy: boolean; onChanged: () => void }) {
  const r = row.result!;
  const [open, setOpen] = useState(false);
  const base = pilotMode ? row.label : null;
  const [unitId, setUnitId] = useState(base?.unitId ?? r.finalUnitId ?? "");
  const [primary, setPrimary] = useState<string>(base?.primaryConceptId ?? r.primaryConceptId ?? "");
  const [secondary, setSecondary] = useState<string[]>(base?.secondaryConceptIds ?? r.secondaryConceptIds);
  const [reason, setReason] = useState("");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !unitId) return;
    let alive = true;
    api(`/api/e2c/concepts?unitId=${encodeURIComponent(unitId)}`)
      .then((x) => (x.ok ? x.json() : []))
      .then((cs: Concept[]) => alive && setConcepts(cs))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, unitId]);

  const send = async (url: string, method: string, body: unknown) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) setErr(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      else onChanged();
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string) =>
    setSecondary((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 3 ? s : [...s, id]));
  const field = "bg-transparent border border-white/10 rounded px-1 py-0.5 text-gray-200";
  const btn = "px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-200 hover:bg-white/10 disabled:opacity-40";
  const locked = r.status === "applied";

  return (
    <div className="rounded border border-white/10 p-2" data-testid="e2c-edit">
      <div className="flex items-center gap-2">
        <button className={btn} onClick={() => setOpen((v) => !v)} data-testid="e2c-edit-toggle">
          {pilotMode ? "파일럿 라벨" : "수동 수정"}
        </button>
        {!pilotMode && (
          <button className={btn} disabled={busy || saving || locked || !r.finalUnitId || !r.primaryConceptId} onClick={() => send("/api/e2c/confirm", "POST", { problemId: row.id })} data-testid="e2c-confirm">
            확인(Enter)
          </button>
        )}
        {row.label && <Badge tone="sky">라벨 있음</Badge>}
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          <label className="flex items-center gap-2">
            <span className="w-10 text-gray-400">단원</span>
            <select
              className={`${field} flex-1`}
              value={unitId}
              onChange={(e) => {
                setUnitId(e.target.value);
                setPrimary("");
                setSecondary([]);
              }}
              data-testid="e2c-unit-select"
            >
              <option value="" className="bg-[#0f1420]">
                선택
              </option>
              {units.map((u) => (
                <option key={u.unitId} value={u.unitId} className="bg-[#0f1420]">
                  {u.text}
                </option>
              ))}
            </select>
          </label>
          <div className="max-h-40 overflow-auto border border-white/10 rounded p-1" data-testid="e2c-concept-list">
            {concepts.map((c) => (
              <div key={c.conceptId} className="flex items-center gap-2" data-concept={c.conceptId}>
                <input type="radio" name={`primary-${row.id}`} checked={primary === c.conceptId} onChange={() => { setPrimary(c.conceptId); setSecondary((s) => s.filter((x) => x !== c.conceptId)); }} title="주 개념" />
                <input type="checkbox" checked={secondary.includes(c.conceptId)} disabled={primary === c.conceptId || (!secondary.includes(c.conceptId) && secondary.length >= 3)} onChange={() => toggle(c.conceptId)} title="보조 개념(최대 3)" />
                <span className="text-gray-200">{c.text}</span>
              </div>
            ))}
            {!concepts.length && <span className="text-gray-500">단원을 고르면 그 단원의 개념만 나옵니다.</span>}
          </div>
          {!pilotMode && <input className={field} placeholder="사유(필수)" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="e2c-reason-input" />}
          <div className="flex items-center gap-2">
            <button
              className={btn}
              disabled={saving || busy || locked || !unitId || (pilotMode ? !primary : !reason.trim())}
              onClick={() =>
                pilotMode
                  ? send("/api/e2c/pilot-label", "PUT", { problemId: row.id, unitId, primaryConceptId: primary, secondaryConceptIds: secondary })
                  : send("/api/e2c/override", "POST", {
                      problemId: row.id,
                      ...(unitId !== r.finalUnitId ? { unitId } : {}),
                      ...(primary ? { primaryConceptId: primary, secondaryConceptIds: secondary } : {}),
                      reason,
                    })
              }
              data-testid="e2c-save"
            >
              저장
            </button>
            {err && <span className="text-red-300">{err}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
