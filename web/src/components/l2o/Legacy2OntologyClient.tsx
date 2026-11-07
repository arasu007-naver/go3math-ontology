"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import MathView from "@/components/MathView";
import GroupEditDialog from "@/components/l2o/GroupEditDialog";
import JobProgress from "@/components/l2o/JobProgress";
import HistoryDialog from "@/components/l2o/HistoryDialog";
import MigrateAllDialog from "@/components/l2o/MigrateAllDialog";
import UnitDecisionDialog from "@/components/l2o/UnitDecisionDialog";
import { api } from "@/lib/api";
import {
  SELECTORS,
  type ConceptsPage,
  type JobVM,
  type RowVM,
  type SelectorName,
} from "@/lib/l2o/types";

const SCHOOL: Record<string, string> = {
  ELEMENTARY: "초등",
  MIDDLESCHOOL: "중등",
  HIGHSCHOOL: "고등",
};
const FILTERS = [
  { key: "all", label: "전체" },
  { key: "needs_review", label: "검토 필요" },
  { key: "error", label: "오류" },
  { key: "migrated", label: "이전됨" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

// 처음/끝 + 현재±radius, 사이는 …
export function pageItems(
  cur: number,
  last: number,
  radius = 2,
): (number | "…")[] {
  const out: (number | "…")[] = [];
  for (let p = 1; p <= last; p++) {
    if (p === 1 || p === last || Math.abs(p - cur) <= radius) out.push(p);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

type DedupeSummary = {
  groups: number;
  multiMemberGroups: number;
  needsReview: number;
  candidatePairs: number;
  jevMerged: number;
  jevReview: number;
  jevErrors: number;
  jevReused: number;
  locked: number;
};

export default function Legacy2OntologyClient({
  data,
  sizes,
  focus,
  activeJob,
}: {
  data: ConceptsPage;
  sizes: number[];
  focus: number | null;
  activeJob: JobVM | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [hovered, setHovered] = useState<number | null>(focus);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editGroup, setEditGroup] = useState<number | null>(null);
  const [mergeRep, setMergeRep] = useState<number | null>(null);

  // 5단계: 일괄 작업 진행 바. 새로고침 후에는 서버가 넘겨준 실행 중/일시정지 작업으로 복원
  const [job, setJob] = useState<JobVM | null>(activeJob);
  const [seenActiveId, setSeenActiveId] = useState(activeJob?.id ?? null);
  if ((activeJob?.id ?? null) !== seenActiveId) {
    setSeenActiveId(activeJob?.id ?? null);
    if (activeJob) setJob(activeJob);
  }
  const jobRunning = job?.status === "running";
  const jobLive = jobRunning || job?.status === "paused"; // 일시정지 직후에도 진행 중이던 배치가 끝나 숫자가 바뀐다
  const jobId = job?.id;
  // 실행 중·일시정지면 2초마다 진행률을 읽고, 처리 수가 바뀌면 표를 새로 그린다
  useEffect(() => {
    if (!jobLive || !jobId) return;
    let last = -1;
    const t = setInterval(async () => {
      const r = await api(`/api/l2o/jobs/${jobId}`).catch(() => null);
      if (!r?.ok) return;
      const j: JobVM = await r.json();
      setJob(j);
      if (j.processed !== last) {
        last = j.processed;
        router.refresh();
      }
    }, 2000);
    return () => clearInterval(t);
  }, [jobLive, jobId, router]);
  const controlJob = async (action: "pause" | "resume" | "cancel") => {
    if (!job) return;
    const d: JobVM | null = await post(
      `job:${action}`,
      `/api/l2o/jobs/${job.id}/${action}`,
    );
    if (d) setJob(d);
  };

  // ?focus 로 열린 경우 그 행으로 스크롤
  useEffect(() => {
    if (focus)
      document
        .querySelector(`[data-legacy-id="${focus}"]`)
        ?.scrollIntoView({ block: "center" });
  }, [focus, data]);

  const post = async (label: string, url: string, body?: unknown) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const r = await api(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `${label} 실패 (HTTP ${r.status})`);
      router.refresh();
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const runDedupe = async () => {
    const d: DedupeSummary | null = await post("중복제거", "/api/l2o/dedupe");
    if (d)
      setNotice(
        `중복제거 완료: 그룹 ${d.groups}개(2개 이상 ${d.multiMemberGroups}) · 묶음 검토 필요 ${d.needsReview} · 임베딩 후보 ${d.candidatePairs}쌍 → JEV 병합 ${d.jevMerged} / 검토 ${d.jevReview} / 오류 ${d.jevErrors} (저장된 판정 재사용 ${d.jevReused}) · 보존된(확정·수동) 개념 ${d.locked}`,
      );
  };

  const merge = async () => {
    const ids = [...selected];
    const rep = mergeRep && selected.has(mergeRep) ? mergeRep : ids[0];
    if (
      await post("묶기", "/api/l2o/dedupe/merge", {
        legacyIds: ids,
        representativeId: rep,
      })
    ) {
      setSelected(new Set());
      setNotice(`#${rep} 를 대표로 ${ids.length}개를 묶었습니다.`);
    }
  };
  // 단건 재선택 + 이전: 3/3 이면 KG 기록(이전됨), 아니면 검토 필요. force=true 면 저장된 표를 쓰지 않고 다시 호출
  const runOne = async (groupId: number, force: boolean) => {
    const d = await post(`run:${groupId}`, "/api/l2o/migrate-one", {
      groupId,
      force,
    });
    if (d)
      setNotice(
        `그룹 ${groupId}: ${STATUS_BADGE[d.status]?.label ?? d.status} (후보 ${d.candidateCount}개${d.candidateFallback ? ", 확장" : ""})`,
      );
  };
  // 테스트: 체크한 행이 있으면 그 행만, 없으면 현재 페이지. dry-run(KG 미기록)
  const runTest = async () => {
    const body = selected.size
      ? { ids: [...selected] }
      : { page: data.page, pageSize: data.pageSize };
    const d: JobVM | null = await post("테스트", "/api/l2o/test", body);
    if (d) {
      setJob(d);
      setSelected(new Set());
    }
  };
  const [migrateOpen, setMigrateOpen] = useState(false);
  // 7단계: 사람이 단원 결정/수정, 이력
  const [decide, setDecide] = useState<{
    groupId: number;
    title: string;
  } | null>(null);
  const [historyGroup, setHistoryGroup] = useState<number | null>(null);
  const runMigrateAll = async () => {
    const d: JobVM | null = await post("모두 이전", "/api/l2o/migrate-all", {
      confirm: true,
    });
    if (d) {
      setJob(d);
      setMigrateOpen(false);
    }
  };
  const focusOn = (id: number) => {
    const el = document.querySelector(`[data-legacy-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setHovered(id);
    } else
      router.push(
        `${pathname}?focus=${id}&size=${data.view ? 20 : data.pageSize}`,
      );
  };
  // 검토 보기 전환: 같은 버튼을 다시 누르면 전체 목록으로
  const view = data.view ?? null;
  const toggleView = (v: "review" | "bundle" | "excluded") => {
    setSelected(new Set());
    setFilter("all");
    router.push(
      view === v ? `${pathname}?page=1&size=20` : `${pathname}?view=${v}`,
    );
  };
  const confirmBundle = async (groupId: number) => {
    if (
      await post(`confirm:${groupId}`, "/api/l2o/dedupe/confirm", { groupId })
    )
      setNotice(`그룹 ${groupId}: 묶음이 맞다고 확인했습니다.`);
  };
  // 검토 필요: 핀 클릭 → 제안 단원으로 바로 결정(사유 없이, 즉시 KG 반영)
  const pinSuggested = async (groupId: number, unitId: string, unitPath: string) => {
    const d = await post(`pin:${groupId}`, "/api/l2o/override", { groupId, unitId });
    if (d)
      setNotice(
        `그룹 ${groupId}: ${unitPath} 로 결정 · KG ${d.kg.created ? "개념 생성" : "개념 갱신"} / 엣지 ${d.kg.edge}${d.kg.retiredEdges ? ` (비활성 ${d.kg.retiredEdges})` : ""}`,
      );
  };
  // 페이지 버튼이 한 줄에 안 들어가면 현재±2 → ±1 → ±0 으로 줄인다
  const pagRef = useRef<HTMLDivElement>(null);
  const [radius, setRadius] = useState(2);
  useLayoutEffect(() => {
    const el = pagRef.current;
    if (el && el.scrollWidth > el.clientWidth && radius > 0)
      setRadius(radius - 1);
  }, [radius, data.page, data.total, data.pageSize]);
  useEffect(() => {
    const el = pagRef.current?.parentElement; // 폭이 grid 로 정해지는 헤더 셀을 본다(내용 변화로는 안 바뀜)
    if (!el) return;
    const ro = new ResizeObserver(() => setRadius(2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  const go = (page: number, size = data.pageSize) => {
    setSelected(new Set());
    router.push(`${pathname}?page=${page}&size=${size}`);
  };
  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <main className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      {/* 상단 버튼 그룹 영역 */}
      <section className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-sm font-bold">
            Legacy math_concepts → 2022 KG 단원
          </h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            전체 {data.total} / 제외 {data.excludedCount} / 그룹{" "}
            {data.stats.groups} / 이전 {data.stats.migrated} / 검토{" "}
            {data.stats.needsReview}
          </p>
        </div>
        <div className="flex items-center gap-2" data-testid="action-buttons">
          <button
            onClick={() => toggleView("excluded")}
            title="제외(is_on=0)된 개념을 모두 보여 줍니다 (이전 대상 아님)"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              view === "excluded" ? "border-gray-300 bg-white/15 text-gray-100" : "border-white/20 text-gray-400 hover:bg-white/10"
            }`}
          >
            제외 {data.excludedCount}
          </button>
          <button
            onClick={() => toggleView("review")}
            title="단원이 검토 필요인 개념을 페이지와 상관없이 모두 보여 줍니다 ([단원 결정]으로 처리)"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              view === "review"
                ? "border-amber-400 bg-amber-500/20 text-amber-200"
                : "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            }`}
          >
            검토 필요 {data.stats.needsReview}
          </button>
          <button
            onClick={() => toggleView("bundle")}
            title="묶음이 확실하지 않은 그룹의 개념을 모두 보여 줍니다 ([그룹 편집]으로 분리·대표 변경, 맞으면 [묶음 맞음])"
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
              view === "bundle"
                ? "border-orange-400 bg-orange-500/20 text-orange-200"
                : "border-orange-500/40 text-orange-300 hover:bg-orange-500/10"
            }`}
          >
            묶음 검토 {data.stats.bundleReview}
          </button>
          <button
            onClick={runDedupe}
            disabled={!!busy}
            title="is_on=1 개념을 같은 개념끼리 묶습니다 (확정·수동 편집 그룹은 유지)"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-40"
          >
            {busy === "중복제거" ? "중복제거 중…" : "중복제거"}
          </button>
          <button
            onClick={runTest}
            disabled={!data.stats.groups || !!busy || jobLive}
            title={
              !data.stats.groups
                ? "먼저 중복제거를 실행하세요"
                : jobLive
                  ? "실행 중이거나 일시정지된 작업이 있습니다"
                  : "단원 선택만 실행합니다(KG 미기록). 체크한 행이 있으면 그 행만, 없으면 현재 페이지"
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-40"
          >
            {busy === "테스트"
              ? "시작 중…"
              : selected.size
                ? `테스트 (선택 ${selected.size})`
                : "테스트"}
          </button>
          <button
            onClick={() => setMigrateOpen(true)}
            disabled={!data.stats.groups || !!busy || jobLive}
            title={
              !data.stats.groups
                ? "먼저 중복제거를 실행하세요"
                : jobLive
                  ? "실행 중이거나 일시정지된 작업이 있습니다"
                  : "전체 그룹을 단원 선택 후 3/3 만 KG 에 기록"
            }
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-40"
          >
            모두 이전
          </button>
        </div>
      </section>

      {job && (
        <JobProgress
          job={job}
          busy={!!busy}
          onControl={controlJob}
          onClose={() => setJob(null)}
        />
      )}
      {decide && (
        <UnitDecisionDialog
          groupId={decide.groupId}
          title={decide.title}
          onClose={() => setDecide(null)}
          onDone={(msg) => {
            setDecide(null);
            setNotice(msg);
            router.refresh();
          }}
        />
      )}
      {historyGroup != null && (
        <HistoryDialog
          groupId={historyGroup}
          onClose={() => setHistoryGroup(null)}
        />
      )}
      {migrateOpen && (
        <MigrateAllDialog
          busy={busy === "모두 이전"}
          onClose={() => setMigrateOpen(false)}
          onConfirm={runMigrateAll}
        />
      )}

      {error && (
        <p className="shrink-0 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300 flex justify-between">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-200">
            닫기
          </button>
        </p>
      )}
      {notice && (
        <p className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-300 flex justify-between">
          {notice}
          <button
            onClick={() => setNotice(null)}
            className="ml-3 text-emerald-200"
          >
            닫기
          </button>
        </p>
      )}

      {/* 본문: 좌우 하나의 grid → 행 높이 자동 일치, 스크롤 1개 */}
      <section className="flex-1 min-h-0 overflow-y-auto glass rounded-2xl">
        <div className="grid grid-cols-2">
          <div className="sticky top-0 z-10 bg-[#0f1420] border-b border-r border-white/10 px-3 py-2 flex items-center justify-between gap-2">
            {view ? (
              <>
                <span
                  className="text-[11px] text-gray-300 truncate"
                  data-testid="review-header"
                >
                  {view === "review"
                    ? `검토 필요 ${data.rows.length}개`
                    : view === "bundle"
                      ? `묶음 검토 ${data.stats.bundleReview}개 그룹 · 개념 ${data.rows.length}개`
                      : `제외 ${data.rows.length}개`}
                  <span className="text-gray-500">
                    {view === "excluded" ? " · is_on=0, 이전 대상 아님" : " · 처리하면 목록에서 빠집니다"}
                  </span>
                </span>
                <button
                  onClick={() => router.push(`${pathname}?page=1&size=20`)}
                  className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-gray-300 hover:bg-white/10 shrink-0"
                >
                  전체 목록
                </button>
              </>
            ) : (
              <>
                <div
                  className="flex items-center gap-0.5 flex-nowrap overflow-hidden min-w-0"
                  data-testid="pagination"
                  ref={pagRef}
                >
                  <PageBtn
                    label="«"
                    disabled={data.page === 1}
                    onClick={() => go(1)}
                  />
                  <PageBtn
                    label="‹"
                    disabled={data.page === 1}
                    onClick={() => go(data.page - 1)}
                  />
                  {pageItems(data.page, lastPage, radius).map((p, i) =>
                    p === "…" ? (
                      <span
                        key={`e${i}`}
                        className="text-[11px] text-gray-500 shrink-0"
                      >
                        …
                      </span>
                    ) : (
                      <PageBtn
                        key={p}
                        label={String(p)}
                        active={p === data.page}
                        onClick={() => go(p)}
                      />
                    ),
                  )}
                  <PageBtn
                    label="›"
                    disabled={data.page === lastPage}
                    onClick={() => go(data.page + 1)}
                  />
                  <PageBtn
                    label="»"
                    disabled={data.page === lastPage}
                    onClick={() => go(lastPage)}
                  />
                </div>
                <select
                  value={data.pageSize}
                  onChange={(e) => go(1, Number(e.target.value))}
                  className="bg-transparent border border-white/10 rounded px-0.5 py-0.5 text-[11px] text-gray-300 shrink-0"
                >
                  {sizes.map((s) => (
                    <option key={s} value={s} className="bg-[#0f1420]">
                      {s}개
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <div className="sticky top-0 z-10 bg-[#0f1420] border-b border-white/10 px-3 py-2 flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                  filter === f.key
                    ? "border-orange-500 bg-orange-500/20 text-orange-400"
                    : "border-white/10 text-gray-400"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {data.rows.map((row) => {
            const id = row.legacy.id;
            const match =
              row.result?.status === filter ||
              (filter === "needs_review" &&
                row.group?.status === "needs_review");
            const dim = filter !== "all" && !match;
            const hl = hovered === id ? "bg-white/[0.04]" : "";
            const groupStart =
              view === "bundle" && row.group?.isRepresentative
                ? "border-t-2 border-t-orange-500/40"
                : "";
            const common = {
              "data-legacy-id": id,
              onMouseEnter: () => setHovered(id),
              onMouseLeave: () => setHovered(null),
            };
            return [
              <div
                key={`l${id}`}
                {...common}
                className={`border-b border-r border-white/5 px-3 py-2.5 ${groupStart} ${hl} ${dim ? "opacity-30" : ""}`}
              >
                <LeftConceptCell
                  row={row}
                  checked={selected.has(id)}
                  onCheck={() => toggle(id)}
                />
              </div>,
              <div
                key={`r${id}`}
                {...common}
                className={`border-b border-white/5 px-3 py-2.5 ${groupStart} ${hl} ${dim ? "opacity-30" : ""}`}
              >
                <RightResultCell
                  row={row}
                  onFocus={focusOn}
                  onEditGroup={setEditGroup}
                  onRunOne={runOne}
                  running={busy === `run:${row.group?.id}`}
                  locked={jobRunning}
                  onDecide={(groupId) =>
                    setDecide({ groupId, title: row.legacy.title })
                  }
                  onHistory={setHistoryGroup}
                  onConfirmBundle={confirmBundle}
                  onPinSuggested={pinSuggested}
                  pinning={busy === `pin:${row.group?.id}`}
                />
              </div>,
            ];
          })}
        </div>
        {data.rows.length === 0 && (
          <p className="p-6 text-center text-xs text-gray-500">
            {view === "excluded" ? "제외된 개념이 없습니다." : view ? "남은 검토 항목이 없습니다." : "이 쪽에 개념이 없습니다."}
          </p>
        )}
      </section>

      {/* SelectionActionBar: 선택 n개 → 같은 개념으로 묶기 */}
      {selected.size > 0 && (
        <section className="shrink-0 glass bg-[#0f1420] rounded-2xl px-4 py-2 flex items-center gap-3 text-xs">
          <span className="text-gray-300">선택 {selected.size}개</span>
          <label className="text-gray-400">
            대표{" "}
            <select
              value={
                mergeRep && selected.has(mergeRep) ? mergeRep : [...selected][0]
              }
              onChange={(e) => setMergeRep(Number(e.target.value))}
              className="bg-transparent border border-white/10 rounded px-1 py-0.5 text-gray-200"
            >
              {[...selected].map((id) => (
                <option key={id} value={id} className="bg-[#0f1420]">
                  #{id}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={merge}
            disabled={!!busy || selected.size < 2 || !data.stats.groups}
            title={data.stats.groups ? "" : "먼저 중복제거를 실행하세요"}
            className="px-3 py-1 rounded-lg font-semibold bg-orange-500/80 text-white disabled:opacity-40"
          >
            같은 개념으로 묶기
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-gray-400 hover:text-white"
          >
            선택 해제
          </button>
        </section>
      )}

      {editGroup != null && (
        <GroupEditDialog
          groupId={editGroup}
          onClose={() => setEditGroup(null)}
          onChanged={() => router.refresh()}
        />
      )}
    </main>
  );
}

function PageBtn({
  label,
  onClick,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`min-w-5 px-1 py-0.5 rounded text-[11px] font-semibold shrink-0 ${
        active ? "bg-orange-500 text-white" : "text-gray-300 hover:bg-white/10"
      } disabled:opacity-30 disabled:hover:bg-transparent`}
    >
      {label}
    </button>
  );
}

function Chip({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "orange" | "dim";
}) {
  const cls = {
    gray: "border-white/10 text-gray-300",
    orange: "border-orange-500/40 text-orange-300",
    dim: "border-gray-600 bg-gray-700/40 text-gray-400",
  }[tone];
  return (
    <span
      className={`px-1.5 py-px rounded border text-[10px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function LeftConceptCell({
  row,
  checked,
  onCheck,
}: {
  row: RowVM;
  checked: boolean;
  onCheck: () => void;
}) {
  const [open, setOpen] = useState(false);
  const c = row.legacy;
  const long = c.statement.length > 120 || c.statement.split("\n").length > 3;
  return (
    <div className="flex gap-2 min-w-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        disabled={!c.isOn}
        className="mt-1 accent-orange-500 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-gray-500 font-mono">#{c.id}</span>
          {c.schoolType && <Chip>{SCHOOL[c.schoolType] ?? c.schoolType}</Chip>}
          {c.mathField && <Chip>{c.mathField}</Chip>}
          {!c.isOn && <Chip tone="dim">제외</Chip>}
          {row.group?.isRepresentative && (
            <Chip tone="orange">★ 대표 · {row.group.memberCount}</Chip>
          )}
        </div>
        <MathView
          as="h4"
          text={c.title}
          className="text-xs font-semibold mt-1 text-gray-100"
        />
        <MathView
          text={c.statement}
          className={`text-[11px] text-gray-400 mt-0.5 whitespace-pre-line break-words ${open ? "" : "line-clamp-3"}`}
        />
        {long && (
          <button
            onClick={() => setOpen(!open)}
            className="text-[10px] text-orange-400 mt-0.5"
          >
            {open ? "접기" : "펼치기"}
          </button>
        )}
        {c.images.length > 0 && (
          <div className="flex gap-1 mt-1 flex-wrap">
            {c.images.map((src) => (
              <a key={src} href={src} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="h-12 rounded border border-white/10 bg-white"
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SELECTOR_LABEL: Record<SelectorName, string> = {
  jev: "JEV",
  claude: "Claude",
  gemini: "Gemini",
};
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  auto_agreed: {
    label: "자동일치 3/3",
    cls: "border-emerald-500/40 text-emerald-300",
  },
  needs_review: {
    label: "검토 필요",
    cls: "border-amber-500/40 text-amber-300",
  },
  overridden: { label: "수동", cls: "border-sky-500/40 text-sky-300" },
  migrated: {
    label: "이전됨",
    cls: "border-emerald-500/60 bg-emerald-500/10 text-emerald-300",
  },
  error: { label: "오류", cls: "border-red-500/40 text-red-300" },
};
const shortPath = (p?: string) => (p ? p.split(" > ").slice(-1)[0] : "");

function StatusBadge({ result }: { result: NonNullable<RowVM["result"]> }) {
  const b = STATUS_BADGE[result.status];
  if (!b) return null;
  return (
    <>
      <span
        className={`px-1.5 py-px rounded border text-[10px] font-semibold ${b.cls}`}
      >
        {b.label}
      </span>
      {result.dryRunOnly && (
        <span className="px-1.5 py-px rounded border border-white/20 text-[10px] text-gray-300">
          테스트
        </span>
      )}
      {result.manual && (
        <span
          className={`px-1.5 py-px rounded border text-[10px] font-semibold ${STATUS_BADGE.overridden.cls}`}
        >
          수동
        </span>
      )}
    </>
  );
}

// 3표 칩: 단원 경로 축약 · confidence %, 오류면 빨강 + 툴팁
function VoteChips({ votes }: { votes: RowVM["votes"] }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {SELECTORS.map((s) => {
        const v = votes[s];
        if (!v)
          return (
            <span
              key={s}
              className="px-1.5 py-px rounded border border-white/10 text-[10px] text-gray-500"
            >
              {SELECTOR_LABEL[s]} –
            </span>
          );
        if (v.error)
          return (
            <span
              key={s}
              title={v.error}
              className="px-1.5 py-px rounded border border-red-500/40 text-[10px] text-red-300"
            >
              {SELECTOR_LABEL[s]} ⚠ 오류
            </span>
          );
        return (
          <span
            key={s}
            title={v.unitPath ?? v.unitId ?? "판단 불가"}
            className="px-1.5 py-px rounded border border-white/10 text-[10px] text-gray-200"
          >
            {SELECTOR_LABEL[s]} ·{" "}
            {v.unitId ? shortPath(v.unitPath) || v.unitId : "판단 불가"}
            {v.confidence != null && (
              <span className="text-gray-500">
                {" "}
                {Math.round(v.confidence * 100)}%
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

// 제외 / 중복제거 전 / 병합된 멤버 / 대표(3표 · 최종 단원 · 상태 · 실행)
function RightResultCell({
  row,
  onFocus,
  onEditGroup,
  onRunOne,
  running,
  locked,
  onDecide,
  onHistory,
  onConfirmBundle,
  onPinSuggested,
  pinning,
}: {
  row: RowVM;
  onFocus: (id: number) => void;
  onEditGroup: (groupId: number) => void;
  onRunOne: (groupId: number, force: boolean) => void;
  running: boolean;
  locked: boolean; // 일괄 작업 실행 중에는 단건 실행·단원 결정을 막는다
  onDecide: (groupId: number) => void;
  onHistory: (groupId: number) => void;
  onConfirmBundle: (groupId: number) => void;
  onPinSuggested: (groupId: number, unitId: string, unitPath: string) => void;
  pinning: boolean;
}) {
  if (!row.legacy.isOn)
    return (
      <p className="text-[11px] text-gray-500">
        제외됨 · 제외 이유: <code className="text-gray-400">is_on=0</code> (원본 MariaDB)
      </p>
    );
  const g = row.group;
  if (!g) return <p className="text-[11px] text-gray-500">중복제거 전</p>;
  const r = row.result;
  const btn =
    "px-2 py-0.5 rounded border border-white/10 text-[10px] text-gray-300 hover:bg-white/10 disabled:opacity-40";
  const editBtn = (
    <button onClick={() => onEditGroup(g.id)} className={btn}>
      그룹 편집
    </button>
  );
  const unitLine = r?.finalUnitId ? (
    <span className="text-gray-100">
      최종: {r.finalUnitPath ?? r.finalUnitId}
    </span>
  ) : r?.suggestedUnitId ? (
    <span className="text-amber-200 inline-flex items-center gap-1">
      제안: {r.suggestedUnitPath ?? r.suggestedUnitId}
      {g.isRepresentative && r.status === "needs_review" && (
        <button
          onClick={() =>
            onPinSuggested(g.id, r.suggestedUnitId!, r.suggestedUnitPath ?? r.suggestedUnitId!)
          }
          disabled={running || locked || pinning}
          title="제안 단원으로 결정 (즉시 KG 반영)"
          className="p-0.5 rounded text-amber-300 hover:bg-amber-500/20 hover:text-amber-100 disabled:opacity-40"
        >
          <Pin size={12} />
        </button>
      )}
    </span>
  ) : null;

  if (!g.isRepresentative)
    return (
      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onFocus(g.representativeId)}
            className="text-orange-300 hover:underline"
          >
            → 대표 #{g.representativeId}로 병합됨
          </button>
          {g.status === "needs_review" && (
            <Chip tone="orange">묶음 검토 필요</Chip>
          )}
          {editBtn}
        </div>
        {unitLine && <div className="text-gray-400">{unitLine}</div>}
      </div>
    );

  const pending = !r || r.status === "pending";
  return (
    <div className="flex flex-col gap-1 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        {pending ? (
          <span className="text-gray-400">단원 미선택</span>
        ) : (
          <StatusBadge result={r} />
        )}
        {g.memberCount > 1 && <Chip>{g.memberCount}개 묶음</Chip>}
        {g.status === "needs_review" && (
          <>
            <Chip tone="orange">묶음 검토 필요</Chip>
            <button
              onClick={() => onConfirmBundle(g.id)}
              disabled={running || locked}
              title="자동으로 묶은 개념들이 같은 개념이 맞으면 확인합니다(단원 결과·KG 는 그대로)"
              className="px-2 py-0.5 rounded border border-orange-500/50 text-[10px] text-orange-200 hover:bg-orange-500/10 disabled:opacity-40"
            >
              묶음 맞음
            </button>
          </>
        )}
        {g.status === "confirmed" && <Chip>확정</Chip>}
      </div>
      {!pending && <VoteChips votes={row.votes} />}
      {unitLine && <div>{unitLine}</div>}
      <div className="flex items-center gap-1.5 flex-wrap">
        {pending ? (
          <button
            onClick={() => onRunOne(g.id, false)}
            disabled={running || locked}
            className={btn}
          >
            {running ? "실행 중…" : "이 개념만 실행"}
          </button>
        ) : (
          <>
            <button
              onClick={() => onDecide(g.id)}
              disabled={running || locked}
              className={
                r.status === "needs_review"
                  ? "px-2 py-0.5 rounded border border-amber-500/50 text-[10px] text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
                  : btn
              }
            >
              {r.status === "needs_review" ? "단원 결정" : "단원 수정"}
            </button>
            <button
              onClick={() => onRunOne(g.id, true)}
              disabled={
                running ||
                locked ||
                r.status === "overridden" ||
                r.status === "migrated"
              }
              className={btn}
            >
              {running ? "실행 중…" : "재선택"}
            </button>
            <button onClick={() => onHistory(g.id)} className={btn}>
              이력
            </button>
          </>
        )}
        {editBtn}
      </div>
    </div>
  );
}
