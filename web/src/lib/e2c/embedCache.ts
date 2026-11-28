import { sha256 } from "./hash.ts";

// 임베딩 캐시: sha256(model+text) → vector. 캐시에 없는 텍스트만 모아 한 번에 보낸다.
export interface EmbedStore {
  getMany(hashes: string[]): Promise<Map<string, number[]>>;
  putMany(entries: { hash: string; model: string; vector: number[] }[]): Promise<void>;
}

export function cachedEmbed(store: EmbedStore, embed: (texts: string[]) => Promise<number[][]>, model: string) {
  return async (texts: string[]): Promise<number[][]> => {
    const hashes = texts.map((t) => sha256(model + t));
    const have = await store.getMany([...new Set(hashes)]);
    const missing = [...new Set(hashes.filter((h) => !have.has(h)))];
    if (missing.length) {
      const first = new Map(hashes.map((h, i) => [h, texts[i]]));
      const vectors = await embed(missing.map((h) => first.get(h)!));
      const entries = missing.map((hash, i) => ({ hash, model, vector: vectors[i] }));
      await store.putMany(entries);
      for (const e of entries) have.set(e.hash, e.vector);
    }
    return hashes.map((h) => have.get(h)!);
  };
}
