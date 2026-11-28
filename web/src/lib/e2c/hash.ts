import { createHash } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function problemHash(problemText: string, solutionText: string, meta: unknown): string {
  return sha256(`${problemText}\u0000${solutionText}\u0000${JSON.stringify(meta)}`);
}

// 모델 호출 멱등 키: problem.inputHash + stage + role + 정렬된 options + promptVersion + model (+ 판정 단계의 입력 요약)
export function callHash(p: {
  inputHash: string;
  stage: string;
  role: string;
  options: { id: string; text: string }[];
  promptVersion: string;
  model: string;
  context?: string;
}): string {
  const options = [...p.options].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((o) => [o.id, o.text]);
  return sha256(JSON.stringify([p.inputHash, p.stage, p.role, options, p.promptVersion, p.model, p.context ?? ""]));
}
