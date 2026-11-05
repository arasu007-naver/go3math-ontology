import AppHeader from "@/components/AppHeader";
import Legacy2OntologyClient from "@/components/l2o/Legacy2OntologyClient";
import { getConceptsPage, getReviewPage } from "@/lib/server/l2oDb";
import { getActiveJob } from "@/lib/server/l2oJobs";
import { positionOf } from "@/lib/server/legacyDb";
import { connection } from "next/server";

const SIZES = [10, 20, 50, 100];

// legacy math_concepts → 2022 KG 단원 이전 (specs/math_concepts2ontology.md)
export default async function Legacy2OntologyPage({ searchParams }: PageProps<"/legacy2ontology">) {
  await connection(); // 요청 때 DB 를 읽는다
  const sp = await searchParams;
  const sizeParam = Number.parseInt(String(sp.size ?? "20"), 10);
  const size = SIZES.includes(sizeParam) ? sizeParam : 20;
  // ?focus=<legacy id> 이면 그 행이 있는 페이지를 연다 (비대표 멤버의 "→ 대표" 링크)
  const focus = Number.parseInt(String(sp.focus ?? ""), 10) || null;
  const page = focus
    ? Math.max(1, Math.ceil((await positionOf(focus)) / size))
    : Math.max(1, Number.parseInt(String(sp.page ?? "1"), 10) || 1);
  // ?view=review|bundle|excluded 이면 페이지 대신 해당 항목 전부
  const view = sp.view === "review" || sp.view === "bundle" || sp.view === "excluded" ? sp.view : null;
  const [data, activeJob] = await Promise.all([view ? getReviewPage(view) : getConceptsPage(page, size), getActiveJob()]);
  return (
    <>
      <AppHeader subtitle="Legacy → Ontology" />
      <Legacy2OntologyClient data={data} sizes={SIZES} focus={focus} activeJob={activeJob} />
    </>
  );
}
