import type { NextConfig } from "next";

// unlimited-ocr(FastAPI) API를 같은 오리진으로 프록시한다. 로그인 쿠키(unlimited_ocr_session)가 그대로 전달된다.
const OCR_BACKEND_URL = (process.env.OCR_BACKEND_URL || "http://localhost:8088").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/ocr/:path*", destination: `${OCR_BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
