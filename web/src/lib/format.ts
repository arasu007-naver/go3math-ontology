import type { PageJsonItem } from "./types";

declare global {
  interface Window {
    MathJax?: { typesetPromise?: (els?: Element[]) => Promise<void>; typesetClear?: (els?: Element[]) => void };
  }
}

export function typeset(el: Element | null) {
  if (!el || !window.MathJax?.typesetPromise) return;
  window.MathJax.typesetClear?.([el]);
  window.MathJax.typesetPromise([el]).catch(() => {});
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
