# Go3 Math Ontology Design Spec

This document defines the design tokens, visual hierarchy, and UI rules for the Go3 Math Ontology web applications.

## Design Tokens

### Colors
- **Background**: `#0b0f19` (Deep Obsidian / Dark Navy)
- **Surface / Cards**: `rgba(255, 255, 255, 0.02)` with `backdrop-filter: blur(12px)` and `border: 1px solid rgba(255, 255, 255, 0.06)` (Glassmorphism)
- **Surface Elevated / Panels**: `#121824` / `#0d1117`
- **Primary Accent**: `#f97316` (Orange-500) to `#fbbf24` (Amber-400) gradient / orange accents
- **Secondary Accent**: `#3b82f6` (Blue-500) for controls and information
- **Success**: `#10b981` (Emerald-500)
- **Danger**: `#ef4444` (Red-500)
- **Text Main**: `#f3f4f6` (Light Gray / Off-white)
- **Text Muted**: `#9ca3af` / `#6b7280` (Medium Gray)
- **Text Subtle**: `#4b5563` (Dark Gray)

### Typography
- **Primary Font**: `"Plus Jakarta Sans", sans-serif`
- **Monospace Font**: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- **Math Rendering**: KaTeX with MathJax fallback styling, high readability, responsive overflow handling

### Shapes & Borders
- **Card Radius**: `rounded-2xl` (16px) or `rounded-3xl` (24px)
- **Control Radius**: `rounded-xl` (12px) / `rounded-lg` (8px) / `rounded-full` for chips
- **Borders**: Subtle translucent borders `border-white/10` or `border-white/5`

## Page Architecture: Markdown & LaTeX Viewer (`/md-viewer`)
- **Top Control Bar**:
  - Compact, single-row layout containing:
    - '파일 선택' button with custom styled button and hidden file input
    - File info badge / loaded indicator
    - URL input (`md file url text input`) with clear placeholder and paste support
    - 'Load' button with loading spinner state and CORS proxy fallback
    - Quick sample loader / action buttons (Clear, Copy, Download)
- **Editor Area (Top / Middle)**:
  - 24-line textarea with monospaced font, line numbers or compact header, character/line counters, and sync update triggers
- **Viewer Area (Bottom / Remaining Body)**:
  - Full-featured Markdown and LaTeX math viewer powered by `react-markdown`, `remark-math`, `rehype-katex`, and `remark-gfm`
  - KaTeX CSS styling loaded for crisp equation display (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`)
  - Auto-scrolling, clear headings, table rendering, code blocks, and math equation blocks
