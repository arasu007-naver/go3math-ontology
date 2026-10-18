import type { PageJsonItem } from "./types";

declare global {
  interface Window {
    MathJax?: {
      typesetPromise?: (els?: Element[]) => Promise<void>;
      typesetClear?: (els?: Element[]) => void;
      startup?: {
        promise?: Promise<void>;
      };
    };
  }
}

let typesetQueue: Promise<void> = Promise.resolve();

export function typeset(elements?: Element | Element[] | null) {
  if (!elements || typeof window === "undefined") return;
  const rawEls = Array.isArray(elements) ? elements : [elements];
  const els = rawEls.filter((el): el is Element => Boolean(el));
  if (els.length === 0) return;

  typesetQueue = typesetQueue
    .then(async () => {
      // 1. Wait for MathJax to initialize if not yet ready
      if (!window.MathJax?.typesetPromise) {
        if (window.MathJax?.startup?.promise) {
          await window.MathJax.startup.promise.catch(() => {});
        } else {
          // Poll up to 3 seconds for MathJax script to load and initialize
          await new Promise<void>((resolve) => {
            const start = Date.now();
            const interval = setInterval(() => {
              if (window.MathJax?.typesetPromise || Date.now() - start > 3000) {
                clearInterval(interval);
                resolve();
              }
            }, 50);
          });
        }
      }

      // 2. Typeset connected elements
      if (window.MathJax?.typesetPromise) {
        const connectedEls = els.filter((el) => el.isConnected);
        if (connectedEls.length > 0) {
          window.MathJax.typesetClear?.(connectedEls);
          await window.MathJax.typesetPromise(connectedEls).catch((err) => {
            console.warn("MathJax typeset error:", err);
          });
        }
      }
    })
    .catch((err) => {
      console.warn("MathJax queue error:", err);
    });
}

export function ensureMathDelimiters(str: string): string {
  if (!str) return "";
  const trimmed = str.trim();
  if (
    trimmed.startsWith("$") ||
    trimmed.startsWith("\\(") ||
    trimmed.startsWith("\\[") ||
    trimmed.startsWith("`")
  ) {
    return trimmed;
  }
  return `$${trimmed}$`;
}

export function itemBodyRaw(item: PageJsonItem) {
  if (item.html != null && String(item.html).length) return String(item.html);
  return String(item.content || "");
}

// ocr.html formatItemBodyForPreview 와 동일: HTML 본문은 그대로, 텍스트는 이스케이프 + 백틱 수식 강조
export function formatItemBodyForPreview(raw: string) {
  const body = raw == null ? "" : String(raw);
  if (!body) return '<span class="text-gray-500">(내용 없음)</span>';
  if (/<[a-zA-Z][\s\S]*>/.test(body.trim())) return body;
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return esc.replace(/`([^`]+)`/g, '<span class="math-expr">`$1`</span>');
}
