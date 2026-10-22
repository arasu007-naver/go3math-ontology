// 임베딩(Gemini) · 1차 판정(Claude) · 교차검증(Gemini) + 비용 장부
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { cfg, out, PRICES, requireEnv } from "./config.mjs";
import { fetchJson, readJson, sha, withRetry, writeJson } from "./util.mjs";

// ---------- 비용 장부 (out/cost_ledger.json, 실행 간 누적) ----------
export class BudgetError extends Error {}

export const ledger = {
  file: out("cost_ledger.json"),
  data: null,
  load() {
    this.data ??= readJson(this.file, { total: 0, models: {} });
    this.data.stages ??= {}; // 단계별 비용 (embed / merge / judge)
    return this.data;
  },
  // u: { input, output, cacheRead, cacheWrite } (토큰 수). output 에 Gemini thinking 토큰 포함
  add(model, u, stage) {
    const d = this.load();
    const p = PRICES[model] ?? PRICES[cfg.models.judge];
    const cost =
      ((u.input ?? 0) * p.input + (u.output ?? 0) * (p.output ?? 0) +
        (u.cacheRead ?? 0) * (p.cacheRead ?? p.input) + (u.cacheWrite ?? 0) * (p.cacheWrite ?? p.input)) / 1e6;
    const m = (d.models[model] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
    m.calls++;
    for (const k of ["input", "output", "cacheRead", "cacheWrite"]) m[k] += u[k] ?? 0;
    m.cost += cost;
    d.total += cost;
    d.stages[stage] = (d.stages[stage] ?? 0) + cost;
    writeJson(this.file, d);
    return cost;
  },
  check() {
    if (this.load().total >= cfg.budgetUsd) throw new BudgetError(`누적 비용 $${this.data.total.toFixed(2)} 가 예산 $${cfg.budgetUsd} 에 도달해 중단합니다`);
  },
};

// ---------- 임베딩 (out/cache/embeddings.jsonl 에 캐시, 재실행 시 재사용) ----------
const embedCacheFile = out("cache/embeddings.jsonl");
let embedCache = null;

function loadEmbedCache() {
  if (embedCache) return embedCache;
  embedCache = new Map();
  if (fs.existsSync(embedCacheFile)) {
    for (const line of fs.readFileSync(embedCacheFile, "utf8").split("\n")) {
      if (!line) continue;
      const { k, v } = JSON.parse(line);
      embedCache.set(k, v);
    }
  }
  return embedCache;
}

export async function embed(texts) {
  const cache = loadEmbedCache();
  const key = (t) => sha(`${cfg.models.embed}\n${t}`);
  const missing = [...new Set(texts.filter((t) => !cache.has(key(t))))];
  if (missing.length) requireEnv("GEMINI_API_KEY");
  fs.mkdirSync(out("cache"), { recursive: true });
  for (let i = 0; i < missing.length; i += 100) {
    ledger.check();
    const batch = missing.slice(i, i + 100); // batchEmbedContents 는 요청당 100개까지
    const res = await withRetry(() =>
      fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.models.embed}:batchEmbedContents`, {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: batch.map((text) => ({
            model: `models/${cfg.models.embed}`,
            content: { parts: [{ text: text || "(내용 없음)" }] }, // 빈 텍스트는 API 가 거부한다
            taskType: "SEMANTIC_SIMILARITY",
          })),
        }),
      })
    );
    // 이 API 는 토큰 수를 돌려주지 않아 글자 수로 어림한다(한국어 약 2자/토큰)
    ledger.add(cfg.models.embed, { input: Math.ceil(batch.reduce((s, t) => s + t.length, 0) / 2) }, "embed");
    const lines = res.embeddings.map((e, j) => {
      cache.set(key(batch[j]), e.values);
      return JSON.stringify({ k: key(batch[j]), v: e.values });
    });
    fs.appendFileSync(embedCacheFile, lines.join("\n") + "\n");
    process.stdout.write(`  임베딩 ${Math.min(i + 100, missing.length)}/${missing.length}\r`);
  }
  return texts.map((t) => cache.get(key(t)));
}

// Gemini 는 가끔 객체 하나를 배열로 감싸 돌려준다([{…}]) → 벗긴다
const parseJson = (text) => {
  const v = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""));
  return Array.isArray(v) && v.length === 1 ? v[0] : v;
};

// ---------- Claude ----------
let anthropic;

export async function claudeJson({ system, user, schema, stage = "judge" }) {
  ledger.check();
  requireEnv("ANTHROPIC_API_KEY");
  // SDK 가 429·5xx 를 지수 백오프로 재시도. 워크스페이스에 묶이지 않은 키는 ANTHROPIC_WORKSPACE_ID 헤더가 필요하다
  anthropic ??= new Anthropic({
    maxRetries: 6,
    ...(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } } : {}),
  });
  const res = await anthropic.beta.messages.create({
    model: cfg.models.judge,
    max_tokens: 16000,
    ...(cfg.claudeFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort: cfg.effort, format: { type: "json_schema", schema } },
    // 공통 지침은 prompt caching (지침 길이가 모델 최소 캐시 길이보다 짧으면 캐시되지 않는다)
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  const u = res.usage;
  ledger.add(res.model, { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }, stage);
  if (res.stop_reason === "refusal") throw new Error(`Claude 거절 (${res.stop_details?.category ?? "?"})`);
  if (res.stop_reason === "max_tokens") throw new Error("Claude 응답이 max_tokens 에서 잘렸습니다");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: parseJson(text), model: res.model };
}

// ---------- Gemini ----------
export async function geminiJson({ system, user, stage = "judge" }) {
  ledger.check();
  requireEnv("GEMINI_API_KEY");
  const res = await withRetry(() =>
    fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.models.cross}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: cfg.geminiThinkingBudget } },
      }),
    })
  );
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  ledger.add(cfg.models.cross, {
    input: (u.promptTokenCount ?? 0) - cached,
    cacheRead: cached,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  }, stage);
  const cand = res.candidates?.[0];
  if (!cand?.content?.parts) throw new Error(`Gemini 응답 없음 (${cand?.finishReason ?? res.promptFeedback?.blockReason ?? "?"})`);
  const text = cand.content.parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
  return { data: parseJson(text), model: res.modelVersion ?? cfg.models.cross };
}
