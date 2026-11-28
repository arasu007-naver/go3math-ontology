import AppHeader from "@/components/AppHeader";
import Exam2ConceptsClient from "@/components/e2c/Exam2ConceptsClient";
import { activeJobVM } from "@/lib/server/e2cService";
import { connection } from "next/server";

// 기출문제 → 단원 1개 → 개념 연동 검토 화면 (docs/specs/196.md)
export default async function Exam2ConceptsPage() {
  await connection(); // 요청 때 DB 를 읽는다
  const activeJob = await activeJobVM().catch(() => null);
  return (
    <>
      <AppHeader subtitle="Exam → Concepts" />
      <Exam2ConceptsClient activeJob={activeJob} />
    </>
  );
}
