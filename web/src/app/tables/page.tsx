import AppHeader from "@/components/AppHeader";
import TableList from "@/components/TableList";
import { listTables } from "@/lib/graphDb";
import { connection } from "next/server";

export default async function TablesPage() {
  await connection(); // 빌드 때가 아니라 요청 때 DB 를 읽는다
  const tables = await listTables();
  return (
    <>
      <AppHeader subtitle="DB 테이블" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto glass rounded-2xl">
          <TableList tables={tables} />
        </div>
      </main>
    </>
  );
}
