import AppHeader from "@/components/AppHeader";
import GraphExplorer from "@/components/graph/GraphExplorer";

export default function GraphPage() {
  return (
    <>
      <AppHeader subtitle="Knowledge Graph 통합 시각화 (단원 · 수학 개념 · 교재 · 사전)" />
      <GraphExplorer />
    </>
  );
}

