// Next.js 서버 시작 훅: 작업 이력 테이블을 보장하고, 이력이 비어 있으면 기준선 1건을 남긴다.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 서버 시작을 막지 않는다(기다리지 않음)
  void (async () => {
    try {
      const { ensureWorkLogTable, seedBaselineIfEmpty } = await import("@/lib/server/workLog");
      await ensureWorkLogTable();
      await seedBaselineIfEmpty();
    } catch (e) {
      console.error("[instrumentation] work_log 준비 실패", e);
    }
  })();
}
