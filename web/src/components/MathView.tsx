"use client";

import { useEffect, useRef } from "react";
import { typeset, ensureMathDelimiters } from "@/lib/format";

interface MathViewProps {
  text?: string | null;
  className?: string;
  isFormula?: boolean;
  inline?: boolean;
  as?: "span" | "div" | "p" | "h3" | "h4";
}

/**
 * MathView: Renders text containing LaTeX math ($...$, $$...$$, \\(...\\)) using MathJax.
 * By keeping React's children empty and setting textContent directly before typesetting,
 * this component prevents React DOM reconciliation conflicts and flickering.
 */
export default function MathView({
  text,
  className = "",
  isFormula = false,
  inline = false,
  as,
}: MathViewProps) {
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const raw = text == null ? "" : String(text);
    if (!raw.trim()) {
      el.textContent = "";
      return;
    }

    const content = isFormula ? ensureMathDelimiters(raw) : raw;
    el.textContent = content;
    typeset(el);
  }, [text, isFormula]);

  const Tag = as || (inline ? "span" : "div");

  return <Tag ref={containerRef as unknown as React.Ref<never>} className={className} />;
}
