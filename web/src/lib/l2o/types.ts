// legacy2ontology 화면·API 공용 타입 (specs/math_concepts2ontology.md 6장)
import type { SelectorName } from "./units";
export type { SelectorName };
export const SELECTORS: SelectorName[] = ["jev", "claude", "gemini"];

export type RowVM = {
  legacy: {
    id: number;
    title: string;
    statement: string; // HTML 을 걷어낸 본문. 수식은 backtick AsciiMath 그대로
    images: string[]; // 본문 <img hwp-img-id> 의 이미지 URL
    schoolType: string | null;
    mathField: string | null;
    isOn: boolean;
  };
  group?: { id: number; isRepresentative: boolean; representativeId: number; memberCount: number; status: string };
  votes: Partial<Record<SelectorName, { unitId: string | null; unitPath?: string; confidence: number | null; error?: string; at: string }>>;
  result?: {
    status: string;
    finalUnitId?: string;
    finalUnitPath?: string;
    suggestedUnitId?: string; // 검토 필요일 때 제안(2표 일치 단원, 없으면 최고 confidence)
    suggestedUnitPath?: string;
    agreeCount?: number;
    dryRunOnly: boolean;
    manual?: boolean; // 사람이 정한 단원(override)으로 KG 에 기록됨
  };
};

export type L2oStats = { groups: number; migrated: number; needsReview: number; bundleReview: number };

// 검토 보기: review = 단원 검토 필요(대표), bundle = 묶음 검토 필요(멤버 전부), excluded = 제외(is_on=0) 전부
export type ReviewView = "review" | "bundle" | "excluded";

export type ConceptsPage = { rows: RowVM[]; total: number; excludedCount: number; stats: L2oStats; page: number; pageSize: number; view?: ReviewView };

// 단원 선택 일괄 작업(job_run) 진행 상태
export type JobVM = {
  id: string;
  kind: string;
  dryRun: boolean;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  needsReview: number;
  failed: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};
