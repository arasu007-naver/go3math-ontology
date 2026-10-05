import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Go3 Math Ontology · 도서 그래프 입력",
  description: "unlimited-ocr 페이지 JSON을 TOC 중심 knowledge graph에 넣는 입력 폼",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-screen flex flex-col overflow-hidden">
        {children}
        <Script id="mathjax-config" strategy="beforeInteractive">
          {`window.MathJax = {
            tex: { inlineMath: [['$', '$'], ['\\\\(', '\\\\)']] },
            asciimath: { delimiters: [['\`', '\`']] },
            loader: { load: ['input/asciimath', 'output/chtml'] }
          };`}
        </Script>
        <Script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/startup.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
