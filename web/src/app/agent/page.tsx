import AgentChat from "@/components/AgentChat";
import AppHeader from "@/components/AppHeader";

export default function AgentPage() {
  return (
    <>
      <AppHeader subtitle="그래프에 입력된 교재·과목만 근거로 답합니다" />
      <AgentChat />
    </>
  );
}
