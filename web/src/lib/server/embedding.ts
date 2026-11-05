// Gemini 임베딩 (scripts/migrate-math-concepts 와 같은 모델). batchEmbedContents 는 요청당 100개까지.
export const EMBED_MODEL = "gemini-embedding-001";

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 가 설정되지 않았습니다.");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        requests: batch.map((text) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType: "SEMANTIC_SIMILARITY" })),
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`Gemini 임베딩 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { embeddings: { values: number[] }[] };
    out.push(...data.embeddings.map((e) => e.values));
  }
  return out;
}
