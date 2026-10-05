import AppHeader from "@/components/AppHeader";
import NodeCard from "@/components/NodeCard";

export default async function NodePage({ searchParams }: PageProps<"/node">) {
  const id = (await searchParams).id;
  return (
    <>
      <AppHeader subtitle="그래프 노드" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto glass rounded-2xl p-5">
          {typeof id === "string" ? <NodeCard id={id} /> : <p className="text-xs text-gray-500">id 가 없습니다.</p>}
        </div>
      </main>
    </>
  );
}
